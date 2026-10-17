import { View, Text, StyleSheet } from "react-native";

import { Card } from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function StudioScreen() {
  return (
    <View style={styles.screen}>
      <Card style={styles.card}>
        <Text style={styles.title}>Avatar Studio</Text>
        <Text style={styles.body}>
          Avatar generation is not available yet. No avatar has been created.
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  card: {
    gap: spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.foreground,
  },
  body: {
    fontSize: 16,
    color: colors.muted,
    lineHeight: 22,
  },
});
