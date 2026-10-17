import assert from "node:assert/strict";
import test from "node:test";

import { MAX_AVATAR_PHOTO_BYTES } from "@runway/shared/avatar";
import { createAvatarHttpServer } from "../src/http-server.ts";

const ownerId = "user-1";
const avatarId = "avatar-1";
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x01);

function createContext(avatarOwnerId = null) {
  const avatars = new Map();
  const avatarsById = new Map();
  if (avatarOwnerId) {
    avatarsById.set(avatarId, {
      id: avatarId,
      ownerId: avatarOwnerId,
      status: "collecting_photos",
      idempotencyKey: "foreign-avatar-key",
    });
  }
  const photos = new Map();
  const photosByAvatar = new Map();
  const calls = { storage: [], saved: [] };
  const repository = {
    async createAvatarForOwner(ownerIdForRequest, idempotencyKey) {
      const key = `${ownerIdForRequest}:${idempotencyKey}`;
      if (avatars.has(key)) throw Object.assign(new Error("duplicate"), { code: "23505" });
      const record = {
        id: avatarId,
        ownerId: ownerIdForRequest,
        status: "collecting_photos",
        idempotencyKey,
      };
      avatars.set(key, record);
      avatarsById.set(record.id, record);
      return record;
    },
    async findAvatarForOwner(ownerIdForRequest, requestedAvatarId) {
      const record = avatarsById.get(requestedAvatarId);
      return record?.ownerId === ownerIdForRequest ? record : null;
    },
    async findAvatarForOwnerByIdempotencyKey(ownerIdForRequest, idempotencyKey) {
      return avatars.get(`${ownerIdForRequest}:${idempotencyKey}`) ?? null;
    },
    async createPhotoForOwner(input) {
      const key = `${input.ownerId}:${input.idempotencyKey}`;
      if (photos.has(key)) throw Object.assign(new Error("duplicate"), { code: "23505" });
      calls.saved.push(input);
      const record = {
        id: "photo-1",
        avatarId: input.avatarId,
        ownerId: input.ownerId,
        view: input.view,
        contentType: input.contentType,
        byteSize: input.byteSize,
        contentSha256: input.contentSha256,
        idempotencyKey: input.idempotencyKey,
      };
      photos.set(key, record);
      photosByAvatar.set(`${input.ownerId}:${input.avatarId}:${input.view}`, record);
      return record;
    },
    async findPhotoForOwnerByIdempotencyKey(ownerIdForRequest, idempotencyKey) {
      return photos.get(`${ownerIdForRequest}:${idempotencyKey}`) ?? null;
    },
    async listPhotosForOwner(ownerIdForRequest, requestedAvatarId) {
      return [...photosByAvatar.values()].filter(
        (photo) => photo.ownerId === ownerIdForRequest && photo.avatarId === requestedAvatarId
      );
    },
    async findLatestAvatarAssetForOwner() {
      return null;
    },
    async findLatestAvatarGenerationJobForOwner() {
      return null;
    },
  };
  const storage = {
    async uploadPrivate(input) {
      calls.storage.push(input);
      return { objectKey: `${input.ownerId}/${input.avatarId}/front-photo.webp` };
    },
    async removePrivate() {},
  };
  return {
    context: {
      principal: { userId: ownerId },
      repository,
      dependencies: { repository, storage },
    },
    calls,
  };
}

async function withServer(authenticate, run) {
  const server = createAvatarHttpServer(authenticate);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("HTTP rejects missing and invalid bearer tokens before resource access", async () => {
  const { context } = createContext();
  let authCalls = 0;
  await withServer(async (token) => {
    authCalls += 1;
    return token === "valid-token" ? context : null;
  }, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/avatars`, { method: "POST" });
    assert.equal(missing.status, 401);
    const expired = await fetch(`${baseUrl}/api/avatars`, {
      method: "POST",
      headers: { Authorization: "Bearer expired-token", "Idempotency-Key": "avatar-key-1" },
    });
    assert.equal(expired.status, 401);
    assert.equal(authCalls, 1);
  });
});

test("HTTP blocks another user's avatar and photo access", async () => {
  const { context, calls } = createContext("user-2");
  await withServer(async () => context, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/avatars/${avatarId}`, {
      headers: { Authorization: "Bearer verified-token" },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "avatar_not_found", message: "Avatar was not found." },
    });

    const form = new FormData();
    form.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "front.jpg");
    const upload = await fetch(`${baseUrl}/api/avatars/${avatarId}/photos/front`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "foreign-photo-key",
      },
      body: form,
    });
    assert.equal(upload.status, 404);
    assert.equal(calls.storage.length, 0);
  });
});

