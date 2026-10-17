import assert from "node:assert/strict";
import test from "node:test";

import { readServerConfig } from "../src/server-config.ts";

test("requires Supabase credentials without exposing their values", () => {
  assert.throws(
    () => readServerConfig({}),
    /SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY/
  );
});

test("accepts HTTPS Supabase URLs and local loopback URLs", () => {
  const config = readServerConfig({
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
  });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(config.supabaseServiceRoleKey, "server-only-test-secret");
});

test("rejects non-HTTPS remote Supabase URLs", () => {
  assert.throws(
    () =>
      readServerConfig({
        SUPABASE_URL: "http://db.example.com",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        SUPABASE_SERVICE_ROLE_KEY: "server-only-test-secret",
      }),
    /HTTPS URL/
  );
});