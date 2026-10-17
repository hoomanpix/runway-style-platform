import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AvatarPhotoContentType,
  AvatarPhotoView,
  AvatarGenerationJobSummary,
  AvatarStatus,
  UserId,
} from "@runway/types";
import type {
  AvatarRepository,
  OwnedAvatarPhotoRecord,
  OwnedAvatarAssetRecord,
  OwnedAvatarRecord,
  PrivateAvatarPhotoStorage,
} from "./avatar-service.ts";
import type { Database } from "./supabase-database.ts";

export const AVATAR_PHOTO_BUCKET = "avatar-photos";

export type AvatarSupabaseClient = SupabaseClient<Database>;
type AvatarSelectRow = Pick<
  Database["public"]["Tables"]["avatars"]["Row"],
  "id" | "owner_id" | "status" | "idempotency_key"
>;
type PhotoSelectRow = Pick<
  Database["public"]["Tables"]["avatar_photos"]["Row"],
  | "id"
  | "owner_id"
  | "avatar_id"
  | "view"
  | "content_type"
  | "byte_size"
  | "content_sha256"
  | "idempotency_key"
>;
type AvatarAssetSelectRow = Pick<
  Database["public"]["Tables"]["avatar_assets"]["Row"],
  "id" | "owner_id" | "avatar_id" | "kind" | "content_type" | "object_key" | "created_at"
>;

