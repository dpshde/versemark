/**
 * Native design tokens mirroring DESIGN.md and apps/web/src/styles.css.
 * React Native cannot consume OKLCH directly on every supported device, so
 * these are perceptually matched sRGB values for the light and dark themes.
 */
import { Platform, type TextStyle } from "react-native";

export type ThemePreference = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";

/** Native UI face for controls, navigation, labels, and data. */
export const fontFamily = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}) as string;

/** The literary face is reserved for the wordmark and Scripture itself. */
export const serifFontFamily = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, serif",
}) as string;

export const lightColors = {
  bg: "#fbfaf9",
  surface: "#f6f4f2",
  surface2: "#ece9e5",
  rail: "#e7e4e0",
  ink: "#3a3632",
  ink2: "#6b6560",
  ink3: "#8b857f",
  accent: "#bd5932",
  accentDeep: "#9f4427",
  accentSoft: "#efd8c9",
  border: "#ddd9d4",
  borderStrong: "#c9c4bd",
  rowRule: "#d4cfc8",
  success: "#477a4d",
  error: "#873b30",
  onAccent: "#ffffff",
  heatClose: "#c8d8b9",
  heatFar: "#ae4829",
  genre: {
    law: "#79b66f",
    history: "#be7549",
    poetry: "#aa74b5",
    prophets: "#bd6039",
    gospels: "#cf7567",
    epistles: "#58a9ab",
  },
} as const;

export const darkColors: ThemeColors = {
  bg: "#242321",
  surface: "#2d2b29",
  surface2: "#393633",
  rail: "#403d3a",
  ink: "#eeeae5",
  ink2: "#b8b1aa",
  ink3: "#88817b",
  accent: "#db7046",
  accentDeep: "#e9a17f",
  accentSoft: "#4b3129",
  border: "#4a4642",
  borderStrong: "#625c57",
  rowRule: "#403c39",
  success: "#82b58b",
  error: "#d98376",
  onAccent: "#ffffff",
  heatClose: "#526f57",
  heatFar: "#c25c38",
  genre: {
    law: "#4f9360",
    history: "#9a5d42",
    poetry: "#895c99",
    prophets: "#9f5137",
    gospels: "#a95d56",
    epistles: "#46888d",
  },
};

export type ThemeColors = {
  [K in keyof typeof lightColors]: K extends "genre"
    ? { [G in keyof typeof lightColors.genre]: string }
    : string;
};

/** Backward-compatible light palette for non-render helpers and tests. */
export const colors: ThemeColors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  touch: 44,
} as const;

/**
 * Geometry follows material role, not component whim:
 * every app-owned surface is square; system-owned native chrome keeps its
 * platform geometry without Versemark imitating it.
 */
export const radius = {
  editorial: 0,
  artwork: 4,
  pill: 999,
} as const;

export function makeTypography(palette: ThemeColors) {
  return {
    display: {
      fontFamily: serifFontFamily,
      fontSize: 32,
      fontWeight: "600" as const,
      lineHeight: 38,
      letterSpacing: -0.3,
      color: palette.ink,
    } satisfies TextStyle,
    body: {
      fontFamily,
      fontSize: 17,
      fontWeight: "400" as const,
      lineHeight: 26,
      color: palette.ink,
    } satisfies TextStyle,
    verse: {
      fontFamily: serifFontFamily,
      fontSize: 18,
      fontWeight: "400" as const,
      lineHeight: 28,
      color: palette.ink,
    } satisfies TextStyle,
    tagline: {
      fontFamily,
      fontSize: 17,
      fontWeight: "400" as const,
      lineHeight: 24,
      color: palette.ink2,
    } satisfies TextStyle,
    label: {
      fontFamily,
      fontSize: 12,
      fontWeight: "600" as const,
      lineHeight: 16,
      letterSpacing: 0.8,
      textTransform: "uppercase" as const,
      color: palette.ink3,
    } satisfies TextStyle,
    section: {
      fontFamily,
      fontSize: 11,
      fontWeight: "600" as const,
      lineHeight: 14,
      letterSpacing: 1,
      textTransform: "uppercase" as const,
      color: palette.ink3,
    } satisfies TextStyle,
    score: {
      fontFamily,
      fontSize: 28,
      fontWeight: "700" as const,
      lineHeight: 34,
      letterSpacing: -0.3,
      color: palette.ink,
    } satisfies TextStyle,
    button: {
      fontFamily,
      fontSize: 16,
      fontWeight: "600" as const,
    } satisfies TextStyle,
  };
}

export const type = makeTypography(lightColors);

export function genreColor(genre: string, palette: ThemeColors = lightColors): string {
  return palette.genre[genre as keyof typeof palette.genre] ?? palette.rail;
}

/** Blend two #rrggbb colors for mastery heat without a rendering dependency. */
export function mixHex(from: string, to: string, t: number): string {
  const n = Math.min(1, Math.max(0, t));
  const parse = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `#${a
    .map((v, i) => Math.round(v + ((b[i] ?? v) - v) * n).toString(16).padStart(2, "0"))
    .join("")}`;
}