test("HTTP creates an avatar and uploads a validated photo with the canonical ID", async () => {
  const { context, calls } = createContext();
  await withServer(async () => context, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/avatars`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "avatar-key-1",
      },
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).avatar.id, avatarId);

    const form = new FormData();
    form.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "front.jpg");
    const uploaded = await fetch(`${baseUrl}/api/avatars/${avatarId}/photos/front`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "photo-key-1",
      },
      body: form,
    });
    const result = await uploaded.json();
    assert.equal(uploaded.status, 201, JSON.stringify(result));
    assert.equal(JSON.stringify(result).includes("storage_object_key"), false);
    assert.equal(JSON.stringify(result).includes("front-photo.webp"), false);
    assert.equal(result.photo.avatarId, avatarId);
    assert.equal(calls.storage[0].avatarId, avatarId);
    assert.equal(calls.saved[0].avatarId, avatarId);

    const status = await fetch(`${baseUrl}/api/avatars/${avatarId}`, {
      headers: { Authorization: "Bearer verified-token" },
    });
    assert.equal(status.status, 200);
    const current = await status.json();
    assert.equal(current.avatar.id, avatarId);
    assert.deepEqual(current.photos.map((photo) => photo.view), ["front"]);
  });
});

test("HTTP rejects invalid image bytes and oversized multipart uploads", async () => {
  const { context, calls } = createContext();
  await withServer(async () => context, async (baseUrl) => {
    const invalidForm = new FormData();
    invalidForm.set("photo", new Blob(["not an image"], { type: "image/jpeg" }), "bad.jpg");
    const invalid = await fetch(`${baseUrl}/api/avatars/${avatarId}/photos/front`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "invalid-photo-key",
      },
      body: invalidForm,
    });
    const invalidResult = await invalid.json();
    assert.equal(invalid.status, 400, JSON.stringify(invalidResult));
    assert.equal(invalidResult.error.code, "unsupported_photo", JSON.stringify(invalidResult));

    const oversizedForm = new FormData();
    const oversizedBytes = new Uint8Array(MAX_AVATAR_PHOTO_BYTES + 1);
    oversizedBytes.set(jpeg);
    oversizedForm.set(
      "photo",
      new Blob([oversizedBytes], { type: "image/jpeg" }),
      "large.jpg"
    );
    const oversized = await fetch(`${baseUrl}/api/avatars/${avatarId}/photos/front`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "oversized-photo-key",
      },
      body: oversizedForm,
    });
    const oversizedResult = await oversized.json();
    assert.equal(oversized.status, 413, JSON.stringify(oversizedResult));
    assert.equal(oversizedResult.error.code, "payload_too_large", JSON.stringify(oversizedResult));
    assert.equal(calls.storage.length, 0);
  });
});

test("HTTP rejects unsupported views and MIME signatures", async () => {
  const { context, calls } = createContext();
  await withServer(async () => context, async (baseUrl) => {
    const invalidViewForm = new FormData();
    invalidViewForm.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "photo.jpg");
    const invalidView = await fetch(`${baseUrl}/api/avatars/${avatarId}/photos/diagonal`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "invalid-view-key",
      },
      body: invalidViewForm,
    });
    assert.equal(invalidView.status, 400);
    assert.equal((await invalidView.json()).error.code, "invalid_request");

    const invalidMimeForm = new FormData();
    invalidMimeForm.set("photo", new Blob([jpeg], { type: "image/gif" }), "photo.gif");
    const invalidMime = await fetch(`${baseUrl}/api/avatars/${avatarId}/photos/front`, {
      method: "POST",
      headers: {
        Authorization: "Bearer verified-token",
        "Idempotency-Key": "invalid-mime-key",
      },
      body: invalidMimeForm,
    });
    assert.equal(invalidMime.status, 400);
    assert.equal((await invalidMime.json()).error.code, "unsupported_photo");
    assert.equal(calls.storage.length, 0);
  });
});