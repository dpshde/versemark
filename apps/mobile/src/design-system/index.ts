/**
 * App-owned UI boundary. Feature code imports primitives here so platform or
 * library changes stay local to the design system.
 */
export {
  AccessibilityInfo,
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
  useWindowDimensions,
} from "react-native";
export type {
  GestureResponderEvent,
  LayoutChangeEvent,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
export { Image } from "expo-image";
export { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
