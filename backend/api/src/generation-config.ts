import { readReplicateTaskConfiguration } from "./replicate-provider.ts";

export function readAvatarGenerationConfiguration(env: NodeJS.ProcessEnv = process.env) {
  return readReplicateTaskConfiguration(
    "avatar_generation",
    env.REPLICATE_API_TOKEN,
    env.AVATAR_GENERATION_MODEL_VERSION,
    env.AVATAR_GENERATION_INPUTS_JSON,
    env.AVATAR_GENERATION_OUTPUT_PATH,
    env.AVATAR_GENERATION_OUTPUT_KIND,
  );
}
