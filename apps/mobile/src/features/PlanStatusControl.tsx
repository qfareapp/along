import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { text } from "../components/ui";
import { colors as c } from "../theme";
export type OwnerPlanState = "live" | "paused" | "successful";
export function PlanStatusControl({
  state = "live",
  onChange,
  busy,
  blocked = false,
  expired = false,
}: {
  state?: OwnerPlanState;
  onChange: (state: OwnerPlanState) => void;
  busy?: boolean;
  blocked?: boolean;
  expired?: boolean;
}) {
  const choices = [
    {
      state: "live" as const,
      label: "Live",
      icon: "radio-outline" as const,
      color: c.green,
    },
    {
      state: "paused" as const,
      label: "Paused",
      icon: "pause-outline" as const,
      color: c.teal,
    },
    {
      state: "successful" as const,
      label: "Done",
      icon: "checkmark-done-outline" as const,
      color: c.coralBright,
    },
  ];
  const current = choices.find((choice) => choice.state === state)!;
  const hint = blocked
    ? {
        icon: "hourglass-outline" as const,
        message:
          "This plan is under review or paused by moderation. It can go live after approval.",
      }
    : state === "successful"
      ? {
          icon: "trophy-outline" as const,
          message:
            "Plan successful! It is saved in Your plans and no longer accepts new requests.",
        }
      : state === "paused"
        ? {
            icon: "eye-off-outline" as const,
            message:
              "Hidden from live plans until you go live again. Your existing chats stay available.",
          }
        : expired
          ? {
              icon: "calendar-clear-outline" as const,
              message:
                "This plan has an earlier date. Reschedule it to appear in live plans again.",
            }
          : {
              icon: "sparkles-outline" as const,
              message: "People can find your plan and send a request.",
            };
  return (
    <View
      style={{
        marginBottom: 18,
        padding: 16,
        borderRadius: 22,
        backgroundColor: c.soft,
        borderWidth: 1,
        borderColor: c.line,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={[text.label, { flex: 1, fontSize: 15 }]}>Plan status</Text>
        {busy ? (
          <ActivityIndicator color={c.teal} size="small" />
        ) : (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: c.white,
            }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: blocked ? c.muted : current.color,
              }}
            />
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: blocked ? c.muted : current.color,
              }}
            >
              {blocked ? "In review" : current.label}
            </Text>
          </View>
        )}
      </View>
      <View
        role="radiogroup"
        accessibilityLabel="Plan status"
        style={{
          flexDirection: "row",
          padding: 4,
          gap: 4,
          borderRadius: 16,
          backgroundColor: c.white,
          borderWidth: 1,
          borderColor: c.line,
          opacity: blocked ? 0.5 : 1,
        }}
      >
        {choices.map((choice) => {
          const selected = state === choice.state;
          return (
            <Pressable
              key={choice.state}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={choice.label}
              accessibilityState={{
                checked: selected,
                disabled: !!busy || blocked,
              }}
              disabled={!!busy || blocked}
              onPress={() => {
                if (!selected) onChange(choice.state);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingHorizontal: 4,
                backgroundColor: selected ? choice.color : "transparent",
                opacity: pressed && !selected ? 0.6 : 1,
              })}
            >
              <Ionicons
                name={choice.icon}
                size={17}
                color={selected ? c.white : choice.color}
              />
              <Text
                style={{
                  color: selected ? c.white : c.charcoal,
                  fontSize: 13,
                  fontWeight: "700",
                }}
              >
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Ionicons
          name={hint.icon}
          size={16}
          color={c.teal}
          style={{ marginTop: 2 }}
        />
        <Text
          accessibilityLiveRegion="polite"
          style={[text.muted, { flex: 1, fontSize: 12, lineHeight: 18 }]}
        >
          {hint.message}
        </Text>
      </View>
    </View>
  );
}
