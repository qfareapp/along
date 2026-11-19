import React, { memo, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { card, text } from "../components/ui";
import { PlanTypeBadge, planTypeLabels } from "../components/PlanTypeBadge";
import { MemberPhoto } from "./LiveDiscover";
import { colors as c, shadow } from "../theme";
import {
  type PlanCategory,
  type PlanRecord,
  useSavePlan,
} from "../services/plans";
export const categoryCovers: Record<string, ImageSourcePropType> = {
  coffee: require("../../assets/categories/coffee.png"),
  commute: require("../../assets/categories/commute.png"),
  travel: require("../../assets/categories/travel.png"),
  food: require("../../assets/categories/food.png"),
  shopping: require("../../assets/categories/shopping.png"),
  fitness: require("../../assets/categories/fitness.png"),
  movies: require("../../assets/categories/movies.png"),
  hobbies: require("../../assets/categories/hobbies.png"),
  sports: require("../../assets/categories/sports.png"),
  learning: require("../../assets/categories/learning.png"),
  events: require("../../assets/categories/events.png"),
  culture: require("../../assets/categories/culture.png"),
  volunteering: require("../../assets/categories/volunteering.png"),
};
export function CategoryCover({ category }: { category: PlanCategory }) {
  const [failed, setFailed] = useState(false);
  const source =
    category.coverImageUrl && !failed
      ? { uri: category.coverImageUrl }
      : (categoryCovers[category.coverAssetKey ?? category.slug] ??
        categoryCovers.coffee);
  return (
    <View style={s.cover}>
      <Image
        source={source}
        onError={() => setFailed(true)}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { width: "100%", height: "100%" }]}
        accessibilityLabel={`${category.name} illustration`}
      />
      {category.liveCount > 0 && (
        <View style={s.liveBadge}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>{category.liveCount} live</Text>
        </View>
      )}
    </View>
  );
}
export function CategoryCard({ category }: { category: PlanCategory }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Explore ${category.name}, ${category.liveCount} live plans`}
      onPress={() => router.push(`/plans/category/${category.slug}`)}
      style={({ pressed }) => [
        card,
        {
          flex: 1,
          overflow: "hidden",
          borderRadius: 20,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <CategoryCover
        key={`${category.coverImageUrl}-${category.coverAssetKey}`}
        category={category}
      />
      <View style={s.categoryBody}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[text.label, { fontSize: 15 }]} numberOfLines={1}>
            {category.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 11,
              color: category.liveCount ? c.green : c.muted,
            }}
          >
            {category.ownManagedCount
              ? `${category.ownManagedCount} of yours · Manage`
              : category.ownPastCount
                ? `${category.ownPastCount} earlier · Manage`
                : category.liveCount
                  ? `${category.liveCount} ${category.liveCount === 1 ? "plan" : "plans"} open`
                  : "Be the first to start one"}
          </Text>
        </View>
        <View style={s.arrow}>
          <Ionicons name="arrow-forward" size={14} color={c.teal} />
        </View>
      </View>
    </Pressable>
  );
}
export function SectionHeader({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.section}>
      <View style={{ flex: 1 }}>
        <Text style={[text.title, { fontSize: 20 }]}>{title}</Text>
        {!!subtitle && (
          <Text style={[text.muted, { fontSize: 12, marginTop: 2 }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {!!action && onAction && (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={onAction}
          style={({ pressed }) => [
            s.sectionAction,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Text style={{ color: c.teal, fontSize: 12, fontWeight: "600" }}>
            {action}
          </Text>
          <Ionicons name="chevron-forward" size={13} color={c.teal} />
        </Pressable>
      )}
    </View>
  );
}
export function PlanChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        s.chip,
        selected && { backgroundColor: c.teal, borderColor: c.teal },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: selected ? c.white : c.teal,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function PlanSearch({
  value,
  onChangeText,
  placeholder = "Search activities or categories...",
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={s.search}>
      <Ionicons name="search-outline" size={19} color={c.teal} />
      <TextInput
        accessibilityLabel="Search plans"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        style={{ flex: 1, minHeight: 48, color: c.charcoal, fontSize: 13 }}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={12}
          onPress={() => onChangeText("")}
        >
          <Ionicons name="close-circle" size={20} color={c.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function planStatus(plan: PlanRecord) {
  if (plan.publicationStatus === "paused")
    return { label: "Not published", color: c.muted };
  if (plan.ownerState === "successful")
    return { label: "Plan successful", color: c.coralBright };
  if (plan.ownerState === "paused") return { label: "Paused", color: c.teal };
  if (plan.ownerState === "closed")
    return { label: "Closed · Reschedule to reopen", color: c.muted };
  if (plan.ownerState === "expired")
    return { label: "Expired · Reschedule to reopen", color: c.muted };
  if (plan.expired)
    return { label: "Past plan · Reschedule to reopen", color: c.muted };
  if (plan.interestStatus === "accepted")
    return { label: "Accepted", color: c.green };
  if (plan.interestStatus === "pending")
    return { label: "Request sent", color: c.coral };
  if (plan.availability === "full")
    return { label: "Activity full", color: c.muted };
  if (plan.placesLeft != null && plan.activityType === "group")
    return { label: `${plan.placesLeft} places open`, color: c.green };
  return { label: "Open to company", color: c.green };
}
function planWhen(startsAt: string) {
  const date = new Date(startsAt);
  const now = new Date();
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${time}`;
}
export const PeoplePlanCard = memo(function PeoplePlanCard({
  plan,
}: {
  plan: PlanRecord;
}) {
  const save = useSavePlan();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const status = planStatus(plan);
  const group = plan.activityType === "group";
  return (
    <View style={{ flex: 1, marginBottom: 16 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${plan.title} by ${plan.creator.name}`}
        accessibilityHint={`Plan type: ${planTypeLabels[plan.type]}`}
        onPress={() => router.push(`/activity?id=${plan._id}`)}
        style={({ pressed }) => [
          card,
          s.plan,
          pressed && { transform: [{ scale: 0.99 }], opacity: 0.9 },
        ]}
      >
        <MemberPhoto id={plan.creator.photoId ?? undefined} style={s.photo} />
        <View style={s.info}>
          <View style={s.nameRow}>
            <Text numberOfLines={1} style={s.name}>
              {plan.creator.name}
              {plan.creator.age ? `, ${plan.creator.age}` : ""}
            </Text>
            {plan.creator.identityVerified && (
              <Ionicons name="checkmark-circle" size={16} color="#1597F5" />
            )}
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={plan.saved ? "Unsave plan" : "Save plan"}
              disabled={busy}
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation();
                setBusy(true);
                setError("");
                void save(plan)
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
              style={[s.save, plan.saved && { backgroundColor: "#FDE3DE" }]}
            >
              <Ionicons
                name={plan.saved ? "bookmark" : "bookmark-outline"}
                size={16}
                color={plan.saved ? c.coral : c.teal}
              />
            </Pressable>
          </View>
          <Text numberOfLines={1} style={s.when}>
            {planWhen(plan.startsAt)}
            {plan.recurring ? " · Recurring" : ""}
          </Text>
          <Text numberOfLines={2} style={s.title}>
            {`“${plan.title}”`}
          </Text>
          <View style={s.chips}>
            <PlanTypeBadge type={plan.type} />
            <View style={s.chip2}>
              <Ionicons
                name={group ? "people-outline" : "person-outline"}
                size={13}
                color={c.charcoal}
              />
              <Text style={s.chipText}>{group ? "Group" : "1:1"}</Text>
            </View>
            {!!plan.zone && (
              <View style={[s.chip2, { flexShrink: 1 }]}>
                <Ionicons name="location-outline" size={13} color={c.charcoal} />
                <Text style={[s.chipText, { flexShrink: 1 }]} numberOfLines={1}>
                  {plan.zone}
                </Text>
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={[s.status, { color: status.color }]}>
            {status.label}
          </Text>
        </View>
      </Pressable>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{ color: "#BA4034", marginTop: 5 }}
        >
          {error}
        </Text>
      )}
    </View>
  );
});
export function PlanSkeleton({ categories = false }: { categories?: boolean }) {
  return (
    <View
      accessibilityLabel="Loading plans"
      style={{ gap: 14, marginVertical: 10 }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            height: categories ? 165 : 220,
            borderRadius: 20,
            backgroundColor: c.soft,
            borderWidth: 1,
            borderColor: c.line,
            padding: 18,
          }}
        >
          <View
            style={{
              width: categories ? "100%" : 62,
              height: 62,
              borderRadius: 18,
              backgroundColor: c.line,
            }}
          />
          <View
            style={{
              width: "65%",
              height: 14,
              marginTop: 18,
              borderRadius: 7,
              backgroundColor: c.line,
            }}
          />
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: c.white,
    borderRadius: 16,
    paddingHorizontal: 15,
    marginVertical: 18,
    borderWidth: 1,
    borderColor: c.line,
    ...shadow,
    shadowOpacity: 0.05,
  },
  cover: {
    width: "100%",
    aspectRatio: 4 / 3,
    maxHeight: 190,
    backgroundColor: c.soft,
    overflow: "hidden",
  },
  liveBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,253,249,0.92)",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.green },
  liveText: { fontSize: 10, fontWeight: "700", color: c.teal },
  categoryBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.soft,
  },
  section: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  sectionAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingBottom: 2,
  },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
  },
  plan: {
    flex: 1,
    flexDirection: "row",
    gap: 14,
    padding: 10,
    borderRadius: 24,
  },
  photo: {
    width: 116,
    aspectRatio: 3 / 4,
    alignSelf: "flex-start",
    borderRadius: 18,
  },
  info: { flex: 1, minWidth: 0, paddingVertical: 4, paddingRight: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: {
    flexShrink: 1,
    fontSize: 19,
    fontWeight: "700",
    color: c.charcoal,
  },
  save: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.soft,
  },
  when: { marginTop: 2, fontSize: 13, color: c.muted },
  title: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
    color: c.charcoal,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  chip2: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F1EEEB",
  },
  chipText: { fontSize: 11, fontWeight: "600", color: c.charcoal },
  status: { marginTop: 10, fontSize: 13, fontWeight: "600" },
});
