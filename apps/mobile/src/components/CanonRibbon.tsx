/** A tiny canon bookmark: product identity with an earned streak flame. */
import { StyleSheet, Text, View } from "../design-system";
import { useTheme } from "../theme-context";

const BANDS = [
  ["law", 0.19],
  ["history", 0.23],
  ["poetry", 0.15],
  ["prophets", 0.18],
  ["gospels", 0.15],
  ["epistles", 0.1],
] as const;

export function CanonRibbon({
  height = 68,
  width = 20,
  horizontal = false,
  markerAt,
  markerFlameLevel = 0,
}: {
  height?: number;
  width?: number;
  horizontal?: boolean;
  markerAt?: number;
  markerFlameLevel?: number;
}) {
  const { colors } = useTheme();
  const axisLength = horizontal ? width : height;
  const flameLevel = Math.max(0, Math.min(5, Math.floor(markerFlameLevel)));
  const flameSize = 11 + flameLevel * 2.5;
  const markerExtent = flameLevel > 0 ? (flameSize + 4) / 2 : 5;
  const markerOffset = markerAt == null
    ? null
    : Math.max(
        markerExtent,
        Math.min(axisLength - markerExtent, Math.max(0, Math.min(1, markerAt)) * axisLength)
      );

  return (
    <View
      style={[styles.wrap, { width, height }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={[
          styles.rail,
          horizontal ? styles.railHorizontal : styles.railVertical,
          { backgroundColor: colors.rail },
        ]}
      >
        {BANDS.map(([genre, flex]) => (
          <View key={genre} style={{ flex, backgroundColor: colors.genre[genre] }} />
        ))}
      </View>
      {markerOffset != null ? (
        flameLevel > 0 ? (
          <View
            style={[
              styles.flame,
              { width: flameSize + 4, height: flameSize + 4 },
              horizontal
                ? { left: markerOffset, top: height / 2, marginLeft: -(flameSize + 4) / 2, marginTop: -(flameSize + 4) / 2 }
                : { top: markerOffset, left: width / 2, marginTop: -(flameSize + 4) / 2, marginLeft: -(flameSize + 4) / 2 },
            ]}
          >
            {flameLevel >= 3 ? (
              <View
                style={[
                  styles.flameGlow,
                  {
                    width: flameSize + (flameLevel >= 5 ? 10 : 7),
                    height: flameSize + (flameLevel >= 5 ? 10 : 7),
                    borderRadius: flameSize,
                    backgroundColor: colors.accentSoft,
                    opacity: flameLevel >= 4 ? 0.72 : 0.48,
                  },
                ]}
              />
            ) : null}
            <Text
              style={[styles.flameGlyph, { fontSize: flameSize, lineHeight: flameSize + 2 }]}
            >
              🔥
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.marker,
              horizontal
                ? { left: markerOffset, top: 5, marginLeft: -5 }
                : { top: markerOffset, left: 5, marginTop: -5 },
              { backgroundColor: colors.accent, borderColor: colors.bg },
            ]}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", alignItems: "center", justifyContent: "center" },
  rail: { overflow: "hidden" },
  railVertical: { width: 7, height: "100%" },
  railHorizontal: { width: "100%", height: 7, flexDirection: "row" },
  marker: {
    position: "absolute",
    width: 10,
    height: 10,
    borderWidth: 1.5,
    transform: [{ rotate: "45deg" }],
  },
  flame: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  flameGlow: {
    position: "absolute",
  },
  flameGlyph: {
    textAlign: "center",
  },
});
