begin;

alter table public.avatars drop constraint if exists avatars_status_check;
alter table public.avatars add constraint avatars_status_check
  check (status in ('collecting_photos', 'generation_queued', 'generating', 'ready', 'failed'));

create or replace function public.claim_generation_job(p_worker_id text, p_lease_seconds integer default 120)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or length(p_worker_id) not between 1 and 120 then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;

  update public.generation_jobs
  set status = 'failed',
      safe_error = 'The job exceeded its retry limit.',
      locked_by = null,
      locked_until = null,
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where status = 'processing'
    and locked_until < pg_catalog.now()
    and attempts >= max_attempts;

  return query
  with candidate as (
    select j.id
    from public.generation_jobs as j
    where j.attempts < j.max_attempts
      and j.available_at <= pg_catalog.now()
      and (j.status = 'queued' or (j.status = 'processing' and j.locked_until < pg_catalog.now()))
      and j.kind = 'avatar_generation'
    order by j.created_at
    for update skip locked
    limit 1
  )
  update public.generation_jobs as j
  set status = 'processing',
      attempts = j.attempts + 1,
      locked_by = p_worker_id,
      locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
      progress = 0,
      safe_error = null,
      updated_at = pg_catalog.now()
  from candidate
  where j.id = candidate.id
  returning j.*;

  update public.avatars a
  set status = 'generating', updated_at = pg_catalog.now()
  where a.id in (
    select j.avatar_id from public.generation_jobs j
    where j.locked_by = p_worker_id and j.status = 'processing' and j.updated_at >= pg_catalog.now() - interval '2 seconds'
  );
end;
$$;

create or replace function public.complete_avatar_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_owner_id uuid,
  p_avatar_id uuid,
  p_object_key text,
  p_content_type text,
  p_provider text,
  p_model text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_object_key is null or p_object_key not like p_owner_id::text || '/' || p_avatar_id::text || '/%' then
    raise exception 'invalid generated object key' using errcode = '22023';
  end if;
  if p_content_type not in ('image/jpeg', 'image/png') then
    raise exception 'invalid generated content type' using errcode = '22023';
  end if;

  insert into public.avatar_assets (owner_id, avatar_id, job_id, kind, content_type, object_key, provider, model)
  values (p_owner_id, p_avatar_id, p_job_id, 'image_2d', p_content_type, p_object_key, p_provider, p_model);

  update public.generation_jobs
  set status = 'succeeded', progress = 100, output = jsonb_build_object('object_key', p_object_key, 'content_type', p_content_type),
      locked_by = null, locked_until = null, completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_job_id and owner_id = p_owner_id and avatar_id = p_avatar_id and status = 'processing' and locked_by = p_worker_id;
  if not found then raise exception 'generation job is not owned by worker' using errcode = '42501'; end if;

  update public.avatars set status = 'ready', updated_at = pg_catalog.now()
  where id = p_avatar_id and owner_id = p_owner_id;
end;
$$;

create or replace function public.fail_avatar_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_safe_error text,
  p_retryable boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  job_row public.generation_jobs;
  next_status text;
begin
  select * into job_row from public.generation_jobs
  where id = p_job_id and status = 'processing' and locked_by = p_worker_id
  for update;
  if not found then raise exception 'generation job is not owned by worker' using errcode = '42501'; end if;

  next_status := case when p_retryable and job_row.attempts < job_row.max_attempts then 'queued' else 'failed' end;
  update public.generation_jobs
  set status = next_status,
      available_at = case when next_status = 'queued' then pg_catalog.now() + pg_catalog.make_interval(secs => least(300, greatest(5, attempts * 10))) else available_at end,
      safe_error = left(coalesce(p_safe_error, 'The generation provider failed.'), 500),
      locked_by = null, locked_until = null,
      completed_at = case when next_status = 'failed' then pg_catalog.now() else null end,
      updated_at = pg_catalog.now()
  where id = p_job_id;

  update public.avatars set status = case when next_status = 'queued' then 'generation_queued' else 'failed' end, updated_at = pg_catalog.now()
  where id = job_row.avatar_id and owner_id = job_row.owner_id;
end;
$$;

revoke all on function public.complete_avatar_generation_job(uuid, text, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_avatar_generation_job(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_avatar_generation_job(uuid, text, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.fail_avatar_generation_job(uuid, text, text, boolean) to service_role;

commit;
