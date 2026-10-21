import { createHash } from "node:crypto";

import {
  AvatarPhotoValidationError,
  isAvatarPhotoView,
  validateAvatarPhoto,
} from "@runway/shared/avatar";
import type {
  AvatarApiErrorCode,
  AvatarId,
  AvatarPhotoContentType,
  AvatarPhotoId,
  AvatarPhotoView,
  AvatarStatus,
  AvatarGeneratedAssetSummary,
  AvatarGenerationJobSummary,
  CreateAvatarResponse,
  GetAvatarResponse,
  UploadAvatarPhotoResponse,
  UserId,
} from "@runway/types";

export interface AuthenticatedPrincipal {
  userId: UserId;
}

export interface OwnedAvatarRecord {
  id: AvatarId;
  ownerId: UserId;
  status: AvatarStatus;
  idempotencyKey: string;
}

export interface OwnedAvatarPhotoRecord {
  id: AvatarPhotoId;
  avatarId: AvatarId;
  ownerId: UserId;
  view: AvatarPhotoView;
  contentType: AvatarPhotoContentType;
  byteSize: number;
  contentSha256: string;
  idempotencyKey: string;
  storageObjectKey: string;
}

export interface OwnedAvatarAssetRecord {
  id: string;
  ownerId: UserId;
  avatarId: AvatarId;
  kind: "image_2d" | "model_3d";
  contentType: string;
  objectKey: string;
  createdAt: string;
}

export interface AvatarRepository {
  createAvatarForOwner(ownerId: UserId, idempotencyKey: string): Promise<OwnedAvatarRecord>;
  findAvatarForOwner(ownerId: UserId, avatarId: AvatarId): Promise<OwnedAvatarRecord | null>;
  findAvatarForOwnerByIdempotencyKey(
    ownerId: UserId,
    idempotencyKey: string
  ): Promise<OwnedAvatarRecord | null>;
  listPhotosForOwner(
    ownerId: UserId,
    avatarId: AvatarId
  ): Promise<OwnedAvatarPhotoRecord[]>;
  findLatestAvatarAssetForOwner(
    ownerId: UserId,
    avatarId: AvatarId
  ): Promise<OwnedAvatarAssetRecord | null>;
  findLatestAvatarGenerationJobForOwner(
    ownerId: UserId,
    avatarId: AvatarId
  ): Promise<AvatarGenerationJobSummary | null>;
  createPhotoForOwner(input: {
    ownerId: UserId;
    avatarId: AvatarId;
    view: AvatarPhotoView;
    contentType: AvatarPhotoContentType;
    byteSize: number;
    contentSha256: string;
    idempotencyKey: string;
    storageObjectKey: string;
  }): Promise<OwnedAvatarPhotoRecord>;
  findPhotoForOwnerByIdempotencyKey(
    ownerId: UserId,
    idempotencyKey: string
  ): Promise<OwnedAvatarPhotoRecord | null>;
}

