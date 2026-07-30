import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";

import { spacing } from "@/theme";

type Props = {
  children: ReactNode;
};

export function Container({ children }: Props) {
  return <View style={styles.container}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
