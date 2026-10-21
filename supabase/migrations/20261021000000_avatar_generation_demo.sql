begin;

alter table public.avatars drop constraint if exists avatars_status_check;
alter table public.avatars add constraint avatars_status_check
  check (status in ('collecting_photos', 'generation_queued', 'generating', 'ready', 'failed'));

create unique index if not exists generation_jobs_active_avatar_generation_idx
  on public.generation_jobs (avatar_id)
  where kind = 'avatar_generation' and status in ('queued', 'processing');

create or replace function public.enqueue_avatar_generation_job(
  p_owner_id uuid,
  p_avatar_id uuid,
  p_idempotency_key text
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  avatar_row public.avatars;
  existing_job public.generation_jobs;
  created_job_id uuid;
  photo_count integer;
  view_count integer;
  invalid_photo boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_avatar_id is null or p_idempotency_key is null
     or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'invalid generation request' using errcode = '22023';
  end if;
  select * into avatar_row from public.avatars
  where id = p_avatar_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'avatar not found' using errcode = 'P0002';
  end if;
  select * into existing_job from public.generation_jobs
  where owner_id = p_owner_id and idempotency_key = p_idempotency_key
  order by created_at desc limit 1;
  if found then
    if existing_job.kind <> 'avatar_generation' or existing_job.avatar_id <> p_avatar_id then
      raise exception 'generation idempotency key conflict' using errcode = '23505';
    end if;
    return query select existing_job.*;
    return;
  end if;
  if avatar_row.status <> 'collecting_photos' then
    raise exception 'avatar is not ready for generation' using errcode = '23505';
  end if;
  select count(*), count(distinct view), bool_or(
    storage_object_key not like p_owner_id::text || '/' || p_avatar_id::text || '/%'
  ) into photo_count, view_count, invalid_photo
  from public.avatar_photos where owner_id = p_owner_id and avatar_id = p_avatar_id;
  if photo_count <> 4 or view_count <> 4 or coalesce(invalid_photo, false)
     or exists (select 1 from public.avatar_photos
       where owner_id = p_owner_id and avatar_id = p_avatar_id
         and view not in ('front', 'left', 'right', 'back')) then
    raise exception 'all four owner-scoped source photos are required' using errcode = '23514';
  end if;
  insert into public.generation_jobs (owner_id, avatar_id, kind, idempotency_key, input)
  values (
    p_owner_id, p_avatar_id, 'avatar_generation', p_idempotency_key,
    jsonb_build_object('photoObjectKeys', (
      select jsonb_object_agg(view, storage_object_key)
      from public.avatar_photos where owner_id = p_owner_id and avatar_id = p_avatar_id
    ))
  ) returning id into created_job_id;
  update public.avatars set status = 'generation_queued', updated_at = pg_catalog.now()
  where id = p_avatar_id and owner_id = p_owner_id;
  return query select j.* from public.generation_jobs j where j.id = created_job_id;
end;
$$;
revoke all on function public.enqueue_avatar_generation_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_avatar_generation_job(uuid, uuid, text) to service_role;

create or replace function public.claim_generation_job(p_worker_id text, p_lease_seconds integer default 120)
returns setof public.generation_jobs
language plpgsql security definer set search_path = ''
as $$
declare
  claimed_id uuid;
  claimed_avatar_id uuid;
  claimed_owner_id uuid;
  expired_job record;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or length(p_worker_id) not between 1 and 120 then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;
  for expired_job in
    select j.id, j.avatar_id, j.owner_id
    from public.generation_jobs j
    where j.kind = 'avatar_generation' and j.status = 'processing'
      and j.locked_until < pg_catalog.now() and j.attempts >= j.max_attempts
    order by j.created_at
    for update skip locked
  loop
    update public.generation_jobs set status = 'failed', safe_error = 'The job exceeded its retry limit.',
      locked_by = null, locked_until = null, completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where id = expired_job.id;
    update public.avatars set status = 'failed', updated_at = pg_catalog.now()
    where id = expired_job.avatar_id and owner_id = expired_job.owner_id;
  end loop;
  select j.id, j.avatar_id, j.owner_id into claimed_id, claimed_avatar_id, claimed_owner_id
  from public.generation_jobs j
  where j.kind = 'avatar_generation' and j.attempts < j.max_attempts
    and j.available_at <= pg_catalog.now()
    and (j.status = 'queued' or (j.status = 'processing' and j.locked_until < pg_catalog.now()))
  order by j.created_at for update skip locked limit 1;
  if claimed_id is null then return; end if;
  update public.generation_jobs set status = 'processing', attempts = attempts + 1,
    locked_by = p_worker_id,
    locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
    progress = 0, safe_error = null, updated_at = pg_catalog.now()
  where id = claimed_id;
  update public.avatars set status = 'generating', updated_at = pg_catalog.now()
  where id = claimed_avatar_id and owner_id = claimed_owner_id;
  return query select j.* from public.generation_jobs j where j.id = claimed_id;
end;
$$;

create or replace function public.renew_avatar_generation_job(p_job_id uuid, p_worker_id text, p_lease_seconds integer default 120)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.generation_jobs set locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(30, least(p_lease_seconds, 600))), updated_at = pg_catalog.now()
  where id = p_job_id and kind = 'avatar_generation' and status = 'processing'
    and locked_by = p_worker_id and locked_until > pg_catalog.now();
  return found;
