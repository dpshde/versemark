/**
 * Platform toast adapter: Android owns its native toast; iOS and web use a
 * safe-area-aware transient notice because React Native has no iOS toast API.
 */
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  ToastAndroid,
  useSafeAreaInsets,
} from "../design-system";
import { EditorialSurface } from "./EditorialSurface";
import { spacing } from "../theme";
import { useTheme } from "../theme-context";

export type AppToastProps = {
  message: string | null;
};

const RESULT_ACTION_CLEARANCE = 128;

export function AppToast({ message }: AppToastProps) {
  const { colors, reduceMotion, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [visibleMessage, setVisibleMessage] = useState<string | null>(message);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const useNativeDriver = Platform.OS !== "web";

  useEffect(() => {
    if (Platform.OS === "android") {
      if (message) ToastAndroid.show(message, ToastAndroid.LONG);
      return;
    }

    opacity.stopAnimation();
    translateY.stopAnimation();

    if (message) {
      setVisibleMessage(message);
      AccessibilityInfo.announceForAccessibility(message);
      if (reduceMotion) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      opacity.setValue(0);
      translateY.setValue(8);
      const animation = Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver,
        }),
      ]);
      animation.start();
      return () => animation.stop();
    }

    if (reduceMotion) {
      opacity.setValue(0);
      setVisibleMessage(null);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver,
      }),
      Animated.timing(translateY, {
        toValue: 6,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setVisibleMessage(null);
    });
    return () => animation.stop();
  }, [message, opacity, reduceMotion, translateY, useNativeDriver]);

  if (Platform.OS === "android" || !visibleMessage) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[
        styles.host,
        {
          bottom: insets.bottom + RESULT_ACTION_CLEARANCE,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <EditorialSurface style={[styles.toast, { backgroundColor: colors.ink, borderColor: colors.ink }]}>
        <Text style={[typography.body, styles.text, { color: colors.bg }]}>{visibleMessage}</Text>
      </EditorialSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
    zIndex: 10,
  },
  toast: {
    maxWidth: 420,
    minHeight: spacing.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
  },
});
