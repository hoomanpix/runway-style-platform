import { Link } from "expo-router";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { Button } from "@/components/ui/Button";
import { colors, spacing } from "@/theme";

export default function LandingScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 820;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <Link href="/" asChild>
            <Text accessibilityRole="link" style={styles.wordmark}>
              RUNWAY <Text style={styles.wordmarkAccent}>STYLE</Text>
            </Text>
          </Link>
          <View style={styles.navigation}>
            <Link href="/onboarding" asChild>
              <Button title={wide ? "Get started" : "Start"} />
            </Link>
            {wide ? (
              <>
                <Link href="/studio" asChild>
                  <Text accessibilityRole="link" style={styles.navLink}>Studio</Text>
                </Link>
                <Link href="/upload" asChild>
                  <Text accessibilityRole="link" style={styles.navLink}>Photo setup</Text>
                </Link>
              </>
            ) : null}
          </View>
        </View>

        <View style={[styles.hero, wide && styles.heroWide]}>
          <View style={[styles.copy, wide && styles.copyWide]}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowMark} />
              <Text style={styles.eyebrow}>A PERSONAL STYLE STUDIO</Text>
            </View>
            <Text style={[styles.title, wide && styles.titleWide]}>
              Find your own kind of presence.
            </Text>
            <Text style={styles.description}>
              Start with four considered views. Build a private avatar profile and make space for the way you want to show up.
            </Text>
            <View style={styles.actions}>
              <Link href="/onboarding" asChild>
                <Button title="Begin your photo setup" />
              </Link>
              <Link href="/upload" asChild>
                <Text accessibilityRole="link" style={styles.secondaryAction}>Continue an upload</Text>
              </Link>
            </View>
            <Text style={styles.disclaimer}>
              PHOTO UPLOAD IS AVAILABLE WITH ACCOUNT SETUP. AVATAR GENERATION IS NOT CONFIGURED YET.
            </Text>
          </View>

          <View style={[styles.editorial, wide && styles.editorialWide]}>
            <View style={styles.editorialHeader}>
              <Text style={styles.editorialIndex}>RS / 01</Text>
              <Text style={styles.editorialLabel}>YOUR STYLE, IN FRAME</Text>
            </View>
            <View style={styles.artwork}>
              <View style={styles.artColumn} />
              <Text style={styles.artNumber}>01</Text>
              <View style={styles.artAccentBlock} />
              <View style={styles.artCopy}>
                <Text style={styles.artTitle}>The shape</Text>
                <Text style={styles.artTitle}>of your style.</Text>
                <View style={styles.artRule} />
                <Text style={styles.artCaption}>FOUR VIEWS. ONE PERSONAL PROFILE.</Text>
              </View>
            </View>
            <View style={styles.editorialFooter}>
              <Text style={styles.editorialLabel}>FRONT / LEFT / RIGHT / BACK</Text>
              <Text style={styles.editorialIndex}>RUNWAY STYLE</Text>
            </View>
          </View>
        </View>

        <View style={styles.footerBand}>
          <Text style={styles.footerLabel}>MADE FOR YOUR POINT OF VIEW</Text>
          <Text style={styles.footerCopy}>
            Your photos stay attached to your account. Selection alone never uploads them.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.navy,
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  page: {
    alignSelf: "center",
    maxWidth: 1280,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    width: "100%",
  },
  header: {
    alignItems: "center",
    borderBottomColor: "rgba(243,239,229,0.18)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 82,
  },
  wordmark: {
    color: colors.cream,
    fontSize: 15,
    fontWeight: "700",
  },
  wordmarkAccent: {
    color: colors.accent,
    fontWeight: "400",
  },
  navigation: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.lg,
  },
  navLink: {
    color: colors.cream,
    fontSize: 14,
  },
  hero: {
    gap: spacing.xl,
    paddingTop: spacing.xl,
  },
  heroWide: {
    alignItems: "center",
    flexDirection: "row",
    gap: 64,
    minHeight: 650,
    paddingVertical: spacing.xl,
  },
  copy: {
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  copyWide: {
    flex: 1,
    maxWidth: 560,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  eyebrowMark: {
    backgroundColor: colors.accent,
    height: 2,
    width: 24,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "600",
  },
  title: {
    color: colors.cream,
    fontFamily: "serif",
    fontSize: 46,
    fontWeight: "400",
    lineHeight: 52,
    maxWidth: 520,
  },
  titleWide: {
    fontSize: 66,
    lineHeight: 72,
  },
  description: {
    color: "#C8CBC8",
    fontSize: 16,
    lineHeight: 25,
    maxWidth: 440,
  },
  actions: {
    alignItems: "flex-start",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  secondaryAction: {
    color: colors.cream,
    fontSize: 14,
    paddingVertical: spacing.sm,
    textDecorationLine: "underline",
  },
  disclaimer: {
    color: "#AAB2B2",
    fontSize: 10,
    lineHeight: 15,
    marginTop: spacing.sm,
    maxWidth: 400,
  },
  editorial: {
    backgroundColor: colors.cream,
    minHeight: 430,
    padding: spacing.lg,
    width: "100%",
  },
  editorialWide: {
    flex: 1,
    maxWidth: 510,
    minHeight: 510,
    padding: spacing.xl,
  },
  editorialHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  editorialIndex: {
    color: colors.foreground,
    fontSize: 10,
    fontWeight: "700",
  },
  editorialLabel: {
    color: colors.muted,
    fontSize: 9,
  },
  artwork: {
    flex: 1,
    justifyContent: "center",
    marginVertical: spacing.md,
    minHeight: 290,
    overflow: "hidden",
    padding: spacing.lg,
    position: "relative",
  },
  artColumn: {
    backgroundColor: colors.surface,
    bottom: 0,
    position: "absolute",
    right: "16%",
    top: 0,
    width: "31%",
  },
  artNumber: {
    color: "rgba(16,29,42,0.08)",
    fontFamily: "serif",
    fontSize: 210,
    lineHeight: 220,
    position: "absolute",
    right: "8%",
    top: 18,
  },
  artAccentBlock: {
    backgroundColor: colors.accent,
    height: 110,
    position: "absolute",
    right: "24%",
    top: "25%",
    width: 2,
  },
  artCopy: {
    gap: 2,
    zIndex: 1,
  },
  artTitle: {
    color: colors.navy,
    fontFamily: "serif",
    fontSize: 31,
    lineHeight: 37,
  },
  artRule: {
    backgroundColor: colors.accent,
    height: 2,
    marginTop: spacing.md,
    width: 36,
  },
  artCaption: {
    color: colors.muted,
    fontSize: 9,
    marginTop: spacing.sm,
  },
  editorialFooter: {
    alignItems: "center",
    borderTopColor: "#D8D2C6",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  footerBand: {
    borderTopColor: "rgba(243,239,229,0.18)",
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    marginTop: spacing.xl,
    paddingTop: spacing.md,
  },
  footerLabel: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "600",
  },
  footerCopy: {
    color: "#AAB2B2",
    fontSize: 13,
    lineHeight: 20,
  },
});