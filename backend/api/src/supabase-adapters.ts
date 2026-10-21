import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AvatarGenerationJobSummary,
  AvatarPhotoContentType,
  AvatarPhotoView,
  AvatarStatus,
  GenerationJobKind,
  GenerationJobStatus,
  UserId,
} from "@runway/types";
import type {
  AvatarRepository,
  OwnedAvatarAssetRecord,
  OwnedAvatarPhotoRecord,
  OwnedAvatarRecord,
  PrivateAvatarPhotoStorage,
} from "./avatar-service.ts";
import type { AvatarGenerationRepository, GenerationJobRecord } from "./generation-service.ts";
import type { Database } from "./supabase-database.ts";

export const AVATAR_PHOTO_BUCKET = "avatar-photos";
export const GENERATED_MEDIA_BUCKET = "generated-media";
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
  | "storage_object_key"
>;
type AvatarAssetSelectRow = Pick<
  Database["public"]["Tables"]["avatar_assets"]["Row"],
  "id" | "owner_id" | "avatar_id" | "kind" | "content_type" | "object_key" | "created_at"
>;
type GenerationJobSelectRow = Pick<
  Database["public"]["Tables"]["generation_jobs"]["Row"],
  | "id"
  | "owner_id"
  | "avatar_id"
  | "kind"
  | "status"
  | "idempotency_key"
  | "input"
  | "progress"
  | "safe_error"
  | "attempts"
  | "updated_at"
>;

