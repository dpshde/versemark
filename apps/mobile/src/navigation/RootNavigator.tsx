import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useFocusEffect,
  useNavigationContainerRef,
  type Theme,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeBottomTabNavigator } from "@react-navigation/bottom-tabs/unstable";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import {
  unseenAchievementCount,
  type AppState,
  type RoundData,
  type TextBundle,
  type TranslationId,
} from "@versemark/core";
import { TranslationButton } from "../components/TopChrome";
import { AchievementsScreen } from "../screens/AchievementsScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { PlayScreen } from "../screens/PlayScreen";
import { fontFamily } from "../theme";
import { useTheme } from "../theme-context";
import {
  ActivityIndicator,
  Image,
  Platform,
  SafeAreaView,
  StyleSheet,
  View,
} from "../design-system";

type RootStackParamList = {
  Main: undefined;
  Round: { mode: "daily" | "endless" };
};

type MainTabParamList = {
  Play: undefined;
  Progress: undefined;
};

export type RootNavigatorProps = {
  appState: AppState;
  round: RoundData | null;
  texts: TextBundle;
  translation: TranslationId;
  onStartDaily: () => void;
  onStartEndless: () => void;
  onProgressFocus: () => void;
  onExitRound: () => void;
  onTranslation: (translation: TranslationId) => void;
  onRoundChange: (round: RoundData) => void;
  onAppState: (state: AppState) => void;
  onUnlocks: (ids: string[]) => void;
  onContinueEndless: () => void;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const WebTabs = createBottomTabNavigator<MainTabParamList>();
const NativeTabs = Platform.OS === "web"
  ? null
  : createNativeBottomTabNavigator<MainTabParamList>();

function PlayTabIcon({ color }: { color: string }) {
  return (
    <View style={styles.tabIconFrame}>
      <View style={[styles.playTabIcon, { borderLeftColor: color }]} />
    </View>
  );
}

function ProgressRoute({
  appState,
  onFocus,
}: {
  appState: AppState;
  onFocus: () => void;
}) {
  useFocusEffect(useCallback(() => {
    onFocus();
  }, [onFocus]));

  return <AchievementsScreen appState={appState} />;
}

function RoundRoute({
  navigation,
  route,
  round,
  texts,
  translation,
  onExitRound,
  onTranslation,
  onRoundChange,
  onAppState,
  onUnlocks,
  onContinueEndless,
}: NativeStackScreenProps<RootStackParamList, "Round"> & Pick<
  RootNavigatorProps,
  | "round"
  | "texts"
  | "translation"
  | "onExitRound"
  | "onTranslation"
  | "onRoundChange"
  | "onAppState"
  | "onUnlocks"
  | "onContinueEndless"
>) {
  useEffect(() => {
    return () => onExitRound();
  }, [onExitRound]);

  const title = round?.mode === "daily" && round.daily
    ? `Daily · ${round.daily.index + 1}/${round.daily.items.length}`
    : route.params.mode === "daily" ? "Daily" : "Practice";

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerRight: () => (
        <TranslationButton translation={translation} onTranslation={onTranslation} />
      ),
    });
  }, [navigation, onTranslation, title, translation]);

  if (!round) {
    return <View style={styles.loading}><ActivityIndicator /></View>;
  }

  return (
    <PlayScreen
      key={`${round.mode}-${round.poolItem.ref}-${round.daily?.index ?? "e"}-${round.phase}`}
      round={round}
      texts={texts}
      onRoundChange={onRoundChange}
      onAppState={onAppState}
      onUnlocks={onUnlocks}
      onExit={() => navigation.goBack()}
      onContinueEndless={onContinueEndless}
    />
  );
}

