import assert from "node:assert/strict";
import test from "node:test";

import { AvatarApiClient, AvatarApiClientError } from "../lib/avatar-api.ts";

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

function createClient(overrides = {}) {
  const calls = [];
  const client = new AvatarApiClient({
    baseUrl: "https://api.example.test/",
    async getAccessToken() {
      return "current-user-access-token";
    },
    async onUnauthorized() {
      calls.push({ kind: "unauthorized" });
    },
    async fetcher(url, init) {
      calls.push({ kind: "request", url, init });
      return response(200, { avatar: { id: "avatar-1", status: "collecting_photos" }, photos: [] });
    },
    formDataFactory: () => ({ append(name, value) { calls.push({ kind: "part", name, value }); } }),
    ...overrides,
  });
  return { client, calls };
}

test("constructs the GET avatar route and sends the current bearer token", async () => {
  const { client, calls } = createClient();
  await client.getAvatar("avatar id/with space");
  const request = calls.find((call) => call.kind === "request");
  assert.equal(request.url, "https://api.example.test/api/avatars/avatar%20id%2Fwith%20space");
  assert.equal(request.init.headers.Authorization, "Bearer current-user-access-token");
});

test("builds multipart uploads with the route view and idempotency header", async () => {
  const file = { uri: "file:///photo.jpg", fileName: "front.jpg", contentType: "image/jpeg" };
  const { client, calls } = createClient();
  await client.uploadPhoto("avatar-1", "front", file, "upload-operation-1");
  const request = calls.find((call) => call.kind === "request");
  const part = calls.find((call) => call.kind === "part");
  assert.equal(request.url, "https://api.example.test/api/avatars/avatar-1/photos/front");
  assert.equal(request.init.headers["Idempotency-Key"], "upload-operation-1");
  assert.equal(request.init.headers["Content-Type"], undefined);
  assert.equal(part.name, "photo");
  assert.deepEqual(part.value, { uri: file.uri, name: file.fileName, type: file.contentType });
});

test("invalidates the session on unauthorized responses without exposing server text", async () => {
  let signedOut = false;
  const { client } = createClient({
    async fetcher() {
      return response(401, { error: { code: "unauthenticated", message: "internal detail" } });
    },
    async onUnauthorized() { signedOut = true; },
  });
  await assert.rejects(client.getAvatar("avatar-1"), (error) => {
    assert.ok(error instanceof AvatarApiClientError);
    assert.equal(error.category, "unauthenticated");
    assert.equal(error.message.includes("internal detail"), false);
    return true;
  });
  assert.equal(signedOut, true);
});

test("maps server and network failures to safe retryable errors", async () => {
  const { client: serverClient } = createClient({
    async fetcher() {
      return response(503, { error: { code: "service_unavailable", message: "secret detail" } });
    },
  });
  await assert.rejects(serverClient.getAvatar("avatar-1"), (error) => {
    assert.equal(error.category, "server");
    assert.equal(error.message.includes("secret detail"), false);
    return true;
  });

  const { client: networkClient } = createClient({
    async fetcher() { throw new Error("private network details"); },
  });
  await assert.rejects(networkClient.getAvatar("avatar-1"), (error) => {
    assert.equal(error.category, "network");
    assert.equal(error.message.includes("private network details"), false);
    return true;
  });
});

test("reports timeouts distinctly", async () => {
  const { client } = createClient({
    timeoutMs: 1,
    fetcher(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });
  await assert.rejects(client.getAvatar("avatar-1"), (error) => error.category === "timeout");
});

test("bounds access-token refresh time", async () => {
  const { client } = createClient({
    timeoutMs: 1,
    getAccessToken() { return new Promise(() => {}); },
    async fetcher() {
      throw new Error("fetch should not run without a token");
    },
  });
  await assert.rejects(client.getAvatar("avatar-1"), (error) => error.category === "timeout");
});

test("requires an explicit API base URL", () => {
  assert.throws(
    () => new AvatarApiClient({
      baseUrl: "",
      async getAccessToken() { return null; },
      async onUnauthorized() {},
    }),
    (error) => error.category === "configuration"
  );
});