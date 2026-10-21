import type { GeneratedMediaKind, JsonValue } from "@runway/types";
import type {
  AsyncGenerationProvider,
  AsyncProviderStatus,
  ProviderConfigurationStatus,
  ProviderInputValues,
  ProviderSubmission,
  ProviderTaskKind,
  ReplicateTaskConfiguration,
} from "./provider-contracts.ts";

const REPLICATE_API_ORIGIN = "https://api.replicate.com";
const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_REDIRECTS = 3;

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted";
  output?: unknown;
  error?: unknown;
}

export type ProviderFetch = typeof fetch;

export class ProviderNotConfiguredError extends Error {
  constructor(taskKind: ProviderTaskKind) {
    super(`${taskKind} provider is not configured.`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderRequestError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean, message: string) {
    super(message);
    this.retryable = retryable;
    this.name = "ProviderRequestError";
  }
}
export class ReplicatePredictionClient {
  private readonly token: string;
  private readonly fetcher: ProviderFetch;
  private readonly baseUrl: string;

  constructor(
    token: string,
    fetcher: ProviderFetch = fetch,
    baseUrl = REPLICATE_API_ORIGIN
  ) {
    this.token = token;
    this.fetcher = fetcher;
    this.baseUrl = baseUrl;
  }

  async create(modelVersion: string, input: Record<string, JsonValue>): Promise<ReplicatePrediction> {
    const response = await this.request("/v1/predictions", {
      method: "POST",
      body: JSON.stringify({ version: modelVersion, input }),
      headers: { Prefer: "wait=1" },
    });
    return parsePrediction(response);
  }

  async get(predictionId: string): Promise<ReplicatePrediction> {
    return parsePrediction(await this.request(`/v1/predictions/${encodeURIComponent(predictionId)}`, {
      method: "GET",
    }));
  }

  async cancel(predictionId: string): Promise<ReplicatePrediction> {
    return parsePrediction(await this.request(
      `/v1/predictions/${encodeURIComponent(predictionId)}/cancel`,
      { method: "POST" }
    ));
  }

  async downloadOutput(urlValue: string, signal: AbortSignal): Promise<Response> {
    let url = validateOutputUrl(urlValue);
    for (let redirectCount = 0; redirectCount <= MAX_OUTPUT_REDIRECTS; redirectCount += 1) {
      if (signal.aborted) throw new ProviderRequestError(true, "The provider output download timed out.");
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "image/*" },
        signal,
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        if (redirectCount === MAX_OUTPUT_REDIRECTS) {
          throw new ProviderRequestError(false, "The provider output redirected too many times.");
        }
        const location = response.headers.get("location");
        if (!location) throw new ProviderRequestError(false, "The provider output redirect was invalid.");
        try {
          url = validateOutputUrl(new URL(location, url).toString());
        } catch {
          throw new ProviderRequestError(false, "The provider output redirect destination is not permitted.");
        }
        continue;
      }
      if (!response.ok) {
        throw new ProviderRequestError(response.status >= 500, "The provider output could not be downloaded.");
      }
      return response;
    }
    throw new ProviderRequestError(false, "The provider output redirected too many times.");
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (url.protocol !== "https:" || url.hostname !== "api.replicate.com") {
      throw new ProviderRequestError(false, "The provider endpoint is not permitted.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderRequestError(
          response.status === 429 || response.status >= 500,
          response.status === 429 || response.status >= 500
            ? "The generation provider is temporarily unavailable."
            : "The generation provider rejected the configured model request."
        );
      }
      try {
        return await response.json();
      } catch {
        throw new ProviderRequestError(false, "The generation provider returned an invalid response.");
      }
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (controller.signal.aborted) {
        throw new ProviderRequestError(true, "The generation provider request timed out.");
      }
      throw new ProviderRequestError(true, "The generation provider could not be reached.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ReplicateGenerationProvider implements AsyncGenerationProvider {
  readonly provider = "replicate" as const;
  readonly taskKind: ProviderTaskKind;
  readonly configuration: ReplicateTaskConfiguration;
  private readonly client: ReplicatePredictionClient;

  constructor(
    taskKind: ProviderTaskKind,
    configuration: ReplicateTaskConfiguration,
    token: string,
    fetcher: ProviderFetch = fetch
  ) {
    this.taskKind = taskKind;
    this.configuration = configuration;
    this.client = new ReplicatePredictionClient(token, fetcher);
  }

  async submit(values: ProviderInputValues): Promise<ProviderSubmission> {
    validateRequiredPlaceholders(this.taskKind, this.configuration.inputTemplate);
    const resolved = resolveTemplate(this.configuration.inputTemplate, values);
    if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
      throw new Error("The configured provider input template is invalid.");
    }
    const input = resolved as Record<string, JsonValue>;
    const prediction = await this.client.create(this.configuration.modelVersion, input);
    return normalizePrediction(prediction, this.configuration);
  }