export function RootNavigator(props: RootNavigatorProps) {
  const { colors, scheme } = useTheme();
  const {
    appState,
    onProgressFocus,
    onStartDaily,
    onStartEndless,
  } = props;
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const unseen = unseenAchievementCount(appState);
  const baseTheme = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navigationTheme = useMemo<Theme>(() => ({
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.accent,
      background: colors.bg,
      card: colors.surface,
      text: colors.ink,
      border: colors.border,
      notification: colors.accent,
    },
  }), [baseTheme, colors]);

  const startDaily = useCallback(() => {
    onStartDaily();
    navigationRef.navigate("Round", { mode: "daily" });
  }, [navigationRef, onStartDaily]);

  const startEndless = useCallback(() => {
    onStartEndless();
    navigationRef.navigate("Round", { mode: "endless" });
  }, [navigationRef, onStartEndless]);

  const playContent = (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <HomeScreen appState={appState} onDaily={startDaily} onEndless={startEndless} />
    </SafeAreaView>
  );
  const progressContent = (
    <ProgressRoute appState={appState} onFocus={onProgressFocus} />
  );

  const tabs = NativeTabs ? (
    <NativeTabs.Navigator
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Platform.OS === "android" ? colors.accentDeep : colors.accent,
        tabBarInactiveTintColor: colors.ink2,
        tabBarActiveIndicatorColor: colors.accentSoft,
        tabBarActiveIndicatorEnabled: Platform.OS === "android",
        tabBarRippleColor: colors.accentSoft,
        tabBarLabelVisibilityMode: "labeled",
        tabBarLabelStyle: { fontFamily, fontSize: 12, fontWeight: "600" },
        tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent },
        tabBarStyle: { backgroundColor: colors.bg, shadowColor: colors.border },
        tabBarControllerMode: "auto",
        tabBarMinimizeBehavior: "onScrollDown",
      }}
    >
      <NativeTabs.Screen
        name="Play"
        options={{
          title: "Play",
          tabBarLabel: "Play",
          tabBarIcon: ({ focused }) => Platform.OS === "ios"
            ? { type: "sfSymbol", name: focused ? "play.fill" : "play" }
            : { type: "image", source: require("../../assets/tab-play.png") },
        }}
      >
        {() => playContent}
      </NativeTabs.Screen>
      <NativeTabs.Screen
        name="Progress"
        options={{
          title: "Progress",
          tabBarLabel: "Progress",
          tabBarBadge: unseen > 0 ? unseen : undefined,
          tabBarIcon: ({ focused }) => Platform.OS === "ios"
            ? { type: "sfSymbol", name: focused ? "chart.bar.fill" : "chart.bar" }
            : { type: "image", source: require("../../assets/tab-progress.png") },
        }}
      >
        {() => progressContent}
      </NativeTabs.Screen>
    </NativeTabs.Navigator>
  ) : (
    <WebTabs.Navigator
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: "fade",
        transitionSpec: { animation: "timing", config: { duration: 180 } },
        tabBarActiveTintColor: colors.accentDeep,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontFamily,
          fontSize: 12,
          fontWeight: "600",
        },
      }}
    >
      <WebTabs.Screen
        name="Play"
        options={{
          title: "Play",
          tabBarLabel: "Play",
          tabBarIcon: ({ color }) => <PlayTabIcon color={color} />,
        }}
      >
        {() => playContent}
      </WebTabs.Screen>
      <WebTabs.Screen
        name="Progress"
        options={{
          title: "Progress",
          tabBarLabel: "Progress",
          tabBarBadge: unseen > 0 ? unseen : undefined,
          tabBarIcon: ({ color }) => (
            <Image
              source={require("../../assets/tab-progress.png")}
              style={styles.tabIcon}
              tintColor={color}
              contentFit="contain"
            />
          ),
        }}
      >
        {() => progressContent}
      </WebTabs.Screen>
    </WebTabs.Navigator>
  );

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          contentStyle: { backgroundColor: colors.bg },
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.ink, fontFamily, fontWeight: "600" },
          headerShadowVisible: false,
          headerBackTitle: "Play",
        }}
      >
        <Stack.Screen name="Main" options={{ headerShown: false }}>
          {() => tabs}
        </Stack.Screen>
        <Stack.Screen name="Round">
          {(screenProps) => <RoundRoute {...screenProps} {...props} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabIcon: { width: 22, height: 22 },
  tabIconFrame: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  playTabIcon: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 12,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
});
