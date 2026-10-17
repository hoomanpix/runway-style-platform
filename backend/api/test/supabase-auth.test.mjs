import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseAuthenticator } from "../src/supabase-auth.ts";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "sb_publishable_test_only",
};

test("constructs the principal only from the verified Supabase user", async () => {
  const receivedTokens = [];
  const serviceClient = {};
  let receivedClientConfig;
  const client = {
    auth: {
      async getUser(token) {
        receivedTokens.push(token);
        return { data: { user: { id: "verified-user-id" } }, error: null };
      },
    },
  };
  const authenticate = createSupabaseAuthenticator(config, serviceClient, (...args) => {
    receivedClientConfig = args;
    return client;
  });
  const context = await authenticate("signed-user-token");
  assert.deepEqual(receivedTokens, ["signed-user-token"]);
  assert.deepEqual(receivedClientConfig, [
    config.supabaseUrl,
    config.supabasePublishableKey,
    "signed-user-token",
  ]);
  assert.equal(context.principal.userId, "verified-user-id");
  assert.equal(context.repository.client, serviceClient);
  assert.equal(context.dependencies.storage.client, serviceClient);
});

test("rejects invalid and expired Supabase tokens", async () => {
  const authenticate = createSupabaseAuthenticator(
    config,
    {},
    () => ({
      auth: {
        async getUser(token) {
          return {
            data: { user: null },
            error: { status: token === "expired-token" ? 401 : 403 },
          };
        },
      },
    })
  );
  assert.equal(await authenticate("invalid-token"), null);
  assert.equal(await authenticate("expired-token"), null);
});