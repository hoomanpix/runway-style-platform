import { createAvatarHttpServer } from "./http-server.ts";
import { readServerConfig } from "./server-config.ts";
import { createSupabaseAuthenticator } from "./supabase-auth.ts";
import { createServiceSupabaseClient } from "./supabase-adapters.ts";

try {
  const config = readServerConfig();
  const serviceClient = createServiceSupabaseClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey
  );
  const server = createAvatarHttpServer(
    createSupabaseAuthenticator(config, serviceClient)
  );
  server.listen(config.port, config.host, () => {
    console.log(`Runway API listening on http://${config.host}:${config.port}`);
  });
  server.on("error", () => {
    console.error("Runway API failed to start or accept connections.");
    process.exitCode = 1;
  });
  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
} catch (error) {
  console.error(error instanceof Error ? error.message : "Runway API configuration is invalid.");
  process.exitCode = 1;
}