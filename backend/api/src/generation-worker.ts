import { randomUUID } from "node:crypto";
import type { UserId } from "@runway/types";
import type { AsyncGenerationProvider, ProviderSubmission } from "./provider-contracts.ts";
import type { GenerationJobRecord } from "./generation-service.ts";

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const SOURCE_URL_TTL_SECONDS = 300;

export interface GenerationWorkerRepository {
  claimNextAvatarGenerationJob(workerId: string, leaseSeconds?: number): Promise<GenerationJobRecord | null>;
  renewGenerationLease(input: { jobId: string; workerId: string; leaseSeconds?: number }): Promise<boolean>;
  setGenerationProviderJob(input: { jobId: string; workerId: string; provider: string; providerJobId: string }): Promise<void>;
  completeAvatarGenerationJob(input: { jobId: string; workerId: string; ownerId: UserId; avatarId: string; objectKey: string; contentType: string; provider: string; model: string }): Promise<void>;
  failAvatarGenerationJob(input: { jobId: string; workerId: string; safeError: string; retryable: boolean }): Promise<void>;
}

export interface GenerationWorkerStorage {
  createSignedPhotoReadUrl(input: { ownerId: UserId; objectKey: string; expiresInSeconds: number }): Promise<string>;
  uploadGeneratedMedia(input: { ownerId: UserId; avatarId: string; jobId: string; contentType: "image/jpeg" | "image/png"; bytes: Uint8Array }): Promise<{ objectKey: string }>;
  removeGeneratedMedia(ownerId: UserId, objectKey: string): Promise<void>;
}

export class AvatarGenerationWorker {
  private readonly repository: GenerationWorkerRepository;
  private readonly storage: GenerationWorkerStorage;
  private readonly provider: AsyncGenerationProvider | null;
  private readonly workerId: string;
  private readonly fetcher: typeof fetch;
  private readonly pollDelayMs: number;
  private readonly outputTimeoutMs: number;

  constructor(
    repository: GenerationWorkerRepository,
    storage: GenerationWorkerStorage,
    provider: AsyncGenerationProvider | null,
    workerId = `avatar-worker-${randomUUID()}`,
    fetcher: typeof fetch = fetch,
    pollDelayMs = 2_000,
    outputTimeoutMs = 30_000,
  ) {
    this.repository = repository;
    this.storage = storage;
    this.provider = provider;
    this.workerId = workerId;
    this.fetcher = fetcher;
    this.pollDelayMs = pollDelayMs;
    this.outputTimeoutMs = outputTimeoutMs;
  }

