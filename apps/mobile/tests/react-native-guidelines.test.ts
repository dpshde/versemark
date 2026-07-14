import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mobileRoot = resolve(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(mobileRoot, path), "utf8");
}

describe("React Native guideline guardrails", () => {
  it("keeps the long progress ledger virtualized and typed", () => {
    const source = read("src/screens/AchievementsScreen.tsx");

    expect(source).toContain('from "@legendapp/list/react-native"');
    expect(source).toContain("recycleItems");
    expect(source).toContain("getItemType={achievementItemType}");
    expect(source).toContain("extraData={scheme}");
  });

  it("renders achievement artwork through expo-image", () => {
    const source = read("src/design-system/index.ts");

    expect(source).toContain('export { Image } from "expo-image"');
    expect(read("src/screens/AchievementsScreen.tsx")).not.toMatch(
      /import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*["']react-native["']/s
    );
  });

  it("uses native content inset adjustment on scroll roots", () => {
    for (const path of ["src/screens/PlayScreen.tsx", "src/screens/AchievementsScreen.tsx"]) {
      const source = read(path);
      expect(source).toContain('contentInsetAdjustmentBehavior: "automatic"');
      expect(source).toContain('Platform.OS === "web" ? {}');
    }
  });

  it("keeps rough placement provisional until the gesture ends", () => {
    const source = read("src/components/TimelineStrip.tsx");

    expect(source).toContain("onPanResponderRelease: finishPlacement");
    expect(source).toContain("if (placed != null) onPlace(placed)");
    expect(source).toContain("scrubVersesPerSecond(activeSpan");
    expect(source).toContain("startEdgeScroll();");
    expect(source).toContain("pickBookLabels(segments, range, axisLength)");
    expect(source).toContain("height: StyleSheet.hairlineWidth, opacity: 0.3");
    expect(source).toContain("resultLabelTop(truthY, height)");
    expect(source).toContain("backgroundColor: colors.success");
    expect(source).toContain("backgroundColor: colors.accentSoft");
  });

  it("uses the web precision ruler in the settled book view", () => {
    const source = read("src/components/TimelineStrip.tsx");
    const playSource = read("src/screens/PlayScreen.tsx");

    expect(source).toContain("viewportForPrecision");
    expect(source).toContain("precisionChapters(range, displayGuess, axisLength)");
    expect(source).toContain("ACTIVE_NOTCH_LENGTH");
    expect(source).toContain('transform: [{ rotate: "90deg" }]');
    expect(source).toContain("numberOfLines={1}");
    expect(source).toContain("settledLabelWidth = Math.max(280, height * 0.9)");
    expect(source).toContain("settledReferenceFontSize(activeLabel, settledLabelWidth)");
    expect(source).toContain("maxWidth: settledLabelWidth");
    expect(source).toContain("marginLeft: -settledLabelWidth / 2");
    expect(source).toContain("backgroundColor: bookPrecision ? colors.accentDeep");
    expect(source).toContain("borderWidth: bookPrecision ? 0 : 2");
    expect(source).toContain("minHeight: minimumBoardHeight");
    expect(source).not.toContain("useWindowDimensions");
    expect(playSource).toContain("board: { flex: 1, minHeight: 0");
  });

  it("uses the experimental OS-native tabs outside the web preview", () => {
    const source = read("src/navigation/RootNavigator.tsx");

    expect(source).toContain("createNativeBottomTabNavigator");
    expect(source).toContain('Platform.OS === "web"');
    expect(source).toContain('type: "sfSymbol"');
    expect(source).toContain('focused ? "play.fill" : "play"');
    expect(source).toContain("<PlayTabIcon color={color} />");
    expect(source).toContain("tabBarControllerMode");
    expect(source).not.toContain("MobileTabBar");
  });

  it("keeps timeline zoom controls with the bottom answer dock", () => {
    const source = read("src/screens/PlayScreen.tsx");

    expect(source).not.toContain("headerTitle");
    expect(source).not.toContain("useNavigation");
    expect(source).toMatch(/<StageReveal>[\s\S]*styles\.zoomSegment[\s\S]*styles\.guessRow/);
    expect(source).toContain("minHeight: spacing.touch");
    expect(source).toContain("styles.resultScore");
    expect(source).toContain("{scoreFormatter.format(displayScore)} pts");
    expect(source).toContain("{item.total} pts · {formatMiss(item.distance)}");
    expect(source).toContain('outlineWidth: Platform.OS === "web" ? 0 : undefined');
  });

  it("leads Progress with the next milestone", () => {
    const source = read("src/screens/AchievementsScreen.tsx");

    expect(source.indexOf("Next milestone")).toBeLessThan(source.indexOf("At a glance"));
    expect(source).toContain('expanded ? "225deg" : "45deg"');
    expect(source).toContain('`${expanded ? "Collapse" : "Expand"} ${title}`');
  });

  it("pins direct dependency versions in every workspace", () => {
    for (const path of [
      "package.json",
      "../../apps/web/package.json",
      "../../packages/core/package.json",
    ]) {
      const pkg = JSON.parse(read(path)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const specs = Object.values({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      });

      expect(specs.filter((spec) => !spec.startsWith("workspace:")).every(
        (spec) => !spec.startsWith("^") && !spec.startsWith("~")
      )).toBe(true);
    }
  });
});
