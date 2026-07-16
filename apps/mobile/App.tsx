/**
 * Versemark native client — Daily / Endless play on a full-canon timeline.
 * Domain rules live in @versemark/core; this shell owns UI, haptics, storage, share.
 */
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  startDailyRound,
  startEndlessRound,
  loadState,
  markAchievementsSeen,
  resetProgress,
  emptyAppState,
  loadTranslation,
  saveTranslation,
  achievementDefForId,
  type RoundData,
  type TextBundle,
  type AppState,
  type PoolItem,
  type TranslationId,
} from "@versemark/core";
import { installNativeStorage } from "./src/lib/storage-native";
import { loadPool, loadTextBundles } from "./src/lib/gameData";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { AppToast } from "./src/components/AppToast";
import { fontFamily } from "./src/theme";
import { ThemeProvider, useTheme } from "./src/theme-context";
import {
  ActivityIndicator,
  SafeAreaProvider,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "./src/design-system";

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { colors, scheme } = useTheme();
  const [boot, setBoot] = useState<
    { status: "loading" } | { status: "ready" } | { status: "error"; message: string }
  >({ status: "loading" });
  const [appState, setAppState] = useState<AppState>(emptyAppState);
  const [round, setRound] = useState<RoundData | null>(null);
  const [translation, setTranslation] = useState<TranslationId>("bsb");
  const [unlockNotice, setUnlockNotice] = useState<string | null>(null);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pool = useMemo(() => loadPool(), []);
  const textsByTranslation = useMemo(() => loadTextBundles(), []);
  const texts = textsByTranslation[translation];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await installNativeStorage();
        if (cancelled) return;
        setTranslation(loadTranslation());
        setAppState(loadState());
        setBoot({ status: "ready" });
      } catch (e) {
        if (cancelled) return;
        setBoot({
          status: "error",
          message: e instanceof Error ? e.message : "Failed to start",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
  }, []);

  const refreshState = useCallback(() => {
    setAppState(loadState());
  }, []);

  const exitRound = useCallback(() => {
    setRound(null);
    refreshState();
  }, [refreshState]);

  const startDaily = useCallback(() => {
    const r = startDailyRound(pool, texts);
    setRound(r);
  }, [pool, texts]);

  const startEndless = useCallback(() => {
    const r = startEndlessRound(pool, texts);
    setRound(r);
  }, [pool, texts]);

  const openProgress = useCallback(() => {
    markAchievementsSeen();
    setAppState(loadState());
  }, []);

  const resetAllProgress = useCallback(() => {
    const next = resetProgress();
    setRound(null);
    setUnlockNotice(null);
    setAppState(next);
  }, []);

  const continueEndless = useCallback(() => {
    const r = startEndlessRound(pool, texts);
    setRound(r);
  }, [pool, texts]);

  const changeTranslation = useCallback(
    (next: TranslationId) => {
      if (next === translation) return;
      saveTranslation(next);
      setTranslation(next);
      setRound((current) => {
        if (!current) return current;
        const bundle = textsByTranslation[next];
        return {
          ...current,
          verseText: bundle.verses[current.poolItem.ref] ?? "(text unavailable)",
          paragraph: bundle.paragraphs[current.poolItem.ref] ?? null,
        };
      });
    },
    [textsByTranslation, translation]
  );

  const showUnlocks = useCallback((ids: string[]) => {
    const first = achievementDefForId(ids[0] ?? "");
    const more = ids.length > 1 ? ` · +${ids.length - 1} more` : "";
    setUnlockNotice(`Unlocked · ${first?.title ?? "Achievement"}${more}`);
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = setTimeout(() => {
      unlockTimerRef.current = null;
      setUnlockNotice(null);
    }, 3200);
  }, []);

  if (boot.status === "loading") {
    return (
      <SafeAreaView style={[styles.boot, { backgroundColor: colors.bg }]}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={[styles.bootText, { color: colors.ink2 }]}>Versemark</Text>
      </SafeAreaView>
    );
  }

  if (boot.status === "error") {
    return (
      <SafeAreaView style={[styles.boot, { backgroundColor: colors.bg }]}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <Text style={[styles.bootText, { color: colors.ink2 }]}>{boot.message}</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <RootNavigator
        appState={appState}
        round={round}
        texts={texts}
        translation={translation}
        onStartDaily={startDaily}
        onStartEndless={startEndless}
        onProgressFocus={openProgress}
        onResetProgress={resetAllProgress}
        onExitRound={exitRound}
        onTranslation={changeTranslation}
        onRoundChange={setRound}
        onAppState={setAppState}
        onUnlocks={showUnlocks}
        onContinueEndless={continueEndless}
      />
      <AppToast message={unlockNotice} />
    </View>
  );
}

// Re-export for smoke tests that assert core wiring surface.
export type { PoolItem, TextBundle, RoundData };

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  bootText: {
    fontFamily,
    fontSize: 16,
  },
});
