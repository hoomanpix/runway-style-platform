import type {
  AvatarPhotoContentType,
  AvatarPhotoView,
  AvatarStatus,
  GeneratedMediaKind,
  GenerationJobKind,
  GenerationJobStatus,
} from "@runway/types";

export interface Database {
  public: {
    Tables: {
      avatars: {
        Row: {
          id: string;
          owner_id: string;
          status: AvatarStatus;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          status?: AvatarStatus;
          idempotency_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["avatars"]["Insert"]>;
        Relationships: [];
      };
      avatar_photos: {
        Row: {
          id: string;
          avatar_id: string;
          owner_id: string;
          view: AvatarPhotoView;
          content_type: AvatarPhotoContentType;
          byte_size: number;
          content_sha256: string;
          idempotency_key: string;
          storage_object_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          avatar_id: string;
          owner_id?: string;
          view: AvatarPhotoView;
          content_type: AvatarPhotoContentType;
          byte_size: number;
          content_sha256: string;
          idempotency_key: string;
          storage_object_key: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["avatar_photos"]["Insert"]>;
        Relationships: [];
      };
      generation_jobs: {
        Row: {
          id: string;
          owner_id: string;
          avatar_id: string | null;
          garment_id: string | null;
          outfit_id: string | null;
          kind: GenerationJobKind;
          status: GenerationJobStatus;
          idempotency_key: string;
          input: Record<string, unknown>;
          output: Record<string, unknown> | null;
          provider: string | null;
          provider_job_id: string | null;
          progress: number | null;
          attempts: number;
          max_attempts: number;
          available_at: string;
          locked_by: string | null;
          locked_until: string | null;
          safe_error: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          avatar_id?: string | null;
          garment_id?: string | null;
          outfit_id?: string | null;
          kind: GenerationJobKind;
          status?: GenerationJobStatus;
          idempotency_key: string;
          input?: Record<string, unknown>;
          output?: Record<string, unknown> | null;
          provider?: string | null;
          provider_job_id?: string | null;
          progress?: number | null;
          attempts?: number;
          max_attempts?: number;
          available_at?: string;
          locked_by?: string | null;
          locked_until?: string | null;
          safe_error?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["generation_jobs"]["Insert"]>;
        Relationships: [];
      };
      avatar_assets: {
        Row: {
          id: string;
          owner_id: string;
          avatar_id: string;
          job_id: string;
          kind: Extract<GeneratedMediaKind, "image_2d" | "model_3d">;
          content_type: string;
          object_key: string;
          provider: string;
          model: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          avatar_id: string;
          job_id: string;
          kind: Extract<GeneratedMediaKind, "image_2d" | "model_3d">;
          content_type: string;
          object_key: string;
          provider: string;
          model: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["avatar_assets"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      enqueue_avatar_generation_job: {
        Args: { p_owner_id: string; p_avatar_id: string; p_idempotency_key: string };
        Returns: Database["public"]["Tables"]["generation_jobs"]["Row"][];
      };
      claim_generation_job: {
        Args: { p_worker_id: string; p_lease_seconds?: number };
        Returns: Database["public"]["Tables"]["generation_jobs"]["Row"][];
      };
      renew_avatar_generation_job: {
        Args: { p_job_id: string; p_worker_id: string; p_lease_seconds?: number };
        Returns: boolean;
      };
      complete_avatar_generation_job: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
          p_owner_id: string;
          p_avatar_id: string;
          p_object_key: string;
          p_content_type: string;
          p_provider: string;
          p_model: string;
        };
        Returns: null;
      };
      fail_avatar_generation_job: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
          p_safe_error: string;
          p_retryable: boolean;
        };
        Returns: null;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
