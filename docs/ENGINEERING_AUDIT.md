# Avatar Pipeline Engineering Audit

Audit date: 2026-10-16
Repository: `hoomanpix/runway-style-platform`, branch `main`
Stack: pnpm 10.32.1 workspace, TypeScript 6, Expo Router / React Native 0.86, Zustand 5.

## Scope and architecture

The repository now has a Node HTTP API in `backend/api`, using `@supabase/supabase-js` and Busboy. Supabase Auth verifies bearer tokens using the publishable key; avatar/photo persistence and private Storage operations use a server-only service-role client. The Expo app now has Supabase Auth, native secure session storage, a typed API client, image selection, and resumable four-view uploads. `supabase/migrations/20261016000000_avatar_pipeline.sql` defines the schema, RLS, grants, restrictive Storage guards, and private bucket. The migration has not been applied to a Supabase project. All required Supabase/API/mobile environment variables are missing, both local `.env` files are absent, and neither Supabase CLI nor `psql` is installed. `packages/database` and `packages/ai` remain interface-only. `temp-app` is a separate Expo sample and is not connected to this flow.

## Confirmed findings

| Severity | Finding and impact | Evidence | Fix status |
| --- | --- | --- | --- |
| Critical / partially implemented | The server verifies access tokens through Supabase Auth, derives owner identity from the verified user, and uses a server-only service-role client for writes. Owner predicates are applied in repository queries. The migration adds owner-scoped table/storage reads and restrictive Storage guards. Live RLS/Storage enforcement is unverified because no credentials or SQL tooling are available. | `backend/api/src/supabase-auth.ts`; `backend/api/src/supabase-adapters.ts`; `supabase/migrations/20261016000000_avatar_pipeline.sql` | Mocked and local code paths are tested. Apply to a non-production project and pass two-user tests before enabling real uploads. |
| High / partially implemented | The HTTP API and Expo workflow now support authenticated front, left, right, and back multipart photos, JPEG/PNG/WebP, a 10 MiB limit, owner-scoped private storage, resume, and retry. Image signatures are validated server-side, but files are not fully decoded and pixel dimensions are not checked. | `backend/api/src/http-server.ts`; `apps/mobile/app/upload/index.tsx`; `apps/mobile/lib/avatar-api.ts`; `apps/mobile/lib/avatar-workflow.ts` | API and offline client tests pass. The app is not verified against live Supabase; missing public configuration and sessions fail visibly. |
| High / unresolved | Avatar/photo status retrieval exists, but there is no generation-job status, polling, worker, or generated-result presentation. | `backend/api/src/http-server.ts`; `apps/mobile/app/studio/index.tsx` (`StudioScreen`) | Photo upload completion is not represented as avatar generation; Studio correctly says generation is unavailable. |
| High / partially implemented | Durable avatar and photo tables, owner constraints, unique view constraints, idempotency constraints, RLS, and private bucket policies are now defined. No generation job, worker, result pipeline, or recovery path exists. | `supabase/migrations/20261016000000_avatar_pipeline.sql`; `backend/api/src/supabase-database.ts` | Migration added but not applied or validated against a live/local PostgreSQL instance. AI/job processing remains unimplemented. |
| High / unresolved | No production AI provider, avatar generation, result retrieval, polling, or retry implementation exists. | `packages/ai/src/index.ts`; `backend/ai`; `apps/mobile/app/studio/index.tsx` | No fake generation was added. Studio continues to state that no avatar has been created. |
| Medium / fixed | The mobile dependency manifest declared Zustand `^5.0.1`, but the lockfile omitted that dependency from the `apps/mobile` importer. Frozen installs failed. | `apps/mobile/package.json`; `pnpm-lock.yaml` importer `apps/mobile` | Lockfile regenerated from existing manifests; no dependency range was changed. Frozen lockfile validation passes. |
| Medium / fixed | The onboarding Continue action skipped the existing photo guide and went directly to the upload placeholder. | `apps/mobile/app/onboarding/index.tsx` (`OnboardingScreen`) | Fixed: Continue opens `/onboarding/photo-guide`. |
| Medium / fixed | The upload placeholder allowed navigation to Studio, suggesting progress without any photo or generation operation. | `apps/mobile/app/upload/index.tsx` (`UploadScreen`) | Fixed: removed the Studio action and made the unavailable state explicit. |
| Medium / unresolved | Expo web export fails because the Avatar component references an absent image asset. Other discovered PNGs belong to the separate `temp-app` demo and are not an established Runway asset. | `apps/mobile/components/ui/Avatar.tsx`; `apps/mobile/assets/icon.png` is absent | Not replaced with an unrelated demo image. |

## Implemented service behavior