export function createUserSupabaseClient(
  supabaseUrl: string,
  publishableKey: string,
  accessToken: string
): AvatarSupabaseClient {
  return createClient<Database>(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export function createServiceSupabaseClient(
  supabaseUrl: string,
  serviceRoleKey: string
): AvatarSupabaseClient {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export class SupabaseAvatarRepository implements AvatarRepository {
  private readonly client: AvatarSupabaseClient;

  constructor(client: AvatarSupabaseClient) {
    this.client = client;
  }

  async createAvatarForOwner(
    ownerId: UserId,
    idempotencyKey: string
  ): Promise<OwnedAvatarRecord> {
    const { data, error } = await this.client
      .from("avatars")
      .insert({ owner_id: ownerId, idempotency_key: idempotencyKey })
      .select("id, owner_id, status, idempotency_key")
      .single();
    if (error) throw error;
    return mapAvatar(data);
  }

  async findAvatarForOwner(
    ownerId: UserId,
    avatarId: string
  ): Promise<OwnedAvatarRecord | null> {
    const { data, error } = await this.client
      .from("avatars")
      .select("id, owner_id, status, idempotency_key")
      .eq("owner_id", ownerId)
      .eq("id", avatarId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAvatar(data) : null;
  }

  async findAvatarForOwnerByIdempotencyKey(
    ownerId: UserId,
    idempotencyKey: string
  ): Promise<OwnedAvatarRecord | null> {
    const { data, error } = await this.client
      .from("avatars")
      .select("id, owner_id, status, idempotency_key")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAvatar(data) : null;
  }

  async listPhotosForOwner(
    ownerId: UserId,
    avatarId: string
  ): Promise<OwnedAvatarPhotoRecord[]> {
    const { data, error } = await this.client
      .from("avatar_photos")
      .select(
        "id, owner_id, avatar_id, view, content_type, byte_size, content_sha256, idempotency_key"
      )
      .eq("owner_id", ownerId)
      .eq("avatar_id", avatarId);
    if (error) throw error;
    return data.map(mapPhoto);
  }

  async findLatestAvatarAssetForOwner(
    ownerId: UserId,
    avatarId: string
  ): Promise<OwnedAvatarAssetRecord | null> {
    const { data, error } = await this.client
      .from("avatar_assets")
      .select("id, owner_id, avatar_id, kind, content_type, object_key, created_at")
      .eq("owner_id", ownerId)
      .eq("avatar_id", avatarId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAvatarAsset(data) : null;
  }

  async findLatestAvatarGenerationJobForOwner(
    ownerId: UserId,
    avatarId: string
  ): Promise<AvatarGenerationJobSummary | null> {
    const { data, error } = await this.client
      .from("generation_jobs")
      .select("id, status, progress, safe_error, attempts, updated_at")
      .eq("owner_id", ownerId)
      .eq("avatar_id", avatarId)
      .eq("kind", "avatar_generation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      status: data.status,
      progress: data.progress,
      safeError: data.safe_error,
      updatedAt: data.updated_at,
    };
  }

  async createPhotoForOwner(input: {
    ownerId: UserId;
    avatarId: string;
    view: AvatarPhotoView;
    contentType: AvatarPhotoContentType;
    byteSize: number;
    contentSha256: string;
    idempotencyKey: string;
    storageObjectKey: string;
  }): Promise<OwnedAvatarPhotoRecord> {
    const { data, error } = await this.client
      .from("avatar_photos")
      .insert({
        owner_id: input.ownerId,
        avatar_id: input.avatarId,
        view: input.view,
        content_type: input.contentType,
        byte_size: input.byteSize,
        content_sha256: input.contentSha256,
        idempotency_key: input.idempotencyKey,
        storage_object_key: input.storageObjectKey,
      })
      .select(
        "id, owner_id, avatar_id, view, content_type, byte_size, content_sha256, idempotency_key"
      )
      .single();
    if (error) throw error;
    return mapPhoto(data);
  }

  async findPhotoForOwnerByIdempotencyKey(
    ownerId: UserId,
    idempotencyKey: string
  ): Promise<OwnedAvatarPhotoRecord | null> {
    const { data, error } = await this.client
      .from("avatar_photos")
      .select(
        "id, owner_id, avatar_id, view, content_type, byte_size, content_sha256, idempotency_key"
      )
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPhoto(data) : null;
  }
}

export class SupabasePrivateAvatarPhotoStorage implements PrivateAvatarPhotoStorage {
  private readonly client: AvatarSupabaseClient;

  constructor(client: AvatarSupabaseClient) {
    this.client = client;
  }

  async uploadPrivate(input: {
    ownerId: UserId;
    avatarId: string;
    view: AvatarPhotoView;
    contentType: AvatarPhotoContentType;
    bytes: Uint8Array;
  }): Promise<{ objectKey: string }> {
    const extension = extensionForContentType(input.contentType);
    const objectKey = `${input.ownerId}/${input.avatarId}/${input.view}-${randomUUID()}.${extension}`;
    const { data, error } = await this.client.storage
      .from(AVATAR_PHOTO_BUCKET)
      .upload(objectKey, Buffer.from(input.bytes), {
        contentType: input.contentType,
        upsert: false,
      });
    if (error) throw error;
    if (!data?.path || data.path !== objectKey) {
      throw new Error("Storage returned an unexpected object path.");
    }
    return { objectKey: data.path };
  }

  async removePrivate(input: { ownerId: UserId; objectKey: string }): Promise<void> {
    if (!input.objectKey.startsWith(`${input.ownerId}/`)) {
      throw new Error("Refusing to remove an object outside the owner path.");
    }
    const { error } = await this.client.storage
      .from(AVATAR_PHOTO_BUCKET)
      .remove([input.objectKey]);
    if (error) throw error;
  }

  async createSignedReadUrl(input: {
    ownerId: UserId;
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string> {
    if (
      !input.objectKey.startsWith(`${input.ownerId}/`) ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < 30 ||
      input.expiresInSeconds > 600
    ) {
      throw new Error("Refusing to sign an invalid owner-scoped object.");
    }
    const { data, error } = await this.client.storage
      .from("generated-media")
      .createSignedUrl(input.objectKey, input.expiresInSeconds);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Storage did not return a signed URL.");
    return data.signedUrl;
  }
}

function mapAvatar(row: AvatarSelectRow): OwnedAvatarRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    status: row.status satisfies AvatarStatus,
    idempotencyKey: row.idempotency_key,
  };
}

function mapPhoto(row: PhotoSelectRow): OwnedAvatarPhotoRecord {
  return {
    id: row.id,
    avatarId: row.avatar_id,
    ownerId: row.owner_id,
    view: row.view,
    contentType: row.content_type,
    byteSize: row.byte_size,
    contentSha256: row.content_sha256,
    idempotencyKey: row.idempotency_key,
  };
}

function mapAvatarAsset(
  row: AvatarAssetSelectRow
): OwnedAvatarAssetRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    avatarId: row.avatar_id,
    kind: row.kind,
    contentType: row.content_type,
    objectKey: row.object_key,
    createdAt: row.created_at,
  };
}

function extensionForContentType(contentType: AvatarPhotoContentType): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}