export interface PrivateAvatarPhotoStorage {
  uploadPrivate(input: {
    ownerId: UserId;
    avatarId: AvatarId;
    view: AvatarPhotoView;
    contentType: AvatarPhotoContentType;
    bytes: Uint8Array;
  }): Promise<{ objectKey: string }>;
  removePrivate(input: { ownerId: UserId; objectKey: string }): Promise<void>;
  createSignedReadUrl(input: {
    ownerId: UserId;
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

export interface AvatarServiceDependencies {
  repository: AvatarRepository;
  storage: PrivateAvatarPhotoStorage;
}

export interface UploadAvatarPhotoInput {
  avatarId: AvatarId;
  view: unknown;
  contentType: unknown;
  bytes: unknown;
}

export class AvatarApiError extends Error {
  readonly code: AvatarApiErrorCode;
  readonly status: number;

  constructor(
    code: AvatarApiErrorCode,
    status: number,
    message: string
  ) {
    super(message);
    this.name = "AvatarApiError";
    this.code = code;
    this.status = status;
  }
}

export async function createAvatar(
  principal: AuthenticatedPrincipal | null | undefined,
  idempotencyKey: unknown,
  repository: AvatarRepository
): Promise<CreateAvatarResponse> {
  const userId = requireUserId(principal);
  const key = requireIdempotencyKey(idempotencyKey);
  let avatar: OwnedAvatarRecord;

  try {
    avatar = await repository.createAvatarForOwner(userId, key);
  } catch (error) {
    if (isUniqueViolation(error)) {
      try {
        const existing = await repository.findAvatarForOwnerByIdempotencyKey(userId, key);
        if (isOwnedAvatar(existing, userId) && existing.idempotencyKey === key) {
          return { avatar: { id: existing.id, status: existing.status } };
        }
      } catch {
        // Return the same safe persistence error for database failures.
      }
    }
    throw new AvatarApiError(
      "avatar_persistence_failed",
      503,
      "The avatar could not be created."
    );
  }

  if (!isOwnedAvatar(avatar, userId) || avatar.status !== "collecting_photos" || avatar.idempotencyKey !== key) {
    throw new AvatarApiError(
      "avatar_persistence_failed",
      503,
      "The avatar could not be created."
    );
  }

  return { avatar: { id: avatar.id, status: avatar.status } };
}

export async function uploadAvatarPhoto(
  principal: AuthenticatedPrincipal | null | undefined,
  input: UploadAvatarPhotoInput,
  idempotencyKey: unknown,
  dependencies: AvatarServiceDependencies
): Promise<UploadAvatarPhotoResponse> {
  const userId = requireUserId(principal);
  const key = requireIdempotencyKey(idempotencyKey);
  if (typeof input.avatarId !== "string" || input.avatarId.trim().length === 0) {
    throw new AvatarApiError("invalid_request", 400, "Avatar ID is required.");
  }
  if (!isAvatarPhotoView(input.view)) {
    throw new AvatarApiError("invalid_request", 400, "Photo view is not supported.");
  }

  let validatedPhoto;
  try {
    validatedPhoto = validateAvatarPhoto(input.contentType, input.bytes);
  } catch (error) {
    if (error instanceof AvatarPhotoValidationError) {
      throw new AvatarApiError("unsupported_photo", 400, error.message);
    }
    throw new AvatarApiError("unsupported_photo", 400, "Photo is not valid.");
  }
  const contentSha256 = createHash("sha256")
    .update(input.bytes as Uint8Array)
    .digest("hex");

  let existingPhoto: OwnedAvatarPhotoRecord | null;
  try {
    existingPhoto = await dependencies.repository.findPhotoForOwnerByIdempotencyKey(
      userId,
      key
    );
  } catch {
    throw new AvatarApiError(
      "photo_persistence_failed",
      503,
      "The photo could not be saved."
    );
  }
  if (existingPhoto) {
    if (
      isSamePhotoRequest(existingPhoto, userId, input, validatedPhoto, contentSha256, key)
    ) {
      return photoResponse(existingPhoto);
    }
    throw new AvatarApiError(
      "idempotency_conflict",
      409,
      "This idempotency key was already used for a different request."
    );
  }

  let avatar: OwnedAvatarRecord | null;
  try {
    avatar = await dependencies.repository.findAvatarForOwner(userId, input.avatarId);
  } catch {
    throw new AvatarApiError(
      "photo_persistence_failed",
      503,
      "The photo could not be saved."
    );
  }
  if (!avatar || avatar.ownerId !== userId || avatar.id !== input.avatarId) {
    throw new AvatarApiError("avatar_not_found", 404, "Avatar was not found.");
  }
  if (avatar.status !== "collecting_photos") {
    throw new AvatarApiError(
      "avatar_not_ready",
      409,
      "This avatar is already queued or generated."
    );
  }

  let storedPhoto: { objectKey: string };
  try {
    storedPhoto = await dependencies.storage.uploadPrivate({
      ownerId: userId,
      avatarId: avatar.id,
      view: input.view,
      contentType: validatedPhoto.contentType,
      bytes: input.bytes as Uint8Array,
    });
  } catch {
    throw new AvatarApiError(
      "photo_storage_failed",
      503,
      "The photo could not be uploaded."
    );
  }

  if (
    typeof storedPhoto?.objectKey !== "string" ||
    storedPhoto.objectKey.trim().length === 0
  ) {
    throw new AvatarApiError(
      "photo_storage_failed",
      503,
      "The photo could not be uploaded."
    );
  }

  let photo: OwnedAvatarPhotoRecord;
  try {
    photo = await dependencies.repository.createPhotoForOwner({
      ownerId: userId,
      avatarId: avatar.id,
      view: input.view,
      contentType: validatedPhoto.contentType,
      byteSize: validatedPhoto.byteSize,
      contentSha256,
      idempotencyKey: key,
      storageObjectKey: storedPhoto.objectKey,
    });
  } catch (error) {
    await removeStoredPhotoBestEffort(dependencies.storage, userId, storedPhoto.objectKey);
    if (isUniqueViolation(error)) {
      try {
        const existing = await dependencies.repository.findPhotoForOwnerByIdempotencyKey(
          userId,
          key
        );
        if (
          existing &&
          isSamePhotoRequest(existing, userId, input, validatedPhoto, contentSha256, key)
        ) {
          return photoResponse(existing);
        }
      } catch {
        // Keep the externally visible error independent of database details.
      }
      throw new AvatarApiError(
        "photo_already_exists",
        409,
        "A photo already exists for this avatar view."
      );
    }
    throw new AvatarApiError(
      "photo_persistence_failed",
      503,
      "The photo could not be saved."
    );
  }

  if (
    typeof photo?.id !== "string" ||
    photo.id.trim().length === 0 ||
    photo.ownerId !== userId ||
    photo.avatarId !== avatar.id ||
    photo.view !== input.view ||
    photo.contentType !== validatedPhoto.contentType ||
    photo.byteSize !== validatedPhoto.byteSize ||
    photo.contentSha256 !== contentSha256 ||
    photo.idempotencyKey !== key
  ) {
    await removeStoredPhotoBestEffort(dependencies.storage, userId, storedPhoto.objectKey);
    throw new AvatarApiError(
      "photo_persistence_failed",
      503,
      "The photo could not be saved."
    );
  }

  return photoResponse(photo);
}

export async function getAvatar(
  principal: AuthenticatedPrincipal | null | undefined,
  avatarId: AvatarId,
  dependencies: AvatarServiceDependencies
): Promise<GetAvatarResponse> {
  const { repository, storage } = dependencies;
  const userId = requireUserId(principal);
  let avatar: OwnedAvatarRecord | null;
  try {
    avatar = await repository.findAvatarForOwner(userId, avatarId);
  } catch {
    throw new AvatarApiError("avatar_persistence_failed", 503, "The avatar could not be loaded.");
  }
  if (!isOwnedAvatar(avatar, userId) || avatar.id !== avatarId) {
    throw new AvatarApiError("avatar_not_found", 404, "Avatar was not found.");
  }
  let photos: OwnedAvatarPhotoRecord[];
  let asset: OwnedAvatarAssetRecord | null;
  let generationJob: AvatarGenerationJobSummary | null;
  try {
    [photos, asset, generationJob] = await Promise.all([
      repository.listPhotosForOwner(userId, avatar.id),
      repository.findLatestAvatarAssetForOwner(userId, avatar.id),
      repository.findLatestAvatarGenerationJobForOwner(userId, avatar.id),
    ]);
  } catch {
    throw new AvatarApiError("avatar_persistence_failed", 503, "The avatar could not be loaded.");
  }
  if (
    photos.some(
      (photo) =>
        photo.ownerId !== userId ||
        photo.avatarId !== avatar.id ||
        !isAvatarPhotoView(photo.view) ||
        typeof photo.id !== "string" ||
        photo.id.trim().length === 0
    )
  ) {
    throw new AvatarApiError("avatar_persistence_failed", 503, "The avatar could not be loaded.");
  }
  let generatedAsset: AvatarGeneratedAssetSummary | null = null;
  if (asset) {
    if (asset.ownerId !== userId || asset.avatarId !== avatar.id) {
      throw new AvatarApiError("avatar_persistence_failed", 503, "The avatar could not be loaded.");
    }
    try {
      const url = await storage.createSignedReadUrl({
        ownerId: userId,
        objectKey: asset.objectKey,
        expiresInSeconds: 300,
      });
      generatedAsset = {
        id: asset.id,
        kind: asset.kind,
        contentType: asset.contentType,
        url,
        createdAt: asset.createdAt,
      };
    } catch {
      throw new AvatarApiError("avatar_persistence_failed", 503, "The avatar could not be loaded.");
    }
  }
  return {
    avatar: { id: avatar.id, status: avatar.status },
    photos: photos.map((photo) => ({
      id: photo.id,
      avatarId: photo.avatarId,
      view: photo.view,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
    })),
    generatedAsset,
    generationJob,
  };
}

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new AvatarApiError(
      "idempotency_key_required",
      400,
      "A valid Idempotency-Key header is required."
    );
  }
  return value;
}

function isOwnedAvatar(
  avatar: OwnedAvatarRecord | null | undefined,
  ownerId: UserId
): avatar is OwnedAvatarRecord {
  return (
    typeof avatar?.id === "string" &&
    avatar.id.trim().length > 0 &&
    avatar.ownerId === ownerId &&
    isAvatarStatus(avatar.status)
  );
}

function isAvatarStatus(value: AvatarStatus): boolean {
  return (
    value === "collecting_photos" ||
    value === "generation_queued" ||
    value === "generating" ||
    value === "ready" ||
    value === "failed"
  );
}

function isSamePhotoRequest(
  photo: OwnedAvatarPhotoRecord,
  ownerId: UserId,
  input: UploadAvatarPhotoInput,
  validatedPhoto: { contentType: AvatarPhotoContentType; byteSize: number },
  contentSha256: string,
  idempotencyKey: string
): boolean {
  return (
    typeof photo.id === "string" &&
    photo.id.trim().length > 0 &&
    photo.ownerId === ownerId &&
    photo.avatarId === input.avatarId &&
    photo.view === input.view &&
    photo.contentType === validatedPhoto.contentType &&
    photo.byteSize === validatedPhoto.byteSize &&
    photo.contentSha256 === contentSha256 &&
    photo.idempotencyKey === idempotencyKey
  );
}

function photoResponse(photo: OwnedAvatarPhotoRecord): UploadAvatarPhotoResponse {
  return {
    photo: {
      id: photo.id,
      avatarId: photo.avatarId,
      view: photo.view,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function requireUserId(principal: AuthenticatedPrincipal | null | undefined): UserId {
  if (typeof principal?.userId !== "string" || principal.userId.trim().length === 0) {
    throw new AvatarApiError("unauthenticated", 401, "Authentication is required.");
  }
  return principal.userId;
}

async function removeStoredPhotoBestEffort(
  storage: PrivateAvatarPhotoStorage,
  ownerId: UserId,
  objectKey: string
): Promise<void> {
  try {
    await storage.removePrivate({ ownerId, objectKey });
  } catch {
    // The object remains private, but an adapter should also provide orphan cleanup.
  }
}
