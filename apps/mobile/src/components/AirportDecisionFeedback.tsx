import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Notice, text } from "./ui";
import { colors as c } from "../theme";
import { type AirportDecisionNotice } from "../services/airports";

export function AirportDecisionFeedback({
  notice,
  busy,
  error,
  onDone,
  onChat,
}: {
  notice: AirportDecisionNotice;
  busy: boolean;
  error: string;
  onDone: () => void;
  onChat: () => void;
}) {
  const connected = notice.kind === "connected";
  const [motion] = useState(() => new Animated.Value(0));
  const [appear] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let disposed = false;
    let animation: Animated.CompositeAnimation | undefined;
    function start(reduced: boolean) {
      animation?.stop();
      if (reduced) {
        motion.setValue(1);
        appear.setValue(1);
        return;
      }
      motion.setValue(0);
      appear.setValue(0);
      animation = Animated.parallel([
        Animated.timing(appear, {
          toValue: 1,
          duration: 300,
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
        Animated.timing(motion, {
          toValue: 1,
          duration: connected ? 1500 : 1800,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
      ]);
      animation.start();
    }
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!disposed) start(reduced);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      start,
    );
    return () => {
      disposed = true;
      animation?.stop();
      subscription.remove();
    };
  }, [motion, appear, connected]);
  return (
    <View testID={`airport-outcome-${notice.kind}`} style={{ gap: 18 }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          height: 150,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {[-1, 1].map((direction, index) => (
          <Animated.View
            key={direction}
            style={{
              position: "absolute",
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: index ? c.peach : c.teal,
              opacity: motion.interpolate({
                inputRange: [0, 1],
                outputRange: connected ? [0.5, 1] : [1, 0.45],
              }),
              transform: [
                {
                  translateX: motion.interpolate({
                    inputRange: [0, 1],
                    outputRange: connected
                      ? [direction * 95, direction * 30]
                      : [direction * 24, direction * 95],
                  }),
                },
                {
                  translateY: motion.interpolate({
                    inputRange: [0, 1],
                    outputRange: connected ? [15, 0] : [0, -18],
                  }),
                },
              ],
            }}
          >
            <Ionicons
              name={connected ? "person" : "airplane"}
              size={28}
              color={index ? c.teal : c.white}
            />
          </Animated.View>
        ))}
        {connected &&
          Array.from({ length: 8 }, (_, i) => (
            <Animated.View
              key={i}
              style={{
                position: "absolute",
                width: 7,
                height: 10,
                borderRadius: 3,
                backgroundColor: [c.coral, c.teal, c.peach][i % 3],
                opacity: motion.interpolate({
                  inputRange: [0, 0.4, 0.75, 1],
                  outputRange: [0, 0, 1, 0],
                }),
                transform: [
                  {
                    translateX: motion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, Math.cos((i * Math.PI) / 4) * 125],
                    }),
                  },
                  {
                    translateY: motion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, Math.sin((i * Math.PI) / 4) * 65],
                    }),
                  },
                  { rotate: `${i * 43}deg` },
                ],
              }}
            />
          ))}
        <Animated.View
          style={{
            backgroundColor: c.ivory,
            borderRadius: 26,
            padding: 10,
            opacity: appear,
            transform: [
              {
                scale: motion.interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [0.7, 1.15, 1],
                }),
              },
            ],
          }}
        >
          <Ionicons
            name={connected ? "heart" : "sunny-outline"}
            size={30}
            color={connected ? c.coral : c.teal}
          />
        </Animated.View>
      </View>
      <Animated.View style={{ opacity: appear, gap: 12 }}>
        <Text
          accessibilityRole="header"
          style={[text.title, { textAlign: "center" }]}
        >
          {notice.title}
        </Text>
        <Text style={[text.body, { textAlign: "center" }]}>{notice.body}</Text>
      </Animated.View>
      {!!error && <Notice>{error}</Notice>}
      {connected && !!notice.conversationId && (
        <Button loading={busy} onPress={onChat}>
          Continue your conversation
        </Button>
      )}
      <Button
        disabled={busy}
        variant={connected ? "outline" : "primary"}
        onPress={onDone}
      >
        {connected ? "Lovely" : "Continue exploring"}
      </Button>
    </View>
  );
}