  async poll(providerJobId: string): Promise<ProviderSubmission> {
    const prediction = await this.client.get(providerJobId);
    return normalizePrediction(prediction, this.configuration);
  }

  async cancel(predictionId: string): Promise<ProviderSubmission> {
    const prediction = await this.client.cancel(predictionId);
    return normalizePrediction(prediction, this.configuration);
  }

  async downloadOutput(url: string, signal: AbortSignal): Promise<Response> {
    return this.client.downloadOutput(url, signal);
  }
}

export function readReplicateTaskConfiguration(
  taskKind: ProviderTaskKind,
  token: string | undefined,
  modelVersion: string | undefined,
  inputTemplateJson: string | undefined,
  outputPathValue: string | undefined,
  outputKindValue: string | undefined
): { provider: ReplicateGenerationProvider | null; status: ProviderConfigurationStatus } {
  const capability = capabilityFor(taskKind, outputKindValue);
  if (!token || !modelVersion || !inputTemplateJson || !outputPathValue || !outputKindValue) {
    return {
      provider: null,
      status: {
        capability,
        configured: false,
        provider: null,
        model: modelVersion ?? null,
        outputKind: isOutputKind(outputKindValue) ? outputKindValue : null,
        reason: `Configure the Replicate token, ${envPrefix(taskKind)} model version, input template, output path, and output kind.`,
      },
    };
  }
  if (!isOutputKind(outputKindValue)) {
    throw new Error(`${envPrefix(taskKind)}_OUTPUT_KIND is not supported.`);
  }
  validateOutputKindForTask(taskKind, outputKindValue);
  const inputTemplate = parseInputTemplate(inputTemplateJson, envPrefix(taskKind));
  const outputPath = parseOutputPath(outputPathValue, envPrefix(taskKind));
  validateRequiredPlaceholders(taskKind, inputTemplate);
  const configuration: ReplicateTaskConfiguration = {
    provider: "replicate",
    modelVersion,
    inputTemplate,
    outputPath,
    outputKind: outputKindValue,
  };
  return {
    provider: new ReplicateGenerationProvider(taskKind, configuration, token),
    status: {
      capability,
      configured: true,
      provider: "replicate",
      model: modelVersion,
      outputKind: outputKindValue,
      reason: null,
    },
  };
}

function parsePrediction(value: unknown): ReplicatePrediction {
  if (typeof value !== "object" || value === null) {
    throw new ProviderRequestError(false, "The generation provider returned an invalid response.");
  }
  const record = value as Record<string, unknown>;
  const statuses = ["starting", "processing", "succeeded", "failed", "canceled", "aborted"];
  if (typeof record.id !== "string" || !statuses.includes(String(record.status))) {
    throw new ProviderRequestError(false, "The generation provider returned an invalid response.");
  }
  return {
    id: record.id,
    status: record.status as ReplicatePrediction["status"],
    output: record.output,
    error: record.error,
  };
}

function normalizePrediction(
  prediction: ReplicatePrediction,
  configuration: ReplicateTaskConfiguration
): ProviderSubmission {
  const statusMap: Record<ReplicatePrediction["status"], AsyncProviderStatus> = {
    starting: "queued",
    processing: "processing",
    succeeded: "succeeded",
    failed: "failed",
    canceled: "cancelled",
    aborted: "failed",
  };
  const status = statusMap[prediction.status];
  let outputUrl: string | null = null;
  let safeError: string | null = null;
  if (status === "succeeded") {
    outputUrl = extractOutputUrl(prediction.output, configuration.outputPath);
    if (!outputUrl) {
      return {
        providerJobId: prediction.id,
        status: "failed",
        progress: null,
        outputUrl: null,
        outputKind: configuration.outputKind,
        safeError: "The configured model output path did not return a valid media URL.",
      };
    }
  } else if (status === "failed") {
    safeError = "The generation provider could not complete this request.";
  }
  return {
    providerJobId: prediction.id,
    status,
    progress: status === "succeeded" ? 100 : null,
    outputUrl,
    outputKind: configuration.outputKind,
    safeError,
  };
}

