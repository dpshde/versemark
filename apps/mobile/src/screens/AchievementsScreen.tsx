/**
 * Progress — the useful feedback first: rhythm, accuracy, strengths, gaps,
 * then milestones on demand. The canon map remains the primary data surface.
 */
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { LegendList } from "@legendapp/list/react-native";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "../design-system";
import {
  bookSegmentAtT,
  bookSegments,
  booksForFocusMode,
  computeMastery,
  formatMiss,
  listAchievements,
  masteryFocusMetric,
  masteryHeatT,
  nextClosestAchievement,
  testamentSeamT,
  unlockedCount,
  type AchievementView,
  type AppState,
  type MasterySlice,
} from "@versemark/core";
import { ThemeButton } from "../components/TopChrome";
import { CanonRibbon } from "../components/CanonRibbon";
import { hapticLight } from "../lib/haptics";
import { achievementImages } from "../lib/achievement-images";
import { mixHex, radius, spacing } from "../theme";
import { useTheme } from "../theme-context";

export type AchievementsScreenProps = { appState: AppState };

const unlockedDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const countFormatter = new Intl.NumberFormat();

function achievementKey(item: AchievementView): string {
  return item.id;
}

function achievementItemType(): string {
  return "achievement";
}

function metalColor(metal: AchievementView["metal"], dark: boolean): string {
  if (metal === "gold") return dark ? "#b99a45" : "#9b792b";
  if (metal === "snow") return dark ? "#eeeae5" : "#2d2a27";
  return dark ? "#ca6844" : "#a6492c";
}

const AchievementRow = memo(function AchievementRow({ item, featured = false, last = false }: { item: AchievementView; featured?: boolean; last?: boolean }) {
  const { colors, scheme, typography } = useTheme();
  const meta = item.unlocked
    ? item.unlockedAt
      ? unlockedDateFormatter.format(new Date(item.unlockedAt))
      : "Unlocked"
    : item.current != null && item.threshold != null
      ? `${countFormatter.format(item.current)} / ${countFormatter.format(item.threshold)}`
      : "Locked";
  const art = achievementImages[item.dropCap];
  return (
    <View style={[styles.achievementRow, { borderBottomColor: colors.rowRule }, last ? styles.lastRow : null, !item.unlocked && !featured ? styles.locked : null]}>
      <View
        style={[
          styles.dropCap,
          featured ? styles.dropCapFeatured : null,
          { borderColor: metalColor(item.metal, scheme === "dark") },
        ]}
      >
        {art ? (
          <Image
            source={art}
            style={styles.dropCapImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={item.id}
            accessible={false}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.dropCapLetter, { color: metalColor(item.metal, scheme === "dark") }]}>{item.title.slice(0, 1)}</Text>
        )}
      </View>
      <View style={styles.achievementCopy}>
        <Text style={[typography.body, styles.achievementTitle]}>{item.title}</Text>
        <Text style={[typography.body, styles.achievementDesc, { color: colors.ink2 }]}>{item.description}</Text>
        <Text style={[typography.section, { color: colors.ink3 }]}>{meta}</Text>
        {!item.unlocked && item.progress != null && (item.progress > 0 || featured) ? (
          <View style={[styles.progress, { backgroundColor: colors.rail }]}>
            <View style={{ width: `${Math.round(Math.max(0, item.progress) * 100)}%`, height: "100%", backgroundColor: metalColor(item.metal, scheme === "dark") }} />
          </View>
        ) : null}
      </View>
    </View>
  );
});

function InsightRow({ label, item, accent }: { label: string; item: MasterySlice | undefined; accent: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.insightRow}>
      <View style={[styles.insightMark, { backgroundColor: accent }]} />
      <View style={styles.insightCopy}>
        <Text style={[typography.section, { color: colors.ink2 }]}>{label}</Text>
        <Text style={[typography.body, styles.insightName]}>{item?.label ?? "More rounds needed"}</Text>
      </View>
      <Text style={[typography.body, styles.insightMetric, { color: colors.ink2 }]}>
        {item ? formatMiss(item.medianDistance) : ""}
      </Text>
    </View>
  );
}

