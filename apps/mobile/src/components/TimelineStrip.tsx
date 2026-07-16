/**
 * Portrait-first canon board. A rough placement uses the whole vertical canon,
 * then the same axis expands into a testament/book precision view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking } from "react-native";
import {
  Animated,
  Easing,
  View,
  Text,
  StyleSheet,
  PanResponder,
  Platform,
  Pressable,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from "../design-system";
import {
  BOOKS,
  OT_END,
  NT_START,
  TOTAL_VERSES,
  bookChapterVerseFromIndex,
  bookSegments,
  clampVerse,
  edgeZoneFraction,
  formatVerseLabel,
  routeBibleUrl,
  scrubVersesPerSecond,
  testamentSeamT,
  viewportForPrecision,
  visibleRange,
  type ZoomPreset,
} from "@versemark/core";
import { hapticConfirm, hapticLight, hapticSelection } from "../lib/haptics";
import { shiftVerseRange } from "../lib/placement";
import { genreColor, spacing } from "../theme";
import { useTheme } from "../theme-context";

export type NativeZoom = "full" | ZoomPreset;

export type TimelineStripProps = {
  guessVerseIndex: number | null;
  truthVerseIndex?: number | null;
  interactive?: boolean;
  zoom: NativeZoom;
  onPlace: (verseIndex: number) => void;
};

type TimelineRange = {
  start: number;
  end: number;
  top: string;
  bottom: string;
  genre: string | null;
};

const AXIS_INSET = 20;
const RAIL_WIDTH = 22;
const MARKER_SIZE = 14;
const RESULT_LABEL_HEIGHT = 46;
const DRAG_LABEL_HEIGHT = 54;
const NOTCH_GAP = 8;
const ACTIVE_NOTCH_LENGTH = 28;
const OVERVIEW_LANDMARK_OSIS = new Set(["JOS", "EZR", "ROM", "EPH", "HEB", "REV"]);
const OVERVIEW_SKIP_OSIS = new Set(["JDG", "2SA", "2KI", "2CH"]);

type BookLabel = ReturnType<typeof bookSegments>[number] & { y: number; length: number };
type ChapterLabel = { key: string; label: string; start: number };

function precisionChapters(
  range: TimelineRange,
  selectedVerse: number | null,
  axisLength: number
): ChapterLabel[] {
  const chapters: ChapterLabel[] = [];
  for (let verseIndex = range.start; verseIndex <= range.end; verseIndex += 1) {
    const loc = bookChapterVerseFromIndex(verseIndex);
    if (!loc) continue;
    const key = `${loc.book.osis}:${loc.chapter}`;
    if (chapters.at(-1)?.key !== key) {
      chapters.push({ key, label: `${loc.book.name} ${loc.chapter}`.toUpperCase(), start: verseIndex });
    }
  }

  const kept: ChapterLabel[] = [];
  const selectedLoc = selectedVerse == null ? null : bookChapterVerseFromIndex(selectedVerse);
  let lastY = -Infinity;
  const span = Math.max(1, range.end - range.start);
  for (const chapter of chapters) {
    const [osis, chapterNumber] = chapter.key.split(":");
    const selected = selectedLoc?.book.osis === osis && selectedLoc.chapter === Number(chapterNumber);
    const y = ((chapter.start - range.start) / span) * axisLength;
    if (!selected && y - lastY < 15) continue;
    kept.push(chapter);
    lastY = y;
  }
  return kept;
}

function pickBookLabels(
  segments: ReturnType<typeof bookSegments>,
  range: TimelineRange,
  axisLength: number
): BookLabel[] {
  if (axisLength <= 0 || range.genre) return [];
  const span = Math.max(1, range.end - range.start);
  const candidates = segments.flatMap((segment) => {
    if (segment.startVerseIndex < range.start || segment.startVerseIndex > range.end) return [];
    const from = Math.max(segment.startVerseIndex, range.start);
    const to = Math.min(segment.endVerseIndex, range.end);
    const length = ((to - from + 1) / span) * axisLength;
    if (OVERVIEW_SKIP_OSIS.has(segment.osis)) return [];
    if (length < 14 && !OVERVIEW_LANDMARK_OSIS.has(segment.osis)) return [];
    return [{
      ...segment,
      y: AXIS_INSET + ((segment.startVerseIndex - range.start) / span) * axisLength,
      length,
    }];
  });
  const kept: BookLabel[] = [];
  const fits = (candidate: BookLabel) => kept.every((item) => Math.abs(item.y - candidate.y) >= 13);
  for (const candidate of candidates.filter((item) => OVERVIEW_LANDMARK_OSIS.has(item.osis))) {
    if (fits(candidate)) kept.push(candidate);
  }
  for (const candidate of candidates.filter((item) => !OVERVIEW_LANDMARK_OSIS.has(item.osis))) {
    if (fits(candidate)) kept.push(candidate);
  }
  return kept.sort((a, b) => a.y - b.y);
}

function rangeFor(zoom: NativeZoom, anchor: number | null): TimelineRange {
  if (zoom === "full" || anchor == null) {
    return { start: 1, end: TOTAL_VERSES, top: "Genesis", bottom: "Revelation", genre: null };
  }
  if (zoom === "ot") {
    return { start: 1, end: OT_END, top: "Genesis", bottom: "Malachi", genre: null };
  }
  if (zoom === "nt") {
    return { start: NT_START, end: TOTAL_VERSES, top: "Matthew", bottom: "Revelation", genre: null };
  }
  const loc = bookChapterVerseFromIndex(anchor) ?? { book: BOOKS[0]! };
  const viewport = viewportForPrecision(
    { center: anchor, span: 150, orientation: "vertical", axisPx: 1, crossPx: 1 },
    anchor
  );
  const visible = visibleRange(viewport);
  return {
    start: visible.start,
    end: visible.end,
    top: "",
    bottom: "",
    genre: loc.book.genre,
  };
}

function labelTop(y: number | null, height: number, labelHeight: number): number {
  return Math.max(spacing.xs, Math.min(height - labelHeight - spacing.xs, (y ?? AXIS_INSET) - labelHeight / 2));
}

function resultLabelTop(y: number | null, height: number): number {
  return Math.max(spacing.xs, Math.min(height - RESULT_LABEL_HEIGHT - spacing.xs, (y ?? AXIS_INSET) - RESULT_LABEL_HEIGHT / 2));
}

function settledReferenceFontSize(label: string | null, width: number): number {
  const characters = Math.max(1, label?.length ?? 1);
  const fitted = (width - characters * 1.8) / (characters * 0.64);
  return Math.max(18, Math.min(30, fitted));
}

export function TimelineStrip({
  guessVerseIndex,
  truthVerseIndex = null,
  interactive = true,
  zoom,
  onPlace,
}: TimelineStripProps) {
  const { colors, reduceMotion, typography } = useTheme();
  const heightRef = useRef(0);
  const [height, setHeight] = useState(0);
  const [boardWidth, setBoardWidth] = useState(0);
  const [dragVerse, setDragVerse] = useState<number | null>(null);
  const [dragRange, setDragRange] = useState<TimelineRange | null>(null);
  const [dragLabelHeight, setDragLabelHeight] = useState(DRAG_LABEL_HEIGHT);
  const dragVerseRef = useRef<number | null>(null);
  const rangeRef = useRef<TimelineRange | null>(null);
  const dragYRef = useRef(AXIS_INSET);
  const draggingRef = useRef(false);
  const edgeFrameRef = useRef<number | null>(null);
  const edgeLastFrameRef = useRef(0);
  const edgeDirectionRef = useRef(0);
  const edgeHoldStartRef = useRef(0);
  const edgeCarryRef = useRef(0);
  const lastHapticVerse = useRef<number | null>(null);
  const lastHapticAt = useRef(0);
  const boardShiftX = useRef(new Animated.Value(0)).current;
  const baseRange = rangeFor(zoom, guessVerseIndex ?? truthVerseIndex);
  const range = dragRange ?? baseRange;
  rangeRef.current = range;
  const span = Math.max(1, range.end - range.start);
  const precise = zoom !== "full";
  const bookPrecision = zoom === "book" && guessVerseIndex != null;
  const revealed = !interactive && truthVerseIndex != null;
  const minimumBoardHeight = revealed ? 340 : precise ? 400 : 470;
  const axisLength = Math.max(1, height - AXIS_INSET * 2);
  const displayGuess = dragVerse ?? guessVerseIndex;
  const dragShift = dragVerse != null
    ? -Math.min(68, boardWidth * 0.13)
    : 0;

  useEffect(() => {
    boardShiftX.stopAnimation();
    if (reduceMotion) {
      boardShiftX.setValue(dragShift);
      return;
    }
    const animation = Animated.timing(boardShiftX, {
      toValue: dragShift,
      duration: dragShift === 0 ? 180 : 150,
      easing: Easing.out(Easing.exp),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [boardShiftX, dragShift, reduceMotion]);

  const placeAt = useCallback(
    (y: number, activeRange = rangeRef.current) => {
      if (!interactive || heightRef.current <= AXIS_INSET * 2) return;
      if (!activeRange) return;
      const usable = heightRef.current - AXIS_INSET * 2;
      const fraction = Math.min(1, Math.max(0, (y - AXIS_INSET) / usable));
      const activeSpan = Math.max(1, activeRange.end - activeRange.start);
      const verseIndex = clampVerse(activeRange.start + fraction * activeSpan);
      const now = performance.now();
      if (lastHapticVerse.current !== verseIndex && now - lastHapticAt.current >= 40) {
        lastHapticVerse.current = verseIndex;
        lastHapticAt.current = now;
        hapticSelection();
      }
      dragVerseRef.current = verseIndex;
      setDragVerse(verseIndex);
    },
    [interactive]
  );

  const resetEdgeRamp = useCallback(() => {
    edgeDirectionRef.current = 0;
    edgeHoldStartRef.current = 0;
    edgeCarryRef.current = 0;
  }, []);

  const stopEdgeScroll = useCallback(() => {
    if (edgeFrameRef.current != null) {
      cancelAnimationFrame(edgeFrameRef.current);
      edgeFrameRef.current = null;
    }
    edgeLastFrameRef.current = 0;
    resetEdgeRamp();
  }, [resetEdgeRamp]);

  const startEdgeScroll = useCallback(() => {
    stopEdgeScroll();
    if (!bookPrecision) return;
    edgeLastFrameRef.current = performance.now();

    const tick = (now: number) => {
      if (!draggingRef.current) {
        edgeFrameRef.current = null;
        resetEdgeRamp();
        return;
      }

      const activeRange = rangeRef.current;
      const usable = heightRef.current - AXIS_INSET * 2;
      if (!activeRange || usable <= 0) {
        edgeFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const deltaMs = Math.min(50, Math.max(0, now - edgeLastFrameRef.current));
      edgeLastFrameRef.current = now;
      const axis = dragYRef.current - AXIS_INSET;
      const zone = usable * edgeZoneFraction({ precision: true, hasMarker: true });
      let direction = 0;
      let intensity = 0;
      if (axis < zone) {
        direction = -1;
        intensity = (zone - axis) / zone;
      } else if (axis > usable - zone) {
        direction = 1;
        intensity = (axis - (usable - zone)) / zone;
      }
      intensity = Math.min(1, Math.max(0, intensity));

      if (direction === 0 || intensity === 0) {
        resetEdgeRamp();
        edgeFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      if (direction !== edgeDirectionRef.current) {
        edgeDirectionRef.current = direction;
        edgeHoldStartRef.current = now;
        edgeCarryRef.current = 0;
      }

      const activeSpan = Math.max(1, activeRange.end - activeRange.start);
      const velocity = scrubVersesPerSecond(activeSpan, now - edgeHoldStartRef.current);
      const requested = direction * velocity * intensity * intensity * (deltaMs / 1000) + edgeCarryRef.current;
      const wholeDelta = requested < 0 ? Math.ceil(requested) : Math.floor(requested);
      edgeCarryRef.current = requested - wholeDelta;

      if (wholeDelta !== 0) {
        const shifted = shiftVerseRange(activeRange.start, activeRange.end, wholeDelta);
        if (shifted.moved !== 0) {
          const center = shifted.start + (shifted.end - shifted.start) / 2;
          const nextRange = {
            ...activeRange,
            start: shifted.start,
            end: shifted.end,
            genre: bookChapterVerseFromIndex(center)?.book.genre ?? activeRange.genre,
          };
          rangeRef.current = nextRange;
          setDragRange(nextRange);
          placeAt(dragYRef.current, nextRange);
        } else {
          edgeCarryRef.current = 0;
        }
      }
      edgeFrameRef.current = requestAnimationFrame(tick);
    };

    edgeFrameRef.current = requestAnimationFrame(tick);
  }, [bookPrecision, placeAt, resetEdgeRamp, stopEdgeScroll]);

  const finishPlacement = useCallback(() => {
    draggingRef.current = false;
    stopEdgeScroll();
    const placed = dragVerseRef.current;
    dragVerseRef.current = null;
    if (placed != null) {
      hapticConfirm();
      onPlace(placed);
    }
    setDragVerse(null);
    setDragRange(null);
  }, [onPlace, stopEdgeScroll]);

  const cancelPlacement = useCallback(() => {
    draggingRef.current = false;
    stopEdgeScroll();
    dragVerseRef.current = null;
    setDragVerse(null);
    setDragRange(null);
  }, [stopEdgeScroll]);

  useEffect(() => stopEdgeScroll, [stopEdgeScroll]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponder: () => interactive,
        onPanResponderGrant: (event: GestureResponderEvent) => {
          draggingRef.current = true;
          lastHapticVerse.current = null;
          lastHapticAt.current = 0;
          dragYRef.current = event.nativeEvent.locationY;
          placeAt(dragYRef.current);
          startEdgeScroll();
        },
        onPanResponderMove: (event: GestureResponderEvent) => {
          dragYRef.current = event.nativeEvent.locationY;
          placeAt(dragYRef.current);
        },
        onPanResponderRelease: finishPlacement,
        onPanResponderTerminate: cancelPlacement,
        onPanResponderTerminationRequest: () => false,
      }),
    [cancelPlacement, finishPlacement, interactive, placeAt, startEdgeScroll]
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    const nextWidth = event.nativeEvent.layout.width;
    heightRef.current = nextHeight;
    setHeight((current) => (current === nextHeight ? current : nextHeight));
    setBoardWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);

  const onDragLabelLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setDragLabelHeight((current) => current === nextHeight ? current : nextHeight);
  }, []);

  const yFor = (verse: number | null) => {
    if (verse == null || verse < range.start || verse > range.end || height <= 0) return null;
    return AXIS_INSET + ((verse - range.start) / span) * axisLength;
  };
  const guessY = yFor(displayGuess);
  const truthY = yFor(truthVerseIndex);
  const activeLabel = displayGuess != null ? formatVerseLabel(displayGuess) : null;
  const settledLabelWidth = Math.max(280, height * 0.9);
  const settledLabelFontSize = settledReferenceFontSize(activeLabel, settledLabelWidth);
  const segments = bookSegments().filter(
    (segment) => segment.endVerseIndex >= range.start && segment.startVerseIndex <= range.end
  );
  const bookLabels = pickBookLabels(segments, range, axisLength);
  const chapterLabels = bookPrecision ? precisionChapters(range, displayGuess, axisLength) : [];

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          styles.board,
          {
            minHeight: minimumBoardHeight,
            transform: [{ translateX: boardShiftX }],
          },
        ]}
        onLayout={onLayout}
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Canon timeline"
        accessibilityHint="Drag up or down to place your guess along Scripture"
        accessibilityValue={{ min: range.start, max: range.end, now: displayGuess ?? undefined, text: activeLabel ?? "No marker placed" }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (!interactive) return;
          const delta = precise ? 1 : Math.max(1, Math.round(span / 100));
          const base = displayGuess ?? range.start;
          hapticSelection();
          onPlace(clampVerse(base + (event.nativeEvent.actionName === "increment" ? delta : -delta)));
        }}
      >
        {precise && !bookPrecision ? <Text style={[typography.section, styles.topEnd, { color: colors.ink3 }]}>{range.top}</Text> : null}
        {precise && !bookPrecision ? <Text style={[typography.section, styles.bottomEnd, { color: colors.ink3 }]}>{range.bottom}</Text> : null}

        {interactive && displayGuess == null ? (
          <Text
            accessible={false}
            pointerEvents="none"
            style={[styles.roughCue, { color: colors.ink2 }]}
          >
            Rough placement
          </Text>
        ) : null}

        {bookLabels.map((book) => (
          <Text
            key={book.osis}
            pointerEvents="none"
            numberOfLines={1}
            style={[typography.section, styles.bookLabel, { top: book.y - 6, color: colors.ink2 }]}
          >
            {book.name}
          </Text>
        ))}

        {chapterLabels.map((chapter) => {
          const chapterY = yFor(chapter.start);
          if (chapterY == null) return null;
          return (
            <Text
              key={chapter.key}
              pointerEvents="none"
              numberOfLines={1}
              style={[styles.chapterLabel, { top: chapterY - 7, color: colors.ink2 }]}
            >
              {chapter.label}
            </Text>
          );
        })}

        <View
          pointerEvents="none"
          style={[
            styles.rail,
            {
              top: AXIS_INSET,
              bottom: AXIS_INSET,
              backgroundColor: colors.rail,
            },
          ]}
        >
          {range.genre ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: genreColor(range.genre, colors), opacity: 0.82 }]} />
          ) : (
            segments.map((segment) => {
              const from = Math.max(segment.startVerseIndex, range.start);
              const to = Math.min(segment.endVerseIndex, range.end);
              return (
                <View
                  key={segment.osis}
                  style={{
                    position: "absolute",
                    top: `${((from - range.start) / span) * 100}%`,
                    height: `${((to - from + 1) / span) * 100}%`,
                    left: 0,
                    right: 0,
                    backgroundColor: genreColor(segment.genre, colors),
                  }}
                />
              );
            })
          )}

          {!range.genre ? segments.slice(1).map((segment) => (
            <View
              key={`boundary-${segment.osis}`}
              style={[
                styles.bookBoundary,
                {
                  top: `${((segment.startVerseIndex - range.start) / span) * 100}%`,
                  backgroundColor: colors.bg,
                },
              ]}
            />
          )) : null}

          {zoom === "full" && range.start === 1 && range.end === TOTAL_VERSES ? (
            <View style={[styles.seam, { top: `${testamentSeamT() * 100}%`, backgroundColor: colors.bg }]} />
          ) : null}

          {precise && !bookPrecision
            ? Array.from({ length: 21 }, (_, index) => (
                <View
                  key={index}
                  style={[
                    styles.tick,
                    {
                      top: `${(index / 20) * 100}%`,
                      width: index % 5 === 0 ? RAIL_WIDTH : 10,
                      backgroundColor: colors.bg,
                    },
                  ]}
                />
              ))
            : null}
        </View>

        {bookPrecision ? Array.from({ length: range.end - range.start + 1 }, (_, index) => {
          const verseIndex = range.start + index;
          const verseY = yFor(verseIndex);
          const loc = bookChapterVerseFromIndex(verseIndex);
          const selected = verseIndex === displayGuess;
          const chapterStart = loc?.verse === 1 || verseIndex === range.start;
          const milestone = loc != null && loc.verse % 5 === 0;
          const length = selected ? ACTIVE_NOTCH_LENGTH : chapterStart ? 22 : milestone ? 16 : 10;
          return (
            <View
              key={`verse-notch-${verseIndex}`}
              pointerEvents="none"
              style={[
                styles.verseNotch,
                {
                  top: (verseY ?? AXIS_INSET) - (selected ? 1.25 : 0.5),
                  width: length,
                  height: selected ? 2.5 : chapterStart ? 1.5 : 1,
                  backgroundColor: selected ? colors.ink : chapterStart ? colors.ink2 : colors.ink3,
                  opacity: selected ? 1 : chapterStart ? 0.62 : milestone ? 0.45 : 0.28,
                },
              ]}
            />
          );
        }) : null}

        {truthY != null && guessY != null && truthY !== guessY ? (
          <View
            pointerEvents="none"
            style={[
              styles.resultConnector,
              {
                top: Math.min(truthY, guessY),
                height: Math.max(2, Math.abs(truthY - guessY)),
                backgroundColor: colors.borderStrong,
              },
            ]}
          />
        ) : null}

        {truthY != null ? (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.truthMarker,
                { top: truthY - MARKER_SIZE / 2, backgroundColor: colors.success, borderColor: colors.bg },
              ]}
            />
            {revealed ? (
              <View
                pointerEvents="box-none"
                style={[
                  styles.resultCallout,
                  styles.truthCallout,
                  { top: resultLabelTop(truthY, height) },
                ]}
              >
                <View
                  pointerEvents="none"
                  style={[styles.resultStem, { backgroundColor: colors.success }]}
                />
                <Pressable
                  onPress={() => {
                    const url = routeBibleUrl(truthVerseIndex!);
                    if (url) {
                      hapticLight();
                      void Linking.openURL(url);
                    }
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={`True reference ${formatVerseLabel(truthVerseIndex!)}`}
                  style={[
                    styles.resultLabel,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <Text style={[styles.resultRole, { color: colors.success }]}>TRUE</Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    style={[styles.markerRef, { color: colors.ink }]}
                  >
                    {formatVerseLabel(truthVerseIndex!)}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}

        {guessY != null ? (
          <>
            {dragVerse != null ? (
              <View
                pointerEvents="none"
                style={[
                  styles.markerHalo,
                  {
                    top: guessY - 12,
                    backgroundColor: colors.accentSoft,
                    borderColor: colors.accent,
                  },
                ]}
              />
            ) : null}
            <View
              pointerEvents="none"
              style={[
                styles.guessMarker,
                {
                  top: guessY - MARKER_SIZE / 2,
                  backgroundColor: bookPrecision ? colors.accentDeep : dragVerse != null ? colors.bg : colors.accent,
                  borderColor: bookPrecision ? colors.ink3 : dragVerse != null ? colors.accent : colors.bg,
                  borderWidth: bookPrecision ? 0 : 2,
                },
              ]}
            />
            {!revealed && activeLabel && bookPrecision && dragVerse == null ? (
              <View pointerEvents="none" style={styles.settledRefWrap}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="clip"
                  style={[
                    styles.settledRef,
                    {
                      width: settledLabelWidth,
                      maxWidth: settledLabelWidth,
                      marginLeft: -settledLabelWidth / 2,
                      fontSize: settledLabelFontSize,
                      color: colors.accentDeep,
                    },
                  ]}
                >
                  {activeLabel.toUpperCase()}
                </Text>
              </View>
            ) : null}
            {!revealed && activeLabel && dragVerse != null ? (
              <Text
                pointerEvents="none"
                onLayout={onDragLabelLayout}
                style={[
                  styles.scrubRef,
                  {
                    top: labelTop(guessY, height, dragLabelHeight),
                    color: colors.accentDeep,
                  },
                ]}
              >
                {activeLabel.toUpperCase()}
              </Text>
            ) : null}
            {revealed ? (
              <View
                pointerEvents="box-none"
                style={[
                  styles.resultCallout,
                  styles.guessCallout,
                  { top: resultLabelTop(guessY, height) },
                ]}
              >
                <Pressable
                  onPress={() => {
                    const url = displayGuess == null ? null : routeBibleUrl(displayGuess);
                    if (url) {
                      hapticLight();
                      void Linking.openURL(url);
                    }
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={activeLabel ? `Your guess ${activeLabel}` : undefined}
                  style={[
                    styles.resultLabel,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderStrong,
                    },
                  ]}
                >
                  <Text style={[styles.resultRole, { color: colors.accentDeep }]}>YOU</Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    style={[styles.markerRef, { color: colors.ink }]}
                  >
                    {activeLabel}
                  </Text>
                </Pressable>
                <View
                  pointerEvents="none"
                  style={[styles.resultStem, { backgroundColor: colors.accentDeep }]}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, width: "100%", alignItems: "center" },
  board: { flex: 1, width: "100%", maxWidth: 540, position: "relative" },
  rail: {
    position: "absolute",
    left: "50%",
    width: RAIL_WIDTH,
    marginLeft: -RAIL_WIDTH / 2,
    overflow: "hidden",
  },
  seam: { position: "absolute", left: 0, right: 0, height: 2, marginTop: -1, opacity: 0.9 },
  tick: { position: "absolute", left: 0, height: 1, opacity: 0.8 },
  bookBoundary: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: 0.3 },
  bookLabel: {
    position: "absolute",
    right: "50%",
    marginRight: RAIL_WIDTH / 2 + 7,
    maxWidth: 112,
    fontSize: 9,
    lineHeight: 12,
    textAlign: "right",
  },
  chapterLabel: {
    position: "absolute",
    right: "50%",
    marginRight: RAIL_WIDTH / 2 + NOTCH_GAP + ACTIVE_NOTCH_LENGTH + 10,
    maxWidth: 116,
    fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }),
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.6,
    textAlign: "right",
  },
  topEnd: { position: "absolute", top: 0, left: "50%", marginLeft: RAIL_WIDTH / 2 + 10, fontSize: 10 },
  bottomEnd: { position: "absolute", bottom: 0, left: "50%", marginLeft: RAIL_WIDTH / 2 + 10, fontSize: 10 },
  roughCue: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 92,
    marginLeft: RAIL_WIDTH / 2 + spacing.lg,
    marginTop: -18,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  verseNotch: {
    position: "absolute",
    right: "50%",
    marginRight: RAIL_WIDTH / 2 + NOTCH_GAP,
  },
  resultConnector: { position: "absolute", left: "50%", width: 2, marginLeft: -1, opacity: 0.7 },
  guessMarker: {
    position: "absolute",
    left: "50%",
    marginLeft: -MARKER_SIZE / 2,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    transform: [{ rotate: "45deg" }],
    zIndex: 4,
  },
  markerHalo: {
    position: "absolute",
    left: "50%",
    marginLeft: -12,
    width: 24,
    height: 24,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: "45deg" }],
    opacity: 0.72,
    zIndex: 3,
  },
  settledRefWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    marginLeft: RAIL_WIDTH / 2 + 24,
    width: 48,
    zIndex: 5,
  },
  settledRef: {
    position: "absolute",
    top: "50%",
    left: "50%",
    height: 38,
    marginTop: -19,
    fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }),
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "600",
    letterSpacing: 1.8,
    textAlign: "center",
    transform: [{ rotate: "90deg" }],
  },
  scrubRef: {
    position: "absolute",
    left: "50%",
    right: spacing.sm,
    marginLeft: RAIL_WIDTH / 2 + spacing.md,
    fontFamily: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }),
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    letterSpacing: 0.4,
    zIndex: 6,
  },
  truthMarker: {
    position: "absolute",
    left: "50%",
    marginLeft: -MARKER_SIZE / 2,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    transform: [{ rotate: "45deg" }],
    borderWidth: 2,
    zIndex: 3,
  },
  resultCallout: {
    position: "absolute",
    height: RESULT_LABEL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 5,
  },
  guessCallout: { left: spacing.xs, right: "50%" },
  truthCallout: { left: "50%", right: spacing.xs },
  resultStem: {
    flex: 1,
    minWidth: spacing.sm,
    height: StyleSheet.hairlineWidth,
  },
  resultLabel: {
    minWidth: 86,
    maxWidth: "92%",
    minHeight: RESULT_LABEL_HEIGHT,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 0,
  },
  resultRole: {
    fontSize: 11,
    lineHeight: 12,
    fontWeight: "600",
    letterSpacing: 0.7,
    textAlign: "center",
  },
  markerRef: {
    width: "100%",
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "600",
    letterSpacing: 0.1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
