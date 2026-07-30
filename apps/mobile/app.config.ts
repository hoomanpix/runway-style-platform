import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Runway Mobile",
  slug: "runway-mobile",
  platforms: ["ios", "android", "web"],
  version: "0.0.1",
});
