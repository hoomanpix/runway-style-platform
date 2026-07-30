import { Link } from "expo-router";
import { View, Text, StyleSheet } from "react-native";

import { Button } from "@/components/ui";
import { colors, spacing } from "@/theme";

export default function LandingScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.title}>Runway</Text>
        <Text style={styles.subtitle}>Create your AI fashion avatar</Text>
      </View>

      <Link href="/onboarding" asChild>
        <Button title="Start Creating" />
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  hero: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 36,
    fontWeight: "700",
    color: colors.foreground,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: 18,
    color: colors.muted,
  },
});
