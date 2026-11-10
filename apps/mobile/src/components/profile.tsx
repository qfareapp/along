import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { card, Chip, text } from "./ui";
import type { IconName } from "../features/data";
import {
  FIRST_PLANS,
  PERSONALITY_PROMPTS,
  PROFILE_DETAILS,
  RELATIONSHIPS,
  VIBES,
} from "../services/onboarding";
import { colors as c } from "../theme";

export const labelOf = (
  list: readonly { id: string; label: string }[],
  id?: string | null,
) => list.find((v) => v.id === id)?.label;

export function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  action?: [string, () => void];
  children: ReactNode;
}) {
  return (
    <View style={[card, { padding: 18, marginTop: 16 }]}>
      <View style={[s.row, { marginBottom: 14 }]}>
        <View style={s.iconTile}>
          <Ionicons name={icon} size={17} color={c.teal} />
        </View>
        <Text style={[text.label, { flex: 1, marginLeft: 10, fontSize: 15 }]}>
          {title}
        </Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action[0]} ${title}`}
            onPress={action[1]}
            style={({ pressed }) => [s.editPill, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="create-outline" size={14} color={c.teal} />
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: "600" }}>
              {action[0]}
            </Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}
export function Placeholder({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [s.placeholder, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="add-circle-outline" size={18} color={c.coralBright} />
      <Text style={{ color: c.teal, fontSize: 13, flex: 1 }}>{children}</Text>
    </Pressable>
  );
}
export function PromptCard({
  type,
  answer,
  fallback = "In their words",
}: {
  type?: string | null;
  answer: string;
  fallback?: string;
}) {
  return (
    <LinearGradient
      colors={[c.coralBright, "#FF8B70"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.prompt}
    >
      <Ionicons
        name="chatbox-ellipses"
        size={70}
        color="#FFFFFF26"
        style={{ position: "absolute", right: 12, top: 8 }}
      />
      <Text style={s.promptQuestion}>
        {labelOf(PERSONALITY_PROMPTS, type) ?? fallback}
      </Text>
      <Text style={s.promptAnswer}>“{answer.trim()}”</Text>
    </LinearGradient>
  );
}
export function VibeChips({ ids }: { ids: string[] }) {
  return (
    <View style={s.chips}>
      {ids.map((id) => {
        const vibe = VIBES.find((v) => v.id === id);
        return (
          <Chip key={id} icon={vibe?.icon ?? "sparkles-outline"}>
            {vibe?.label ?? id}
          </Chip>
        );
      })}
    </View>
  );
}
export function LookingFor({
  firstPlan,
  relationship,
}: {
  firstPlan?: string | null;
  relationship?: string | null;
}) {
  const items = [
    FIRST_PLANS.find((v) => v.id === firstPlan),
    RELATIONSHIPS.find((v) => v.id === relationship),
  ].filter((v) => !!v);
  return (
    <View style={{ gap: 10 }}>
      {items.map((v) => (
        <View key={v.id} style={[s.row, { gap: 12 }]}>
          <View style={s.iconTileCoral}>
            <Ionicons name={v.icon} size={17} color={c.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={text.label}>{v.label}</Text>
            {"description" in v && (
              <Text style={[text.muted, { fontSize: 12 }]}>
                {v.description}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
export const filledDetails = (details?: Record<string, string>) =>
  PROFILE_DETAILS.filter((d) => !!details?.[d.id]?.trim());
export function DetailList({ details }: { details: Record<string, string> }) {
  return (
    <View style={{ gap: 12 }}>
      {filledDetails(details).map((d) => (
        <View key={d.id} style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
          <View style={s.iconTile}>
            <Ionicons name={d.icon} size={16} color={c.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.tileLabel}>{d.short}</Text>
            <Text style={text.body}>{details[d.id]}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
export function InfoTiles({
  items,
}: {
  items: { icon: IconName; label: string; value?: string }[];
}) {
  return (
    <View style={s.grid}>
      {items
        .filter((b) => b.value)
        .map((b) => (
          <View key={b.label} style={s.tile}>
            <Ionicons name={b.icon} size={16} color={c.coralBright} />
            <Text style={s.tileLabel}>{b.label}</Text>
            <Text style={s.tileValue}>{b.value}</Text>
          </View>
        ))}
    </View>
  );
}
export const formatMonthYear = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })
    : undefined;
export const profileStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#FBE7DA",
    alignItems: "center",
    justifyContent: "center",
  },
});
const s = StyleSheet.create({
  ...profileStyles,
  iconTileCoral: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  editPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: c.soft,
  },
  placeholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#F2C4B2",
    backgroundColor: "#FFFBF7",
  },
  prompt: {
    marginTop: 16,
    borderRadius: 22,
    padding: 20,
    overflow: "hidden",
  },
  promptQuestion: {
    color: "#FFFFFFD9",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  promptAnswer: {
    color: c.white,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: "700",
    marginTop: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#FCF1E8",
    gap: 4,
  },
  tileLabel: { fontSize: 11, color: c.muted, fontWeight: "600" },
  tileValue: { fontSize: 14, color: c.charcoal, fontWeight: "600" },
});
