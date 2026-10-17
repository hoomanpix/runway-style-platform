export type AvatarId = string;
export type AvatarPhotoId = string;

export const AVATAR_PHOTO_VIEWS = ["front", "left", "right", "back"] as const;

export type AvatarPhotoView = (typeof AVATAR_PHOTO_VIEWS)[number];
export type AvatarPhotoContentType = "image/jpeg" | "image/png" | "image/webp";
export type AvatarStatus =
  | "collecting_photos"
  | "generation_queued"
  | "generating"
  | "ready"
  | "failed";

export type AvatarGenerationStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";

export interface AvatarSummary {
  id: AvatarId;
  status: AvatarStatus;
}

export interface AvatarPhotoSummary {
  id: AvatarPhotoId;
  avatarId: AvatarId;
  view: AvatarPhotoView;
  contentType: AvatarPhotoContentType;
  byteSize: number;
}

export interface CreateAvatarResponse {
  avatar: AvatarSummary;
}

export interface GetAvatarResponse {
  avatar: AvatarSummary;
  photos: AvatarPhotoSummary[];
  generatedAsset: AvatarGeneratedAssetSummary | null;
  generationJob: AvatarGenerationJobSummary | null;
}

export interface AvatarGeneratedAssetSummary {
  id: string;
  kind: "image_2d" | "model_3d";
  contentType: string;
  url: string;
  createdAt: string;
}

export interface AvatarGenerationJobSummary {
  id: string;
  status: AvatarGenerationStatus;
  progress: number | null;
  safeError: string | null;
  updatedAt: string;
}

export interface UploadAvatarPhotoRequest {
  view: AvatarPhotoView;
  contentType: AvatarPhotoContentType;
}

export interface UploadAvatarPhotoResponse {
  photo: AvatarPhotoSummary;
}

export type AvatarApiErrorCode =
  | "unauthenticated"
  | "service_unavailable"
  | "internal_error"
  | "invalid_request"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "avatar_not_found"
  | "unsupported_photo"
  | "payload_too_large"
  | "photo_already_exists"
  | "avatar_persistence_failed"
  | "photo_storage_failed"
  | "photo_persistence_failed";

export interface AvatarApiErrorResponse {
  error: {
    code: AvatarApiErrorCode;
    message: string;
  };
}