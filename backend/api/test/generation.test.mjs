import assert from "node:assert/strict";
import test from "node:test";
import { startAvatarGeneration } from "../src/generation-service.ts";
import { AvatarGenerationWorker } from "../src/generation-worker.ts";

const owner = { userId: "user-1" };
const avatar = { id: "avatar-1", ownerId: owner.userId, status: "collecting_photos" };
const views = ["front", "left", "right", "back"];
function photoList() {
  return views.map((view) => ({ id: `photo-${view}`, avatarId: avatar.id, ownerId: owner.userId, view, contentType: "image/jpeg", byteSize: 100, contentSha256: "a".repeat(64), idempotencyKey: `photo-${view}-key`, storageObjectKey: `${owner.userId}/${avatar.id}/${view}.jpg` }));
}
function createRepository() {
  const jobs = [];
  return {
    jobs,
    async findAvatarForOwner() { return avatar; },
    async listPhotosForOwner() { return photoList(); },
    async findGenerationJobForOwnerByIdempotencyKey(_ownerId, key) { return jobs.find((job) => job.idempotencyKey === key) ?? null; },
    async enqueueAvatarGenerationJob(input) {
      const job = { id: `job-${jobs.length + 1}`, ownerId: input.ownerId, avatarId: input.avatarId, kind: "avatar_generation", status: "queued", idempotencyKey: input.idempotencyKey, input: { photoObjectKeys: Object.fromEntries(photoList().map((photo) => [photo.view, photo.storageObjectKey])) }, progress: null, safeError: null, attempts: 0, updatedAt: new Date().toISOString() };
      jobs.push(job);
      return job;
    },
  };
}

function createOutputWorker(fetcher, outputTimeoutMs = 30) {
  const repository = {
    async claimNextAvatarGenerationJob() {
      return { id: "job-output", ownerId: owner.userId, avatarId: avatar.id, kind: "avatar_generation", status: "processing", idempotencyKey: "output-key-1", input: { photoObjectKeys: Object.fromEntries(views.map((view) => [view, `${owner.userId}/${avatar.id}/${view}.jpg`])) }, progress: 0, safeError: null, attempts: 1, updatedAt: new Date().toISOString() };
    },
    async renewGenerationLease() { return true; },
    async setGenerationProviderJob() {},
    async completeAvatarGenerationJob(input) { this.completed = input; },
    async failAvatarGenerationJob(input) { this.failed = input; },
  };
  const storage = {
    async createSignedPhotoReadUrl({ objectKey }) { return `https://storage.example/${objectKey}`; },
    async uploadGeneratedMedia(input) { this.upload = input; return { objectKey: `${owner.userId}/${avatar.id}/generation-output.png` }; },
    async removeGeneratedMedia() {},
  };
  const provider = {
    provider: "replicate",
    taskKind: "avatar_generation",
    configuration: { provider: "replicate", modelVersion: "model-v1", inputTemplate: {}, outputPath: ["0"], outputKind: "image_2d" },
    async submit() { return { providerJobId: "provider-output", status: "succeeded", progress: 100, outputUrl: "https://replicate.delivery/result.png", outputKind: "image_2d", safeError: null }; },
    async poll() { throw new Error("poll should not run for immediate success"); },
    async cancel() { throw new Error("cancel not used"); },
  };
  return { worker: new AvatarGenerationWorker(repository, storage, provider, "worker-output", fetcher, 0, outputTimeoutMs), repository, storage };
}

function streamedResponse(chunks, headers = {}, close = true) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
  }), { status: 200, headers: { "content-type": "image/png", ...headers } });
}

test("requires provider configuration but preserves a replayable idempotency key", async () => {
  const repository = createRepository();
  await assert.rejects(startAvatarGeneration(owner, avatar.id, "generation-key-1", repository, false), (error) => error.code === "generation_not_configured");
  assert.equal(repository.jobs.length, 0);
});

test("creates one owner-scoped job and replays it idempotently", async () => {
  const repository = createRepository();
  const first = await startAvatarGeneration(owner, avatar.id, "generation-key-1", repository, true);
  const replay = await startAvatarGeneration(owner, avatar.id, "generation-key-1", repository, false);
  assert.equal(first.job.id, replay.job.id);
  assert.deepEqual(repository.jobs[0].input.photoObjectKeys, Object.fromEntries(views.map((view) => [view, `${owner.userId}/${avatar.id}/${view}.jpg`])));
});

