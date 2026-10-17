import { Link } from "expo-router";
import { View, Text, StyleSheet } from "react-native";

import { Button, Card } from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function OnboardingScreen() {
  return (
    <View style={styles.screen}>
      <Card style={styles.card}>
        <Text style={styles.title}>Create Your Avatar</Text>
        <Text style={styles.body}>
          Sign in and upload four photo views. Avatar generation is a separate step and is not available yet.
        </Text>

        <Link href="/onboarding/photo-guide" asChild>
          <Button title="Continue" />
        </Link>
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
