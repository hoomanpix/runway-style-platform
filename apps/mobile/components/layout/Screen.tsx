import { ReactNode } from "react";
import { View, StyleSheet } from "react-native";

import { spacing } from "@/theme";

type Props = {
  children: ReactNode;
};

export function Screen({ children }: Props) {
  return <View style={styles.screen}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: spacing.lg,
  },
});
