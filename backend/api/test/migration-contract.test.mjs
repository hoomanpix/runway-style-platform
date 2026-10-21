import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../../../supabase/migrations/20261021000000_avatar_generation_demo.sql", import.meta.url);

test("claim migration fails the exact exhausted avatar with its final job", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const claimStart = sql.indexOf("create or replace function public.claim_generation_job");
  const renewStart = sql.indexOf("create or replace function public.renew_avatar_generation_job");
  assert.notEqual(claimStart, -1);
  assert.notEqual(renewStart, -1);
  const claim = sql.slice(claimStart, renewStart);
  assert.match(claim, /for expired_job in[\s\S]*j\.kind = 'avatar_generation'/);
  assert.match(claim, /j\.status = 'processing'[\s\S]*j\.attempts >= j\.max_attempts/);
  assert.match(claim, /update public\.generation_jobs[\s\S]*where id = expired_job\.id/);
  assert.match(claim, /update public\.avatars set status = 'failed'[\s\S]*where id = expired_job\.avatar_id and owner_id = expired_job\.owner_id/);
});
