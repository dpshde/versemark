/**
 * Square primary / secondary / ghost — matches web .btn-primary / .btn-secondary / .btn-ghost.
 */
import type { ReactElement } from "react";
import {
  Platform,
  Pressable,
  Text,
  StyleSheet,
  View,
  type ViewStyle,
  type StyleProp,
} from "../design-system";
import { hapticLight } from "../lib/haptics";
import { spacing, radius } from "../theme";
import { useTheme } from "../theme-context";

type Variant = "primary" | "secondary" | "ghost";

export type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  icon?: ReactElement;
  fullWidth?: boolean;
  supportingText?: string;
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  variant = "primary",
  style,
  accessibilityHint,
  icon,
  fullWidth = true,
  supportingText,
}: PrimaryButtonProps) {
  const { colors, reduceMotion, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      android_ripple={{ color: colors.accentSoft }}
      onPress={() => {
        if (disabled) return;
        hapticLight();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        fullWidth ? styles.full : null,
        variant === "primary" ? { backgroundColor: colors.accent, borderColor: colors.accent } : null,
        variant === "secondary" ? { backgroundColor: "transparent", borderColor: colors.borderStrong } : null,
        variant === "ghost" ? styles.ghost : null,
        disabled && variant === "primary" ? { backgroundColor: colors.accentSoft, borderColor: colors.accentSoft } : null,
        disabled && variant !== "primary" ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
        pressed && !disabled && !reduceMotion && Platform.OS !== "android" ? styles.pressedScale : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ?? null}
        <View style={styles.copy}>
          <Text
            style={[
              typography.button,
              styles.label,
              variant === "primary" ? { color: colors.onAccent } : null,
              variant === "secondary" ? { color: colors.ink2, fontWeight: "600" } : null,
              variant === "ghost" ? { color: colors.ink3, fontWeight: "500", fontSize: 15 } : null,
              disabled && variant === "primary" ? { color: colors.accentDeep } : null,
              disabled && variant !== "primary" ? { color: colors.ink3 } : null,
            ]}
          >
            {label}
          </Text>
          {supportingText ? (
            <Text
              style={[
                styles.supporting,
                { color: variant === "primary" ? colors.onAccent : colors.ink3 },
              ]}
            >
              {supportingText}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: spacing.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.editorial,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  full: {
    width: "100%",
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  disabled: {
    opacity: 0.38,
  },
  pressed: {
    opacity: 0.9,
  },
  pressedScale: {
    transform: [{ scale: 0.985 }],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  copy: {
    alignItems: "center",
    gap: 2,
  },
  label: {
    textAlign: "center",
  },
  supporting: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    opacity: 0.86,
    textAlign: "center",
  },
});
