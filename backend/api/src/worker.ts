import { randomUUID } from "node:crypto";
import { readServerConfig } from "./server-config.ts";
import { readAvatarGenerationConfiguration } from "./generation-config.ts";
import { AvatarGenerationWorker } from "./generation-worker.ts";
import { createServiceSupabaseClient, SupabaseAvatarGenerationStorage, SupabaseAvatarRepository } from "./supabase-adapters.ts";

try {
  const config = readServerConfig();
  const generation = readAvatarGenerationConfiguration();
  const client = createServiceSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const repository = new SupabaseAvatarRepository(client);
  const storage = new SupabaseAvatarGenerationStorage(client);
  const worker = new AvatarGenerationWorker(repository, storage, generation.provider, `avatar-worker-${randomUUID()}`);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  console.log(generation.status.configured ? "Runway avatar worker started." : "Runway avatar worker started without a configured provider; jobs will fail safely.");
  await worker.runForever(controller.signal);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Runway avatar worker failed to start.");
  process.exitCode = 1;
}
