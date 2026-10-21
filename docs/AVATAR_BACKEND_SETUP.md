# Avatar Backend Setup

## Verified Repository State

The repository contains a Node HTTP API, Supabase JS adapters, Supabase Auth token verification, and migrations for the avatar pipeline, fashion jobs, and the avatar-generation demo. No API/mobile `.env` file or Supabase CLI/PostgreSQL client is available in the current workspace. The migrations have not been applied to any project. Automated integration tests use mocks and local loopback HTTP; they do not establish that Supabase is operational.

## Environment Variables

| Variable | Used by | Visibility | Required |
| --- | --- | --- | --- |
| `SUPABASE_URL` | API Auth verification and database/storage clients | Server only | Yes |
| `SUPABASE_PUBLISHABLE_KEY` | API client used to verify a user's access token | Server only | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | API database writes and private Storage operations | Server secret only | Yes |
| `REPLICATE_API_TOKEN` | Avatar-generation provider | Server secret only | For live generation |
| `AVATAR_GENERATION_MODEL_VERSION` | Approved Replicate model/version | Server only | For live generation |
| `AVATAR_GENERATION_INPUTS_JSON` | Provider input template | Server only | For live generation |
| `AVATAR_GENERATION_OUTPUT_PATH` | Provider output extraction path | Server only | For live generation |
| `AVATAR_GENERATION_OUTPUT_KIND` | Expected provider output kind | Server only | For live generation |
| `HOST` | API listener; defaults to `127.0.0.1` | Server | No |
| `PORT` | API listener; defaults to `3000` | Server | No |
| `EXPO_PUBLIC_API_BASE_URL` | Mobile API client | Public app config | Yes |
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile Auth client | Public app config | Yes |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Mobile Auth client | Public app config | Yes |

The API reads the root `.env` from its start and worker scripts. Copy root `.env.example` to `.env` and fill values locally. The mobile app reads build-time public values through `apps/mobile/app.config.ts`; copy `apps/mobile/.env.example` to `apps/mobile/.env`, then restart Expo after changing it. Both `.env` files are git-ignored. Never put a service-role key or provider token in an Expo variable.

Supabase Auth must have the Email provider enabled for the current email/password UI. The mobile client persists native sessions in SecureStore and uses browser local storage on web. The API verifies every bearer token with `auth.getUser(accessToken)` and derives the owner ID from the returned user; it never trusts a client-supplied user ID.

## HTTP Contract

- `POST /api/avatars`: bearer token and `Idempotency-Key` (8–128 characters). A repeated key for the same owner returns the same canonical avatar ID.
- `GET /api/avatars/:avatarId`: returns the owner-scoped avatar, photo metadata, generation job, and a short-lived signed generated-asset URL after success.
- `POST /api/avatars/:avatarId/photos/:view`: bearer token, `Idempotency-Key`, and one multipart file named `photo`. Views are `front`, `left`, `right`, `back`; accepted JPEG/PNG/WebP signatures; maximum 10 MiB.
- `POST /api/avatars/:avatarId/generation`: bearer token and `Idempotency-Key`; requires all four uploaded views and returns a queued job. A new job is rejected safely when the provider is not configured.

The API validates content before upload, generates owner/avatar/view-scoped private object keys, and uses `upsert: false`. Same-key/same-content retries are idempotent; changed content under that key conflicts. Generation enqueue is an owner-locked database RPC: it validates all four source rows, writes the job, and changes avatar state in one transaction. Source object keys are stored in the job input, while signed URLs are created only inside the worker.

## Non-Production Supabase Setup

1. Create a separate non-production Supabase project. Enable Email Auth and permit test-account sign-up. Do not use production credentials or accounts for this verification.
2. Copy the project URL, publishable key, and service-role secret to the matching server variables. Keep the service-role value only in the API process's root `.env`.
3. Apply, in order, `supabase/migrations/20261016000000_avatar_pipeline.sql`, `supabase/migrations/20261017000000_fashion_jobs.sql`, and `supabase/migrations/20261021000000_avatar_generation_demo.sql` in that non-production project. This repository has not run them remotely.
4. Verify that RLS is enabled on `avatars`, `avatar_photos`, `generation_jobs`, and `avatar_assets`; that both storage buckets are private; and that the five generation RPCs (`enqueue_avatar_generation_job`, `claim_generation_job`, `renew_avatar_generation_job`, `complete_avatar_generation_job`, and `fail_avatar_generation_job`) exist with execute access limited to `service_role`.
5. Start the API from the repository root with Node.js 22.6+ and pnpm 10.32.1: `pnpm install --frozen-lockfile`, then `pnpm --filter @runway/api start`. Start the worker separately with `pnpm --filter @runway/api worker`.
6. Set public variables in `apps/mobile/.env`, use an HTTPS API URL except for a loopback simulator, and start Expo with `pnpm --filter @runway/mobile start`.
7. With test user A, create an avatar, upload all four views, start generation, and verify status/result polling. With test user B, request user A's avatar and attempt generation or upload; both must be rejected with no cross-owner object access.

Do not run `supabase db push`, SQL, or any remote migration command against production. The migration sequence above is for non-production validation only.

## Provider Configuration

Configure `AVATAR_GENERATION_INPUTS_JSON` with all four complete placeholders: `{{front_photo_url}}`, `{{left_photo_url}}`, `{{right_photo_url}}`, and `{{back_photo_url}}`. Use `AVATAR_GENERATION_OUTPUT_KIND=image_2d` for this demo and set `AVATAR_GENERATION_OUTPUT_PATH` to the path that extracts the provider's HTTPS image URL. The provider adapter rejects non-HTTPS/non-Replicate output hosts, unsupported output kinds, and invalid provider responses. Replicate's API documentation states that output files may require the API authorization header, so the worker downloads output through the provider adapter rather than fetching the URL directly.

## Security and Limitations

All automated tests use injected mocks and local loopback HTTP. No live Supabase login, migration, RLS, bucket, cross-account test, or real provider call has been performed. The service-role client bypasses RLS; every API query still includes the owner ID derived from the verified token.

Storage and database writes cannot share a transaction. The worker uses atomic database RPCs for job/result state and renews a bounded lease while provider work runs, but a failed storage cleanup can still leave a private orphan. If the provider accepts a request and the network fails before its prediction ID is persisted, the current Replicate adapter cannot prove whether the request was accepted; this remains an at-least-once ambiguity and must be closed with a verified provider idempotency mechanism or reconciliation before production billing. Upload validation checks signatures and byte size but does not fully decode images or enforce pixel limits. Rate limiting, decoder limits, orphan monitoring, production observability, cancellation UI, try-on, wardrobe, runway, and 3D output remain outside this slice.

## Offline checks

```sh
pnpm --filter @runway/api test
pnpm --filter @runway/api typecheck
pnpm --filter @runway/mobile test
pnpm --filter @runway/mobile exec tsc --noEmit -p tsconfig.json
pnpm --filter @runway/web build
```
