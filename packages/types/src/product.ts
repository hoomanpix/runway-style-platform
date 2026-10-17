import type { AvatarId, AvatarPhotoView } from "./avatar";

export type ProductId = string;
export type BrandId = string;
export type CollectionId = string;
export type OutfitId = string;
export type GenerationJobId = string;
export type DesignerId = string;

export type UserRole = "customer" | "designer" | "admin";
export type PublicationStatus = "draft" | "published" | "archived";
export type GenerationJobKind = "avatar_generation" | "virtual_try_on" | "runway_animation";
export type GenerationJobStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";
export type GeneratedMediaKind = "image_2d" | "model_3d" | "video";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: string;
}

export interface BrandSummary {
  id: BrandId;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
}

export interface DesignerProfileSummary {
  id: DesignerId;
  brand: BrandSummary;
  biography: string | null;
}

export interface GarmentSummary {
  id: ProductId;
  brand: BrandSummary;
  name: string;
  description: string | null;
  category: string;
  sizes: string[];
  colors: string[];
  tags: string[];
  priceMinor: number | null;
  currency: string | null;
  imageUrl: string | null;
  has3dAsset: boolean;
}

export interface GarmentDetail extends GarmentSummary {
  materials: string[];
  careInstructions: string | null;
  designer: DesignerProfileSummary;
}

export interface CollectionSummary {
  id: CollectionId;
  brand: BrandSummary;
  name: string;
  description: string | null;
  garmentCount: number;
  coverUrl: string | null;
}

export interface GenerationJobSummary {
  id: GenerationJobId;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  progress: number | null;
  safeError: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  result: GeneratedMediaSummary | null;
}

export interface GeneratedMediaSummary {
  id: string;
  kind: GeneratedMediaKind;
  contentType: string;
  url: string;
  createdAt: string;
}

export interface OutfitSummary {
  id: OutfitId;
  avatarId: AvatarId;
  name: string;
  description: string | null;
  garments: GarmentSummary[];
  createdAt: string;
}

export interface CreateGenerationJobResponse {
  job: GenerationJobSummary;
}

export interface CatalogResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export type ProviderCapability =
  | "avatar_image_2d"
  | "try_on_image_2d"
  | "runway_video"
  | "garment_model_3d"
  | "avatar_model_3d"
  | "cloth_simulation_3d";

export interface ProviderConfigurationStatus {
  capability: ProviderCapability;
  configured: boolean;
  provider: string | null;
  model: string | null;
  outputKind: GeneratedMediaKind | null;
  reason: string | null;
}

export interface CreateOutfitRequest {
  avatarId: AvatarId;
  name: string;
  description?: string | null;
  garmentIds: ProductId[];
}

export interface TryOnRequest {
  avatarId: AvatarId;
  garmentId: ProductId;
  photoView?: AvatarPhotoView;
}