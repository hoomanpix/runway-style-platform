import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  const name = process.env.APP_NAME ?? "Runway Mobile";
  const slug = process.env.APP_SLUG ?? "runway-mobile";

  return {
    ...config,
    name,
    slug,
    platforms: ["ios", "android", "web"],
    version: "1.0.0",
    extra: {
      env,
    },
  };
};
