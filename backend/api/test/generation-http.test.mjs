import assert from "node:assert/strict";
import test from "node:test";
import { createAvatarHttpServer } from "../src/http-server.ts";

async function withServer(authenticate, options, run) {
  const server = createAvatarHttpServer(authenticate, options);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function context() {
  const jobs = [];
  const repository = {
    async findAvatarForOwner() { return { id: "avatar-1", ownerId: "user-1", status: "collecting_photos" }; },
    async listPhotosForOwner() { return ["front", "left", "right", "back"].map((view) => ({ id: view, avatarId: "avatar-1", ownerId: "user-1", view, contentType: "image/jpeg", byteSize: 10, contentSha256: "a".repeat(64), idempotencyKey: `${view}-key`, storageObjectKey: `user-1/avatar-1/${view}.jpg` })); },
    async findGenerationJobForOwnerByIdempotencyKey(_owner, key) { return jobs.find((job) => job.idempotencyKey === key) ?? null; },
    async enqueueAvatarGenerationJob(input) { const job = { id: "job-1", ownerId: input.ownerId, avatarId: input.avatarId, kind: "avatar_generation", status: "queued", idempotencyKey: input.idempotencyKey, input: { photoObjectKeys: Object.fromEntries(["front", "left", "right", "back"].map((view) => [view, `user-1/avatar-1/${view}.jpg`])) }, progress: null, safeError: null, attempts: 0, updatedAt: new Date().toISOString() }; jobs.push(job); return job; },
  };
  return { principal: { userId: "user-1" }, repository, dependencies: { repository, storage: {} } };
}

test("starts an owner-scoped generation job only when provider configuration is enabled", async () => {
  const supplied = context();
  await withServer(async () => supplied, { generationConfigured: true }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/avatars/avatar-1/generation`, { method: "POST", headers: { Authorization: "Bearer token", "Idempotency-Key": "generation-key-1" } });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).job.id, "job-1");
  });
});

test("returns a safe configuration error before creating a job", async () => {
  const supplied = context();
  await withServer(async () => supplied, { generationConfigured: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/avatars/avatar-1/generation`, { method: "POST", headers: { Authorization: "Bearer token", "Idempotency-Key": "generation-key-1" } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "generation_not_configured");
  });
});