function MasteryList({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: MasterySlice[];
  selected?: string | null;
  onSelect?: (item: MasterySlice) => void;
}) {
  const { colors, typography } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 4);
  return (
    <View style={[styles.masteryList, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
      <Pressable
        onPress={() => {
          if (items.length <= 4) return;
          hapticLight();
          setExpanded((value) => !value);
        }}
        style={[styles.listHeader, { backgroundColor: colors.surface2 }]}
        accessibilityRole={items.length > 4 ? "button" : undefined}
        accessibilityState={items.length > 4 ? { expanded } : undefined}
        accessibilityLabel={items.length > 4 ? `${expanded ? "Collapse" : "Expand"} ${title}` : undefined}
      >
        <Text style={typography.section}>{title}</Text>
        {items.length > 4 ? (
          <View
            accessibilityElementsHidden
            style={[
              styles.listChevron,
              {
                borderColor: colors.ink2,
                transform: [{ rotate: expanded ? "225deg" : "45deg" }],
              },
            ]}
          />
        ) : null}
      </Pressable>
      {visible.map((item, index) => (
        <Pressable
          key={item.id}
          onPress={() => onSelect?.(item)}
          disabled={!onSelect}
          accessibilityRole={onSelect ? "button" : undefined}
          style={[
            styles.masteryRow,
            index > 0 ? { borderTopColor: colors.rowRule, borderTopWidth: StyleSheet.hairlineWidth } : null,
            selected === item.id ? { backgroundColor: colors.accentSoft } : null,
          ]}
        >
          <Text style={[typography.body, styles.masteryName]}>
            {item.label}<Text style={{ color: colors.ink3 }}> · {item.rounds}</Text>
          </Text>
          <Text style={[typography.body, styles.masteryMetric, { color: colors.ink2 }]}>{masteryFocusMetric(item, "farther")}</Text>
        </Pressable>
      ))}
      {items.length === 0 ? (
        <Text style={[typography.body, styles.listEmpty, { color: colors.ink2 }]}>Finish a few rounds to reveal this view.</Text>
      ) : null}
    </View>
  );
}

export function AchievementsScreen({ appState }: AchievementsScreenProps) {
  const { colors, scheme, typography } = useTheme();
  const mapRef = useRef<ComponentRef<typeof View>>(null);
  const mastery = useMemo(() => computeMastery(appState), [appState]);
  const achievements = useMemo(() => listAchievements(appState), [appState]);
  const counts = unlockedCount(appState);
  const next = nextClosestAchievement(achievements);
  const segments = useMemo(() => bookSegments(), []);
  const catalog = useMemo(() => segments.map((segment) => ({ osis: segment.osis, name: segment.name })), [segments]);
  const books = useMemo(() => booksForFocusMode(mastery, "farther", catalog), [catalog, mastery]);
  const measuredGenres = useMemo(() => mastery.genres.filter((item) => item.rounds > 0), [mastery.genres]);
  const insightCandidates = useMemo(
    () => measuredGenres.length > 1 ? measuredGenres : Object.values(mastery.bookHeat),
    [mastery.bookHeat, measuredGenres]
  );
  const strongest = useMemo(
    () => [...insightCandidates].sort((a, b) => a.medianDistance - b.medianDistance || b.rounds - a.rounds)[0],
    [insightCandidates]
  );
  const practiceNext = useMemo(
    () => insightCandidates.length > 1
      ? [...insightCandidates].sort((a, b) => b.medianDistance - a.medianDistance || b.rounds - a.rounds)[0]
      : undefined,
    [insightCandidates]
  );
  const defaultBook = useMemo(
    () => [...Object.values(mastery.bookHeat)].sort((a, b) => b.medianDistance - a.medianDistance)[0],
    [mastery.bookHeat]
  );
  const [selectedOverride, setSelectedOverride] = useState<string>();
  const selected = selectedOverride ?? defaultBook?.id ?? null;
  const [mapWidth, setMapWidth] = useState(0);
  const [showAllMilestones, setShowAllMilestones] = useState(false);
  const selectedSegment = segments.find((segment) => segment.osis === selected);
  const selectedSlice = selected ? mastery.bookHeat[selected] : undefined;
  const unlocked = useMemo(
    () => achievements
      .filter((item) => item.unlocked)
      .sort((a, b) => String(b.unlockedAt ?? "").localeCompare(String(a.unlockedAt ?? ""))),
    [achievements]
  );
  const milestoneRows = useMemo(
    () => showAllMilestones ? achievements : unlocked.slice(0, 5),
    [achievements, showAllMilestones, unlocked]
  );
  const exactRate = mastery.totalRounds > 0 ? Math.round((mastery.exactCount / mastery.totalRounds) * 100) : 0;
  const milestoneThemeStyle = useMemo(
    () => ({ borderColor: colors.borderStrong, backgroundColor: colors.surface }),
    [colors.borderStrong, colors.surface]
  );

  const updateMapWidth = useCallback((width: number) => {
    setMapWidth((current) => current === width ? current : width);
  }, []);

  useLayoutEffect(() => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (rect) updateMapWidth(rect.width);
  }, [updateMapWidth]);

  const selectAt = useCallback((x: number, width: number) => {
    if (width <= 0) return;
    const segment = bookSegmentAtT(x / width, segments);
    if (!segment) return;
    hapticLight();
    setSelectedOverride(segment.osis);
  }, [segments]);

  const selectBook = useCallback((item: MasterySlice) => {
    hapticLight();
    setSelectedOverride(item.id);
  }, []);

  const renderMilestone = useCallback(({ item, index }: { item: AchievementView; index: number }) => (
    <View
      style={[
        styles.milestoneRowFrame,
        milestoneThemeStyle,
        index === 0 ? styles.milestoneRowFirst : null,
        index === milestoneRows.length - 1 ? styles.milestoneRowLast : null,
      ]}
    >
      <AchievementRow item={item} last={index === milestoneRows.length - 1} />
    </View>
  ), [milestoneRows.length, milestoneThemeStyle]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[typography.body, styles.title]}>Progress</Text>
        <View style={styles.themeAction}><ThemeButton /></View>
      </View>
      <LegendList
        data={milestoneRows}
        extraData={scheme}
        keyExtractor={achievementKey}
        getItemType={achievementItemType}
        renderItem={renderMilestone}
        recycleItems
        contentContainerStyle={styles.body}
        {...(Platform.OS === "web" ? {} : { contentInsetAdjustmentBehavior: "automatic" as const })}
        ListHeaderComponent={(
          <View style={styles.headerContent}>
        {next && !showAllMilestones ? (
          <View>
            <Text style={[typography.section, styles.outsideLabel]}>Next milestone</Text>
            <View style={[styles.log, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
              <AchievementRow item={next} featured last />
            </View>
          </View>
        ) : null}

        {mastery.totalRounds === 0 ? (
          <View style={styles.emptyState}>
            <CanonRibbon height={88} />
            <Text style={[typography.body, styles.emptyTitle]}>Your map begins with the first mark.</Text>
          </View>
        ) : (
          <>
            <View style={[styles.panel, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
              <Text style={[typography.section, styles.sectionLabel]}>At a glance</Text>
              <View style={styles.statGrid}>
                {[
                  ["Rounds", countFormatter.format(mastery.totalRounds)],
                  ["Exact rate", `${exactRate}%`],
                  ["Best streak", countFormatter.format(mastery.bestStreak)],
                ].map(([label, value]) => (
                  <View key={label} style={styles.statCell}>
                    <Text style={[typography.body, styles.statValue]}>{value}</Text>
                    <Text style={typography.section}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {practiceNext ? (
              <View style={[styles.panel, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
                <Text style={[typography.section, styles.sectionLabel]}>Your read on the canon</Text>
                <InsightRow label="Strongest" item={strongest} accent={colors.success} />
                <View style={[styles.rowRule, { backgroundColor: colors.rowRule }]} />
                <InsightRow label="Practice next" item={practiceNext} accent={colors.accent} />
              </View>
            ) : null}

            <View style={[styles.panel, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]}>
              <Text style={[typography.section, styles.sectionLabel]}>Canon map</Text>
              <Text style={[typography.body, styles.mapIntro, { color: colors.ink2 }]}>Olive is closer. Terracotta is farther away.</Text>
              <Pressable
                style={styles.mapHit}
                onPress={(event) => selectAt(event.nativeEvent.locationX, mapWidth)}
                accessibilityRole="adjustable"
                accessibilityLabel="Canon mastery by book"
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(event) => {
                  const current = Math.max(0, segments.findIndex((segment) => segment.osis === selected));
                  const delta = event.nativeEvent.actionName === "increment" ? 1 : -1;
                  const nextIndex = Math.min(segments.length - 1, Math.max(0, current + delta));
                  setSelectedOverride(segments[nextIndex]?.osis ?? selected ?? undefined);
                }}
              >
                <View
                  ref={mapRef}
                  onLayout={(event) => updateMapWidth(event.nativeEvent.layout.width)}
                  style={[styles.mapRail, { backgroundColor: colors.rail }]}
                >
                  {segments.map((segment) => {
                    const slice = mastery.bookHeat[segment.osis];
                    const heat = slice ? mixHex(colors.heatClose, colors.heatFar, masteryHeatT(slice.medianDistance)) : colors.rail;
                    return (
                      <View key={segment.osis} style={{ flex: Math.max(0.001, segment.t1 - segment.t0), backgroundColor: heat }}>
                        {selected === segment.osis ? (
                          <View
                            style={[
                              styles.mapSelection,
                              { backgroundColor: colors.accent, borderColor: colors.surface },
                            ]}
                          />
                        ) : null}
                      </View>
                    );
                  })}
                  <View style={[styles.seam, { left: `${testamentSeamT() * 100}%`, backgroundColor: colors.ink3 }]} />
                </View>
              </Pressable>
              <View style={styles.mapEnds}>
                <Text style={typography.section}>Genesis</Text>
                <Text style={typography.section}>Revelation</Text>
              </View>
              <View style={[styles.mapDetail, { borderColor: colors.rowRule }]}>
                <Text style={[typography.body, styles.mapName]}>{selectedSegment?.name ?? "Choose a book"}</Text>
                <Text style={[typography.body, styles.mapMeta, { color: colors.ink2 }]}>
                  {selectedSlice
                    ? `${formatMiss(selectedSlice.medianDistance)} · ${selectedSlice.rounds} round${selectedSlice.rounds === 1 ? "" : "s"}`
                    : selectedSegment ? "Not tested yet" : "Tap the map to inspect a book."}
                </Text>
              </View>
            </View>

            {books.length > 1 ? <MasteryList title="Books to practice" items={books} selected={selected} onSelect={selectBook} /> : null}
          </>
        )}

        <View>
          <View style={styles.sectionHeaderRow}>
            <Text style={[typography.section, styles.outsideLabel, styles.sectionHeaderLabel]}>Milestones · {counts.unlocked}</Text>
            <Pressable
              onPress={() => {
                hapticLight();
                setShowAllMilestones((value) => !value);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: showAllMilestones }}
              style={styles.allButton}
            >
              <Text style={[typography.body, styles.allButtonText, { color: colors.accentDeep }]}>{showAllMilestones ? "Show earned" : `View all ${counts.total}`}</Text>
            </Pressable>
          </View>
        </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 64, justifyContent: "flex-end", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  themeAction: { position: "absolute", right: spacing.sm, bottom: spacing.xs },
  title: { fontWeight: "700", fontSize: 30, lineHeight: 36 },
  body: { width: "100%", paddingBottom: spacing.xxxl },
  headerContent: { gap: spacing.lg, paddingHorizontal: spacing.lg },
  panel: { borderWidth: 1, borderRadius: radius.panel, borderCurve: "continuous", padding: spacing.md },
  sectionLabel: { marginBottom: spacing.sm },
  outsideLabel: { marginBottom: spacing.sm },
  emptyState: { paddingVertical: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.xl },
  emptyTitle: { flex: 1, maxWidth: 260, fontSize: 22, lineHeight: 29, fontWeight: "700" },
  statGrid: { flexDirection: "row" },
  statCell: { flex: 1, paddingVertical: spacing.xs },
  statValue: { fontSize: 20, lineHeight: 26, fontWeight: "700", fontVariant: ["tabular-nums"] },
  insightRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md },
  insightMark: { width: 8, height: 8, transform: [{ rotate: "45deg" }] },
  insightCopy: { flex: 1 },
  insightName: { marginTop: 2, fontSize: 16, lineHeight: 21, fontWeight: "700" },
  insightMetric: { maxWidth: 126, fontSize: 13, lineHeight: 18, textAlign: "right" },
  rowRule: { height: StyleSheet.hairlineWidth, marginLeft: 20 },
  mapIntro: { marginTop: -spacing.xs, fontSize: 13, lineHeight: 18 },
  mapHit: { paddingVertical: spacing.sm },
  mapRail: { height: 42, flexDirection: "row", position: "relative", overflow: "hidden" },
  mapSelection: { position: "absolute", left: "50%", top: 16, width: 10, height: 10, marginLeft: -5, borderWidth: 1, transform: [{ rotate: "45deg" }], zIndex: 2 },
  seam: { position: "absolute", top: -2, bottom: -2, width: 1, opacity: 0.7 },
  mapEnds: { flexDirection: "row", justifyContent: "space-between" },
  mapDetail: { marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  mapName: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  mapMeta: { fontSize: 13, lineHeight: 19 },
  masteryList: { borderWidth: 1 },
  listHeader: { minHeight: spacing.touch, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listChevron: { width: 9, height: 9, marginRight: spacing.xs, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
  masteryRow: { minHeight: spacing.touch, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  masteryName: { flex: 1, fontSize: 14, lineHeight: 20 },
  masteryMetric: { fontSize: 13, lineHeight: 18, textAlign: "right" },
  listEmpty: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 14, lineHeight: 20 },
  sectionHeaderRow: { minHeight: spacing.touch, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionHeaderLabel: { marginBottom: 0 },
  allButton: { minHeight: spacing.touch, justifyContent: "center", paddingLeft: spacing.lg },
  allButtonText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  log: { borderWidth: 1 },
  milestoneRowFrame: { borderLeftWidth: 1, borderRightWidth: 1, marginHorizontal: spacing.lg },
  milestoneRowFirst: { borderTopWidth: 1 },
  milestoneRowLast: { borderBottomWidth: 1 },
  achievementRow: { flexDirection: "row", gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  lastRow: { borderBottomWidth: 0 },
  locked: { opacity: 0.68 },
  dropCap: { width: 48, height: 48, borderWidth: 1.5, alignItems: "center", justifyContent: "center", borderRadius: radius.dropcap, borderCurve: "continuous" },
  dropCapFeatured: { width: 60, height: 60 },
  dropCapLetter: { fontFamily: "Georgia", fontSize: 27, fontWeight: "600" },
  dropCapImage: { width: "100%", height: "100%", borderRadius: radius.dropcap - 1, borderCurve: "continuous" },
  achievementCopy: { flex: 1, gap: 2 },
  achievementTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  achievementDesc: { fontSize: 13, lineHeight: 18 },
  progress: { height: 3, width: "100%", marginTop: spacing.xs, overflow: "hidden" },
});
