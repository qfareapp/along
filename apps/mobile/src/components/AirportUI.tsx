import React, { useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors as c, shadow } from "../theme";
import type { IconName } from "../features/data";
import { text } from "./ui";

export const airportIntents: Record<
  string,
  { label: string; icon: IconName; hint: string; tint: string }
> = {
  conversation: {
    label: "Conversation",
    icon: "chatbubbles-outline",
    hint: "Chat while you wait",
    tint: "#E3EFEC",
  },
  coffee: {
    label: "Coffee",
    icon: "cafe-outline",
    hint: "Meet nearby in person",
    tint: "#F9E6D8",
  },
  dating: {
    label: "Dating",
    icon: "heart-outline",
    hint: "Open to romance",
    tint: "#FCE3DF",
  },
  games: {
    label: "Games",
    icon: "game-controller-outline",
    hint: "Play something quick",
    tint: "#E8E6F4",
  },
};
export const intentLabel = (key: string) =>
  airportIntents[key]?.label ?? key.charAt(0).toUpperCase() + key.slice(1);

export const airportPanel = {
  backgroundColor: "#FFFDF9",
  borderRadius: 22,
  borderWidth: 1,
  borderColor: "#F1E5DB",
  padding: 18,
  marginBottom: 16,
  gap: 14,
  ...shadow,
} satisfies ViewStyle;

/** Minutes until an ISO timestamp, refreshed every 30 seconds. */
export function useMinutesLeft(until?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return undefined;
  return Math.max(0, Math.round((new Date(until).getTime() - now) / 60000));
}
export const formatMinutes = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : `${minutes} min`;

export function StepHeader({
  step,
  title,
  description,
  done,
}: {
  step: number;
  title: string;
  description?: string;
  done?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: done ? c.green : c.soft,
        }}
      >
        {done ? (
          <Ionicons name="checkmark" size={17} color={c.white} />
        ) : (
          <Text style={{ color: c.teal, fontWeight: "700" }}>{step}</Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text accessibilityRole="header" style={[text.label, { fontSize: 16 }]}>
          {title}
        </Text>
        {!!description && <Text style={text.muted}>{description}</Text>}
      </View>
    </View>
  );
}

export function SectionLabel({
  icon,
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Ionicons name={icon} size={16} color={c.coralBright} />
      <Text style={text.label}>{children}</Text>
    </View>
  );
}

export function IntentTile({
  intent,
  selected,
  onPress,
}: {
  intent: string;
  selected: boolean;
  onPress: () => void;
}) {
  const meta = airportIntents[intent];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${meta.label}. ${meta.hint}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        borderRadius: 18,
        padding: 14,
        gap: 8,
        borderWidth: 1.5,
        borderColor: selected ? c.teal : "#EFE3D8",
        backgroundColor: selected ? "#F1F7F5" : "#FFFBF7",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: meta.tint,
          }}
        >
          <Ionicons name={meta.icon} size={19} color={c.teal} />
        </View>
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={20}
          color={selected ? c.teal : "#D8CBBF"}
        />
      </View>
      <Text style={text.label}>{meta.label}</Text>
      <Text style={[text.muted, { fontSize: 12, lineHeight: 16 }]}>
        {meta.hint}
      </Text>
    </Pressable>
  );
}

export function MetaPill({
  icon,
  children,
  light,
}: {
  icon: IconName;
  children: ReactNode;
  light?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        backgroundColor: light ? "#FFFFFF1F" : c.soft,
      }}
    >
      <Ionicons name={icon} size={13} color={light ? c.peach : c.teal} />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: light ? c.ivory : c.teal,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/** Boarding-pass style card used for the active visit and airport choices. */
