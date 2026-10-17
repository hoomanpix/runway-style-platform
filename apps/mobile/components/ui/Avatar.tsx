import { Image, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";

type Props = {
  uri?: string;
  size?: number;
};

export function Avatar({ uri, size = 120 }: Props) {
  const imageStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (uri) return <Image source={{ uri }} style={imageStyle} />;

  return (
    <View style={[styles.fallback, imageStyle]}>
      <Text style={[styles.initials, { fontSize: size * 0.24 }]}>RS</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    backgroundColor: colors.navy,
    justifyContent: "center",
  },
  initials: {
    color: colors.cream,
    fontFamily: "serif",
  },
});