test("rejects generation when a required photo view is missing", async () => {
  const repository = createRepository();
  repository.listPhotosForOwner = async () => photoList().slice(0, 3);
  await assert.rejects(startAvatarGeneration(owner, avatar.id, "generation-key-2", repository, true), (error) => error.code === "avatar_not_ready");
});

test("worker stores only a verified image output and completes the job", async () => {
  const repository = {
    claimed: false,
    async claimNextAvatarGenerationJob() { if (this.claimed) return null; this.claimed = true; return { id: "job-1", ownerId: owner.userId, avatarId: avatar.id, kind: "avatar_generation", status: "processing", idempotencyKey: "generation-key-1", input: { photoObjectKeys: Object.fromEntries(views.map((view) => [view, `${owner.userId}/${avatar.id}/${view}.jpg`])) }, progress: 0, safeError: null, attempts: 1, updatedAt: new Date().toISOString() }; },
    async setGenerationProviderJob(input) { this.providerJob = input; },
    async renewGenerationLease() { return true; },
    async completeAvatarGenerationJob(input) { this.completed = input; },
    async failAvatarGenerationJob(input) { this.failed = input; },
  };
  const storage = {
    async createSignedPhotoReadUrl({ objectKey }) { return `https://storage.example/${objectKey}`; },
    async uploadGeneratedMedia(input) { this.upload = input; return { objectKey: `${owner.userId}/${avatar.id}/generation-job-1.png` }; },
    async removeGeneratedMedia() {},
  };
  const provider = {
    provider: "replicate",
    taskKind: "avatar_generation",
    configuration: { provider: "replicate", modelVersion: "model-v1", inputTemplate: {}, outputPath: ["0"], outputKind: "image_2d" },
    async submit(values) { assert.equal(values.front_photo_url, `https://storage.example/${owner.userId}/${avatar.id}/front.jpg`); return { providerJobId: "provider-job-1", status: "succeeded", progress: 100, outputUrl: "https://replicate.delivery/result.png", outputKind: "image_2d", safeError: null }; },
    async poll() { throw new Error("poll should not run for immediate success"); },
    async cancel() { throw new Error("cancel not used"); },
  };
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x00);
  const worker = new AvatarGenerationWorker(repository, storage, provider, "worker-1", async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }), 0);
  assert.equal(await worker.runOnce(), true);
  assert.equal(repository.completed.contentType, "image/png");
  assert.equal(storage.upload.contentType, "image/png");
  assert.equal(repository.failed, undefined);
});

test("worker fails safely when provider is not configured", async () => {
  const repository = {
    async claimNextAvatarGenerationJob() { return { id: "job-1", ownerId: owner.userId, avatarId: avatar.id, kind: "avatar_generation", status: "processing", idempotencyKey: "key-123456", input: {}, progress: 0, safeError: null, attempts: 1, updatedAt: new Date().toISOString() }; },
    async renewGenerationLease() { return true; },
    async failAvatarGenerationJob(input) { this.failed = input; },
  };
  const worker = new AvatarGenerationWorker(repository, {}, null, "worker-1");
  await worker.runOnce();
  assert.equal(repository.failed.retryable, false);
});

test("worker rejects an oversized streamed body without trusting Content-Length", async () => {
  const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
  oversized.set([0x89, 0x50, 0x4e, 0x47]);
  const { worker, repository } = createOutputWorker(async () => streamedResponse([oversized], { "content-length": "1" }));
  await worker.runOnce();
  assert.equal(repository.completed, undefined);
  assert.match(repository.failed.safeError, /downloaded or verified/);
});

test("worker rejects an oversized streamed body when Content-Length is absent", async () => {
  const first = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, ...new Uint8Array(1024));
  const oversized = new Uint8Array(20 * 1024 * 1024);
  const { worker, repository } = createOutputWorker(async () => streamedResponse([first, oversized]));
  await worker.runOnce();
  assert.equal(repository.completed, undefined);
  assert.match(repository.failed.safeError, /downloaded or verified/);
});

test("worker cancels and fails a stalled output body after the full-body timeout", async () => {
  const response = streamedResponse([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], {}, false);
  const { worker, repository } = createOutputWorker(async () => response, 20);
  await worker.runOnce();
  assert.equal(repository.completed, undefined);
  assert.match(repository.failed.safeError, /timed out/);
});
