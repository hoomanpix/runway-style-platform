import assert from "node:assert/strict";
import test from "node:test";

import {
  AVATAR_PHOTO_BUCKET,
  SupabaseAvatarRepository,
  SupabasePrivateAvatarPhotoStorage,
} from "../src/supabase-adapters.ts";

function createQueryClient(rows) {
  const calls = [];
  const client = {
    from(table) {
      const query = {
        table,
        filters: [],
        select(columns) {
          calls.push({ kind: "select", table, columns });
          return this;
        },
        eq(column, value) {
          this.filters.push([column, value]);
          calls.push({ kind: "filter", table, column, value });
          return this;
        },
        async maybeSingle() {
          const row = rows[table] ?? null;
          const matches = row && this.filters.every(([column, value]) => {
            const field = column === "owner_id" ? "owner_id" : column;
            return row[field] === value;
          });
          return { data: matches ? row : null, error: null };
        },
      };
      return query;
    },
  };
  return { client, calls };
}

test("repository queries include owner filters and hide another user's avatar", async () => {
  const { client, calls } = createQueryClient({
    avatars: {
      id: "avatar-owned-by-user-2",
      owner_id: "user-2",
      status: "collecting_photos",
      idempotency_key: "avatar-key-2",
    },
  });
  const repository = new SupabaseAvatarRepository(client);
  const avatar = await repository.findAvatarForOwner("user-1", "avatar-owned-by-user-2");
  assert.equal(avatar, null);
  assert.ok(calls.some((call) => call.kind === "filter" && call.column === "owner_id" && call.value === "user-1"));
  assert.ok(calls.some((call) => call.kind === "filter" && call.column === "id"));
});

test("storage creates owner/avatar-scoped objects without upsert", async () => {
  let uploadCall;
  const client = {
    storage: {
      from(bucket) {
        assert.equal(bucket, AVATAR_PHOTO_BUCKET);
        return {
          async upload(path, bytes, options) {
            uploadCall = { path, bytes, options };
            return { data: { path }, error: null };
          },
        };
      },
    },
  };
  const storage = new SupabasePrivateAvatarPhotoStorage(client);
  const result = await storage.uploadPrivate({
    ownerId: "user-1",
    avatarId: "avatar-1",
    view: "left",
    contentType: "image/jpeg",
    bytes: Uint8Array.of(0xff, 0xd8, 0xff),
  });
  assert.match(result.objectKey, /^user-1\/avatar-1\/left-[0-9a-f-]+\.jpg$/);
  assert.equal(uploadCall.path, result.objectKey);
  assert.equal(uploadCall.options.upsert, false);
  assert.equal(uploadCall.options.contentType, "image/jpeg");
});

test("storage refuses cleanup outside the verified owner's prefix", async () => {
  let removeCalled = false;
  const client = {
    storage: {
      from() {
        return {
          async remove() {
            removeCalled = true;
            return { error: null };
          },
        };
      },
    },
  };
  const storage = new SupabasePrivateAvatarPhotoStorage(client);
  await assert.rejects(
    storage.removePrivate({ ownerId: "user-1", objectKey: "user-2/avatar-2/file.jpg" }),
    /outside the owner path/
  );
  assert.equal(removeCalled, false);
});