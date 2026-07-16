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

  it("uses native content inset adjustment on the progress ledger", () => {
    const source = read("src/screens/AchievementsScreen.tsx");

    expect(source).toContain('contentInsetAdjustmentBehavior: "automatic"');
    expect(source).toContain('Platform.OS === "web" ? {}');
  });

  it("keeps the timeline page fixed with no scroll owner above its drag surface", () => {
    const source = read("src/screens/PlayScreen.tsx");

    expect(source).not.toContain("ScrollView");
    expect(source).toContain("<View style={styles.playfield}>");
    expect(source).toContain('root: { flex: 1, overflow: "hidden" }');
    expect(source).toContain('playfield: { flex: 1, minHeight: 0, paddingBottom: spacing.sm, overflow: "hidden" }');
  });

  it("keeps rough placement provisional until the gesture ends", () => {
    const source = read("src/components/TimelineStrip.tsx");

    expect(source).toContain("onPanResponderRelease: finishPlacement");
    expect(source).toMatch(/if \(placed != null\) \{[\s\S]{0,100}hapticConfirm\(\);[\s\S]{0,100}onPlace\(placed\);/);
    expect(source).toContain("scrubVersesPerSecond(activeSpan");
    expect(source).toContain("startEdgeScroll();");
    expect(source).toContain("pickBookLabels(segments, range, axisLength)");
    expect(source).toContain("Rough placement");
    expect(source).toContain("interactive && displayGuess == null");
    expect(source).toContain("height: StyleSheet.hairlineWidth, opacity: 0.3");
    expect(source).toContain("resultLabelTop(truthY, height)");
    expect(source).toContain("backgroundColor: colors.success");
    expect(source).toContain("backgroundColor: colors.accentSoft");
    expect(source).toContain("styles.resultCallout");
    expect(source).toContain("styles.resultStem");
    expect(source).toContain("backgroundColor: colors.surface");
    expect(source).toContain("borderColor: colors.borderStrong");
    expect(source).toContain(">TRUE</Text>");
    expect(source).toContain(">YOU</Text>");
    expect(source).toContain("adjustsFontSizeToFit");
    expect(source).toContain("borderRadius: 0");
    expect(source).not.toContain("styles.truthLabel");
    expect(source).not.toContain("styles.guessLabel");
    expect(source).toContain("right: spacing.sm");
    expect(source).toContain("onLayout={onDragLabelLayout}");
    expect(source).toContain("labelTop(guessY, height, dragLabelHeight)");
    expect(source).not.toContain("maxWidth: 148");
    expect(source).not.toContain("maxWidth: 180");
    expect(source).not.toMatch(/numberOfLines=\{1\}\s+style=\{\[styles\.scrubRef/);
    expect(source).not.toContain("styles.scrubReference");
    expect(source).not.toContain("styles.dragReference");
    expect(source).not.toContain("liveMarkerRef");
    expect(source).toContain("const dragShift = dragVerse != null");
    expect(source).not.toContain("dragVerse != null && !bookPrecision");
    expect(source).toContain("transform: [{ translateX: boardShiftX }]");
    expect(source).toContain('useNativeDriver: Platform.OS !== "web"');
    expect(source).toMatch(/!revealed && activeLabel && dragVerse != null[\s\S]*styles\.scrubRef/);
    expect(source).toMatch(/<Text\s+pointerEvents="none"\s+onLayout=\{onDragLabelLayout\}[\s\S]*styles\.scrubRef/);
    expect(source).not.toMatch(/styles\.scrubRef[\s\S]{0,180}(backgroundColor|borderColor)/);
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
    expect(source).toContain('focused ? "book.fill" : "book"');
    expect(source).toContain('source={require("../../assets/tab-book.png")}');
    expect(source).not.toContain("PlayTabIcon");
    expect(source).toContain("tabBarControllerMode");
    expect(source).toContain('tabBarBlurEffect: "systemDefault"');
    expect(source).toContain('Platform.OS === "ios"');
    expect(source).toContain("UIKit owns the bar material and typography");
    expect(source).toContain("StackActions.popToTop()");
    expect(source).toContain('listeners={{ tabPress: leaveRoundForTab }}');
    expect(source).toMatch(/<SafeAreaView[^>]*edges=\{\["top", "bottom", "left", "right"\]\}>\s*<HomeScreen/);
    expect(source).toMatch(/<SafeAreaView[^>]*edges=\{\["top", "left", "right"\]\}>\s*<ProgressRoute/);
    expect(source).not.toContain("MobileTabBar");
  });

  it("anchors the home cluster above geometric center", () => {
    const source = read("src/screens/HomeScreen.tsx");

    expect(source).toContain("<View style={styles.topSpacer} />");
    expect(source).toContain("<View style={styles.cluster}>");
    expect(source).toContain("<View style={styles.bottomSpacer} />");
    expect(source).toContain("topSpacer: { flex: 4 }");
    expect(source).toContain("bottomSpacer: { flex: 6 }");
    expect(source).not.toMatch(/panel:\s*\{[\s\S]{0,240}justifyContent: "center"/);
  });

  it("uses the canonical diamond marker for the native app icon", () => {
    const source = read("assets/app-icon-source.svg");
    const adaptive = read("assets/adaptive-icon-source.svg");
    const config = JSON.parse(read("app.json")) as { expo: { icon: string; android: { adaptiveIcon: { foregroundImage: string } } } };

    expect(source).toContain('fill="#fbfaf9"');
    expect(source).toContain('fill="#bd5932"');
    expect(source).toContain('d="M512 184 840 512 512 840 184 512 Z"');
    expect(adaptive).toContain('fill="#bd5932"');
    expect(adaptive).toContain('d="M512 248 776 512 512 776 248 512 Z"');
    expect(config.expo.icon).toBe("./assets/icon.png");
    expect(config.expo.android.adaptiveIcon.foregroundImage).toBe("./assets/adaptive-icon.png");
  });

  it("adapts game controls into a compact native bottom accessory", () => {
    const source = read("src/screens/PlayScreen.tsx");
    const surfaces = read("src/components/EditorialSurface.tsx");

    expect(source).not.toContain("headerTitle");
    expect(source).not.toContain("useNavigation");
    expect(source).toMatch(/<EditorialSurface style=\{styles\.controlSurface\}>[\s\S]*styles\.utilityRow[\s\S]*styles\.commitRow/);
    expect(source).toContain('behavior={Platform.OS === "ios" ? "padding" : "height"}');
    expect(source).toContain("keyboardVerticalOffset={headerHeight}");
    expect(source).toContain("const headerHeight = useHeaderHeight()");
    expect(source).toContain("Keyboard.isVisible()");
    expect(source).toContain('Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"');
    expect(source).toContain("keyboardVisible ? spacing.md : Math.max(spacing.sm, insets.bottom)");
    expect(surfaces).not.toContain("GlassView");
    expect(surfaces).toContain("borderRadius: radius.editorial");
    expect(source).not.toContain("GlassView");
    expect(source).toContain('backgroundColor: "transparent"');
    expect(source).toContain("borderRadius: radius.editorial");
    expect(source).not.toContain("backgroundColor: colors.surface2");
    expect(source).toContain("minHeight: spacing.touch");
    expect(source).toContain("styles.resultScore");
    expect(source).toContain("ActionSheetIOS.showActionSheetWithOptions");
    expect(source).toContain('title: "Timeline scale"');
    expect(source).toContain('accessibilityLabel={`Timeline scale: ${zoomLabels[zoom]}`}');
    expect(source).toContain('placeholder="John 3:16"');
    expect(source).toContain('submitBehavior="blurAndSubmit"');
    expect(source).not.toContain("onSubmitEditing={handleConfirm}");
    expect(source).toMatch(/>Hint<\/Text>/);
    expect(source).toContain("const [hintExpanded, setHintExpanded] = useState(false)");
    expect(source).toContain('accessibilityState={{ expanded: hintExpanded }}');
    expect(source).toContain("styles.hintDisclosure");
    expect(source).toContain("styles.hintDisclosureHeader");
    expect(source).toContain("styles.hintDisclosureBody");
    expect(source).toContain('>Hint revealed</Text>');
    expect(source).toContain('hintExpanded ? "Hide" : "Show"');
    expect(source).toContain("setHintExpanded(false)");
    expect(source).toMatch(/>\s*Confirm\s*<\/Text>/);
    expect(source).toContain("bottom: 58");
    expect(source).toContain("height: 52");
    expect(source).toContain("paddingVertical: 0");
    expect(source).toContain('textAlignVertical: "center"');
    expect(source).toContain("includeFontPadding: false");
    expect(source).not.toContain("borderRadius: 12");
    expect(source).not.toContain("borderRadius: 16");
    expect(source).not.toContain("styles.zoomSegment");
    expect(source).not.toContain("Hint ·");
    expect(source).not.toContain("Lock ·");
    expect(source).toContain("{scoreFormatter.format(displayScore)}");
    expect(source).toContain(">PTS</Text>");
    expect(source).toContain("{formatMiss(item.distance)} · <Text style={styles.summaryPoints}>{item.total} pts</Text>");
    expect(source).toContain('outlineWidth: Platform.OS === "web" ? 0 : undefined');
  });

  it("leads Progress with the next milestone", () => {
    const source = read("src/screens/AchievementsScreen.tsx");

    expect(source.indexOf("Next milestone")).toBeLessThan(source.indexOf("At a glance"));
    expect(source).toContain('["Close rate", `${insights.closeRate}%`]');
    expect(source).toContain('label="Best book"');
    expect(source).toContain('label="Book to practice"');
    expect(source).toContain('label="Best genre"');
    expect(source).toContain('label="Genre to practice"');
    expect(source).toContain('title="Genres to practice"');
    expect(source).toContain('genresForFocusMode(mastery, "farther")');
    expect(source).toContain("map.measureInWindow");
    expect(source).toContain('testID="canon-mastery-map"');
    expect(source).toContain('expanded ? "225deg" : "45deg"');
    expect(source).toContain('`${expanded ? "Collapse" : "Expand"} ${title}`');
    expect(source).toContain("ListFooterComponent");
    expect(source).toContain('"Reset all progress?"');
    expect(source).toContain('style: "destructive"');
    expect(source).toContain("onResetProgress()");
    expect(source).toContain("borderRadius: radius.editorial");
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
