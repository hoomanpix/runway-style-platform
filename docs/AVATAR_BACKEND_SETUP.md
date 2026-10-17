# Avatar Backend Setup

## Verified Repository State

The repository contains a Node HTTP API, Supabase JS adapters, Supabase Auth token verification, and the migration `supabase/migrations/20261016000000_avatar_pipeline.sql`. At the time of this audit, no API/mobile `.env` file or Supabase CLI/PostgreSQL client is available. The migration has not been applied to any project. All automated integration tests use mocks; they do not establish that Supabase is operational.

## Environment Variables

| Variable | Used by | Visibility | Required |
| --- | --- | --- | --- |
| `SUPABASE_URL` | API Auth verification and database/storage clients | Server environment only | Yes |
| `SUPABASE_PUBLISHABLE_KEY` | API client that verifies a user's access token with Supabase Auth | Server environment only; this is a public Supabase key, but the API needs it for `auth.getUser` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | API database writes and private Storage operations | Server secret only; never Expo, `EXPO_PUBLIC_*`, logs, or client responses | Yes |
| `HOST` | API listener; defaults to `127.0.0.1` | Server environment | No |
| `PORT` | API listener; defaults to `3000` | Server environment | No |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile API client | Public app configuration, bundled into the client | Yes |
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile Auth client | Public app configuration, bundled into the client | Yes |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Mobile Auth client | Public app configuration, bundled into the client | Yes |

The API reads the root `.env` from its start script. Copy root `.env.example` to `.env` and fill values locally. The mobile app reads build-time public values through `apps/mobile/app.config.ts`; copy `apps/mobile/.env.example` to `apps/mobile/.env`, then restart Expo after changing it. Both `.env` files are git-ignored. The mobile app has no service-role variable or fallback API host.

Supabase Auth must have the Email provider enabled to use the current email/password UI. The mobile client persists native sessions in SecureStore and uses browser local storage on web. The API verifies every bearer token with `auth.getUser(accessToken)` and derives the owner ID from the returned user; it never trusts a client-supplied user ID.

## HTTP Contract

- `POST /api/avatars`: bearer token and `Idempotency-Key` (8-128 characters). A repeated key for the same owner returns the same canonical avatar ID.
- `GET /api/avatars/:avatarId`: returns the avatar and uploaded photo metadata/views for that owner. A foreign or missing ID returns 404.
- `POST /api/avatars/:avatarId/photos/:view`: bearer token, `Idempotency-Key`, and one multipart file named `photo`. Views are `front`, `left`, `right`, `back`; accepted JPEG/PNG/WebP signatures; maximum 10 MiB.

The API validates content before upload, generates `<owner UUID>/<avatar UUID>/<view>-<random UUID>.<ext>`, and uses `upsert: false`. A photo is successful only after Storage confirms the private write and Postgres confirms metadata. Same-key/same-content retries are idempotent; changed content under that key conflicts. Unique `(avatar_id, view)` prevents replacement after upload. Failed metadata inserts trigger best-effort Storage cleanup. Responses never include bucket paths or public URLs.

## Non-Production Supabase Setup

1. Create a separate non-production Supabase project. In Authentication settings, enable the Email provider and permit test-account sign-up. Do not use production credentials or accounts for this verification.
2. In Project Settings, copy the project URL, publishable key, and service-role secret to the matching local variables above. The service-role value belongs only in the API process's root `.env`.
3. Apply the migration only to that non-production project. In the Supabase Dashboard, select the non-production project, open **SQL Editor**, create a new query, paste the complete contents of `supabase/migrations/20261016000000_avatar_pipeline.sql`, review the project/ref shown in the dashboard, and run it once. Do not re-run after success; this migration creates named tables, constraints, policies, and bucket configuration. This repository task has not run it.
4. Verify the migration in the dashboard or SQL Editor:

	 ```sql
	 select tablename, rowsecurity
	 from pg_tables
	 where schemaname = 'public'
		 and tablename in ('avatars', 'avatar_photos');

	 select policyname, permissive, roles, cmd
	 from pg_policies
	 where schemaname = 'public'
		 and tablename in ('avatars', 'avatar_photos');

	 select id, public, file_size_limit, allowed_mime_types
	 from storage.buckets
	 where id = 'avatar-photos';

	 select policyname, permissive, roles, cmd
	 from pg_policies
	 where schemaname = 'storage'
		 and tablename = 'objects'
		 and policyname like 'avatar_storage_%';
	 ```

	 Expected: RLS is enabled on both public tables; bucket `avatar-photos` is private, limited to 10 MiB and JPEG/PNG/WebP; owner select policies and restrictive storage guards exist. Authenticated clients have no table insert/update or bucket upload/update policy. Their storage delete policy is limited to an unreferenced object in their own avatar path. Server writes use the service-role key after verified identity and owner checks.
5. Start the API from the repository root with Node.js 22.6+ and pnpm 10.32.1: `pnpm install --frozen-lockfile`, then `pnpm --filter @runway/api start`. The script reads root `.env` and defaults to `127.0.0.1:3000`. Bind to `0.0.0.0` only on a trusted development network or behind an appropriately secured HTTPS proxy.
6. Set the public variables in `apps/mobile/.env`. Use an HTTPS API URL except for a loopback simulator. For a physical device, use a reachable HTTPS development endpoint; do not change the API URL to a production localhost address.
7. Start Expo with `pnpm --filter @runway/mobile start`. Create/confirm two separate test users. With user A, sign in, select all four views, upload, then refresh/relaunch and verify the same avatar ID and four views persist. With user B, request user A's avatar and attempt an upload to its ID; both must return 404 and no object may be created. Also verify direct authenticated reads against a foreign Storage path are denied. Delete only the test project/data after verification.

Do not run `supabase db push`, SQL, or any remote migration command against production. The SQL Editor workflow above is the documented non-production procedure; local tests do not substitute for it.

## Security and Limitations

- All automated tests use injected mocks and local loopback HTTP. No live Supabase login, migration, RLS, bucket, or cross-account test has been performed.
- The service-role client bypasses RLS; every API query still includes the owner ID derived from the verified token. Keep the service key server-only.
- Storage and database writes cannot share a transaction. Cleanup after a failed metadata insert is best effort; a failed cleanup can leave a private orphan.
- Server validation checks declared MIME, basic file signatures, and byte size, but does not fully decode images or enforce pixel limits. Upload bodies are buffered up to 10 MiB; add decoder limits, request/rate limits, and orphan monitoring before public exposure.
- Expo web export is currently blocked by the missing `apps/mobile/assets/icon.png` referenced in `apps/mobile/components/ui/Avatar.tsx`. No unrelated `temp-app` asset was substituted.

Offline checks:

```sh
pnpm --filter @runway/api test
pnpm --filter @runway/api typecheck
pnpm --filter @runway/mobile test
pnpm --filter @runway/mobile exec tsc --noEmit -p tsconfig.json
```