import { missingAvatarPhotoViews } from "@runway/shared/avatar";
import type {
  AvatarGenerationJobSummary,
  AvatarId,
  AvatarPhotoView,
  AvatarStatus,
  CreateAvatarGenerationResponse,
  GenerationJobKind,
  GenerationJobStatus,
  UserId,
} from "@runway/types";
import { AvatarApiError, type AuthenticatedPrincipal, type OwnedAvatarPhotoRecord } from "./avatar-service.ts";

export interface GenerationJobRecord {
  id: string;
  ownerId: UserId;
  avatarId: AvatarId;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  idempotencyKey: string;
  input: Record<string, unknown>;
  progress: number | null;
  safeError: string | null;
  attempts: number;
  updatedAt: string;
}

export interface AvatarGenerationRepository {
  findAvatarForOwner(ownerId: UserId, avatarId: AvatarId): Promise<{
    id: AvatarId;
    ownerId: UserId;
    status: AvatarStatus;
  } | null>;
  listPhotosForOwner(ownerId: UserId, avatarId: AvatarId): Promise<OwnedAvatarPhotoRecord[]>;
  createGenerationJobForOwner(input: {
    ownerId: UserId;
    avatarId: AvatarId;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }): Promise<GenerationJobRecord>;
  findGenerationJobForOwnerByIdempotencyKey(
    ownerId: UserId,
    idempotencyKey: string
  ): Promise<GenerationJobRecord | null>;
}

export function summarizeGenerationJob(job: GenerationJobRecord): AvatarGenerationJobSummary {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    safeError: job.safeError,
    updatedAt: job.updatedAt,
  };
}

export async function startAvatarGeneration(
  principal: AuthenticatedPrincipal | null | undefined,
  avatarId: AvatarId,
  idempotencyKey: unknown,
  repository: AvatarGenerationRepository,
  configured: boolean,
): Promise<CreateAvatarGenerationResponse> {
  const ownerId = requireUserId(principal);
  const key = requireIdempotencyKey(idempotencyKey);

  let existing: GenerationJobRecord | null;
  try {
    existing = await repository.findGenerationJobForOwnerByIdempotencyKey(ownerId, key);
  } catch {
    throw new AvatarApiError(
      "generation_persistence_failed",
      503,
      "The generation request could not be loaded.",
    );
  }
  if (existing) {
    if (existing.avatarId !== avatarId || existing.kind !== "avatar_generation") {
      throw new AvatarApiError(
        "idempotency_conflict",
        409,
        "This idempotency key was already used for a different generation request.",
      );
    }
    return { job: summarizeGenerationJob(existing) };
  }

  if (!configured) {
    throw new AvatarApiError(
      "generation_not_configured",
      503,
      "Avatar generation is not configured on this server yet.",
    );
  }

  let avatar;
  let photos: OwnedAvatarPhotoRecord[];
  try {
    avatar = await repository.findAvatarForOwner(ownerId, avatarId);
    photos = avatar ? await repository.listPhotosForOwner(ownerId, avatarId) : [];
  } catch {
    throw new AvatarApiError(
      "generation_persistence_failed",
      503,
      "The avatar generation request could not be loaded.",
    );
  }
  if (!avatar || avatar.ownerId !== ownerId || avatar.id !== avatarId) {
    throw new AvatarApiError("avatar_not_found", 404, "Avatar was not found.");
  }
  if (avatar.status !== "collecting_photos") {
    throw new AvatarApiError(
      "avatar_not_ready",
      409,
      "This avatar is already queued or generated.",
    );
  }
  const missingViews = missingAvatarPhotoViews(photos);
  if (missingViews.length > 0) {
    throw new AvatarApiError(
      "avatar_not_ready",
      409,
      `Upload all required photo views before generation: ${missingViews.join(", ")}.`,
    );
  }

  const photoObjectKeys = Object.fromEntries(
    photos.map((photo) => [photo.view satisfies AvatarPhotoView, photo.storageObjectKey]),
  );
  try {
    const created = await repository.createGenerationJobForOwner({
      ownerId,
      avatarId,
      idempotencyKey: key,
      input: { photoObjectKeys },
    });
    if (
      created.ownerId !== ownerId ||
      created.avatarId !== avatarId ||
      created.kind !== "avatar_generation" ||
      created.idempotencyKey !== key
    ) {
      throw new Error("The generation repository returned an inconsistent job.");
    }
    return { job: summarizeGenerationJob(created) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      try {
        const replay = await repository.findGenerationJobForOwnerByIdempotencyKey(ownerId, key);
        if (replay && replay.avatarId === avatarId && replay.kind === "avatar_generation") {
          return { job: summarizeGenerationJob(replay) };
        }
      } catch {
        // Keep the response independent of persistence details.
      }
    }
    throw new AvatarApiError(
      "generation_persistence_failed",
      503,
      "The generation request could not be saved.",
    );
  }
}

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new AvatarApiError(
      "idempotency_key_required",
      400,
      "A valid Idempotency-Key header is required.",
    );
  }
  return value;
}

function requireUserId(principal: AuthenticatedPrincipal | null | undefined): UserId {
  if (typeof principal?.userId !== "string" || principal.userId.trim().length === 0) {
    throw new AvatarApiError("unauthenticated", 401, "Authentication is required.");
  }
  return principal.userId;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
