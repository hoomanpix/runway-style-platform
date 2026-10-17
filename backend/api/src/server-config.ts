export interface ServerConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  port: number;
  host: string;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabasePublishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const portValue = env.PORT?.trim() || "3000";
  const port = Number(portValue);

  if (!supabaseUrl || !supabasePublishableKey || !supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY must be configured."
    );
  }
  try {
    const url = new URL(supabaseUrl);
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !isLoopback) {
      throw new Error("invalid scheme");
    }
  } catch {
    throw new Error(
      "SUPABASE_URL must be a valid HTTPS URL (or a loopback URL for development)."
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return {
    supabaseUrl,
    supabasePublishableKey,
    supabaseServiceRoleKey,
    port,
    host: env.HOST?.trim() || "127.0.0.1",
  };
}