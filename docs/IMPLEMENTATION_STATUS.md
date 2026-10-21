# Implementation Status — Avatar Generation Demo

## Repository state

The work is on working branch `fix/avatar-generation-demo-hardening`, based on the verified `main` commit `46a077c25e27b85ffc761df457a887478575650d`. The branch is intentionally not merged or pushed to `main`. The incremental migration was applied only to the explicitly confirmed non-production Supabase project `dzqwozozpmogfjwufeju`; no production data write, live provider request, or public deployment was executed. The current environment has no Replicate token, approved model version, or provider template.

## Delivered on this branch

The backend now has an authenticated `POST /api/avatars/:avatarId/generation` endpoint. It derives ownership from the verified bearer token, requires an 8–128 character `Idempotency-Key`, requires all four uploaded views, stores only owner-scoped source object keys in the job input, and replays an existing job for the same owner/key. Provider configuration is checked before creating a new job, so an unconfigured server returns a safe `generation_not_configured` response.

The new `generation-worker.ts` claims jobs with a lease, signs private source-photo URLs, submits and polls the configured async provider, rejects unsupported output kinds and invalid/oversized image output, writes the result to the private `generated-media` bucket, and completes the database job only after storage succeeds. Provider failures and missing configuration are converted to bounded safe job failure transitions. The Replicate adapter is used only through explicit server environment variables; no provider credential is present here.

The new incremental migration `supabase/migrations/20261021000000_avatar_generation_demo.sql` expands avatar states, adds an atomic owner-locked enqueue RPC, makes claim/update transitions exact, adds bounded lease renewal, hardens completion/failure ownership checks, and fixes generated-media policy output keys. It is committed as a file and has been applied and verified against the explicitly confirmed non-production project `dzqwozozpmogfjwufeju`.

The mobile workflow now persists a generation idempotency key, starts generation after the four photos are confirmed, polls queued/processing jobs, and renders the signed generated asset when the server reports success. The editorial web experience was not structurally changed.

## Files changed and purpose

- `backend/api/src/generation-service.ts`: authenticated start-job validation, ownership, four-view checks, idempotency and safe errors.
- `backend/api/src/generation-config.ts`: explicit environment-to-Replicate configuration boundary.
- `backend/api/src/generation-worker.ts`: lease-based worker, provider polling, output validation and storage orchestration.
- `backend/api/src/worker.ts`: standalone worker entrypoint.
- `backend/api/src/http-server.ts`, `server.ts`, `avatar-service.ts`: generation route, configuration gate, and avatar-state enforcement.
- `backend/api/src/supabase-adapters.ts`, `supabase-database.ts`: job persistence, RPC calls, private source/result storage adapters and generated types.
- `backend/api/package.json`: `worker` command.
- `packages/types/src/avatar.ts`: generation response and API error contracts.
- `apps/mobile/lib/avatar-api.ts`, `avatar-workflow.ts`, `app/upload/index.tsx`: start, polling, idempotency and result UI.
- `backend/api/test/generation.test.mjs`, `generation-http.test.mjs`: service, worker and HTTP tests.
- `supabase/migrations/20261021000000_avatar_generation_demo.sql`: incremental schema/RPC migration.
- `.env.example`: server-only provider configuration placeholders.
- `docs/IMPLEMENTATION_STATUS.md`: this status and delivery boundary.

## Verification results

The following commands passed after implementation:

- `pnpm --filter @runway/api test` — PASS, 43 tests.
- `pnpm --filter @runway/api typecheck` — PASS.
- `pnpm --filter @runway/mobile test` — PASS, 11 tests.
- `pnpm --filter @runway/mobile exec tsc --noEmit -p tsconfig.json` — PASS.
- `pnpm --filter @runway/web build` — PASS.
- `git diff --check` — PASS.
- Migration structural checks for one transaction wrapper, five generation RPC names, lease predicates, owner-scoped source keys and snake_case output policy keys — PASS.
- `supabase --version` / `supabase db push --help` — unavailable because the Supabase CLI is not installed; no remote operation was attempted.
- Live non-production verification — migration history contains the incremental migration; all five RPCs exist as `security definer` functions with `service_role` execution; the active-job unique index and avatar status constraint exist; generated-media owner policy uses `output ->> 'object_key'`; public tables are currently empty.
- Supabase security advisors — no findings. Performance advisors retain existing informational warnings for unindexed foreign keys and unused indexes.

The pre-change baseline also passed API tests/typecheck, mobile tests/typecheck, Expo web export, and web build. Mobile lint remains unverified because the repository has no ESLint configuration and automatic setup was not accepted.

## What is actually end-to-end versus unverified

The existing four-photo upload path remains locally end-to-end through mocked HTTP/storage boundaries and is covered by tests. The new generation slice is end-to-end in unit/HTTP tests through a fake provider and fake storage, including success, missing views, ownership, idempotency, safe configuration failure and provider/output validation.

Live Supabase Auth, two-user RLS/Storage isolation, worker lease behavior against Postgres, Replicate submission, provider billing, and real generated-media retrieval remain unverified. The first demo is therefore not declared live-ready. The confirmed non-production project has the three migrations applied, but still requires Email Auth test accounts, safe cleanup credentials, server-only Supabase service-role credentials, an approved Replicate model/version, a matching `AVATAR_GENERATION_INPUTS_JSON` template, output path, and `image_2d` output kind.

## Local demo procedure

1. Use the confirmed non-production Supabase project `dzqwozozpmogfjwufeju`, where `20261016000000_avatar_pipeline`, `20261017000000_fashion_jobs`, and `avatar_generation_demo` are now applied. Verify two-user Auth/RLS/Storage isolation before connecting a provider.
2. Copy `.env.example` to `.env` and fill server-only Supabase and Replicate values. Never place service-role or Replicate secrets in Expo variables.
3. Start the API with `pnpm --filter @runway/api start` and the worker with `pnpm --filter @runway/api worker`.
4. Configure `apps/mobile/.env` with public Supabase values and the reachable API base URL, then start Expo with `pnpm --filter @runway/mobile start`.
5. Create/sign in a test account, select one JPEG/PNG/WebP for each front/left/right/back view, upload all four, press `Generate my avatar`, and observe queued/processing/succeeded state plus the private signed result URL.

## Remaining product limits

Wardrobe/catalog ingestion, garment selection, try-on job creation, runway session creation, runway video playback, 3D avatar/model output, cancellation UI, rate limiting, decoder-level image limits, orphan cleanup monitoring, and production observability are not implemented in this slice. A failed generation currently remains a terminal avatar failure rather than offering a new UI retry flow; this is an explicit follow-up rather than a hidden claim of completeness.