export function BoardingPass({
  code,
  title,
  subtitle,
  children,
  footer,
}: {
  code: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <View style={{ borderRadius: 24, marginBottom: 16, ...shadow }}>
      <LinearGradient
        colors={[c.tealDark, c.teal, "#2F7A73"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 24, overflow: "hidden" }}
      >
        <Ionicons
          name="airplane"
          size={150}
          color="#FFFFFF0D"
          style={{
            position: "absolute",
            right: -24,
            top: -18,
            transform: [{ rotate: "-20deg" }],
          }}
        />
        <View style={{ padding: 20, gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text
                style={{
                  color: c.peach,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 1.4,
                }}
              >
                AIRPORT MODE
              </Text>
              <Text
                style={{ color: c.white, fontSize: 19, fontWeight: "700" }}
                numberOfLines={2}
              >
                {title}
              </Text>
              {!!subtitle && (
                <Text style={{ color: "#D6E6E3", fontSize: 13 }}>
                  {subtitle}
                </Text>
              )}
            </View>
            <Text
              style={{
                color: c.white,
                fontSize: 38,
                fontWeight: "800",
                letterSpacing: 1,
              }}
            >
              {code}
            </Text>
          </View>
          {children}
        </View>
        {!!footer && (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginHorizontal: -10,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: c.ivory,
                }}
              />
              <View
                style={{
                  flex: 1,
                  borderTopWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: "#FFFFFF40",
                  marginHorizontal: 6,
                }}
              />
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: c.ivory,
                }}
              />
            </View>
            <View style={{ padding: 16, paddingTop: 10 }}>{footer}</View>
          </>
        )}
      </LinearGradient>
    </View>
  );
}

export function PrivacyPoint({
  icon,
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 10,
          backgroundColor: "#E9F0EB",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={15} color={c.teal} />
      </View>
      <Text style={[text.muted, { flex: 1, color: c.charcoal }]}>
        {children}
      </Text>
    </View>
  );
}

const nativeDriver = Platform.OS !== "web";
/**
 * Header aeroplane that toggles the Airport Mode card. It keeps flying
 * (bob, tilt and a soft pulse) for as long as Airport Mode is on, pausing
 * in the background and staying still when the system asks for reduced motion.
 */
export function AirportModeToggle({
  expanded,
  onPress,
}: {
  expanded: boolean;
  onPress: () => void;
}) {
  const [motion] = useState(() => new Animated.Value(0));
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    const motionSub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    const appSub = AppState.addEventListener("change", (next) =>
      setAppActive(next === "active"),
    );
    return () => {
      mounted = false;
      motionSub.remove();
      appSub.remove();
    };
  }, []);
  useEffect(() => {
    if (reducedMotion || !appActive) {
      motion.setValue(0);
      return;
    }
    const step = (toValue: number) =>
      Animated.timing(motion, {
        toValue,
        duration: 1100,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: nativeDriver,
        isInteraction: false,
      });
    const animation = Animated.loop(
      Animated.sequence([step(1), step(0), Animated.delay(500)]),
    );
    animation.start();
    return () => {
      animation.stop();
      motion.setValue(0);
    };
  }, [motion, reducedMotion, appActive]);
  return (
    <Pressable
      testID="airport-mode-toggle"
      accessibilityRole="button"
      accessibilityLabel={
        expanded ? "Hide Airport Mode card" : "Show Airport Mode card"
      }
      accessibilityState={{ expanded }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: c.coral,
          opacity: motion.interpolate({
            inputRange: [0, 1],
            outputRange: [0.12, 0.3],
          }),
          transform: [
            {
              scale: motion.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.3],
              }),
            },
          ],
        }}
      />
      <LinearGradient
        colors={[c.teal, "#327E78", c.coral]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          width: 40,
          height: 40,
          borderRadius: 20,
        }}
      />
      <Animated.View
        testID="airport-mode-toggle-glyph"
        pointerEvents="none"
        style={{
          transform: [
            {
              translateY: motion.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -3],
              }),
            },
            {
              rotate: motion.interpolate({
                inputRange: [0, 1],
                outputRange: ["0deg", "-9deg"],
              }),
            },
          ],
        }}
      >
        <Ionicons name="airplane" size={21} color={c.white} />
      </Animated.View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          right: -1,
          bottom: -1,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: c.white,
          alignItems: "center",
          justifyContent: "center",
          ...shadow,
        }}
      >
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={12}
          color={c.teal}
        />
      </View>
    </Pressable>
  );
}

/** Fades and slides its children in whenever it mounts. */
export function RevealOnMount({ children }: { children: ReactNode }) {
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let disposed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (disposed) return;
      if (reduced) appear.setValue(1);
      else
        Animated.timing(appear, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: nativeDriver,
        }).start();
    });
    return () => {
      disposed = true;
    };
  }, [appear]);
  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [
          {
            translateY: appear.interpolate({
              inputRange: [0, 1],
              outputRange: [-12, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
