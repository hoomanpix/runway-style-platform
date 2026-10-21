import {
  AVATAR_PHOTO_VIEWS,
  type AvatarId,
  type AvatarPhotoView,
  type GetAvatarResponse,
  type UploadAvatarPhotoResponse,
} from "@runway/types/avatar";
import { AvatarApiClientError } from "./avatar-api.ts";
import type { AvatarUploadFile } from "./avatar-api.ts";

export interface AvatarWorkflowStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AvatarWorkflowApi {
  createAvatar(idempotencyKey: string): Promise<{ avatar: { id: AvatarId } }>;
  getAvatar(avatarId: AvatarId): Promise<GetAvatarResponse>;
  uploadPhoto(
    avatarId: AvatarId,
    view: AvatarPhotoView,
    file: AvatarUploadFile,
    idempotencyKey: string
  ): Promise<UploadAvatarPhotoResponse>;
  startGeneration(avatarId: AvatarId, idempotencyKey: string): Promise<{ job: NonNullable<GetAvatarResponse["generationJob"]> }>;
}

export type SelectedAvatarPhoto = AvatarUploadFile & {
  byteSize: number;
  sha256: string;
};

export class MissingPhotoViewsError extends Error {
  readonly missingViews: AvatarPhotoView[];

  constructor(missingViews: AvatarPhotoView[]) {
    super(`Select a photo for each required view: ${missingViews.join(", ")}.`);
    this.name = "MissingPhotoViewsError";
    this.missingViews = missingViews;
  }
}

export class AvatarWorkflow {
  private uploadInProgress = false;
  private readonly keyPrefix: string;
  private readonly api: AvatarWorkflowApi;
  private readonly storage: AvatarWorkflowStorage;
  private readonly userId: string;
  private readonly createIdempotencyKey: () => string;

  constructor(
    api: AvatarWorkflowApi,
    storage: AvatarWorkflowStorage,
    userId: string,
    createIdempotencyKey: () => string
  ) {
    this.api = api;
    this.storage = storage;
    this.userId = userId;
    this.createIdempotencyKey = createIdempotencyKey;
    this.keyPrefix = `runway.avatar.${userId}`;
  }

  async resume(): Promise<GetAvatarResponse> {
    const avatarStorageKey = `${this.keyPrefix}.active-id`;
    let avatarId = await this.storage.getItem(avatarStorageKey);
    if (avatarId) {
      try {
        return await this.refreshUploadedViews(avatarId);
      } catch (error) {
        if (!(error instanceof AvatarApiClientError) || error.code !== "avatar_not_found") {
          throw error;
        }
        await this.storage.removeItem(avatarStorageKey);
      }
    }

    const createKeyStorageKey = `${this.keyPrefix}.create-key`;
    let createKey = await this.storage.getItem(createKeyStorageKey);
    if (!createKey) {
      createKey = this.createIdempotencyKey();
      await this.storage.setItem(createKeyStorageKey, createKey);
    }
    const created = await this.api.createAvatar(createKey);
    avatarId = created.avatar.id;
    await this.storage.setItem(avatarStorageKey, avatarId);
    await this.storage.removeItem(createKeyStorageKey);
    return this.refreshUploadedViews(avatarId);
  }

  async uploadSelected(
    snapshot: GetAvatarResponse,
    selected: Partial<Record<AvatarPhotoView, SelectedAvatarPhoto>>,
    onStarting: (view: AvatarPhotoView) => void,
    onUploaded: (photo: UploadAvatarPhotoResponse["photo"]) => void
  ): Promise<void> {
    if (this.uploadInProgress) return;
    const uploaded = new Set(snapshot.photos.map((photo) => photo.view));
    const missingViews = AVATAR_PHOTO_VIEWS.filter(
      (view) => !uploaded.has(view) && !selected[view]
    );
    if (missingViews.length > 0) throw new MissingPhotoViewsError(missingViews);

    this.uploadInProgress = true;
    try {
      for (const view of AVATAR_PHOTO_VIEWS) {
        if (uploaded.has(view)) continue;
        const photo = selected[view];
        if (!photo) continue;
        const operationKey = `${this.keyPrefix}.${snapshot.avatar.id}.photo.${view}`;
        const idempotencyKey = await this.getPhotoIdempotencyKey(
          operationKey,
          photo.sha256
        );
        onStarting(view);
        const result = await this.api.uploadPhoto(
          snapshot.avatar.id,
          view,
          photo,
          idempotencyKey
        );
        if (result.photo.avatarId !== snapshot.avatar.id || result.photo.view !== view) {
          throw new Error("The server returned an inconsistent photo result.");
        }
        await this.storage.removeItem(operationKey);
        uploaded.add(view);
        onUploaded(result.photo);
      }
    } finally {
      this.uploadInProgress = false;
    }
  }

  async startGeneration(snapshot: GetAvatarResponse): Promise<GetAvatarResponse> {
    if (!snapshot.generationJob && snapshot.photos.length !== AVATAR_PHOTO_VIEWS.length) {
      throw new MissingPhotoViewsError(
        AVATAR_PHOTO_VIEWS.filter((view) => !snapshot.photos.some((photo) => photo.view === view)),
      );
    }
    if (snapshot.generationJob) return snapshot;
    const operationKey = `${this.keyPrefix}.${snapshot.avatar.id}.generation`;
    let idempotencyKey = await this.storage.getItem(operationKey);
    if (!idempotencyKey) {
      idempotencyKey = this.createIdempotencyKey();
      await this.storage.setItem(operationKey, idempotencyKey);
    }
    await this.api.startGeneration(snapshot.avatar.id, idempotencyKey);
    await this.storage.removeItem(operationKey);
    return this.refreshUploadedViews(snapshot.avatar.id);
  }

  private async refreshUploadedViews(avatarId: AvatarId): Promise<GetAvatarResponse> {
    const snapshot = await this.api.getAvatar(avatarId);
    if (snapshot.avatar.id !== avatarId) {
      throw new Error("The server returned an inconsistent avatar ID.");
    }
    await Promise.all(
      snapshot.photos.map((photo) =>
        this.storage.removeItem(`${this.keyPrefix}.${avatarId}.photo.${photo.view}`)
      )
    );
    return snapshot;
  }

  private async getPhotoIdempotencyKey(key: string, sha256: string): Promise<string> {
    const stored = await this.storage.getItem(key);
    if (stored) {
      try {
        const operation = JSON.parse(stored) as { key?: unknown; sha256?: unknown };
        if (operation.key && operation.sha256 === sha256) return String(operation.key);
      } catch {
        // Replace corrupt local operation state with a new key.
      }
    }
    const nextKey = this.createIdempotencyKey();
    await this.storage.setItem(key, JSON.stringify({ key: nextKey, sha256 }));
    return nextKey;
  }
}
