# Runway Style Platform

Runway Style is a fashion-tech monorepo for authenticated avatar capture, private photo storage, provider-backed avatar generation, wardrobe and virtual runway features.

## Current deliverables

The repository includes an Expo mobile client with email authentication and a resumable four-view avatar photo workflow. The Node API verifies Supabase bearer tokens, enforces owner-scoped access, validates image uploads, and persists idempotent avatar/photo records. The feature branch `feat/avatar-generation-demo` adds a testable avatar-generation vertical slice: an authenticated start endpoint, a lease-based worker, explicit Replicate configuration, private generated-media storage, atomic job transitions, and mobile status/result polling.

The `apps/web` workspace contains the Runway Style editorial landing experience. Its visual design remains separate from the mobile/API vertical slice and is verified by a production build.

## Structure

- `apps/mobile/` — Expo Router app and avatar upload/generation UX.
- `apps/web/` — responsive Runway Style editorial web experience.
- `backend/api/` — authenticated HTTP API, Supabase adapters, generation worker and provider integration.
- `packages/` — shared types, validation, UI and utilities.
- `supabase/migrations/` — ordered database and storage migrations.
- `docs/` — setup, implementation status and engineering notes.

## Verification

```sh
pnpm --filter @runway/api test
pnpm --filter @runway/api typecheck
pnpm --filter @runway/mobile test
pnpm --filter @runway/mobile exec tsc --noEmit -p tsconfig.json
pnpm --filter @runway/web build
```

Live Supabase/provider verification is intentionally separate from local tests. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) and [`docs/AVATAR_BACKEND_SETUP.md`](docs/AVATAR_BACKEND_SETUP.md) for the exact non-production setup and remaining blockers.
