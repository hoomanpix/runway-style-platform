import assert from "node:assert/strict";
import test from "node:test";

import { AvatarApiClientError } from "../lib/avatar-api.ts";
import { AvatarWorkflow, MissingPhotoViewsError } from "../lib/avatar-workflow.ts";

const views = ["front", "left", "right", "back"];
const fileFor = (view, digest = `digest-${view}`) => ({
  uri: `file:///${view}.jpg`,
  fileName: `${view}.jpg`,
  contentType: "image/jpeg",
  byteSize: 100,
  sha256: digest,
});

function createStorage() {
  const values = new Map();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

function emptyAvatar(id = "canonical-avatar") {
  return { avatar: { id, status: "collecting_photos" }, photos: [] };
}

test("requires every not-yet-uploaded photo view before starting any upload", async () => {
  const storage = createStorage();
  const calls = [];
  const api = {
    async getAvatar() { return emptyAvatar(); },
    async uploadPhoto(...args) { calls.push(args); },
  };
  const workflow = new AvatarWorkflow(api, storage, "user-1", () => "key-12345678");
  await assert.rejects(
    workflow.uploadSelected(emptyAvatar(), { front: fileFor("front") }, () => {}, () => {}),
    (error) => {
      assert.ok(error instanceof MissingPhotoViewsError);
      assert.deepEqual(error.missingViews, ["left", "right", "back"]);
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test("persists create idempotency before the request and resumes the canonical avatar", async () => {
  const storage = createStorage();
  const createKeys = [];
  let avatar = emptyAvatar();
  const api = {
    async createAvatar(key) { createKeys.push(key); return { avatar: avatar.avatar }; },
    async getAvatar(id) { assert.equal(id, "canonical-avatar"); return avatar; },
  };
  const workflow = new AvatarWorkflow(api, storage, "user-1", () => "create-key-123456");
  const result = await workflow.resume();
  assert.equal(result.avatar.id, "canonical-avatar");
  assert.deepEqual(createKeys, ["create-key-123456"]);
  assert.equal(storage.values.get("runway.avatar.user-1.active-id"), "canonical-avatar");
});

test("retains the same key after a failed upload and changes it for different content", async () => {
  const storage = createStorage();
  const uploadKeys = [];
  let shouldFail = true;
  const api = {
    async uploadPhoto(avatarId, view, file, key) {
      uploadKeys.push({ avatarId, view, digest: file.sha256, key });
      if (shouldFail) {
        shouldFail = false;
        throw new AvatarApiClientError("network", "Retry safely.");
      }
      return { photo: { id: "photo-1", avatarId, view, contentType: file.contentType, byteSize: file.byteSize } };
    },
  };
  const workflow = new AvatarWorkflow(api, storage, "user-1", () => `random-key-${uploadKeys.length}-123456`);
  const snapshot = emptyAvatar();
  const selection = Object.fromEntries(views.map((view) => [view, fileFor(view)]));
  await assert.rejects(workflow.uploadSelected(snapshot, selection, () => {}, () => {}));
  await workflow.uploadSelected(snapshot, selection, () => {}, () => {});
  assert.equal(uploadKeys[0].key, uploadKeys[1].key);
  await workflow.uploadSelected(
    snapshot,
    { ...selection, front: fileFor("front", "different-digest") },
    () => {},
    () => {}
  );
  assert.notEqual(uploadKeys[1].key, uploadKeys[2].key);
  assert.ok(uploadKeys.every((call) => call.avatarId === snapshot.avatar.id));
});

test("recovers partial uploads from server state and preserves one avatar ID", async () => {
  const storage = createStorage();
  const uploaded = new Map();
  const calls = [];
  let failOnce = true;
  const api = {
    async createAvatar() { return { avatar: { id: "canonical-avatar" } }; },
    async getAvatar(id) {
      return {
        ...emptyAvatar(id),
        photos: [...uploaded.values()],
      };
    },
    async uploadPhoto(avatarId, view, file, key) {
      calls.push({ avatarId, view, key });
      if (view === "left" && failOnce) {
        failOnce = false;
        throw new AvatarApiClientError("timeout", "Timed out.");
      }
      const photo = { id: `photo-${view}`, avatarId, view, contentType: file.contentType, byteSize: file.byteSize };
      uploaded.set(view, photo);
      return { photo };
    },
  };
  const workflow = new AvatarWorkflow(api, storage, "user-1", () => `operation-${calls.length}-123456`);
  const initial = await workflow.resume();
  const selection = Object.fromEntries(views.map((view) => [view, fileFor(view)]));
  await assert.rejects(workflow.uploadSelected(initial, selection, () => {}, () => {}));
  const recovered = await workflow.resume();
  assert.deepEqual(recovered.photos.map((photo) => photo.view), ["front"]);
  await workflow.uploadSelected(recovered, selection, () => {}, () => {});
  assert.equal(calls.filter((call) => call.view === "front").length, 1);
  assert.ok(calls.every((call) => call.avatarId === initial.avatar.id));
  assert.deepEqual([...uploaded.keys()], views);
});