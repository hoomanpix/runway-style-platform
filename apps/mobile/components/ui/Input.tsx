import { TextInput, StyleSheet, TextInputProps } from "react-native";

import { colors, spacing } from "@/theme";

export function Input(props: TextInputProps) {
  return <TextInput {...props} style={[styles.input, props.style]} />;
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    fontSize: 16,
  },
});