  async runOnce(): Promise<boolean> {
    const job = await this.repository.claimNextAvatarGenerationJob(this.workerId);
    if (!job) return false;
    if (!this.provider) {
      await this.fail(job, "Avatar generation is not configured on this server.", false);
      return true;
    }
    let leaseLost = false;
    const heartbeat = typeof this.repository.renewGenerationLease === "function"
      ? setInterval(() => {
          void this.repository.renewGenerationLease({ jobId: job.id, workerId: this.workerId })
            .then((renewed) => { if (!renewed) leaseLost = true; })
            .catch(() => { leaseLost = true; });
        }, 30_000)
      : undefined;
    const ensureLease = () => {
      if (leaseLost) throw new GenerationLeaseLostError();
    };
    try {
      const values = await this.sourcePhotoInputs(job);
      ensureLease();
      let submission = await this.provider.submit(values);
      ensureLease();
      await this.repository.setGenerationProviderJob({
        jobId: job.id,
        workerId: this.workerId,
        provider: this.provider.provider,
        providerJobId: submission.providerJobId,
      });
      while (submission.status === "queued" || submission.status === "processing") {
        await delay(this.pollDelayMs);
        ensureLease();
        submission = await this.provider.poll(submission.providerJobId);
        ensureLease();
      }
      if (submission.status !== "succeeded" || !submission.outputUrl) {
        await this.fail(job, submission.safeError ?? "The generation provider could not complete this request.", false);
        return true;
      }
      if (submission.outputKind !== "image_2d") {
        await this.fail(job, "This demo only accepts a generated 2D avatar image.", false);
        return true;
      }
      const outputController = new AbortController();
      const outputTimeout = setTimeout(() => outputController.abort(), this.outputTimeoutMs);
      let output: Awaited<ReturnType<typeof downloadGeneratedImage>>;
      try {
        output = await downloadGeneratedImage(
          this.provider.downloadOutput
            ? (url, init) => this.provider!.downloadOutput!(url, init.signal as AbortSignal)
            : this.fetcher,
          submission.outputUrl,
          outputController.signal,
        );
      } finally {
        clearTimeout(outputTimeout);
      }
      ensureLease();
      const stored = await this.storage.uploadGeneratedMedia({
        ownerId: job.ownerId,
        avatarId: job.avatarId,
        jobId: job.id,
        contentType: output.contentType,
        bytes: output.bytes,
      });
      try {
        await this.repository.completeAvatarGenerationJob({
          jobId: job.id,
          workerId: this.workerId,
          ownerId: job.ownerId,
          avatarId: job.avatarId,
          objectKey: stored.objectKey,
          contentType: output.contentType,
          provider: this.provider.provider,
          model: this.provider.configuration.modelVersion,
        });
      } catch (error) {
        await this.storage.removeGeneratedMedia(job.ownerId, stored.objectKey).catch(() => undefined);
        throw error;
      }
      return true;
    } catch (error) {
      if (!leaseLost) await this.fail(job, safeError(error), isRetryable(error)).catch(() => undefined);
      return true;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  async runForever(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const worked = await this.runOnce();
      if (!worked) await delay(1_000);
    }
  }

  private async sourcePhotoInputs(job: GenerationJobRecord): Promise<Record<string, string>> {
    const raw = job.input.photoObjectKeys;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The generation job is missing source photos.");
    const keys = raw as Record<string, unknown>;
    const values: Record<string, string> = {};
    for (const view of ["front", "left", "right", "back"] as const) {
      const objectKey = keys[view];
      if (typeof objectKey !== "string" || !objectKey.startsWith(`${job.ownerId}/${job.avatarId}/`)) {
        throw new Error("The generation job contains an invalid source photo.");
      }
      values[`${view}_photo_url`] = await this.storage.createSignedPhotoReadUrl({ ownerId: job.ownerId, objectKey, expiresInSeconds: SOURCE_URL_TTL_SECONDS });
    }
    return values;
  }

  private async fail(job: GenerationJobRecord, message: string, retryable: boolean): Promise<void> {
    await this.repository.failAvatarGenerationJob({ jobId: job.id, workerId: this.workerId, safeError: message, retryable });
  }
}

type OutputFetcher = (url: string, init: RequestInit) => Promise<Response>;

async function downloadGeneratedImage(
  fetcher: OutputFetcher,
  url: string,
  signal: AbortSignal,
): Promise<{ contentType: "image/jpeg" | "image/png"; bytes: Uint8Array }> {
  validateProviderOutputUrl(url);
  const response = await fetcher(url, { signal, redirect: "error" });
  if (!response.ok) throw new Error("The provider output could not be downloaded.");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "image/jpeg" && contentType !== "image/png") throw new Error("The provider output format is not supported.");
  const lengthHeader = response.headers.get("content-length");
  const length = lengthHeader === null ? null : Number(lengthHeader);
  if (length !== null && Number.isSafeInteger(length) && length > MAX_OUTPUT_BYTES) throw new Error("The provider output is too large.");
  if (!response.body) throw new Error("The provider output body is missing.");
  const bytes = await readBoundedBody(response.body, MAX_OUTPUT_BYTES, signal);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OUTPUT_BYTES || !hasImageSignature(contentType, bytes)) throw new Error("The provider output is not a valid image.");
  return { contentType, bytes };
}

function validateProviderOutputUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The provider output URL is not permitted.");
  }
  if (url.protocol !== "https:" || !isReplicateOutputHost(url.hostname)) {
    throw new Error("The provider output URL is not permitted.");
  }
}

function isReplicateOutputHost(hostname: string): boolean {
  return hostname === "replicate.delivery" || hostname.endsWith(".replicate.delivery") ||
    hostname === "replicate.com" || hostname.endsWith(".replicate.com");
}

async function readBoundedBody(body: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortHandler: (() => void) | undefined;
  try {
    const read = (async () => {
      while (true) {
        if (signal.aborted) throw new Error("The provider output download timed out.");
        const result = await reader.read();
        if (result.done) return;
        total += result.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel("The provider output is too large.");
          throw new Error("The provider output is too large.");
        }
        chunks.push(result.value);
      }
    })();
    const aborted = new Promise<never>((_, reject) => {
      abortHandler = () => {
        void reader.cancel("The provider output download timed out.");
        reject(new Error("The provider output download timed out."));
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    });
    await Promise.race([read, aborted]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function hasImageSignature(contentType: "image/jpeg" | "image/png", bytes: Uint8Array): boolean {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function safeError(error: unknown): string {
  if (error instanceof GenerationLeaseLostError) return "The generation worker lease expired.";
  if (error instanceof Error && (error.name === "AbortError" || /aborted|timeout|timed out/i.test(error.message))) return "The generation provider timed out.";
  if (error instanceof Error && /download|output/i.test(error.message)) return "The generated image could not be downloaded or verified.";
  return "Avatar generation failed while contacting the provider.";
}

function isRetryable(error: unknown): boolean {
  return error instanceof Error && /(aborted|temporarily|timeout|could not be reached|downloaded)/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class GenerationLeaseLostError extends Error {
  constructor() {
    super("The generation worker lease expired.");
    this.name = "GenerationLeaseLostError";
  }
}
