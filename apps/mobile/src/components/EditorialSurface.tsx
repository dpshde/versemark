/** Flat Versemark-owned surface: square, hairline-defined, and never blurred. */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "../design-system";
import { radius } from "../theme";
import { useTheme } from "../theme-context";

export function EditorialSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.surface,
        { backgroundColor: colors.surface, borderColor: colors.borderStrong },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    borderRadius: radius.editorial,
    borderCurve: "continuous",
  },
});
