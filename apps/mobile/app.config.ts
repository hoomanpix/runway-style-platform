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
    plugins: [
      ...(config.plugins ?? []),
      "expo-secure-store",
      [
        "expo-image-picker",
        {
          photosPermission: "Runway Style uses photos you choose for your avatar.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    extra: {
      ...config.extra,
      env,
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      supabasePublishableKey:
        process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
  };
};
