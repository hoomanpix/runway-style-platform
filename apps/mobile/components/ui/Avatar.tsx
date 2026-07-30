import { Image, StyleSheet } from "react-native";

type Props = {
  uri?: string;
  size?: number;
};

export function Avatar({ uri, size = 120 }: Props) {
  return (
    <Image
      source={uri ? { uri } : require("../../assets/icon.png")}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
      }}
    />
  );
}
