import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import Busboy from "busboy";

import { MAX_AVATAR_PHOTO_BYTES, isAvatarPhotoView } from "@runway/shared/avatar";
import { AvatarApiError } from "./avatar-service.ts";
import { AuthProviderUnavailableError, type AccessTokenAuthenticator } from "./supabase-auth.ts";
import {
  createAvatar,
  getAvatar,
  uploadAvatarPhoto,
} from "./avatar-service.ts";

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function createAvatarHttpServer(authenticate: AccessTokenAuthenticator) {
  const server = createServer((request, response) => {
    void handleRequest(request, response, authenticate);
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.maxHeadersCount = 50;
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authenticate: AccessTokenAuthenticator
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    const route = matchRoute(request.method, url.pathname);
    if (!route) {
      throw new AvatarApiError("invalid_request", 404, "Route was not found.");
    }

    const accessToken = readBearerToken(request.headers.authorization);
    if (!accessToken) {
      throw new AvatarApiError("unauthenticated", 401, "Authentication is required.");
    }

    let context;
    try {
      context = await authenticate(accessToken);
    } catch (error) {
      if (error instanceof AuthProviderUnavailableError) {
        throw new AvatarApiError(
          "service_unavailable",
          503,
          "Authentication is temporarily unavailable."
        );
      }
      throw new AvatarApiError(
        "service_unavailable",
        503,
        "Authentication is temporarily unavailable."
      );
    }
    if (!context) {
      throw new AvatarApiError("unauthenticated", 401, "Authentication is required.");
    }

    if (route.kind === "create-avatar") {
      const result = await createAvatar(
        context.principal,
        request.headers["idempotency-key"],
        context.repository
      );
      sendJson(response, 201, result);
      return;
    }

    if (route.kind === "get-avatar") {
      const result = await getAvatar(context.principal, route.avatarId, context.dependencies);
      sendJson(response, 200, result);
      return;
    }

    const multipart = await readPhotoUpload(request);
    const result = await uploadAvatarPhoto(
      context.principal,
      {
        avatarId: route.avatarId,
        view: route.view,
        contentType: multipart.contentType,
        bytes: multipart.bytes,
      },
      request.headers["idempotency-key"],
      context.dependencies
    );
    sendJson(response, 201, result);
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof AvatarApiError) {
      sendJson(response, error.status, {
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof PayloadTooLargeError) {
      sendJson(response, 413, {
        error: { code: "payload_too_large", message: "The photo exceeds the upload limit." },
      });
      return;
    }
    if (error instanceof InvalidMultipartError) {
      sendJson(response, 400, {
        error: { code: "invalid_request", message: "A single photo file is required." },
      });
      return;
    }
    sendJson(response, 500, {
      error: { code: "internal_error", message: "The request could not be completed." },
    });
  }
}

type Route =
  | { kind: "create-avatar" }
  | { kind: "get-avatar"; avatarId: string }
  | { kind: "upload-photo"; avatarId: string; view: string };

function matchRoute(method: string | undefined, pathname: string): Route | null {
  if (method === "POST" && pathname === "/api/avatars") {
    return { kind: "create-avatar" };
  }
  const getAvatarMatch = /^\/api\/avatars\/([^/]+)$/.exec(pathname);
  if (method === "GET" && getAvatarMatch) {
    return { kind: "get-avatar", avatarId: decodePathPart(getAvatarMatch[1]) };
  }
  const uploadMatch = /^\/api\/avatars\/([^/]+)\/photos\/([^/]+)$/.exec(pathname);
  if (method === "POST" && uploadMatch) {
    const view = decodePathPart(uploadMatch[2]);
    if (!isAvatarPhotoView(view)) {
      throw new AvatarApiError("invalid_request", 400, "Photo view is not supported.");
    }
    return {
      kind: "upload-photo",
      avatarId: decodePathPart(uploadMatch[1]),
      view,
    };
  }
  return null;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AvatarApiError("invalid_request", 400, "Path parameter is invalid.");
  }
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function readPhotoUpload(
  request: IncomingMessage
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_AVATAR_PHOTO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    throw new PayloadTooLargeError();
  }

  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fileSize: MAX_AVATAR_PHOTO_BYTES,
          files: 1,
          fields: 0,
        },
      });
    } catch {
      reject(new InvalidMultipartError());
      return;
    }

    const chunks: Buffer[] = [];
    let fileCount = 0;
    let contentType = "";
    let failure: Error | undefined;
    let totalBytes = 0;

    request.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AVATAR_PHOTO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
        failure = new PayloadTooLargeError();
        parser.destroy(failure);
      }
    });
    request.on("error", (error) => {
      failure ??= asError(error);
    });

    parser.on("file", (fieldName, file, info) => {
      fileCount += 1;
      if (fieldName !== "photo" || fileCount > 1) {
        failure ??= new InvalidMultipartError();
        file.resume();
        return;
      }
      contentType = info.mimeType;
      file.on("limit", () => {
        failure = new PayloadTooLargeError();
      });
      file.on("data", (chunk: Buffer) => chunks.push(chunk));
      file.on("error", (error) => {
        failure ??= asError(error);
      });
    });
    parser.on("field", () => {
      failure ??= new InvalidMultipartError();
    });
    parser.on("filesLimit", () => {
      failure ??= new InvalidMultipartError();
    });
    parser.on("fieldsLimit", () => {
      failure ??= new InvalidMultipartError();
    });
    parser.on("error", (error) => {
      failure ??= asError(error);
    });
    parser.on("finish", () => {
      if (failure) {
        reject(failure);
      } else if (fileCount !== 1 || chunks.length === 0) {
        reject(new InvalidMultipartError());
      } else {
        resolve({ bytes: Buffer.concat(chunks), contentType });
      }
    });
    request.pipe(parser);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

class PayloadTooLargeError extends Error {}
class InvalidMultipartError extends Error {}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Request stream failed.");
}