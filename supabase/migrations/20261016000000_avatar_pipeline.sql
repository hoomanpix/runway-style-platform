begin;

create table public.avatars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'collecting_photos'
    check (status in ('collecting_photos')),
  idempotency_key text not null
    check (length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, idempotency_key)
);

create index avatars_owner_created_idx
  on public.avatars (owner_id, created_at desc);

create table public.avatar_photos (
  id uuid primary key default gen_random_uuid(),
  avatar_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  view text not null check (view in ('front', 'left', 'right', 'back')),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  storage_object_key text not null unique,
  created_at timestamptz not null default now(),
  constraint avatar_photos_avatar_owner_fk
    foreign key (avatar_id, owner_id)
    references public.avatars (id, owner_id)
    on delete cascade,
  constraint avatar_photos_one_per_view unique (avatar_id, view),
  constraint avatar_photos_one_per_owner_key unique (owner_id, idempotency_key),
  constraint avatar_photos_owner_scoped_key check (
    storage_object_key like owner_id::text || '/' || avatar_id::text || '/%'
  )
);

create index avatar_photos_owner_created_idx
  on public.avatar_photos (owner_id, created_at desc);
create index avatar_photos_avatar_idx
  on public.avatar_photos (avatar_id, owner_id);

alter table public.avatars enable row level security;
alter table public.avatar_photos enable row level security;

revoke all on table public.avatars from public, anon, authenticated;
revoke all on table public.avatar_photos from public, anon, authenticated;
grant select on table public.avatars to authenticated;
grant select on table public.avatar_photos to authenticated;
grant select, insert on table public.avatars to service_role;
grant select, insert on table public.avatar_photos to service_role;

create policy avatars_select_owner
  on public.avatars for select to authenticated
  using (owner_id = (select auth.uid()));

create policy avatar_photos_select_owner
  on public.avatar_photos for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.avatars a
      where a.id = avatar_photos.avatar_id
        and a.owner_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatar-photos',
  'avatar-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy avatar_storage_select_owner
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatar-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.avatars a
      where a.id::text = (storage.foldername(name))[2]
        and a.owner_id = (select auth.uid())
    )
  );

create policy avatar_storage_delete_unreferenced_owner
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatar-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.avatars a
      where a.id::text = (storage.foldername(name))[2]
        and a.owner_id = (select auth.uid())
    )
    and not exists (
      select 1 from public.avatar_photos p
      where p.storage_object_key = storage.objects.name
        and p.owner_id = (select auth.uid())
    )
  );

-- Restrictive guards ensure any pre-existing permissive Storage policies cannot
-- broaden access to this bucket. The service_role bypasses RLS for API writes.
create policy avatar_storage_select_guard
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'avatar-photos'
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.avatars a
        where a.id::text = (storage.foldername(name))[2]
          and a.owner_id = (select auth.uid())
      )
    )
  );

create policy avatar_storage_insert_guard
  on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'avatar-photos');

create policy avatar_storage_update_guard
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'avatar-photos')
  with check (bucket_id <> 'avatar-photos');

create policy avatar_storage_delete_guard
  on storage.objects as restrictive for delete to public
  using (
    bucket_id <> 'avatar-photos'
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.avatars a
        where a.id::text = (storage.foldername(name))[2]
          and a.owner_id = (select auth.uid())
      )
      and not exists (
        select 1 from public.avatar_photos p
        where p.storage_object_key = storage.objects.name
          and p.owner_id = (select auth.uid())
      )
    )
  );

-- Authenticated clients can read only their own rows/objects. Database writes,
-- Storage uploads, and updates are server-only after JWT verification and owner
-- checks. Client deletes are limited to same-owner objects not referenced by a
-- photo row; the API performs normal cleanup with its server-only service role.

commit;