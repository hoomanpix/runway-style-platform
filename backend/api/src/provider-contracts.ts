import type { GeneratedMediaKind, JsonValue } from "@runway/types";

export type AsyncProviderStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";
export type ProviderTaskKind = "avatar_generation" | "virtual_try_on" | "runway_animation";

export interface ReplicateTaskConfiguration {
  provider: "replicate";
  modelVersion: string;
  inputTemplate: { [key: string]: JsonValue };
  outputPath: string[];
  outputKind: GeneratedMediaKind;
}

export interface ProviderInputValues {
  [key: string]: string | number | boolean | null | ProviderInputValues | ProviderInputValues[];
}

export interface ProviderSubmission {
  providerJobId: string;
  status: AsyncProviderStatus;
  progress: number | null;
  outputUrl: string | null;
  outputKind: GeneratedMediaKind;
  safeError: string | null;
}

export interface AsyncGenerationProvider {
  readonly provider: "replicate";
  readonly taskKind: ProviderTaskKind;
  readonly configuration: ReplicateTaskConfiguration;
  submit(values: ProviderInputValues): Promise<ProviderSubmission>;
  poll(providerJobId: string): Promise<ProviderSubmission>;
  cancel(providerJobId: string): Promise<ProviderSubmission>;
  downloadOutput?(url: string): Promise<Response>;
}

export interface ProviderConfigurationStatus {
  capability: "avatar_image_2d" | "avatar_model_3d" | "try_on_image_2d" | "runway_video";
  configured: boolean;
  provider: "replicate" | null;
  model: string | null;
  outputKind: GeneratedMediaKind | null;
  reason: string | null;
}
