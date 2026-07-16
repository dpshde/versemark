import type { TranslationId } from "@versemark/core";
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from "../design-system";
import { useTheme } from "../theme-context";
import { hapticLight, hapticSelection } from "../lib/haptics";

export function ThemeButton() {
  const { colors, preference, cycleTheme } = useTheme();
  const label = preference[0]!.toUpperCase() + preference.slice(1);
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        cycleTheme();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Appearance: ${label}. Double tap to change.`}
      style={styles.button}
    >
      <View style={[styles.themeRing, { borderColor: colors.ink3 }]}>
        {preference === "system" ? <View style={[styles.themeHalf, { backgroundColor: colors.ink3 }]} /> : null}
        {preference === "light" ? <View style={[styles.sun, { backgroundColor: colors.ink3 }]} /> : null}
        {preference === "dark" ? <Text style={[styles.moon, { color: colors.ink3 }]}>◐</Text> : null}
      </View>
    </Pressable>
  );
}

export function TranslationButton({
  translation,
  onTranslation,
}: {
  translation: TranslationId;
  onTranslation: (translation: TranslationId) => void;
}) {
  const { colors, typography } = useTheme();
  const label = translation.toUpperCase();
  const selectTranslation = (next: TranslationId) => {
    hapticSelection();
    onTranslation(next);
  };
  const choose = () => {
    hapticLight();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Translation",
          options: ["Cancel", "Berean Standard Bible", "King James Version"],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) selectTranslation("bsb");
          if (index === 2) selectTranslation("kjv");
        }
      );
      return;
    }
    if (Platform.OS === "android") {
      Alert.alert("Translation", undefined, [
        { text: "Berean Standard Bible", onPress: () => selectTranslation("bsb") },
        { text: "King James Version", onPress: () => selectTranslation("kjv") },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    selectTranslation(translation === "bsb" ? "kjv" : "bsb");
  };

  return (
    <Pressable
      onPress={choose}
      accessibilityRole="button"
      accessibilityLabel={`Translation: ${label}`}
      accessibilityHint="Choose a Bible translation"
      style={({ pressed }) => [styles.translation, pressed ? styles.pressed : null]}
    >
      <Text style={[typography.body, styles.translationLabel, { color: colors.accentDeep }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  themeRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderCurve: "continuous",
    borderWidth: 1.5,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  themeHalf: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 8,
  },
  sun: { width: 6, height: 6, borderRadius: 3, borderCurve: "continuous" },
  moon: { fontSize: 15, lineHeight: 16, marginTop: -1 },
  translation: { minWidth: 44, height: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  translationLabel: { fontSize: 14, lineHeight: 20, fontWeight: "600", letterSpacing: 0 },
  pressed: { opacity: 0.55 },
});