- `createAvatar` requires a non-empty authenticated principal and returns only the server/repository-provided avatar ID.
- `POST /api/avatars` and photo upload require verified Supabase bearer tokens plus `Idempotency-Key`; user identity is read only from Supabase Auth's verified response.
- `GET /api/avatars/:id` uses owner-filtered queries and returns the confirmed photo-view metadata for resume; another user's ID returns the same 404 as a missing ID.
- Database writes and private Storage uploads use a server-only service-role client. Every repository method scopes lookups by owner, and inserts use the verified owner ID. The service-role key is not referenced by the mobile app.
- `uploadAvatarPhoto` validates the view, content type, byte signature, and size, verifies avatar ownership, generates a server-controlled object key, disables upsert, and reports success only after storage and metadata writes succeed.
- Creation and photo retries are idempotent. Photo replay also compares a SHA-256 digest; key reuse with a different request conflicts. A duplicate view is rejected and the newly stored object is cleaned up.
- API errors are mapped to safe status/code/message responses. If metadata insertion fails after upload, cleanup is attempted; if cleanup also fails, a private orphan may remain and needs operational cleanup.
- The migration grants authenticated users owner-scoped reads and restricts database writes and Storage uploads/updates to the server role. Restrictive Storage guards prevent pre-existing permissive policies from broadening access to this bucket. Storage reads are owner scoped; the only authenticated delete policy permits unreferenced objects under that user's avatar path, never objects referenced by photo metadata. No public URLs are returned.

## Photo workflow and product contract

The API contract defines four required views (`front`, `left`, `right`, `back`) and a 10 MiB per-image limit; content validation accepts JPEG, PNG, and WebP signatures. The mobile picker validates declared MIME/extension and size, previews selections, and allows replacement before upload. Secure per-user local state preserves avatar creation keys and photo operation keys bound to SHA-256 content. Uploads are sequential; the app refreshes server state before each retry batch and marks a view uploaded only after a server response. The workflow does not report byte progress because fetch does not provide measured upload progress. Image bytes are not fully decoded or dimension checked.

## Security status

- Authentication: `auth.getUser(accessToken)` verifies tokens. Invalid/expired tokens invalidate the mobile session; the API never accepts a client-supplied user ID as identity. Native refresh tokens use SecureStore; web uses browser localStorage.
- Ownership: service and adapter tests cover cross-owner denial and owner predicates. The migration adds composite ownership FKs and RLS reads, but live policies have not been tested.
- Storage: a private bucket and owner/avatar path policies are defined in SQL. Server uploads use the service role after ownership validation; direct authenticated clients have no insert/update policy and can delete only unreferenced objects under their own avatar path. Live bucket behavior is unverified.
- Secrets: root `.env.example` is server-only and contains placeholders. `apps/mobile/.env.example` contains only public API/Auth configuration. The service-role key is required by API server config and is not used in mobile code. Never place it in `EXPO_PUBLIC_*` variables or client bundles.
- Image safety: the service limits size and matches basic JPEG/PNG/WebP signatures to declared MIME. Full decode, dimensions/pixel limits, malware scanning, and content-disarm processing are not implemented.
- IDs and job state: API responses preserve the repository's canonical avatar ID, but no durable job or server-authoritative state transition exists.

## Verification

- `pnpm --filter @runway/api test`: passed, 27 tests covering validation, authentication, ownership, multipart limits, adapter failures, cleanup, idempotency, response privacy, and avatar-ID consistency.
- `pnpm --filter @runway/api typecheck`: passed after Supabase server implementation.
- `pnpm --filter @runway/mobile test`: passed, 11 tests covering request routes/headers, multipart construction, unauthorized/network/timeout handling, required views, content-bound retries, partial recovery, and canonical IDs.
- `pnpm --filter @runway/mobile exec tsc --noEmit -p tsconfig.json`: passed.
- `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts`: passed after API and Expo dependencies were added.
- `pnpm --filter @runway/mobile exec expo config --type public`: passed with image-picker and SecureStore plugins.
- `git diff --check`: passed after final source and documentation changes.
- Environment availability check: API and mobile Supabase variables are unset; root and mobile `.env` files are absent. The check printed only set/missing statuses, not values.
- Tests listed above use mocks and local HTTP only; none are real Supabase integration tests.
- `pnpm --filter @runway/mobile lint`: blocked because no ESLint configuration exists; automatic setup was declined.
- `pnpm --dir apps/mobile exec expo export --platform web --output-dir /tmp/runway-style-mobile-export`: failed because `apps/mobile/components/ui/Avatar.tsx` requires missing `apps/mobile/assets/icon.png`. Available images are in a separate Expo sample and were not copied.
- Supabase CLI and `psql` are not installed. No project credentials are configured; migration execution and live two-user RLS/storage tests remain unverified.

## Required next work

1. Provision a non-production Supabase project, configure Auth, apply/review the migration, and run real two-user RLS and private Storage checks.
2. Configure API-only Supabase credentials in the ignored root `.env` and public values in `apps/mobile/.env`; never expose the service-role key to the Expo app.
3. Run two-user authorization and storage tests against a configured non-production Supabase project before enabling real uploads.
4. Add a production image decoder, dimension/pixel limits, rate limits, and operational orphan cleanup before public exposure.
5. Implement durable generation jobs, a worker, polling, and a real server-side AI provider before showing any generated avatar.