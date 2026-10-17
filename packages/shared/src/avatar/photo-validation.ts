import {
  AVATAR_PHOTO_VIEWS,
  type AvatarPhotoContentType,
  type AvatarPhotoView,
} from "@runway/types/avatar";

export const MAX_AVATAR_PHOTO_BYTES = 10 * 1024 * 1024;

export class AvatarPhotoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarPhotoValidationError";
  }
}

export interface ValidatedAvatarPhoto {
  contentType: AvatarPhotoContentType;
  byteSize: number;
}

export function isAvatarPhotoView(value: unknown): value is AvatarPhotoView {
  return AVATAR_PHOTO_VIEWS.some((view) => view === value);
}

export function missingAvatarPhotoViews(
  photos: readonly { view: AvatarPhotoView }[]
): AvatarPhotoView[] {
  return AVATAR_PHOTO_VIEWS.filter(
    (view) => !photos.some((photo) => photo.view === view)
  );
}

export function validateAvatarPhoto(
  contentType: unknown,
  bytes: unknown
): ValidatedAvatarPhoto {
  if (!(bytes instanceof Uint8Array)) {
    throw new AvatarPhotoValidationError("Photo data must be binary.");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_PHOTO_BYTES) {
    throw new AvatarPhotoValidationError("Photo size is not allowed.");
  }
  if (typeof contentType !== "string") {
    throw new AvatarPhotoValidationError("Photo type is not supported.");
  }

  const normalizedContentType = contentType
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!isSupportedImage(normalizedContentType, bytes)) {
    throw new AvatarPhotoValidationError("Photo content does not match a supported image type.");
  }

  return {
    contentType: normalizedContentType,
    byteSize: bytes.byteLength,
  };
}

function isSupportedImage(contentType: string, bytes: Uint8Array): contentType is AvatarPhotoContentType {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (contentType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}