function resolveTemplate(
  value: JsonValue,
  values: ProviderInputValues
): JsonValue {
  if (typeof value === "string") {
    const tokenMatch = /^\{\{([a-z0-9_]+)\}\}$/.exec(value);
    if (tokenMatch) {
      const replacement = values[tokenMatch[1]];
      if (replacement === undefined) throw new Error(`Missing provider input ${tokenMatch[1]}.`);
      return replacement as JsonValue;
    }
    if (/\{\{[a-z0-9_]+\}\}/.test(value)) {
      throw new Error("Provider input templates must use a placeholder as the complete value.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplate(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplate(item, values)])
    );
  }
  return value;
}

function validateRequiredPlaceholders(
  taskKind: ProviderTaskKind,
  inputTemplate: Record<string, JsonValue>
): void {
  const serialized = JSON.stringify(inputTemplate);
  const required = requiredInputs(taskKind);
  const missing = required.filter((key) => !serialized.includes(`{{${key}}}`));
  if (missing.length > 0) {
    throw new Error(`Provider input template is missing: ${missing.join(", ")}.`);
  }
}

function extractOutputUrl(output: unknown, path: string[]): string | null {
  let current = output;
  for (const part of path) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (typeof current === "object" && current !== null) current = (current as Record<string, unknown>)[part];
    else return null;
  }
  if (typeof current !== "string") return null;
  try {
    const url = new URL(current);
    if (url.protocol !== "https:" || !isReplicateOutputHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isReplicateOutputHost(hostname: string): boolean {
  return hostname === "replicate.delivery" || hostname.endsWith(".replicate.delivery") ||
    hostname === "replicate.com" || hostname.endsWith(".replicate.com");
}

function validateOutputUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderRequestError(false, "The provider output URL is not permitted.");
  }
  if (url.protocol !== "https:" || !isReplicateOutputHost(url.hostname)) {
    throw new ProviderRequestError(false, "The provider output URL is not permitted.");
  }
  return url;
}

function parseInputTemplate(value: string, prefix: string): Record<string, JsonValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${prefix}_INPUTS_JSON must be valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${prefix}_INPUTS_JSON must be a JSON object.`);
  }
  return parsed as Record<string, JsonValue>;
}

function parseOutputPath(value: string, prefix: string): string[] {
  const path = value.split(".").map((part) => part.trim()).filter(Boolean);
  if (path.length === 0 || path.length > 8) throw new Error(`${prefix}_OUTPUT_PATH is invalid.`);
  return path;
}

function requiredInputs(taskKind: ProviderTaskKind): string[] {
  if (taskKind === "avatar_generation") {
    return ["front_photo_url", "left_photo_url", "right_photo_url", "back_photo_url"];
  }
  if (taskKind === "virtual_try_on") return ["avatar_image_url", "garment_image_url"];
  return ["outfit_image_url"];
}

function envPrefix(taskKind: ProviderTaskKind): string {
  if (taskKind === "avatar_generation") return "AVATAR_GENERATION";
  if (taskKind === "virtual_try_on") return "VIRTUAL_TRY_ON";
  return "RUNWAY_ANIMATION";
}

function capabilityFor(
  taskKind: ProviderTaskKind,
  outputKind: string | undefined
): ProviderConfigurationStatus["capability"] {
  if (taskKind === "avatar_generation") return outputKind === "model_3d" ? "avatar_model_3d" : "avatar_image_2d";
  if (taskKind === "virtual_try_on") return "try_on_image_2d";
  return "runway_video";
}

function isOutputKind(value: string | undefined): value is GeneratedMediaKind {
  return value === "image_2d" || value === "model_3d" || value === "video";
}

function validateOutputKindForTask(
  taskKind: ProviderTaskKind,
  outputKind: GeneratedMediaKind
): void {
  const valid = taskKind === "avatar_generation"
    ? outputKind === "image_2d" || outputKind === "model_3d"
    : taskKind === "virtual_try_on"
      ? outputKind === "image_2d"
      : outputKind === "video";
  if (!valid) throw new Error(`Unsupported output kind for ${taskKind}.`);
}
