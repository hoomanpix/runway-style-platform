import assert from "node:assert/strict";
import test from "node:test";

import {
  AvatarPhotoValidationError,
  MAX_AVATAR_PHOTO_BYTES,
  missingAvatarPhotoViews,
  validateAvatarPhoto,
} from "@runway/shared/avatar";
import {
  AvatarApiError,
  createAvatar,
  uploadAvatarPhoto,
} from "../src/avatar-service.ts";

const owner = { userId: "user-1" };
const avatar = {
  id: "avatar-1",
  ownerId: owner.userId,
  status: "collecting_photos",
  idempotencyKey: "avatar-key-1",
};
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x01);

function createDependencies(overrides = {}) {
  const calls = { avatarCreates: [], storage: [], saved: [], removed: [] };
  const avatarsByKey = new Map();
  const photosByKey = new Map();
  const repository = {
    async createAvatarForOwner(ownerId, idempotencyKey) {
      calls.avatarCreates.push({ ownerId, idempotencyKey });
      if (avatarsByKey.has(`${ownerId}:${idempotencyKey}`)) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      const created = { ...avatar, ownerId, idempotencyKey };
      avatarsByKey.set(`${ownerId}:${idempotencyKey}`, created);
      return created;
    },
    async findAvatarForOwner(ownerId, avatarId) {
      return avatar.ownerId === ownerId && avatar.id === avatarId ? avatar : null;
    },
    async findAvatarForOwnerByIdempotencyKey(ownerId, idempotencyKey) {
      return avatarsByKey.get(`${ownerId}:${idempotencyKey}`) ?? null;
    },
    async createPhotoForOwner(input) {
      const key = `${input.ownerId}:${input.idempotencyKey}`;
      if (
        photosByKey.has(key) ||
        calls.saved.some((photo) => photo.avatarId === input.avatarId && photo.view === input.view)
      ) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      calls.saved.push(input);
      const created = {
        id: "photo-1",
        ownerId: input.ownerId,
        avatarId: input.avatarId,
        view: input.view,
        contentType: input.contentType,
        byteSize: input.byteSize,
        contentSha256: input.contentSha256,
        idempotencyKey: input.idempotencyKey,
      };
      photosByKey.set(key, created);
      return created;
    },
    async findPhotoForOwnerByIdempotencyKey(ownerId, idempotencyKey) {
      return photosByKey.get(`${ownerId}:${idempotencyKey}`) ?? null;
    },
    ...overrides.repository,
  };
  const storage = {
    async uploadPrivate(input) {
      calls.storage.push(input);
      return { objectKey: "private/avatar-photo-1" };
    },
    async removePrivate(input) {
      calls.removed.push(input);
    },
    ...overrides.storage,
  };
  return { dependencies: { repository, storage }, calls };
}

test("validates view-specific supported image bytes and size", () => {
  assert.deepEqual(validateAvatarPhoto("image/jpeg; charset=binary", jpeg), {
    contentType: "image/jpeg",
    byteSize: jpeg.byteLength,
  });
  assert.throws(
    () => validateAvatarPhoto("image/png", jpeg),
    AvatarPhotoValidationError
  );
  assert.throws(
    () => validateAvatarPhoto("image/jpeg", new Uint8Array(MAX_AVATAR_PHOTO_BYTES + 1)),
    AvatarPhotoValidationError
  );
  assert.throws(
    () => validateAvatarPhoto("image/jpeg", new Uint8Array()),
    AvatarPhotoValidationError
  );
});

test("reports missing required views in canonical order", () => {
  assert.deepEqual(missingAvatarPhotoViews([{ view: "left" }, { view: "left" }]), [
    "front",
    "right",
    "back",
  ]);
});

test("rejects missing authentication before creating an avatar", async () => {
  let createCalled = false;
  const repository = {
    async createAvatarForOwner() {
      createCalled = true;
      return avatar;
    },
  };
  await assert.rejects(createAvatar(null, "avatar-key-1", repository), (error) => {
    assert.ok(error instanceof AvatarApiError);
    assert.equal(error.code, "unauthenticated");
    return true;
  });
  assert.equal(createCalled, false);
});

test("replays an avatar creation with the same idempotency key", async () => {
  const { dependencies, calls } = createDependencies();
  const first = await createAvatar(owner, "avatar-retry-key", dependencies.repository);
  const replay = await createAvatar(owner, "avatar-retry-key", dependencies.repository);
  assert.equal(first.avatar.id, replay.avatar.id);
  assert.equal(calls.avatarCreates.length, 2);
});

test("rejects malformed avatar records returned by the repository", async () => {
  for (const invalidAvatar of [
    { ...avatar, id: " " },
    { ...avatar, ownerId: "another-user" },
    { ...avatar, status: "ready" },
  ]) {
    await assert.rejects(
      createAvatar(owner, "avatar-key-1", {
        async createAvatarForOwner() {
          return invalidAvatar;
        },
      }),
      (error) => error.code === "avatar_persistence_failed"
    );
  }
});

