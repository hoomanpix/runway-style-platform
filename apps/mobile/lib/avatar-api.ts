import type {
  AvatarApiErrorCode,
  AvatarId,
  AvatarPhotoContentType,
  AvatarPhotoView,
  CreateAvatarResponse,
  GetAvatarResponse,
  UploadAvatarPhotoResponse,
} from "@runway/types/avatar";

export type AvatarUploadFile = {
  uri: string;
  fileName: string;
  contentType: AvatarPhotoContentType;
};

export interface MultipartFormData {
  append(name: string, value: unknown): void;
}

export class AvatarApiClientError extends Error {
  readonly category: "configuration" | "unauthenticated" | "timeout" | "network" | "request" | "server";
  readonly code?: AvatarApiErrorCode;

  constructor(
    category: "configuration" | "unauthenticated" | "timeout" | "network" | "request" | "server",
    message: string,
    code?: AvatarApiErrorCode
  ) {
    super(message);
    this.name = "AvatarApiClientError";
    this.category = category;
    this.code = code;
  }
}

type AvatarApiClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  onUnauthorized: () => Promise<void>;
  fetcher?: typeof fetch;
  formDataFactory?: () => MultipartFormData;
  timeoutMs?: number;
};

const SAFE_ERROR_MESSAGES: Partial<Record<AvatarApiErrorCode, string>> = {
  unauthenticated: "Your session has expired. Sign in again to continue.",
  invalid_request: "The request could not be completed. Check the selected photo and try again.",
  idempotency_key_required: "The upload could not be safely retried. Please try again.",
  idempotency_conflict: "This photo changed during a retry. Select it again and retry.",
  avatar_not_found: "This avatar could not be found. Refresh and try again.",
  unsupported_photo: "Choose a JPEG, PNG, or WebP photo no larger than 10 MB.",
  payload_too_large: "This photo is larger than 10 MB.",
  photo_already_exists: "This view is already uploaded. Refresh the upload status.",
  avatar_persistence_failed: "Avatar details could not be loaded. Check your connection and retry.",
  photo_storage_failed: "The photo could not be uploaded. Check your connection and retry.",
  photo_persistence_failed: "The upload could not be confirmed. Refresh the status before retrying.",
  service_unavailable: "The service is temporarily unavailable. Please retry shortly.",
  internal_error: "The request could not be completed. Please retry shortly.",
};

export class AvatarApiClient {
  private readonly options: AvatarApiClientOptions;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly formDataFactory: () => MultipartFormData;

  constructor(options: AvatarApiClientOptions) {
    this.options = options;
    try {
      const url = new URL(options.baseUrl);
      const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
        url.username ||
        url.password ||
        !url.hostname ||
        url.search ||
        url.hash
      ) {
        throw new Error("invalid URL");
      }
      this.baseUrl = url.toString().replace(/\/+$/, "");
    } catch {
      throw new AvatarApiClientError(
        "configuration",
        "The API address is not configured. Set EXPO_PUBLIC_API_BASE_URL and restart the app."
      );
    }
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.formDataFactory = options.formDataFactory ?? (() => new FormData());
  }

  createAvatar(idempotencyKey: string): Promise<CreateAvatarResponse> {
    return this.request("/api/avatars", {
      method: "POST",
      idempotencyKey,
    });
  }

  getAvatar(avatarId: AvatarId): Promise<GetAvatarResponse> {
    return this.request(`/api/avatars/${encodeURIComponent(avatarId)}`, {
      method: "GET",
    });
  }

  uploadPhoto(
    avatarId: AvatarId,
    view: AvatarPhotoView,
    file: AvatarUploadFile,
    idempotencyKey: string
  ): Promise<UploadAvatarPhotoResponse> {
    const form = this.formDataFactory();
    form.append("photo", {
      uri: file.uri,
      name: file.fileName,
      type: file.contentType,
    });
    return this.request(
      `/api/avatars/${encodeURIComponent(avatarId)}/photos/${view}`,
      {
        method: "POST",
        idempotencyKey,
        body: form as BodyInit,
      }
    );
  }

  private async request<T>(
    path: string,
    options: { method: "GET" | "POST"; idempotencyKey?: string; body?: BodyInit }
  ): Promise<T> {
    let accessToken: string | null;
    let accessTokenTimedOut = false;
    let accessTokenTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      accessToken = await Promise.race([
        this.options.getAccessToken(),
        new Promise<never>((_resolve, reject) => {
          accessTokenTimeout = setTimeout(() => {
            accessTokenTimedOut = true;
            reject(new Error("Session token request timed out."));
          }, this.timeoutMs);
        }),
      ]);
    } catch {
      if (accessTokenTimedOut) {
        throw new AvatarApiClientError("timeout", "Your session could not be refreshed in time. Retry the request.");
      }
      throw new AvatarApiClientError("network", "Your session could not be refreshed. Check your connection.");
    } finally {
      if (accessTokenTimeout) clearTimeout(accessTokenTimeout);
    }
    if (!accessToken) {
      await this.expireSession();
      throw new AvatarApiClientError("unauthenticated", SAFE_ERROR_MESSAGES.unauthenticated!);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
      });
      if (response.status === 401) {
        await this.expireSession();
        throw new AvatarApiClientError(
          "unauthenticated",
          SAFE_ERROR_MESSAGES.unauthenticated!,
          "unauthenticated"
        );
      }
      if (!response.ok) throw await this.mapResponseError(response);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof AvatarApiClientError) throw error;
      if (controller.signal.aborted) {
        throw new AvatarApiClientError("timeout", "The request timed out. Refresh the upload status before retrying.");
      }
      throw new AvatarApiClientError("network", "Could not reach the service. Check your connection and retry.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async mapResponseError(response: Response): Promise<AvatarApiClientError> {
    let code: AvatarApiErrorCode | undefined;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "code" in body.error &&
        typeof body.error.code === "string"
      ) {
        code = body.error.code as AvatarApiErrorCode;
      }
    } catch {
      code = undefined;
    }
    const message = code ? SAFE_ERROR_MESSAGES[code] : undefined;
    const category = response.status >= 500 ? "server" : "request";
    return new AvatarApiClientError(
      category,
      message ?? (category === "server" ? "The service is unavailable. Please retry shortly." : "The request could not be completed."),
      code
    );
  }

  private async expireSession(): Promise<void> {
    try {
      await this.options.onUnauthorized();
    } catch {
      // The request still fails closed if local sign-out cannot complete.
    }
  }
}