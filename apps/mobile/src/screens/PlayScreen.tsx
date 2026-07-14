/**
 * Native play surface in parity with web: native stack chrome, translation and
 * zoom controls, expandable verse, rough-to-precision timeline, typed Bible
 * references, hints, result links, daily summary, and sharing.
 */
import { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useSafeAreaInsets,
} from "../design-system";
import {
  advanceDailyRound,
  canTakeHint,
  confirmGuess,
  formatMiss,
  formatVerseLabel,
  hintQuadrantLabel,
  isUsefulParagraph,
  parseGuessText,
  progressiveInsertText,
  shareForRound,
  suggestGuessPassages,
  takeHint,
  type AppState,
  type RoundData,
  type TextBundle,
  type ZoomPreset,
} from "@versemark/core";
import { TimelineStrip, type NativeZoom } from "../components/TimelineStrip";
import { PrimaryButton } from "../components/PrimaryButton";
import { StageReveal } from "../components/StageReveal";
import { ExactLanding } from "../components/ExactLanding";
import { hapticConfirm, hapticLight, hapticResult } from "../lib/haptics";
import { shareText } from "../lib/share";
import { radius, spacing } from "../theme";
import { useTheme } from "../theme-context";

export type PlayScreenProps = {
  round: RoundData;
  texts: TextBundle;
  onRoundChange: (round: RoundData) => void;
  onAppState: (state: AppState) => void;
  onUnlocks: (ids: string[]) => void;
  onExit: () => void;
  onContinueEndless?: () => void;
};

function multiplierLabel(step: number): string {
  return step <= 1 ? "×3" : step === 2 ? "×2" : "×1";
}

function hintSpendLabel(step: number): string {
  return step <= 1 ? "no hints" : step === 2 ? "1 hint" : "2 hints";
}

const scoreFormatter = new Intl.NumberFormat();

function SegmentedButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.segmentButton, active ? { backgroundColor: colors.accentSoft } : null]}
    >
      <Text style={[typography.section, { color: active ? colors.accentDeep : colors.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

export function PlayScreen({
  round,
  texts,
  onRoundChange,
  onAppState,
  onUnlocks,
  onExit,
  onContinueEndless,
}: PlayScreenProps) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const isCompletedDailyRound =
    round.mode === "daily" &&
    round.phase === "revealed" &&
    round.daily != null &&
    round.daily.results.length >= round.daily.items.length;
  const [guess, setGuess] = useState<number | null>(round.guessVerseIndex);
  const [zoom, setZoom] = useState<NativeZoom>(round.guessVerseIndex == null ? "full" : "book");
  const [guessText, setGuessText] = useState(round.guessVerseIndex ? formatVerseLabel(round.guessVerseIndex) : "");
  const [verseExpanded, setVerseExpanded] = useState(!isCompletedDailyRound);
  const [verseCanCollapse, setVerseCanCollapse] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const guessForStrip = round.phase === "revealed" ? round.guessVerseIndex : guess;
  const suggestions = useMemo(
    () => (showSuggestions ? suggestGuessPassages(guessText, 5) : []),
    [guessText, showSuggestions]
  );
  const guessInvalid = useMemo(() => {
    const trimmed = guessText.trim();
    return trimmed.length > 0 && !parseGuessText(guessText).ok && /\d|:/.test(guessText);
  }, [guessText]);
  const shareBody = useMemo(() => shareForRound(round), [round]);

  const setPlacedGuess = useCallback((verseIndex: number) => {
    setGuess(verseIndex);
    setGuessText(formatVerseLabel(verseIndex));
    setShowSuggestions(false);
    setZoom((current) => (current === "full" ? "book" : current));
  }, []);

  const handleGuessText = (value: string) => {
    setGuessText(value);
    setShowSuggestions(value.trim().length > 0);
    const parsed = parseGuessText(value);
    if (parsed.ok) {
      setGuess(parsed.verseIndex);
      setZoom("book");
      return;
    }
  };

  const handleHint = () => {
    if (!canTakeHint(round)) return;
    onRoundChange(takeHint(round));
  };

  const handleConfirm = () => {
    if (guess == null || guessInvalid || round.phase !== "playing") return;
    hapticConfirm();
    const { round: next, appState, newlyUnlocked } = confirmGuess(round, guess);
    if (appState) onAppState(appState);
    if (next.result) hapticResult(next.result.distance === 0);
    if (newlyUnlocked.length) onUnlocks(newlyUnlocked);
    onRoundChange(next);
  };

  const handleNext = () => {
    if (round.mode === "daily") {
      const next = advanceDailyRound(round, texts);
      if (next === round) {
        onExit();
        return;
      }
      onRoundChange(next);
      return;
    }
    onContinueEndless?.();
  };

  const hintBody = useMemo(() => {
    if (round.hintStep < 2) return null;
    const useful = isUsefulParagraph(round.paragraph, round.poolItem.verse);
    const parts: string[] = [];
    if (useful && round.paragraph) {
      parts.push(round.paragraph.verses.map((v) => `${v.v}. ${v.t}`).join("\n"));
    }
    if (round.hintStep >= 3 || !useful) parts.push(hintQuadrantLabel(round));
    return parts.join("\n\n");
  }, [round]);

  const dailyDone = isCompletedDailyRound;
  const displayScore = dailyDone
    ? round.daily!.results.reduce((sum, item) => sum + item.total, 0)
    : round.result?.total ?? 0;
  const zoomPreset = useCallback((preset: ZoomPreset) => {
    if (guess == null) return;
    if (zoom === preset) {
      setZoom("full");
      setGuess(null);
      setGuessText("");
      return;
    }
    setZoom(preset);
  }, [guess, zoom]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        {...(Platform.OS === "web" ? {} : { contentInsetAdjustmentBehavior: "automatic" as const })}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={styles.verseBand}
          disabled={!verseCanCollapse}
          onPress={() => {
            if (verseCanCollapse) setVerseExpanded((value) => !value);
          }}
          accessibilityRole={verseCanCollapse ? "button" : undefined}
          accessibilityLabel={verseCanCollapse ? (verseExpanded ? "Collapse verse" : "Expand verse") : undefined}
          accessibilityState={verseCanCollapse ? { expanded: verseExpanded } : undefined}
        >
          <Text
            style={typography.verse}
            selectable
            numberOfLines={verseExpanded ? undefined : 2}
            onTextLayout={(event) => {
              if (verseExpanded && event.nativeEvent.lines.length > 2) setVerseCanCollapse(true);
            }}
          >
            {round.verseText}
          </Text>
          {verseCanCollapse ? <Text style={[styles.chevron, { color: colors.ink3 }]}>{verseExpanded ? "⌃" : "⌄"}</Text> : null}
        </Pressable>

        <View style={styles.board}>
          <TimelineStrip
            guessVerseIndex={guessForStrip}
            truthVerseIndex={round.phase === "revealed" ? round.poolItem.verseIndex : null}
            interactive={round.phase === "playing"}
            zoom={round.phase === "revealed" ? "full" : zoom}
            onPlace={setPlacedGuess}
          />
        </View>
      </ScrollView>

      {hintBody || (round.phase === "playing" && guess != null) || (round.phase === "revealed" && round.result) ? (
        <View
          style={[
            styles.dock,
            {
              paddingBottom: Math.max(spacing.sm, insets.bottom),
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
          ]}
        >
          <View style={styles.dockInner}>
            {hintBody ? <Text style={[typography.body, styles.hintBody, { color: colors.ink2 }]}>{hintBody}</Text> : null}

            {round.phase === "playing" && guess != null ? (
              <StageReveal>
                <View style={styles.playChrome}>
                  <View style={[styles.zoomSegment, { backgroundColor: colors.surface2 }]}>
                    <SegmentedButton label="OT" active={zoom === "ot"} onPress={() => zoomPreset("ot")} />
                    <SegmentedButton label="NT" active={zoom === "nt"} onPress={() => zoomPreset("nt")} />
                    <SegmentedButton label="Book" active={zoom === "book"} onPress={() => zoomPreset("book")} />
                  </View>
                  <View style={styles.guessRow}>
                    <View style={styles.inputWrap}>
                      <TextInput
                        value={guessText}
                        onChangeText={handleGuessText}
                        onFocus={() => setShowSuggestions(guessText.trim().length > 0)}
                        onSubmitEditing={handleConfirm}
                        placeholder="Type a reference"
                        placeholderTextColor={colors.ink2}
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="done"
                        accessibilityLabel="Bible reference guess"
                        style={[
                          typography.body,
                          styles.guessInput,
                          {
                            color: colors.ink,
                            backgroundColor: colors.bg,
                            borderColor: guessInvalid ? colors.error : colors.borderStrong,
                          },
                        ]}
                      />
                      {guessInvalid ? <Text style={[styles.guessError, { color: colors.error }]}>Enter a book, chapter, and optional verse.</Text> : null}
                      {suggestions.length > 0 ? (
                        <View style={[styles.suggestions, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
                          {suggestions.map((suggestion, index) => (
                            <Pressable
                              key={`${suggestion.canonical}-${suggestion.insertText}-${index}`}
                              onPress={() => {
                                const next = progressiveInsertText(suggestion);
                                handleGuessText(next);
                                if (parseGuessText(next).ok) setShowSuggestions(false);
                              }}
                              style={[styles.suggestion, index > 0 ? { borderTopColor: colors.rowRule, borderTopWidth: StyleSheet.hairlineWidth } : null]}
                            >
                              <Text style={[typography.body, { color: colors.ink, fontSize: 15 }]}>{suggestion.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <PrimaryButton
                      label={`Hint · ${multiplierLabel(Math.min(3, round.hintStep + 1))}`}
                      onPress={handleHint}
                      disabled={!canTakeHint(round)}
                      variant="secondary"
                      fullWidth={false}
                      style={styles.hintBtn}
                    />
                    <PrimaryButton
                      label={`Lock · ${multiplierLabel(round.hintStep)}`}
                      onPress={handleConfirm}
                      disabled={guess == null || guessInvalid}
                      fullWidth={false}
                      style={styles.confirmBtn}
                    />
                  </View>
                </View>
              </StageReveal>
            ) : null}

            {round.phase === "revealed" && round.result ? (
              <StageReveal>
                <View style={styles.result}>
                  {round.result.distance === 0 ? <ExactLanding /> : null}
                  <Text style={[typography.score, styles.resultScore, { color: colors.ink }]}>
                    {scoreFormatter.format(displayScore)} pts
                  </Text>
                  <View style={styles.resultDetailRow}>
                    <Text style={[typography.body, styles.resultDistance, { color: round.result.distance === 0 ? colors.success : colors.ink2 }]}>
                      {round.result.distance === 0 ? "Exact" : formatMiss(round.result.distance)}
                    </Text>
                    <View style={[styles.resultDetailDot, { backgroundColor: colors.ink3 }]} />
                    <Text style={[typography.body, styles.scoreMeta, { color: colors.ink2 }]}>
                      {hintSpendLabel(round.result.hintStep)}
                    </Text>
                  </View>

                  {dailyDone && round.daily ? (
                    <View style={[styles.dailySummary, { borderTopColor: colors.rowRule }]}>
                      {round.daily.results.map((item, index) => (
                        <View key={`${item.trueRef}-${index}`} style={styles.summaryRow}>
                          <Text style={[typography.body, styles.summaryText]}>{index + 1}. {formatVerseLabel(item.trueVerseIndex)}</Text>
                          <Text style={[typography.body, styles.summaryText, { color: colors.ink2 }]}>
                            {item.total} pts · {formatMiss(item.distance)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.resultActions}>
                    {shareBody ? (
                      <PrimaryButton
                        label="Share"
                        onPress={() => {
                          void shareText(shareBody);
                        }}
                        variant="secondary"
                        fullWidth={false}
                        style={styles.resultButton}
                      />
                    ) : null}
                    <PrimaryButton
                      label={dailyDone ? "Done" : round.mode === "daily" ? "Next verse" : "Next"}
                      onPress={dailyDone ? onExit : handleNext}
                      fullWidth={false}
                      style={styles.resultButton}
                    />
                  </View>
                </View>
              </StageReveal>
            ) : null}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  zoomSegment: { alignSelf: "center", flexDirection: "row", padding: 2, borderRadius: 9, borderCurve: "continuous" },
  segmentButton: { minWidth: spacing.touch, minHeight: spacing.touch, paddingHorizontal: spacing.sm, borderRadius: 7, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { paddingBottom: spacing.sm, flexGrow: 1 },
  verseBand: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, maxWidth: 576, alignSelf: "center", width: "100%" },
  chevron: { alignSelf: "center", fontSize: 15, lineHeight: 18, marginTop: spacing.xs },
  board: { flex: 1, minHeight: 0, paddingHorizontal: spacing.sm, paddingVertical: 0, width: "100%" },
  dock: { flexShrink: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, width: "100%", borderTopWidth: StyleSheet.hairlineWidth },
  dockInner: { gap: spacing.sm, maxWidth: 576, width: "100%", alignSelf: "center" },
  hintBody: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  playChrome: { gap: spacing.sm },
  guessRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, zIndex: 3 },
  inputWrap: { flex: 1, position: "relative" },
  guessInput: {
    minHeight: spacing.touch,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    lineHeight: 22,
    outlineWidth: Platform.OS === "web" ? 0 : undefined,
    outlineColor: Platform.OS === "web" ? "transparent" : undefined,
  },
  guessError: { fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), fontSize: 12, marginTop: spacing.xs },
  suggestions: { borderWidth: 1, borderTopWidth: 0, maxHeight: 220 },
  suggestion: { minHeight: spacing.touch, paddingHorizontal: spacing.md, justifyContent: "center" },
  hintBtn: { width: 84 },
  confirmBtn: { width: 120 },
  result: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderRadius: radius.panel, borderCurve: "continuous" },
  resultScore: { fontSize: 38, lineHeight: 44, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"] },
  resultDetailRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  resultDistance: { fontSize: 15, lineHeight: 22, fontWeight: "600", textAlign: "center" },
  resultDetailDot: { width: 3, height: 3, borderRadius: 2 },
  scoreMeta: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  dailySummary: { width: "100%", borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.sm },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, paddingVertical: spacing.xs },
  summaryText: { fontSize: 13, lineHeight: 18 },
  resultActions: { flexDirection: "row", gap: spacing.sm, width: "100%", marginTop: spacing.sm },
  resultButton: { flex: 1 },
});
