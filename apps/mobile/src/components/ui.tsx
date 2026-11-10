import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardMetrics,
  type ScrollViewInstance,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { colors as c, shadow } from "../theme";
import type { IconName } from "../features/data";
import { demoMode } from "../services/api";

export const text = StyleSheet.create({
  title: {
    fontSize: 25,
    fontWeight: "700",
    color: c.charcoal,
    letterSpacing: -0.7,
  },
  body: { fontSize: 14, lineHeight: 21, color: c.charcoal },
  muted: { color: c.muted, fontSize: 13, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "600", color: c.charcoal },
});
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
/** Brings the focused field above the keyboard. Provided by scrolling screens. */
const RevealContext = createContext<() => void>(() => {});
export const useRevealFocusedInput = () => useContext(RevealContext);
// Space kept between the focused field and the top of the keyboard.
const KEYBOARD_GAP = 24;
const avoidKeyboard = Platform.OS === "web" ? undefined : "padding";

export function Screen({
  children,
  scroll = true,
  style,
  width = "standard",
  contentStyle,
  refreshing = false,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  width?: "reading" | "standard" | "wide";
  contentStyle?: ViewStyle;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const reveal = useCallback((keyboard?: KeyboardMetrics) => {
    const metrics = keyboard ?? Keyboard.metrics();
    const input = TextInput.State.currentlyFocusedInput();
    if (!metrics || !input || !scroller.current) return;
    // Wait for the keyboard-avoiding padding to apply before measuring.
    setTimeout(() => {
      input.measureInWindow((_x, y, _w, height) => {
        const overlap = y + height + KEYBOARD_GAP - metrics.screenY;
        if (overlap > 0)
          scroller.current?.scrollTo({
            y: offset.current + overlap,
            animated: true,
          });
      });
    }, 60);
  }, []);
  useEffect(() => {
    if (!scroll || Platform.OS === "web") return;
    const sub = Keyboard.addListener("keyboardDidShow", (e) =>
      reveal(e.endCoordinates),
    );
    return () => sub.remove();
  }, [scroll, reveal]);
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[s.screen, style]}>
      <KeyboardAvoidingView behavior={avoidKeyboard} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            width: "100%",
            maxWidth: width === "wide" ? 1200 : width === "reading" ? 680 : 840,
            alignSelf: "center",
          }}
        >
          {scroll ? (
            <RevealContext.Provider value={reveal}>
              <ScrollView
                ref={scroller}
                contentContainerStyle={[s.content, contentStyle]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                  onRefresh ? (
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={onRefresh}
                      tintColor={c.teal}
                      colors={[c.teal]}
                    />
                  ) : undefined
                }
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={
                  Platform.OS === "ios" ? "interactive" : "on-drag"
                }
                onScroll={(e) => {
                  offset.current = e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={32}
              >
                {children}
              </ScrollView>
            </RevealContext.Provider>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Logo({ large = false }: { large?: boolean }) {
  const heartSize = large ? 57 : 29;
  return (
    <View
      accessibilityLabel="Along. Do Life Together."
      style={{ alignItems: "center" }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={[s.logo, large && { fontSize: 75, lineHeight: 85 }]}>
          al
        </Text>
        <View
          style={{
            width: heartSize,
            height: heartSize,
            marginHorizontal: -2,
            marginTop: large ? 14 : 6,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="heart" color={c.coralBright} size={heartSize} />
          <Ionicons
            name="heart"
            color={c.ivory}
            size={heartSize * 0.48}
            style={{ position: "absolute", top: heartSize * 0.27 }}
          />
        </View>
        <Text style={[s.logo, large && { fontSize: 75, lineHeight: 85 }]}>
          ng
        </Text>
      </View>
      {large && (
        <Text
          style={{
            fontSize: 14,
            letterSpacing: 1.2,
            color: c.teal,
            marginTop: -5,
          }}
        >
          Do Life Together
        </Text>
      )}
    </View>
  );
}
export function IconButton({
  icon,
  onPress,
  label,
  color = c.charcoal,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.iconButton,
        style,
        pressed && { opacity: 0.55 },
      ]}
    >
      <Ionicons name={icon} size={23} color={color} />
    </Pressable>
  );
}
export function Header({
  title,
  subtitle,
  right,
  back = false,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
}) {
  return (
    <View style={s.header}>
      {back && (
        <IconButton
          icon="chevron-back"
          label="Go back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/plans")
          }
        />
      )}
      <View style={{ flex: 1 }}>
        {title ? (
          <Text style={[text.title, back && { fontSize: 21 }]}>{title}</Text>
        ) : (
          <View style={{ alignSelf: "flex-start" }}>
            <Logo />
          </View>
        )}
        {subtitle && <Text style={text.muted}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}
export function Button({
  children,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: "primary" | "coral" | "outline";
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
}) {
  const outline = variant === "outline";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        { opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        s.buttonOuter,
        outline && { borderWidth: 1, borderColor: c.teal },
      ]}
    >
      <LinearGradient
        colors={
          outline
            ? [c.ivory, c.ivory]
            : variant === "coral"
              ? ["#FF8B70", "#FA6752"]
              : ["#1A6065", "#08484F"]
        }
        style={s.button}
      >
        {loading ? (
          <ActivityIndicator color={outline ? c.teal : c.white} />
        ) : (
          <>
            {icon && (
              <Ionicons
                name={icon}
                size={18}
                color={outline ? c.teal : c.white}
              />
            )}
            <Text
              style={{
                color: outline ? c.teal : c.white,
                fontWeight: "600",
                fontSize: 15,
              }}
            >
              {children}
            </Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}
export function Chip({
  children,
  selected,
  onPress,
  icon,
}: {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        s.chip,
        selected && { backgroundColor: c.teal, borderColor: c.teal },
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? c.white : c.coralBright}
        />
      )}
      <Text style={{ color: selected ? c.white : c.charcoal, fontSize: 12 }}>
        {children}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string }) {
  const reveal = useRevealFocusedInput();
  return (
    <View style={{ gap: 7, marginBottom: 15 }}>
      {label && <Text style={text.label}>{label}</Text>}
      <TextInput
        accessibilityLabel={label ?? props.placeholder}
        placeholderTextColor="#95928D"
        {...props}
        onFocus={(e) => {
          props.onFocus?.(e);
          // Moving between fields while the keyboard is already open fires no keyboard event.
          if (Keyboard.isVisible()) reveal();
        }}
        style={[
          s.input,
          props.multiline && { minHeight: 110, textAlignVertical: "top" },
          props.style,
        ]}
      />
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: "#BA4034", fontSize: 12 }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <View style={s.notice}>
      <Ionicons name="information-circle-outline" size={17} color={c.teal} />
      <Text style={{ color: c.teal, fontSize: 12, lineHeight: 18, flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}
export function DemoNotice() {
  return demoMode ? (
    <Text
      style={{
        fontSize: 10,
        color: c.muted,
        textAlign: "center",
        marginVertical: 10,
      }}
    >
      PREVIEW · Fictional profiles & local interactions
    </Text>
  ) : null;
}
export function Empty({
  icon = "sparkles-outline",
  title,
  description,
  children,
}: {
  icon?: IconName;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: 50,
        paddingHorizontal: 24,
        gap: 14,
      }}
    >
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={33} color={c.teal} />
      </View>
      <Text style={[text.title, { fontSize: 21, textAlign: "center" }]}>
        {title}
      </Text>
      <Text style={[text.muted, { textAlign: "center" }]}>{description}</Text>
      {children}
    </View>
  );
}
export function Avatar({
  source,
  size = 40,
}: {
  source: React.ComponentProps<typeof Image>["source"];
  size?: number;
}) {
  return (
    <Image
      source={source}
      style={{
        height: size,
        width: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: c.ivory,
      }}
    />
  );
}
export const card = {
  backgroundColor: "#FFFDF9",
  borderRadius: 20,
  borderWidth: 1,
  borderColor: "#F1E5DB",
  ...shadow,
} satisfies ViewStyle;
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ivory },
  content: { paddingHorizontal: 22, paddingBottom: 28 },
  logo: {
    fontSize: 39,
    lineHeight: 47,
    letterSpacing: -2.8,
    fontWeight: "900",
    color: "#07505A",
  },
  header: {
    minHeight: 79,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  buttonOuter: { borderRadius: 18, overflow: "hidden" },
  button: {
    minHeight: 51,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "#FCF1E8",
    borderWidth: 1,
    borderColor: "#EFE3D8",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 16,
    padding: 15,
    color: c.charcoal,
    backgroundColor: "#FFFBF7",
    fontSize: 14,
  },
  notice: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 13,
    padding: 12,
    marginVertical: 10,
    backgroundColor: "#E9F0EB",
  },
  emptyIcon: {
    height: 76,
    width: 76,
    borderRadius: 38,
    backgroundColor: "#F9E8DB",
    alignItems: "center",
    justifyContent: "center",
  },
});