test("does not upload when the avatar is not owned by the principal", async () => {
  const { dependencies, calls } = createDependencies({
    repository: {
      async findAvatarForOwner() {
        return { ...avatar, ownerId: "another-user" };
      },
    },
  });
  await assert.rejects(
    uploadAvatarPhoto(owner, {
      avatarId: avatar.id,
      view: "front",
      contentType: "image/jpeg",
      bytes: jpeg,
    }, "upload-key-1", dependencies),
    (error) => error.code === "avatar_not_found"
  );
  assert.equal(calls.storage.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("returns success only after private storage and record persistence use the same avatar ID", async () => {
  const { dependencies, calls } = createDependencies();
  const created = await createAvatar(owner, "avatar-key-1", dependencies.repository);
  const uploaded = await uploadAvatarPhoto(owner, {
    avatarId: created.avatar.id,
    view: "front",
    contentType: "image/jpeg",
    bytes: jpeg,
  }, "upload-key-1", dependencies);

  assert.equal(calls.storage[0].avatarId, created.avatar.id);
  assert.equal(calls.saved[0].avatarId, created.avatar.id);
  assert.equal(uploaded.photo.avatarId, created.avatar.id);
  assert.equal(uploaded.photo.id, "photo-1");
});

test("replays an identical photo request without uploading a second object", async () => {
  const { dependencies, calls } = createDependencies();
  const first = await uploadAvatarPhoto(owner, {
    avatarId: avatar.id,
    view: "front",
    contentType: "image/jpeg",
    bytes: jpeg,
  }, "photo-retry-key", dependencies);
  const replay = await uploadAvatarPhoto(owner, {
    avatarId: avatar.id,
    view: "front",
    contentType: "image/jpeg",
    bytes: jpeg,
  }, "photo-retry-key", dependencies);
  assert.deepEqual(replay, first);
  assert.equal(calls.storage.length, 1);
});

test("rejects a reused photo idempotency key with different content", async () => {
  const { dependencies, calls } = createDependencies();
  const request = {
    avatarId: avatar.id,
    view: "front",
    contentType: "image/jpeg",
  };
  await uploadAvatarPhoto(owner, { ...request, bytes: jpeg }, "photo-retry-key", dependencies);
  await assert.rejects(
    uploadAvatarPhoto(
      owner,
      { ...request, bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0x02) },
      "photo-retry-key",
      dependencies
    ),
    (error) => error.code === "idempotency_conflict"
  );
  assert.equal(calls.storage.length, 1);
});

test("rejects a duplicate view under a different key and cleans up its object", async () => {
  const { dependencies, calls } = createDependencies();
  await uploadAvatarPhoto(owner, {
    avatarId: avatar.id,
    view: "front",
    contentType: "image/jpeg",
    bytes: jpeg,
  }, "photo-first-key", dependencies);
  await assert.rejects(
    uploadAvatarPhoto(owner, {
      avatarId: avatar.id,
      view: "front",
      contentType: "image/jpeg",
      bytes: jpeg,
    }, "photo-second-key", dependencies),
    (error) => error.code === "photo_already_exists"
  );
  assert.equal(calls.storage.length, 2);
  assert.equal(calls.removed.length, 1);
});

test("maps storage errors to a safe failure and does not persist a photo", async () => {
  const { dependencies, calls } = createDependencies({
    storage: {
      async uploadPrivate() {
        throw new Error("private bucket credential leaked");
      },
    },
  });
  await assert.rejects(
    uploadAvatarPhoto(owner, {
      avatarId: avatar.id,
      view: "front",
      contentType: "image/jpeg",
      bytes: jpeg,
    }, "upload-key-1", dependencies),
    (error) => {
      assert.equal(error.code, "photo_storage_failed");
      assert.equal(error.message.includes("credential"), false);
      return true;
    }
  );
  assert.equal(calls.saved.length, 0);
});

test("maps malformed storage results to a safe failure", async () => {
  const { dependencies, calls } = createDependencies({
    storage: {
      async uploadPrivate() {
        return undefined;
      },
    },
  });
  await assert.rejects(
    uploadAvatarPhoto(owner, {
      avatarId: avatar.id,
      view: "front",
      contentType: "image/jpeg",
      bytes: jpeg,
    }, "upload-key-1", dependencies),
    (error) => error.code === "photo_storage_failed"
  );
  assert.equal(calls.saved.length, 0);
});

test("cleans up a stored object if photo persistence fails", async () => {
  const { dependencies, calls } = createDependencies({
    repository: {
      async createPhotoForOwner() {
        throw new Error("database details");
      },
    },
  });
  await assert.rejects(
    uploadAvatarPhoto(owner, {
      avatarId: avatar.id,
      view: "back",
      contentType: "image/jpeg",
      bytes: jpeg,
    }, "upload-key-1", dependencies),
    (error) => error.code === "photo_persistence_failed"
  );
  assert.deepEqual(calls.removed, [
    { ownerId: owner.userId, objectKey: "private/avatar-photo-1" },
  ]);
});

test("cleans up stored data when the repository returns a malformed photo", async () => {
  const { dependencies, calls } = createDependencies({
    repository: {
      async createPhotoForOwner(input) {
        return {
          id: " ",
          ownerId: input.ownerId,
          avatarId: input.avatarId,
          view: input.view,
          contentType: input.contentType,
          byteSize: input.byteSize,
        };
      },
    },
  });
  await assert.rejects(
    uploadAvatarPhoto(owner, {
      avatarId: avatar.id,
      view: "back",
      contentType: "image/jpeg",
      bytes: jpeg,
    }, "upload-key-1", dependencies),
    (error) => error.code === "photo_persistence_failed"
  );
  assert.deepEqual(calls.removed, [
    { ownerId: owner.userId, objectKey: "private/avatar-photo-1" },
  ]);
});