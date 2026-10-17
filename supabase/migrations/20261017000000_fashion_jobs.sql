begin;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) between 1 and 80),
  role text not null default 'customer' check (role in ('customer', 'designer', 'admin')),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(name) between 1 and 120),
  description text check (description is null or length(description) <= 4000),
  logo_object_key text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.garments (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.profiles (id) on delete cascade,
  brand_id uuid not null,
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 8000),
  category text not null check (category in ('tops', 'bottoms', 'dresses', 'outerwear', 'shoes', 'accessories')),
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  tags text[] not null default '{}',
  materials text[] not null default '{}',
  care_instructions text,
  price_minor integer check (price_minor is null or price_minor >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  image_object_key text not null,
  model_3d_object_key text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garments_brand_owner_fk
    foreign key (brand_id, designer_id)
    references public.brands (id, owner_id)
    on delete cascade,
  unique (id, designer_id),
  check (model_3d_object_key is null or model_3d_object_key like designer_id::text || '/%')
);

create index garments_catalog_idx on public.garments (status, category, created_at desc);
create index garments_designer_idx on public.garments (designer_id, status, created_at desc);
create index garments_brand_idx on public.garments (brand_id, status);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 8000),
  cover_object_key text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_brand_owner_fk
    foreign key (brand_id, owner_id)
    references public.brands (id, owner_id)
    on delete cascade,
  unique (id, owner_id)
);

create table public.collection_garments (
  collection_id uuid not null,
  garment_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  primary key (collection_id, garment_id),
  foreign key (collection_id, owner_id)
    references public.collections (id, owner_id) on delete cascade,
  foreign key (garment_id, owner_id)
    references public.garments (id, designer_id) on delete cascade
);

create table public.garment_favorites (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  garment_id uuid not null references public.garments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, garment_id)
);

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  avatar_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  description text check (description is null or length(description) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (avatar_id, owner_id)
    references public.avatars (id, owner_id) on delete cascade,
  unique (id, owner_id)
);

create table public.outfit_items (
  outfit_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  garment_id uuid not null references public.garments (id) on delete restrict,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (outfit_id, garment_id),
  foreign key (outfit_id, owner_id)
    references public.outfits (id, owner_id) on delete cascade
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  avatar_id uuid,
  garment_id uuid references public.garments (id) on delete set null,
  outfit_id uuid references public.outfits (id) on delete set null,
  kind text not null check (kind in ('avatar_generation', 'virtual_try_on', 'runway_animation')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  provider text,
  provider_job_id text,
  progress smallint check (progress is null or progress between 0 and 100),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  safe_error text check (safe_error is null or length(safe_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (avatar_id, owner_id)
    references public.avatars (id, owner_id) on delete cascade,
  foreign key (outfit_id, owner_id)
    references public.outfits (id, owner_id) on delete cascade,
  unique (owner_id, idempotency_key),
  check (
    (kind = 'avatar_generation' and avatar_id is not null)
    or (kind = 'virtual_try_on' and avatar_id is not null and garment_id is not null)
    or (kind = 'runway_animation' and avatar_id is not null and outfit_id is not null)
  ),
  check (
    (status = 'processing' and locked_by is not null and locked_until is not null)
    or (status <> 'processing' and locked_by is null and locked_until is null)
  )
);

create index generation_jobs_owner_idx on public.generation_jobs (owner_id, created_at desc);
create index generation_jobs_queue_idx on public.generation_jobs (status, available_at, created_at)
  where status in ('queued', 'processing');
create index generation_jobs_provider_idx on public.generation_jobs (provider, provider_job_id)
  where provider_job_id is not null;

create table public.avatar_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  avatar_id uuid not null,
  job_id uuid not null unique references public.generation_jobs (id) on delete cascade,
  kind text not null check (kind in ('image_2d', 'model_3d')),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'model/gltf-binary', 'model/gltf+json')),
  object_key text not null unique,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now(),
  foreign key (avatar_id, owner_id)
    references public.avatars (id, owner_id) on delete cascade,
  check (object_key like owner_id::text || '/' || avatar_id::text || '/%')
);

create table public.try_on_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null unique references public.generation_jobs (id) on delete cascade,
  avatar_id uuid not null,
  garment_id uuid not null references public.garments (id) on delete restrict,
  result_object_key text,
  result_content_type text,
  created_at timestamptz not null default now(),
  foreign key (avatar_id, owner_id)
    references public.avatars (id, owner_id) on delete cascade,
  check (result_object_key is null or result_object_key like owner_id::text || '/' || avatar_id::text || '/%')
);

create table public.runway_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null unique references public.generation_jobs (id) on delete cascade,
  outfit_id uuid not null,
  result_object_key text,
  result_content_type text check (result_content_type is null or result_content_type in ('video/mp4', 'model/gltf-binary')),
  created_at timestamptz not null default now(),
  foreign key (outfit_id, owner_id)
    references public.outfits (id, owner_id) on delete cascade,
  check (result_object_key is null or result_object_key like owner_id::text || '/%')
);

