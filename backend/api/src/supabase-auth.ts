import type { AvatarServiceDependencies, AuthenticatedPrincipal } from "./avatar-service.ts";
import {
  SupabaseAvatarRepository,
  SupabasePrivateAvatarPhotoStorage,
  createUserSupabaseClient,
  type AvatarSupabaseClient,
} from "./supabase-adapters.ts";

export interface AuthenticatedAvatarContext {
  principal: AuthenticatedPrincipal;
  repository: SupabaseAvatarRepository;
  dependencies: AvatarServiceDependencies;
}

export class AuthProviderUnavailableError extends Error {
  constructor() {
    super("Authentication provider is unavailable.");
    this.name = "AuthProviderUnavailableError";
  }
}

export type AccessTokenAuthenticator = (
  accessToken: string
) => Promise<AuthenticatedAvatarContext | null>;
export type UserSupabaseClientFactory = (
  supabaseUrl: string,
  publishableKey: string,
  accessToken: string
) => AvatarSupabaseClient;

export function createSupabaseAuthenticator(
  config: { supabaseUrl: string; supabasePublishableKey: string },
  serviceClient: AvatarSupabaseClient,
  createUserClient: UserSupabaseClientFactory = createUserSupabaseClient
): AccessTokenAuthenticator {
  return async (accessToken) => {
    const authClient = createUserClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      accessToken
    );
    const user = await verifyAccessToken(authClient, accessToken);
    if (!user) return null;

    const repository = new SupabaseAvatarRepository(serviceClient);
    return {
      principal: { userId: user.id },
      repository,
      dependencies: {
        repository,
        storage: new SupabasePrivateAvatarPhotoStorage(serviceClient),
      },
    };
  };
}

async function verifyAccessToken(
  client: AvatarSupabaseClient,
  accessToken: string
): Promise<{ id: string } | null> {
  try {
    const { data, error } = await client.auth.getUser(accessToken);
    if (error) {
      const status = "status" in error ? error.status : undefined;
      if (status === 400 || status === 401 || status === 403) return null;
      throw new AuthProviderUnavailableError();
    }
    return data.user?.id ? { id: data.user.id } : null;
  } catch (error) {
    if (error instanceof AuthProviderUnavailableError) throw error;
    throw new AuthProviderUnavailableError();
  }
}