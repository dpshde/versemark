/**
 * Native play surface in parity with web: native stack chrome, translation and
 * zoom controls, expandable verse, rough-to-precision timeline, typed Bible
 * references, hints, result links, daily summary, and sharing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHeaderHeight } from "@react-navigation/elements";
import {
  ActionSheetIOS,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  type TranslationId,
} from "@versemark/core";
import { TimelineStrip, type NativeZoom } from "../components/TimelineStrip";
import { PrimaryButton } from "../components/PrimaryButton";
import { StageReveal } from "../components/StageReveal";
import { ExactLanding } from "../components/ExactLanding";
import { EditorialSurface } from "../components/EditorialSurface";
import {
  hapticLight,
  hapticResult,
  hapticSelection,
  hapticWarning,
} from "../lib/haptics";
import { shareText } from "../lib/share";
import { radius, spacing } from "../theme";
import { useTheme } from "../theme-context";

export type PlayScreenProps = {
  round: RoundData;
  texts: TextBundle;
  deviceId: string;
  translation: TranslationId;
  onRoundChange: (round: RoundData) => void;
  onAppState: (state: AppState) => void;
  onUnlocks: (ids: string[]) => void;
  onExit: () => void;
  onContinueEndless?: () => void;
};

function hintSpendLabel(step: number): string {
  return step <= 1 ? "no hints" : step === 2 ? "1 hint" : "2 hints";
}

const scoreFormatter = new Intl.NumberFormat();
const zoomLabels: Record<NativeZoom, string> = {
  full: "Full canon",
  ot: "Old Testament",
  nt: "New Testament",
  book: "Current book",
};

export function PlayScreen({
  round,
  texts,
  deviceId,
  translation,
  onRoundChange,
  onAppState,
  onUnlocks,
  onExit,
  onContinueEndless,
}: PlayScreenProps) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
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
  const [hintExpanded, setHintExpanded] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    setHintExpanded(false);
  }, [round.poolItem.verseIndex]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

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
    setHintExpanded(false);
    setShowSuggestions(false);
    setVerseExpanded(false);
    setZoom((current) => (current === "full" ? "book" : current));
  }, []);

  const handleGuessText = (value: string) => {
    setGuessText(value);
    setHintExpanded(false);
    setShowSuggestions(value.trim().length > 0);
    const parsed = parseGuessText(value);
    if (parsed.ok) {
      setGuess(parsed.verseIndex);
      setZoom("book");
      setVerseExpanded(false);
      return;
    }
  };

  const handleHint = () => {
    if (!canTakeHint(round)) return;
    setHintExpanded(true);
    onRoundChange(takeHint(round));
  };

  const handleConfirm = () => {
    if (guessInvalid) {
      hapticWarning();
      return;
    }
    if (guess == null || round.phase !== "playing") return;
    const { round: next, appState, newlyUnlocked } = confirmGuess(round, guess, new Date(), {
      deviceId,
      appVersion: "0.1.0",
      rulesVersion: "1",
      contentVersion: "2026-07",
      translation,
    });
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

  const hintDetails = useMemo(() => {
    if (round.hintStep < 2) return null;
    const useful = isUsefulParagraph(round.paragraph, round.poolItem.verse);
    return {
      showParagraph: useful && round.paragraph != null,
      quadrant: round.hintStep >= 3 || !useful ? hintQuadrantLabel(round) : null,
    };
  }, [round]);

  const dailyDone = isCompletedDailyRound;
  const displayScore = dailyDone
    ? round.daily!.results.reduce((sum, item) => sum + item.total, 0)
    : round.result?.total ?? 0;
  const chooseZoom = useCallback((nextZoom: NativeZoom) => {
    hapticLight();
    setShowSuggestions(false);
    setZoom(nextZoom);
  }, []);
  const openZoomMenu = useCallback(() => {
    hapticLight();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Timeline scale",
          options: ["Cancel", "Full canon", "Old Testament", "New Testament", "Current book"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          const nextZoom = ([null, "full", "ot", "nt", "book"] as const)[buttonIndex];
          if (nextZoom) chooseZoom(nextZoom);
        }
      );
      return;
    }
    Alert.alert("Timeline scale", undefined, [
      { text: "Full canon", onPress: () => chooseZoom("full") },
      { text: "Old Testament", onPress: () => chooseZoom("ot") },
      { text: "New Testament", onPress: () => chooseZoom("nt") },
      { text: "Current book", onPress: () => chooseZoom("book") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [chooseZoom]);
  const showPlayingDock = round.phase === "playing" && guess != null;
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <View style={styles.playfield}>
        <Pressable
          style={styles.verseBand}
          disabled={!verseCanCollapse}
          onPress={() => {
            if (verseCanCollapse) {
              hapticSelection();
              setVerseExpanded((value) => !value);
            }
          }}
          accessibilityRole={verseCanCollapse ? "button" : undefined}
          accessibilityLabel={verseCanCollapse ? (verseExpanded ? "Collapse verse" : "Expand verse") : undefined}
          accessibilityState={verseCanCollapse ? { expanded: verseExpanded } : undefined}
        >
          <Text
            style={[typography.verse, styles.verseText]}
            selectable
            numberOfLines={verseExpanded ? undefined : 3}
            onTextLayout={(event) => {
              if (verseExpanded && event.nativeEvent.lines.length > 3) setVerseCanCollapse(true);
            }}
          >
            {round.verseText}
          </Text>
          {verseCanCollapse ? (
            <View
              style={[
                styles.chevron,
                { borderColor: colors.ink3 },
                verseExpanded ? styles.chevronUp : styles.chevronDown,
              ]}
            />
          ) : null}
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
      </View>

      {showPlayingDock || (round.phase === "revealed" && round.result) ? (
        <View
          style={[
            styles.dock,
            {
              paddingBottom: keyboardVisible ? spacing.md : Math.max(spacing.sm, insets.bottom),
            },
          ]}
        >
          <View style={styles.dockInner}>
            {showPlayingDock && hintDetails ? (
              <View
                style={[
                  styles.hintDisclosure,
                  { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={hintExpanded ? "Collapse revealed hint" : "Expand revealed hint"}
                  accessibilityState={{ expanded: hintExpanded }}
                  onPress={() => {
                    hapticSelection();
                    setHintExpanded((value) => !value);
                  }}
                  style={({ pressed }) => [
                    styles.hintDisclosureHeader,
                    pressed ? styles.controlPressed : null,
                  ]}
                >
                  <View style={[styles.hintMarker, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.hintDisclosureTitle, { color: colors.accentDeep }]}>Hint revealed</Text>
                  <Text style={[styles.hintDisclosureState, { color: colors.accentDeep }]}>
                    {hintExpanded ? "Hide" : "Show"}
                  </Text>
                  <View
                    style={[
                      styles.hintChevron,
                      { borderColor: colors.accentDeep },
                      hintExpanded ? styles.hintChevronUp : styles.hintChevronDown,
                    ]}
                  />
                </Pressable>
                {hintExpanded ? (
                  <View style={[styles.hintDisclosureBody, { borderTopColor: colors.accent }]}>
                    {hintDetails.showParagraph && round.paragraph ? (
                      <Text style={[typography.body, styles.hintParagraph, { color: colors.ink2 }]}>
                        {round.paragraph.verses.map((verse) => (
                          <Text
                            key={verse.v}
                            style={verse.v === round.poolItem.verse ? { color: colors.ink, fontWeight: "600" } : undefined}
                          >
                            {verse.t}{" "}
                          </Text>
                        ))}
                      </Text>
                    ) : null}
                    {hintDetails.quadrant ? (
                      <Text style={[typography.body, styles.hintQuadrant, { color: colors.ink2 }]}>
                        {hintDetails.quadrant}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            {showPlayingDock ? (
              <EditorialSurface style={styles.controlSurface}>
                <View style={styles.playChrome}>
                  <View style={[styles.utilityRow, { borderBottomColor: colors.border }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Timeline scale: ${zoomLabels[zoom]}`}
                      accessibilityHint="Opens timeline scale choices"
                      onPress={openZoomMenu}
                      style={({ pressed }) => [
                        styles.scaleButton,
                        pressed ? styles.controlPressed : null,
                      ]}
                    >
                      <Text style={[styles.scaleLabel, { color: colors.ink }]}>{zoomLabels[zoom]}</Text>
                      <View style={[styles.menuChevron, { borderColor: colors.ink2 }]} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={canTakeHint(round) ? "Take a hint" : "All hints used"}
                      accessibilityHint="Using a hint lowers the score multiplier"
                      accessibilityState={{ disabled: !canTakeHint(round) }}
                      disabled={!canTakeHint(round)}
                      onPress={() => {
                        hapticLight();
                        handleHint();
                      }}
                      style={({ pressed }) => [
                        styles.hintAction,
                        pressed ? styles.controlPressed : null,
                        !canTakeHint(round) ? styles.controlDisabled : null,
                      ]}
                    >
                      <Text style={[styles.hintActionLabel, { color: colors.accentDeep }]}>Hint</Text>
                    </Pressable>
                  </View>
                  <View style={styles.commitRow}>
                    <View style={styles.inputWrap}>
                      <TextInput
                        value={guessText}
                        onChangeText={handleGuessText}
                        onFocus={() => setShowSuggestions(guessText.trim().length > 0)}
                        placeholder="John 3:16"
                        placeholderTextColor={colors.ink2}
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="done"
                        submitBehavior="blurAndSubmit"
                        accessibilityLabel="Bible reference guess"
                        style={[
                          typography.body,
                          styles.guessInput,
                          {
                            color: parseGuessText(guessText).ok ? colors.accentDeep : colors.ink,
                            backgroundColor: "transparent",
                            borderColor: guessInvalid ? colors.error : colors.borderStrong,
                          },
                        ]}
                      />
                      {guessInvalid ? <Text style={[styles.guessError, { color: colors.error }]}>Enter a book, chapter, and optional verse.</Text> : null}
                      {suggestions.length > 0 ? (
                        <View style={[styles.suggestions, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                          {suggestions.map((suggestion, index) => (
                            <Pressable
                              key={`${suggestion.canonical}-${suggestion.insertText}-${index}`}
                              onPress={() => {
                                hapticSelection();
                                const next = progressiveInsertText(suggestion);
                                handleGuessText(next);
                                if (parseGuessText(next).ok) setShowSuggestions(false);
                              }}
                              style={[styles.suggestion, index > 0 ? { borderTopColor: colors.rowRule, borderTopWidth: StyleSheet.hairlineWidth } : null]}
                            >
                              <Text style={[typography.body, styles.suggestionText, { color: colors.ink }]}>{suggestion.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirm guess"
                      accessibilityState={{ disabled: guess == null || guessInvalid }}
                      disabled={guess == null || guessInvalid}
                      onPress={handleConfirm}
                      style={({ pressed }) => [
                        styles.confirmAction,
                        { backgroundColor: colors.accent },
                        pressed ? styles.confirmPressed : null,
                        guess == null || guessInvalid ? { backgroundColor: colors.accentSoft } : null,
                      ]}
                    >
                      <Text
                        style={[
                          typography.button,
                          styles.confirmLabel,
                          { color: guess == null || guessInvalid ? colors.accentDeep : colors.onAccent },
                        ]}
                      >
                        Confirm
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </EditorialSurface>
            ) : null}

            {round.phase === "revealed" && round.result ? (
              <StageReveal>
                <View style={styles.result}>
                  {round.result.distance === 0 ? <ExactLanding /> : null}
                  <View style={styles.scoreLine}>
                    <Text style={[typography.score, styles.resultScore, { color: round.result.distance === 0 ? colors.accentDeep : colors.ink }]}>
                      {scoreFormatter.format(displayScore)}
                    </Text>
                    <Text style={[styles.pointsUnit, { color: round.result.distance === 0 ? colors.accent : colors.ink3 }]}>PTS</Text>
                  </View>
                  <Text style={[typography.body, styles.scoreMeta, { color: colors.ink2 }]}>
                    {round.result.distance === 0 ? "Exact" : formatMiss(round.result.distance)} · {hintSpendLabel(round.result.hintStep)}
                  </Text>

                  {dailyDone && round.daily ? (
                    <View style={[styles.dailySummary, { borderTopColor: colors.rowRule }]}>
                      {round.daily.results.map((item, index) => (
                        <View key={`${item.trueRef}-${index}`} style={[styles.summaryRow, { borderBottomColor: colors.rowRule }]}>
                          <Text style={[typography.body, styles.summaryText]}>{index + 1}. {formatVerseLabel(item.trueVerseIndex)}</Text>
                          <Text style={[typography.body, styles.summaryText, styles.summaryDetail, { color: colors.ink2 }]}>
                            {formatMiss(item.distance)} · <Text style={styles.summaryPoints}>{item.total} pts</Text>
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
  root: { flex: 1, overflow: "hidden" },
  playfield: { flex: 1, minHeight: 0, paddingBottom: spacing.sm, overflow: "hidden" },
  verseBand: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, maxWidth: 576, alignSelf: "center", width: "100%" },
  verseText: { textAlign: "center" },
  chevron: { alignSelf: "center", width: 10, height: 10, marginTop: spacing.sm, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  chevronDown: { transform: [{ rotate: "45deg" }] },
  chevronUp: { transform: [{ rotate: "225deg" }] },
  board: { flex: 1, minHeight: 0, paddingHorizontal: spacing.sm, paddingVertical: 0, width: "100%" },
  dock: { flexShrink: 0, paddingHorizontal: spacing.md, paddingTop: spacing.xs, width: "100%" },
  dockInner: { gap: spacing.sm, maxWidth: 576, width: "100%", alignSelf: "center" },
  hintDisclosure: { borderWidth: 1, borderRadius: radius.editorial, borderCurve: "continuous", overflow: "hidden" },
  hintDisclosureHeader: { minHeight: spacing.touch, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hintMarker: { width: 9, height: 9, transform: [{ rotate: "45deg" }] },
  hintDisclosureTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  hintDisclosureState: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  hintChevron: { width: 7, height: 7, marginLeft: 2, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  hintChevronDown: { marginTop: -3, transform: [{ rotate: "45deg" }] },
  hintChevronUp: { marginTop: 3, transform: [{ rotate: "225deg" }] },
  hintDisclosureBody: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  hintParagraph: { fontSize: 14, lineHeight: 20, textAlign: "left" },
  hintQuadrant: { fontSize: 13, lineHeight: 18, fontStyle: "italic", textAlign: "left" },
  controlSurface: { padding: spacing.sm },
  playChrome: { gap: spacing.sm },
  utilityRow: { minHeight: spacing.touch, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  scaleButton: { minHeight: spacing.touch, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scaleLabel: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  menuChevron: { width: 7, height: 7, marginTop: -3, borderRightWidth: 1.5, borderBottomWidth: 1.5, transform: [{ rotate: "45deg" }] },
  hintAction: { minWidth: 68, minHeight: spacing.touch, paddingHorizontal: spacing.sm, alignItems: "center", justifyContent: "center" },
  hintActionLabel: { fontSize: 16, lineHeight: 21, fontWeight: "600" },
  controlPressed: { opacity: 0.62 },
  controlDisabled: { opacity: 0.34 },
  commitRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, zIndex: 4 },
  inputWrap: { flex: 1, position: "relative", zIndex: 5 },
  guessInput: {
    height: 52,
    borderWidth: 1,
    borderRadius: radius.editorial,
    borderCurve: "continuous",
    paddingHorizontal: spacing.lg,
    paddingVertical: 0,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "left",
    textAlignVertical: "center",
    includeFontPadding: false,
    outlineWidth: Platform.OS === "web" ? 0 : undefined,
    outlineColor: Platform.OS === "web" ? "transparent" : undefined,
  },
  guessError: { fontSize: 12, lineHeight: 16, marginTop: spacing.xs, textAlign: "center" },
  suggestions: { position: "absolute", left: 0, right: 0, bottom: 58, borderWidth: 1, borderRadius: radius.editorial, borderCurve: "continuous", maxHeight: 220, zIndex: 8, overflow: "hidden" },
  suggestion: { minHeight: spacing.touch, paddingHorizontal: spacing.md, justifyContent: "center", alignItems: "center" },
  suggestionText: { fontSize: 16, lineHeight: 22, fontWeight: "600", textAlign: "center" },
  confirmAction: { minWidth: 112, height: 52, paddingHorizontal: spacing.lg, borderRadius: radius.editorial, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  confirmPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  confirmLabel: { fontSize: 17, lineHeight: 22, textAlign: "center" },
  result: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderRadius: radius.editorial, borderCurve: "continuous" },
  scoreLine: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  resultScore: { fontSize: 42, lineHeight: 46, fontWeight: "700", letterSpacing: -0.8, textAlign: "center", fontVariant: ["tabular-nums"] },
  pointsUnit: { marginLeft: spacing.xs, marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: "600", letterSpacing: 0.8 },
  scoreMeta: { fontSize: 15, lineHeight: 21, fontWeight: "500", textAlign: "center" },
  dailySummary: { width: "100%", maxWidth: 352, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  summaryText: { fontSize: 13, lineHeight: 18 },
  summaryDetail: { flexShrink: 0, textAlign: "right" },
  summaryPoints: { fontWeight: "700" },
  resultActions: { flexDirection: "row", gap: spacing.sm, width: "100%", marginTop: spacing.sm },
  resultButton: { flex: 1 },
});
