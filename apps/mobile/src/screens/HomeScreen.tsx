/**
 * Home — centered wordmark and launch actions inside the native Play tab.
 */
import { View, Text, StyleSheet } from "../design-system";
import {
  DAILY_VERSE_COUNT,
  isDailyComplete,
  todayPuzzleNumber,
  type AppState,
} from "@versemark/core";
import { PrimaryButton } from "../components/PrimaryButton";
import { CanonRibbon } from "../components/CanonRibbon";
import { ThemeButton } from "../components/TopChrome";
import { streakFlameLevel, streakMarkerProgress } from "../lib/streak-progress";
import { spacing } from "../theme";
import { useTheme } from "../theme-context";

const homeDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const homeNumberFormatter = new Intl.NumberFormat();

export type HomeScreenProps = {
  appState: AppState;
  onDaily: () => void;
  onEndless: () => void;
};

export function HomeScreen({
  appState,
  onDaily,
  onEndless,
}: HomeScreenProps) {
  const { colors, typography } = useTheme();
  const puzzleNumber = todayPuzzleNumber();
  const todayRecord = appState.lastDaily?.puzzleNumber === puzzleNumber
    ? appState.lastDaily
    : appState.history.find((record) => record.puzzleNumber === puzzleNumber) ?? null;
  const completed = todayRecord ? isDailyComplete(todayRecord) : false;
  const completedVerses = Math.min(DAILY_VERSE_COUNT, todayRecord?.rounds.length ?? 0);
  const todayLabel = homeDateFormatter.format(new Date());
  const dailyAction = completed
    ? "View result"
    : completedVerses > 0
      ? "Continue daily"
      : "Play daily";
  const dailySupport = completed
    ? `${homeNumberFormatter.format(todayRecord?.total ?? 0)} points`
    : completedVerses > 0
      ? undefined
      : "About 2 minutes";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.topActions}>
        <ThemeButton />
      </View>

      <View style={styles.panel}>
        <View style={styles.topSpacer} />
        <View style={styles.cluster}>
          {/* Versem◆rk wordmark */}
          <View style={styles.wordmarkRow} accessibilityRole="header">
            <Text style={typography.display}>Versem</Text>
            <View style={[styles.pin, { backgroundColor: colors.accent }]} accessibilityElementsHidden />
            <Text style={typography.display}>rk</Text>
          </View>

          <View style={styles.bookmark}>
            <CanonRibbon
              horizontal
              width={184}
              height={20}
              markerAt={streakMarkerProgress(appState.streak)}
              markerFlameLevel={streakFlameLevel(appState.streak)}
            />
          </View>

          <View style={styles.dailyHeader}>
            <View style={styles.statusRow}>
              <Text style={[typography.body, styles.date, { color: colors.ink2 }]}>{todayLabel}</Text>
              {appState.streak > 0 ? (
                <Text style={[typography.label, styles.streak, { color: colors.ink3 }]}>
                  Streak {appState.streak}{appState.bestStreak > appState.streak ? ` · Best ${appState.bestStreak}` : ""}
                </Text>
              ) : null}
            </View>
            <View style={styles.progressRow} accessibilityLabel={`${completedVerses} of ${DAILY_VERSE_COUNT} verses finished`}>
              {Array.from({ length: DAILY_VERSE_COUNT }, (_, index) => (
                <View
                  key={index}
                  style={[
                    styles.progressMark,
                    { borderColor: index < completedVerses ? colors.accent : colors.borderStrong },
                    index < completedVerses ? { backgroundColor: colors.accent } : null,
                  ]}
                />
              ))}
            </View>
          </View>

          <View style={styles.btnRow}>
            <PrimaryButton
              label={dailyAction}
              onPress={onDaily}
              accessibilityHint="Open today's daily game"
              supportingText={dailySupport}
            />
            <PrimaryButton
              label="Practice"
              onPress={onEndless}
              variant="secondary"
              accessibilityHint="Practice rounds without a daily limit"
            />
          </View>
        </View>
        <View style={styles.bottomSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
  },
  topActions: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  panel: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl,
    maxWidth: 360,
    width: "100%",
    alignItems: "center",
  },
  topSpacer: { flex: 4 },
  cluster: { flexShrink: 0, width: "100%", alignItems: "center" },
  bottomSpacer: { flex: 6 },
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
  },
  pin: {
    width: 11.5,
    height: 11.5,
    marginLeft: 3.2,
    marginRight: 3.8,
    transform: [{ translateY: -1.3 }, { rotate: "45deg" }],
  },
  dailyHeader: {
    width: "100%",
    maxWidth: 280,
    marginTop: spacing.md,
  },
  bookmark: { marginTop: spacing.xl },
  date: {
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  progressRow: {
    marginTop: spacing.sm,
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  progressMark: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    transform: [{ rotate: "45deg" }],
  },
  streak: {
    letterSpacing: 0.5,
  },
  btnRow: {
    marginTop: spacing.lg,
    width: "100%",
    maxWidth: 280,
    gap: spacing.sm,
  },
});