end;
$$;

create or replace function public.complete_avatar_generation_job(
  p_job_id uuid, p_worker_id text, p_owner_id uuid, p_avatar_id uuid,
  p_object_key text, p_content_type text, p_provider text, p_model text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare job_row public.generation_jobs;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_object_key is null or p_object_key not like p_owner_id::text || '/' || p_avatar_id::text || '/%'
     or p_content_type not in ('image/jpeg', 'image/png') then
    raise exception 'invalid generated asset' using errcode = '22023';
  end if;
  select * into job_row from public.generation_jobs
  where id = p_job_id and kind = 'avatar_generation' and status = 'processing'
    and locked_by = p_worker_id and locked_until > pg_catalog.now() for update;
  if not found or job_row.owner_id <> p_owner_id or job_row.avatar_id <> p_avatar_id then
    raise exception 'generation job lease is invalid' using errcode = '42501';
  end if;
  insert into public.avatar_assets (owner_id, avatar_id, job_id, kind, content_type, object_key, provider, model)
  values (p_owner_id, p_avatar_id, p_job_id, 'image_2d', p_content_type, p_object_key, p_provider, p_model);
  update public.generation_jobs set status = 'succeeded', progress = 100,
    output = jsonb_build_object('object_key', p_object_key, 'content_type', p_content_type),
    locked_by = null, locked_until = null, completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_job_id;
  update public.avatars set status = 'ready', updated_at = pg_catalog.now()
  where id = p_avatar_id and owner_id = p_owner_id;
end;
$$;

create or replace function public.fail_avatar_generation_job(p_job_id uuid, p_worker_id text, p_safe_error text, p_retryable boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare job_row public.generation_jobs; next_status text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into job_row from public.generation_jobs
  where id = p_job_id and kind = 'avatar_generation' and status = 'processing'
    and locked_by = p_worker_id and locked_until > pg_catalog.now() for update;
  if not found then raise exception 'generation job lease is invalid' using errcode = '42501'; end if;
  next_status := case when p_retryable and job_row.attempts < job_row.max_attempts then 'queued' else 'failed' end;
  update public.generation_jobs set status = next_status,
    available_at = case when next_status = 'queued' then pg_catalog.now() + pg_catalog.make_interval(secs => least(300, greatest(5, attempts * 10))) else available_at end,
    safe_error = left(coalesce(p_safe_error, 'The generation provider failed.'), 500),
    locked_by = null, locked_until = null,
    completed_at = case when next_status = 'failed' then pg_catalog.now() else null end,
    updated_at = pg_catalog.now() where id = p_job_id;
  update public.avatars set status = case when next_status = 'queued' then 'generation_queued' else 'failed' end, updated_at = pg_catalog.now()
  where id = job_row.avatar_id and owner_id = job_row.owner_id;
end;
$$;

drop policy if exists generated_media_read_owner on storage.objects;
create policy generated_media_read_owner on storage.objects for select to authenticated
using (bucket_id = 'generated-media' and exists (
  select 1 from public.generation_jobs j where j.owner_id = (select auth.uid())
    and (j.output ->> 'object_key') = storage.objects.name
));
drop policy if exists generated_storage_select_guard on storage.objects;
create policy generated_storage_select_guard on storage.objects as restrictive for select to public
using (bucket_id <> 'generated-media' or exists (
  select 1 from public.generation_jobs j where j.owner_id = (select auth.uid())
    and (j.output ->> 'object_key') = storage.objects.name
));

revoke all on function public.claim_generation_job(text, integer) from public, anon, authenticated;
revoke all on function public.renew_avatar_generation_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_avatar_generation_job(uuid, text, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_avatar_generation_job(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_generation_job(text, integer) to service_role;
grant execute on function public.renew_avatar_generation_job(uuid, text, integer) to service_role;
grant execute on function public.complete_avatar_generation_job(uuid, text, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.fail_avatar_generation_job(uuid, text, text, boolean) to service_role;
commit;
