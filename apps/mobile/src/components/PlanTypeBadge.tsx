import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PlanRecord } from "../services/plans";
import { colors as c } from "../theme";

export const planTypeLabels = {
  need: "I Need",
  offer: "I Can Offer",
  together: "Plan Together",
} as const;

const tones = {
  need: {
    icon: "help-circle-outline",
    foreground: c.teal,
    background: "#E6F0EE",
  },
  offer: {
    icon: "hand-left-outline",
    foreground: "#98483D",
    background: "#FFE8DF",
  },
  together: { icon: "people-outline", foreground: c.white, background: c.teal },
} as const;

export function PlanTypeBadge({ type }: { type?: PlanRecord["type"] }) {
  if (!type) return null;
  const tone = tones[type];
  return (
    <View
      accessibilityLabel={`Plan type: ${planTypeLabels[type]}`}
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: tone.background,
      }}
    >
      <Ionicons name={tone.icon} size={14} color={tone.foreground} />
      <Text
        style={{
          color: tone.foreground,
          fontSize: 11,
          fontWeight: "700",
          flexShrink: 1,
        }}
      >
        {planTypeLabels[type]}
      </Text>
    </View>
  );
}
