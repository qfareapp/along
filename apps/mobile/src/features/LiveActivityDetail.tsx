import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  card,
  text,
} from "../components/ui";
import { api, ApiError } from "../services/api";
import {
  type PlanRecord,
  usePlanCategories,
  useRefreshPlans,
  useSavePlan,
} from "../services/plans";
import { MemberPhoto } from "./LiveDiscover";
import { PlanTypeBadge } from "../components/PlanTypeBadge";
import { PlanAudienceSummary } from "../components/PlanAudienceSummary";
import { colors as c } from "../theme";
import { CategoryPlanSummary } from "./CategoryPlanFields";
import DateTimeField from "../components/DateTimeField";
import { localDate } from "../components/dateTime";
import { PlanStatusControl, type OwnerPlanState } from "./PlanStatusControl";
import { formatSchedule } from "./PlanSchedule";
export default function LiveActivityDetail() {
  const insets = useSafeAreaInsets();
  const { id, created } = useLocalSearchParams<{
    id: string;
    created?: string;
  }>();
  const query = useQuery({
    queryKey: ["activity", id],
    queryFn: () => api<PlanRecord>(`/activities/${id}`),
    refetchInterval: 10000,
    retry: false,
  });
  const categories = usePlanCategories();
  const refresh = useRefreshPlans(),
    save = useSavePlan();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmBlock, setConfirmBlock] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [reschedule, setReschedule] = useState(false),
    [newDate, setNewDate] = useState(""),
    [newTime, setNewTime] = useState("18:00");
  const plan = query.data;
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!plan || (query.error instanceof ApiError && query.error.status === 404))
    return (
      <Screen>
        <Header back title="The plan" />
        {query.isPending ? (
          <ActivityIndicator color={c.teal} />
        ) : (
          <Empty
            title="Activity Closed"
            description={
              query.error?.message ?? "This plan is no longer available."
            }
          >
            <Button onPress={() => void query.refetch()}>Retry</Button>
          </Empty>
        )}
      </Screen>
    );
  const organizer = plan.creator;
  const category = categories.data?.find((cat) => cat.slug === plan.category);
  // Closed plans behave like expired ones: only a new date brings them back.
  const ended = !!plan.expired || plan.ownerState === "closed";
  const requestLabel = plan.privatePlan
    ? "View private plan agreement"
    : plan.isOwner
      ? plan.ownerState === "successful"
        ? "Plan successful"
        : ended
          ? "Reschedule plan"
          : plan.ownerState === "paused"
            ? "Go live"
            : "View interest requests"
      : plan.interestStatus === "accepted"
        ? "Accepted · Open chat"
        : plan.interestStatus === "declined"
          ? "Declined"
          : plan.interestStatus === "pending"
            ? "Request Sent"
            : plan.availability === "full"
              ? "Activity Full"
              : "I'm Interested";
  const status = plan.privatePlan
    ? { label: "Private · agreed together", color: c.teal }
    : plan.isOwner
      ? plan.publicationStatus === "paused"
        ? { label: "In review", color: c.muted }
        : plan.ownerState === "successful"
          ? { label: "Successful", color: c.coralBright }
          : plan.ownerState === "closed"
            ? { label: "Closed", color: c.muted }
            : plan.ownerState === "expired"
              ? { label: "Expired", color: c.muted }
              : plan.expired
                ? { label: "Past date", color: c.muted }
                : plan.ownerState === "paused"
                  ? { label: "Paused", color: c.teal }
                  : { label: "Live", color: c.green }
      : plan.availability === "full"
        ? { label: "Full", color: c.muted }
        : { label: "Open to join", color: c.green };
  const start = new Date(plan.startsAt);
  const days = Math.round(
    (new Date(start).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) /
      86400000,
  );
  const details: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    label: string;
    value: string;
    hint?: string;
    hintColor?: string;
  }[] = [
    {
      icon: "calendar-outline",
      label: plan.recurring ? "When · Recurring" : "When",
      value: formatSchedule(plan.startsAt, plan.endsAt, plan.schedule),
      hint: plan.expired
        ? "Past date"
        : days < 0
          ? "Happening now"
          : days === 0
            ? "Today"
            : days === 1
              ? "Tomorrow"
              : days > 1 && days < 60
                ? `In ${days} days`
                : undefined,
      hintColor: plan.expired ? c.muted : c.coralBright,
    },
    ...(plan.endsAt && !plan.schedule
      ? [
          {
            icon: "time-outline" as const,
            label: "Until",
            value: formatWhen(new Date(plan.endsAt)),
          },
        ]
      : []),
    { icon: "location-outline", label: "Where", value: plan.zone },
    {
      icon: "people-outline",
      label: plan.activityType === "group" ? "Small group" : "One-on-one",
      value: plan.privatePlan
        ? "Confirmed for you both"
        : plan.availability === "full"
          ? "Activity full"
          : plan.placesLeft == null
            ? "Open to company"
            : `${plan.placesLeft} ${plan.placesLeft === 1 ? "place" : "places"} available`,
    },
    {
      icon: "wallet-outline",
      label: "Costs",
      value: plan.budget ?? "Agree on costs together",
    },
  ];
  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{
          padding: 22,
          paddingTop: 6,
          paddingBottom: 30,
        }}
      >
        <Header
          back
          title={
            plan.privatePlan ? "Your private plan" : "A plan worth sharing"
          }
          right={
            !plan.privatePlan ? (
              <IconButton
                icon="share-outline"
                label="Share plan"
                onPress={() =>
                  void act(() =>
                    Share.share({
                      title: plan.title,
                      message: `${plan.title} on Along · ${plan.zone} · ${new Date(plan.startsAt).toLocaleString()}\nalong://activity?id=${plan._id}`,
                    }),
                  )
                }
              />
            ) : undefined
          }
        />
        {!!created &&
          !plan.expired &&
          (plan.ownerState ?? "live") === "live" &&
          plan.publicationStatus !== "paused" && (
            <Notice>Your plan is published. Find it in Explore Plans.</Notice>
          )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 18,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 11,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: c.soft,
            }}
          >
            <Ionicons name="pricetag-outline" size={12} color={c.teal} />
            <Text
              style={{
                color: c.teal,
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              {category?.name ?? plan.category}
            </Text>
          </View>
          <PlanTypeBadge type={plan.type} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 11,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: status.color + "1A",
            }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: status.color,
              }}
            />
            <Text
              style={{ color: status.color, fontSize: 11, fontWeight: "700" }}
            >
              {status.label}
            </Text>
          </View>
        </View>
        <Text
          style={[
            text.title,
            { fontSize: 30, lineHeight: 37, marginTop: 12, marginBottom: 22 },
          ]}
        >
          {plan.title}
        </Text>
        <PlanAudienceSummary audience={plan.audience} />
        {plan.isOwner && !plan.privatePlan && !ended && (
          <PlanStatusControl
            state={plan.ownerState as OwnerPlanState | undefined}
            busy={busy}
            expired={plan.expired}
            blocked={plan.publicationStatus === "paused"}
            onChange={(state: OwnerPlanState) =>
              void act(() =>
                api(`/activities/${plan._id}/state`, {
                  method: "PATCH",
                  body: JSON.stringify({ state }),
                }),
              )
            }
          />
        )}
        <View style={[card, { borderRadius: 22, paddingHorizontal: 16 }]}>
          {details.map((row, index) => (
            <View
              key={row.label}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 13,
                paddingVertical: 14,
                borderTopWidth: index ? 1 : 0,
                borderColor: c.line,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  backgroundColor: c.soft,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name={row.icon} size={19} color={c.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[text.muted, { fontSize: 11, lineHeight: 15 }]}>
                  {row.label}
                </Text>
                <Text style={[text.label, { fontSize: 15, marginTop: 2 }]}>
                  {row.value}
                </Text>
              </View>
              {!!row.hint && (
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: row.hintColor ?? c.teal,
                  }}
                >
                  {row.hint}
                </Text>
              )}
            </View>
          ))}
        </View>
        <Text style={[sectionLabel, { marginTop: 26 }]}>
          {plan.isOwner ? "Hosted by you" : "Your organizer"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${organizer.name}'s profile`}
          onPress={() =>
            router.push(
              plan.isOwner ? "/(tabs)/profile" : `/person?id=${organizer._id}`,
            )
          }
          style={({ pressed }) => [
            card,
            {
              padding: 13,
              flexDirection: "row",
              alignItems: "center",
              gap: 13,
              borderRadius: 22,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <MemberPhoto
            id={organizer.photoId ?? undefined}
            style={{ width: 62, height: 62, borderRadius: 20 }}
          />
          <View style={{ flex: 1 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
            >
              <Text style={[text.label, { fontSize: 17 }]}>
                {organizer.name}
                {organizer.age ? `, ${organizer.age}` : ""}
              </Text>
              {organizer.identityVerified && (
                <Ionicons name="checkmark-circle" color="#1597F5" size={17} />
              )}
            </View>
            <Text style={[text.muted, { fontSize: 12, marginTop: 2 }]}>
              {plan.isOwner ? "That's you · View your profile" : "View profile"}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.muted} />
        </Pressable>
        <Text style={[sectionLabel, { marginTop: 26 }]}>About the plan</Text>
        <View style={[card, { borderRadius: 22, padding: 17 }]}>
          <Text style={[text.body, { fontSize: 15, lineHeight: 23 }]}>
            {plan.description?.trim() || "No description added yet."}
          </Text>
        </View>
        <View style={{ marginTop: 24 }}>
          <CategoryPlanSummary
            category={plan.category}
            details={plan.categoryDetails}
          />
        </View>
        <View
          style={{
            backgroundColor: "#E9EFE7",
            padding: 17,
            borderRadius: 22,
            flexDirection: "row",
            gap: 13,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 13,
              backgroundColor: c.white,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={21}
              color={c.teal}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[text.label, { color: c.teal }]}>
              Good plans start with feeling safe.
            </Text>
            <Text style={[text.muted, { fontSize: 12, lineHeight: 18 }]}>
              Meet in public, arrange your own transport, and share your plans
              with someone you trust. Joining a plan is never romantic consent.
            </Text>
            {!plan.isOwner && (
              <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() =>
                    router.push(
                      `/safety?target=${organizer._id}&activity=${plan._id}`,
                    )
                  }
                >
                  <Text style={safetyLink}>Report activity</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setConfirmBlock(!confirmBlock)}
                >
                  <Text style={safetyLink}>Block organizer</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
        {confirmBlock && (
          <View style={[card, { marginTop: 14, padding: 16, gap: 12 }]}>
            <Text style={text.body}>
              Block {organizer.name}? Their plans and conversations will be
              hidden for both of you.
            </Text>
            <Button
              loading={busy}
              onPress={() =>
                void act(async () => {
                  await api("/blocks", {
                    method: "POST",
                    body: JSON.stringify({ userId: organizer._id }),
                  });
                  router.replace("/(tabs)/plans");
                })
              }
            >
              Confirm block
            </Button>
          </View>
        )}
        {plan.isOwner && !plan.privatePlan && (
          <>
            <Text style={[sectionLabel, { marginTop: 26 }]}>Manage plan</Text>
            {ended && plan.ownerState !== "successful" && (
              <View style={{ marginBottom: 10 }}>
                <Notice>
                  {plan.ownerState === "closed"
                    ? "You closed this plan, so it is only visible to you. Reschedule it to reopen."
                    : "This plan has an earlier date and is only visible to you. Choose a future date to make it discoverable again."}
                </Notice>
              </View>
            )}
            <View style={[card, { borderRadius: 22, paddingHorizontal: 16 }]}>
              {[
                {
                  icon: "calendar-number-outline" as const,
                  label: "Reschedule plan",
                  hint: "Pick a new date and time",
                  color: c.teal,
                  onPress: () => setReschedule(!reschedule),
                },
                {
                  icon: "trash-outline" as const,
                  label: "Delete plan",
                  hint: "Remove it from discovery",
                  color: "#BA4034",
                  onPress: () => setConfirmDelete(!confirmDelete),
                },
              ].map((item, index) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  onPress={item.onPress}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 13,
                    paddingVertical: 14,
                    borderTopWidth: index ? 1 : 0,
                    borderColor: c.line,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 13,
                      backgroundColor: item.color + "14",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name={item.icon} size={19} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[text.label, { color: item.color }]}>
                      {item.label}
                    </Text>
                    <Text style={[text.muted, { fontSize: 12 }]}>
                      {item.hint}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.muted} />
                </Pressable>
              ))}
            </View>
            {confirmDelete && (
              <View style={[card, { marginTop: 12, padding: 16, gap: 12 }]}>
                <Text style={text.body}>Remove this plan from discovery?</Text>
                <Button
                  loading={busy}
                  onPress={() =>
                    void act(async () => {
                      await api(`/activities/${plan._id}`, {
                        method: "DELETE",
                      });
                      router.replace("/(tabs)/plans");
                    })
                  }
                >
                  Confirm delete
                </Button>
              </View>
            )}
          </>
        )}
      </ScrollView>
      <View
        style={{
          padding: 18,
          paddingBottom: 18 + insets.bottom,
          backgroundColor: c.ivory,
          borderTopWidth: 1,
          borderColor: c.line,
          gap: 9,
        }}
      >
        {reschedule && plan.isOwner && !plan.privatePlan && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <DateTimeField
                  label="New date"
                  mode="date"
                  minimumDate={localDate()}
                  value={newDate}
                  onChange={setNewDate}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DateTimeField
                  label="New time"
                  mode="time"
                  value={newTime}
                  onChange={setNewTime}
                />
              </View>
            </View>
            <Button
              loading={busy}
              onPress={() =>
                void act(async () => {
                  const start = new Date(`${newDate}T${newTime}:00`);
                  if (
                    !/^\d{4}-\d{2}-\d{2}$/.test(newDate) ||
                    !/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime) ||
                    Number.isNaN(start.getTime()) ||
                    start.getDate() !== Number(newDate.slice(8)) ||
                    start <= new Date()
                  )
                    throw new Error("Choose a valid future date and time.");
                  const duration = plan.endsAt
                    ? new Date(plan.endsAt).getTime() -
                      new Date(plan.startsAt).getTime()
                    : 0;
                  await api(`/activities/${plan._id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      startsAt: start.toISOString(),
                      endsAt:
                        duration > 0
                          ? new Date(start.getTime() + duration).toISOString()
                          : null,
                    }),
                  });
                  setReschedule(false);
                })
              }
            >
              Save new date
            </Button>
          </View>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: "#BA4034" }}>
            {error}
          </Text>
        )}
        {plan.interestStatus === "pending" && (
          <Text style={[text.muted, { fontSize: 11, textAlign: "center" }]}>
            The organizer has been notified and can accept and message you
            first.
          </Text>
        )}
        <View style={{ flexDirection: "row", gap: 12 }}>
          {!plan.privatePlan &&
            (!plan.isOwner ||
              (!ended &&
                (plan.ownerState ?? "live") === "live" &&
                plan.publicationStatus !== "paused")) && (
              <IconButton
                icon={plan.saved ? "bookmark" : "bookmark-outline"}
                label={plan.saved ? "Unsave plan" : "Save plan"}
                onPress={() => {
                  if (!busy) void act(() => save(plan));
                }}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: c.soft,
                }}
              />
            )}
          <View style={{ flex: 1 }}>
            <Button
              variant="coral"
              loading={busy}
              disabled={
                !plan.privatePlan &&
                ((plan.isOwner &&
                  (plan.ownerState === "successful" ||
                    plan.publicationStatus === "paused")) ||
                  (!plan.isOwner &&
                    (plan.interestStatus === "pending" ||
                      plan.interestStatus === "declined" ||
                      (plan.availability === "full" &&
                        plan.interestStatus !== "accepted"))))
              }
              onPress={() =>
                plan.privatePlan
                  ? router.push("/social-invitations")
                  : plan.isOwner
                    ? ended
                      ? setReschedule(!reschedule)
                      : plan.ownerState === "paused"
                        ? void act(() =>
                            api(`/activities/${plan._id}/state`, {
                              method: "PATCH",
                              body: JSON.stringify({ state: "live" }),
                            }),
                          )
                        : router.push("/notifications")
                    : plan.interestStatus === "accepted" && plan.conversationId
                      ? router.push(`/conversation?id=${plan.conversationId}`)
                      : void act(() =>
                          api(`/activities/${plan._id}/interests`, {
                            method: "POST",
                          }),
                        )
              }
            >
              {requestLabel}
            </Button>
          </View>
        </View>
      </View>
    </Screen>
  );
}
function formatWhen(date: Date) {
  return `${date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
const sectionLabel = {
  color: c.muted,
  fontSize: 11,
  fontWeight: "700",
  letterSpacing: 1.2,
  textTransform: "uppercase",
  marginBottom: 10,
  marginLeft: 4,
} as const;
const safetyLink = {
  color: c.teal,
  fontSize: 12,
  fontWeight: "700",
  textDecorationLine: "underline",
} as const;