create table public.published_shows (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  collection_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  description text,
  media_object_key text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  foreign key (brand_id, owner_id)
    references public.brands (id, owner_id) on delete cascade,
  foreign key (collection_id, owner_id)
    references public.collections (id, owner_id) on delete cascade
);

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.garments enable row level security;
alter table public.collections enable row level security;
alter table public.collection_garments enable row level security;
alter table public.garment_favorites enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.avatar_assets enable row level security;
alter table public.try_on_sessions enable row level security;
alter table public.runway_sessions enable row level security;
alter table public.published_shows enable row level security;

revoke all on public.profiles, public.brands, public.garments, public.collections,
  public.collection_garments, public.garment_favorites, public.outfits,
  public.outfit_items, public.generation_jobs, public.avatar_assets,
  public.try_on_sessions, public.runway_sessions, public.published_shows
  from public, anon, authenticated;

grant select on public.profiles, public.brands, public.garments, public.collections,
  public.collection_garments, public.garment_favorites, public.outfits,
  public.outfit_items, public.generation_jobs, public.avatar_assets,
  public.try_on_sessions, public.runway_sessions, public.published_shows
  to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles, public.brands, public.garments,
  public.collections, public.collection_garments, public.garment_favorites,
  public.outfits, public.outfit_items, public.generation_jobs, public.avatar_assets,
  public.try_on_sessions, public.runway_sessions, public.published_shows to service_role;

create policy profiles_read on public.profiles for select to anon, authenticated
  using (id = (select auth.uid()) or (role = 'designer' and is_public));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy brands_read on public.brands for select to anon, authenticated
  using (status = 'published' or owner_id = (select auth.uid()));
create policy garments_read on public.garments for select to anon, authenticated
  using (status = 'published' or designer_id = (select auth.uid()));
create policy collections_read on public.collections for select to anon, authenticated
  using (status = 'published' or owner_id = (select auth.uid()));
create policy collection_garments_read on public.collection_garments for select to anon, authenticated
  using (exists (
    select 1 from public.collections c
    where c.id = collection_garments.collection_id
      and (c.status = 'published' or c.owner_id = (select auth.uid()))
  ));
create policy garment_favorites_owner on public.garment_favorites for select to authenticated
  using (owner_id = (select auth.uid()));
create policy outfits_owner on public.outfits for select to authenticated
  using (owner_id = (select auth.uid()));
create policy outfit_items_owner on public.outfit_items for select to authenticated
  using (owner_id = (select auth.uid()));
create policy generation_jobs_owner on public.generation_jobs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy avatar_assets_owner on public.avatar_assets for select to authenticated
  using (owner_id = (select auth.uid()));
create policy try_on_sessions_owner on public.try_on_sessions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy runway_sessions_owner on public.runway_sessions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy published_shows_read on public.published_shows for select to anon, authenticated
  using (status = 'published' or owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('catalog-assets', 'catalog-assets', false, 52428800,
    array['image/jpeg', 'image/png', 'image/webp', 'model/gltf-binary', 'model/gltf+json']),
  ('generated-media', 'generated-media', false, 104857600,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'model/gltf-binary', 'model/gltf+json'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy catalog_storage_read on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'catalog-assets'
    and (
      exists (select 1 from public.garments g where g.image_object_key = storage.objects.name and g.status = 'published')
      or exists (select 1 from public.brands b where b.logo_object_key = storage.objects.name and b.status = 'published')
      or exists (select 1 from public.collections c where c.cover_object_key = storage.objects.name and c.status = 'published')
    )
  );
create policy generated_media_read_owner on storage.objects for select to authenticated
  using (
    bucket_id = 'generated-media'
    and exists (
      select 1 from public.generation_jobs j
      where j.owner_id = (select auth.uid())
        and (j.output ->> 'objectKey') = storage.objects.name
    )
  );

create policy catalog_storage_select_guard on storage.objects as restrictive for select to public
  using (bucket_id <> 'catalog-assets' or (
    exists (select 1 from public.garments g where g.image_object_key = storage.objects.name and g.status = 'published')
    or exists (select 1 from public.brands b where b.logo_object_key = storage.objects.name and b.status = 'published')
    or exists (select 1 from public.collections c where c.cover_object_key = storage.objects.name and c.status = 'published')
  ));
create policy catalog_storage_insert_guard on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'catalog-assets');
create policy catalog_storage_update_guard on storage.objects as restrictive for update to public
  using (bucket_id <> 'catalog-assets') with check (bucket_id <> 'catalog-assets');
create policy catalog_storage_delete_guard on storage.objects as restrictive for delete to public
  using (bucket_id <> 'catalog-assets');
create policy generated_storage_select_guard on storage.objects as restrictive for select to public
  using (bucket_id <> 'generated-media' or exists (
    select 1 from public.generation_jobs j
    where j.owner_id = (select auth.uid())
      and (j.output ->> 'objectKey') = storage.objects.name
  ));
create policy generated_storage_insert_guard on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'generated-media');
create policy generated_storage_update_guard on storage.objects as restrictive for update to public
  using (bucket_id <> 'generated-media') with check (bucket_id <> 'generated-media');
create policy generated_storage_delete_guard on storage.objects as restrictive for delete to public
  using (bucket_id <> 'generated-media');

create function public.claim_generation_job(p_worker_id text, p_lease_seconds integer default 120)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
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
      and (
        j.status = 'queued'
        or (j.status = 'processing' and j.locked_until < pg_catalog.now())
      )
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
end;
$$;

revoke all on function public.claim_generation_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_generation_job(text, integer) to service_role;

commit;