export function createUserSupabaseClient(
  supabaseUrl: string,
  publishableKey: string,
  accessToken: string
): AvatarSupabaseClient {
  return createClient<Database>(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function createServiceSupabaseClient(
  supabaseUrl: string,
  serviceRoleKey: string
): AvatarSupabaseClient {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

export class SupabaseAvatarRepository implements AvatarRepository, AvatarGenerationRepository {
  private readonly client: AvatarSupabaseClient;

  constructor(client: AvatarSupabaseClient) {
    this.client = client;
  }

  async createAvatarForOwner(ownerId: UserId, idempotencyKey: string): Promise<OwnedAvatarRecord> {
    const { data, error } = await this.client
      .from("avatars")
      .insert({ owner_id: ownerId, idempotency_key: idempotencyKey })
      .select("id, owner_id, status, idempotency_key")
      .single();
    if (error) throw error;
    return mapAvatar(data);
  }

  async findAvatarForOwner(ownerId: UserId, avatarId: string): Promise<OwnedAvatarRecord | null> {
    const { data, error } = await this.client
      .from("avatars")
      .select("id, owner_id, status, idempotency_key")
      .eq("owner_id", ownerId)
      .eq("id", avatarId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAvatar(data) : null;
  }

  async findAvatarForOwnerByIdempotencyKey(ownerId: UserId, idempotencyKey: string): Promise<OwnedAvatarRecord | null> {
    const { data, error } = await this.client
      .from("avatars")
      .select("id, owner_id, status, idempotency_key")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAvatar(data) : null;
  }

  async listPhotosForOwner(ownerId: UserId, avatarId: string): Promise<OwnedAvatarPhotoRecord[]> {
    const { data, error } = await this.client
      .from("avatar_photos")
      .select("id, owner_id, avatar_id, view, content_type, byte_size, content_sha256, idempotency_key, storage_object_key")
      .eq("owner_id", ownerId)
      .eq("avatar_id", avatarId);
    if (error) throw error;
    return data.map(mapPhoto);
  }

  async findLatestAvatarAssetForOwner(ownerId: UserId, avatarId: string): Promise<OwnedAvatarAssetRecord | null> {
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

  async findLatestAvatarGenerationJobForOwner(ownerId: UserId, avatarId: string): Promise<AvatarGenerationJobSummary | null> {
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
    return { id: data.id, status: data.status, progress: data.progress, safeError: data.safe_error, updatedAt: data.updated_at };
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
      .select("id, owner_id, avatar_id, view, content_type, byte_size, content_sha256, idempotency_key, storage_object_key")
      .single();
    if (error) throw error;
    return mapPhoto(data);
  }

  async findPhotoForOwnerByIdempotencyKey(ownerId: UserId, idempotencyKey: string): Promise<OwnedAvatarPhotoRecord | null> {
    const { data, error } = await this.client
      .from("avatar_photos")
      .select("id, owner_id, avatar_id, view, content_type, byte_size, content_sha256, idempotency_key, storage_object_key")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPhoto(data) : null;
  }

  async createGenerationJobForOwner(input: {
    ownerId: UserId;
    avatarId: string;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }): Promise<GenerationJobRecord> {
    const { data, error } = await this.client
      .from("generation_jobs")
      .insert({ owner_id: input.ownerId, avatar_id: input.avatarId, kind: "avatar_generation", idempotency_key: input.idempotencyKey, input: input.input })
      .select("id, owner_id, avatar_id, kind, status, idempotency_key, input, progress, safe_error, attempts, updated_at")
      .single();
    if (error) throw error;
    return mapGenerationJob(data);
  }

  async findGenerationJobForOwnerByIdempotencyKey(ownerId: UserId, idempotencyKey: string): Promise<GenerationJobRecord | null> {
    const { data, error } = await this.client
      .from("generation_jobs")
      .select("id, owner_id, avatar_id, kind, status, idempotency_key, input, progress, safe_error, attempts, updated_at")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .eq("kind", "avatar_generation")
      .maybeSingle();
    if (error) throw error;
    return data ? mapGenerationJob(data) : null;
  }

  async claimNextAvatarGenerationJob(workerId: string, leaseSeconds = 120): Promise<GenerationJobRecord | null> {
    const { data, error } = await this.client.rpc("claim_generation_job", { p_worker_id: workerId, p_lease_seconds: leaseSeconds });
    if (error) throw error;
    const row = data?.[0];
    return row ? mapGenerationJob(row) : null;
  }

  async setGenerationProviderJob(input: { jobId: string; workerId: string; provider: string; providerJobId: string }): Promise<void> {
    const { error } = await this.client
      .from("generation_jobs")
      .update({ provider: input.provider, provider_job_id: input.providerJobId, updated_at: new Date().toISOString() })
      .eq("id", input.jobId)
      .eq("locked_by", input.workerId)
      .eq("status", "processing");
    if (error) throw error;
  }

  async completeAvatarGenerationJob(input: {
    jobId: string;
    workerId: string;
    ownerId: UserId;
    avatarId: string;
    objectKey: string;
    contentType: string;
    provider: string;
    model: string;
  }): Promise<void> {
    const { error } = await this.client.rpc("complete_avatar_generation_job", {
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_owner_id: input.ownerId,
      p_avatar_id: input.avatarId,
      p_object_key: input.objectKey,
      p_content_type: input.contentType,
      p_provider: input.provider,
      p_model: input.model,
    });
    if (error) throw error;
  }

  async failAvatarGenerationJob(input: { jobId: string; workerId: string; safeError: string; retryable: boolean }): Promise<void> {
    const { error } = await this.client.rpc("fail_avatar_generation_job", {
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_safe_error: input.safeError.slice(0, 500),
      p_retryable: input.retryable,
    });
    if (error) throw error;
  }
}

export class SupabasePrivateAvatarPhotoStorage implements PrivateAvatarPhotoStorage {
  private readonly client: AvatarSupabaseClient;
  constructor(client: AvatarSupabaseClient) { this.client = client; }

  async uploadPrivate(input: { ownerId: UserId; avatarId: string; view: AvatarPhotoView; contentType: AvatarPhotoContentType; bytes: Uint8Array }): Promise<{ objectKey: string }> {
    const extension = extensionForContentType(input.contentType);
    const objectKey = `${input.ownerId}/${input.avatarId}/${input.view}-${randomUUID()}.${extension}`;
    const { data, error } = await this.client.storage.from(AVATAR_PHOTO_BUCKET).upload(objectKey, Buffer.from(input.bytes), { contentType: input.contentType, upsert: false });
    if (error) throw error;
    if (!data?.path || data.path !== objectKey) throw new Error("Storage returned an unexpected object path.");
    return { objectKey: data.path };
  }

  async removePrivate(input: { ownerId: UserId; objectKey: string }): Promise<void> {
    if (!input.objectKey.startsWith(`${input.ownerId}/`)) {
      throw new Error("Refusing to remove an object outside the owner path.");
    }
    const { error } = await this.client.storage.from(AVATAR_PHOTO_BUCKET).remove([input.objectKey]);
    if (error) throw error;
  }

  async createSignedReadUrl(input: { ownerId: UserId; objectKey: string; expiresInSeconds: number }): Promise<string> {
    assertScopedObject(input.ownerId, input.objectKey, input.expiresInSeconds);
    const { data, error } = await this.client.storage.from(GENERATED_MEDIA_BUCKET).createSignedUrl(input.objectKey, input.expiresInSeconds);
    if (error || !data?.signedUrl) throw error ?? new Error("Storage did not return a signed URL.");
    return data.signedUrl;
  }
}

export class SupabaseAvatarGenerationStorage {
  private readonly client: AvatarSupabaseClient;
  constructor(client: AvatarSupabaseClient) { this.client = client; }

  async createSignedPhotoReadUrl(input: { ownerId: UserId; objectKey: string; expiresInSeconds: number }): Promise<string> {
    assertScopedObject(input.ownerId, input.objectKey, input.expiresInSeconds);
    const { data, error } = await this.client.storage.from(AVATAR_PHOTO_BUCKET).createSignedUrl(input.objectKey, input.expiresInSeconds);
    if (error || !data?.signedUrl) throw error ?? new Error("Storage did not return a signed URL.");
    return data.signedUrl;
  }

  async uploadGeneratedMedia(input: { ownerId: UserId; avatarId: string; jobId: string; contentType: "image/jpeg" | "image/png"; bytes: Uint8Array }): Promise<{ objectKey: string }> {
    const extension = input.contentType === "image/jpeg" ? "jpg" : "png";
    const objectKey = `${input.ownerId}/${input.avatarId}/generation-${input.jobId}.${extension}`;
    const { data, error } = await this.client.storage.from(GENERATED_MEDIA_BUCKET).upload(objectKey, Buffer.from(input.bytes), { contentType: input.contentType, upsert: false });
    if (error || data?.path !== objectKey) throw error ?? new Error("Storage returned an unexpected object path.");
    return { objectKey };
  }

  async removeGeneratedMedia(ownerId: UserId, objectKey: string): Promise<void> {
    if (!objectKey.startsWith(`${ownerId}/`)) throw new Error("Refusing to remove an object outside the owner path.");
    const { error } = await this.client.storage.from(GENERATED_MEDIA_BUCKET).remove([objectKey]);
    if (error) throw error;
  }
}

function mapAvatar(row: AvatarSelectRow): OwnedAvatarRecord {
  return { id: row.id, ownerId: row.owner_id, status: row.status satisfies AvatarStatus, idempotencyKey: row.idempotency_key };
}

function mapPhoto(row: PhotoSelectRow): OwnedAvatarPhotoRecord {
  return { id: row.id, avatarId: row.avatar_id, ownerId: row.owner_id, view: row.view, contentType: row.content_type, byteSize: row.byte_size, contentSha256: row.content_sha256, idempotencyKey: row.idempotency_key, storageObjectKey: row.storage_object_key };
}

function mapAvatarAsset(row: AvatarAssetSelectRow): OwnedAvatarAssetRecord {
  return { id: row.id, ownerId: row.owner_id, avatarId: row.avatar_id, kind: row.kind, contentType: row.content_type, objectKey: row.object_key, createdAt: row.created_at };
}

function mapGenerationJob(row: GenerationJobSelectRow): GenerationJobRecord {
  if (!row.avatar_id) throw new Error("Generation job is missing its avatar ID.");
  return { id: row.id, ownerId: row.owner_id, avatarId: row.avatar_id, kind: row.kind as GenerationJobKind, status: row.status as GenerationJobStatus, idempotencyKey: row.idempotency_key, input: row.input, progress: row.progress, safeError: row.safe_error, attempts: row.attempts, updatedAt: row.updated_at };
}

function assertScopedObject(ownerId: UserId, objectKey: string, expiresInSeconds = 60): void {
  if (!objectKey.startsWith(`${ownerId}/`) || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > 600) {
    throw new Error("Refusing to access an invalid owner-scoped object.");
  }
}

function extensionForContentType(contentType: AvatarPhotoContentType): string {
  switch (contentType) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
  }
}
