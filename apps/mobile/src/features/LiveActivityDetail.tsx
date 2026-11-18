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
import { distanceRange } from "../components/DistancePreference";
import { colors as c } from "../theme";
import { fieldsForCategory } from "../../../../packages/plan-details/index.js";
import DateTimeField from "../components/DateTimeField";
import { localDate } from "../components/dateTime";
import { PlanStatusControl, type OwnerPlanState } from "./PlanStatusControl";
import { formatSchedule } from "./PlanSchedule";
import { PlanGroupEntry } from "./PlanGroupEntry";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
const GUTTER = 20;
const SECTION_GAP = 24;
const danger = "#BA4034";

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
    ? "Message"
    : plan.isOwner
      ? plan.ownerState === "successful"
        ? "Plan successful"
        : ended
          ? "Reschedule plan"
          : plan.ownerState === "paused"
            ? "Go live"
            : "View interest requests"
      : plan.interestStatus === "accepted"
        ? plan.activityType === "group"
          ? "Message organiser"
          : "Accepted · Open chat"
        : plan.interestStatus === "declined"
          ? "Declined"
          : plan.interestStatus === "pending"
            ? "Request Sent"
            : plan.availability === "full"
              ? "Activity Full"
              : "I'm Interested";
  const requestIcon: IconName | undefined = plan.privatePlan
    ? "chatbubble-ellipses-outline"
    : !plan.isOwner
      ? plan.interestStatus === "accepted"
        ? "chatbubble-ellipses-outline"
        : plan.interestStatus === "pending"
          ? "checkmark"
          : !plan.interestStatus && plan.availability !== "full"
            ? "hand-right-outline"
            : undefined
      : undefined;
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
  const audience = plan.audience;
  const details: {
    icon: IconName;
    label: string;
    value: string;
    sub?: string;
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
    ...(audience
      ? [
          {
            icon: "person-circle-outline" as const,
            label: "Who it's for",
            value: `Ages ${audience.minAge}–${audience.maxAge} · ${
              audience.gender === "male"
                ? "Male"
                : audience.gender === "female"
                  ? "Female"
                  : "All genders"
            }`,
            sub:
              audience.maxDistanceKm == null
                ? "Any distance"
                : `Within ${distanceRange(audience.maxDistanceKm, audience.distanceUnit)} ${audience.distanceUnit} of the plan`,
          },
        ]
      : []),
  ];
  const extraDetails = plan.categoryDetails
    ? fieldsForCategory(plan.category).flatMap((field) => {
        const value = plan.categoryDetails?.[field.key];
        if (!value || (Array.isArray(value) && !value.length)) return [];
        return [
          {
            key: field.key,
            label: field.label.replace(" (optional)", ""),
            value: Array.isArray(value)
              ? (
                  field.options?.filter((day) => value.includes(day)) ?? value
                ).join(", ")
              : String(value),
          },
        ];
      })
    : [];
  const canSave =
    !plan.privatePlan &&
    (!plan.isOwner ||
      (!ended &&
        (plan.ownerState ?? "live") === "live" &&
        plan.publicationStatus !== "paused"));
  return (
    <Screen scroll={false}>
      <View style={{ paddingHorizontal: GUTTER }}>
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
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: GUTTER,
          paddingTop: 4,
          paddingBottom: 32,
          gap: SECTION_GAP,
        }}
      >
        {!!created &&
          !plan.expired &&
          (plan.ownerState ?? "live") === "live" &&
          plan.publicationStatus !== "paused" && (
            // Notice carries its own vertical margin; the column gap spaces it.
            <View style={{ marginVertical: -10 }}>
              <Notice>Your plan is published. Find it in Explore Plans.</Notice>
            </View>
          )}

        {/* Hero: tags, title and the host */}
        <View style={{ gap: 14 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <Pill
              icon="pricetag-outline"
              label={category?.name ?? plan.category}
              color={c.teal}
              background={c.soft}
            />
            <PlanTypeBadge type={plan.type} />
            <Pill
              dot
              label={status.label}
              color={status.color}
              background={status.color + "1A"}
            />
          </View>
          <Text
            style={[
              text.title,
              { fontSize: 28, lineHeight: 34, letterSpacing: -0.8 },
            ]}
          >
            {plan.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${organizer.name}'s profile`}
            onPress={() =>
              router.push(
                plan.isOwner
                  ? "/(tabs)/profile"
                  : `/person?id=${organizer._id}`,
              )
            }
            style={({ pressed }) => [
              card,
              {
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderRadius: 20,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <MemberPhoto
              id={organizer.photoId ?? undefined}
              style={{ width: 48, height: 48, borderRadius: 16 }}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[text.muted, { fontSize: 12, lineHeight: 16 }]}>
                {plan.isOwner ? "Hosted by you" : "Hosted by"}
              </Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Text
                  numberOfLines={1}
                  style={[text.label, { fontSize: 16, flexShrink: 1 }]}
                >
                  {organizer.name}
                  {organizer.age ? `, ${organizer.age}` : ""}
                </Text>
                {organizer.identityVerified && (
                  <Ionicons name="checkmark-circle" color="#1597F5" size={16} />
                )}
              </View>
            </View>
            <Text style={{ color: c.teal, fontSize: 12, fontWeight: "700" }}>
              {plan.isOwner ? "Your profile" : "View profile"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        </View>

        {plan.isOwner && !plan.privatePlan && !ended && (
          <PlanStatusControl
            style={{ marginBottom: 0 }}
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

        <Section label="The essentials">
          <View style={[card, { borderRadius: 22, paddingHorizontal: 16 }]}>
            {details.map((row, index) => (
              <View
                key={row.label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 13,
                  paddingVertical: 13,
                  borderTopWidth: index ? 1 : 0,
                  borderColor: c.line,
                }}
              >
                <IconTile icon={row.icon} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[text.muted, { fontSize: 12, lineHeight: 16 }]}>
                    {row.label}
                  </Text>
                  <Text style={[text.label, { fontSize: 15, lineHeight: 20 }]}>
                    {row.value}
                  </Text>
                  {!!row.sub && (
                    <Text
                      style={[text.muted, { fontSize: 12, lineHeight: 16 }]}
                    >
                      {row.sub}
                    </Text>
                  )}
                </View>
                {!!row.hint && (
                  <Pill
                    label={row.hint}
                    color={row.hintColor ?? c.teal}
                    background={(row.hintColor ?? c.teal) + "1A"}
                  />
                )}
              </View>
            ))}
          </View>
        </Section>

        <Section label="About the plan">
          <View style={[card, { borderRadius: 22, padding: 18 }]}>
            <Text
              style={[
                text.body,
                { fontSize: 15, lineHeight: 23 },
                !plan.description?.trim() && { color: c.muted },
              ]}
            >
              {plan.description?.trim() || "No description added yet."}
            </Text>
          </View>
        </Section>

        {extraDetails.length > 0 && (
          <Section label="Plan details">
            <View style={[card, { borderRadius: 22, paddingHorizontal: 18 }]}>
              {extraDetails.map((row, index) => (
                <View
                  key={row.key}
                  style={{
                    paddingVertical: 13,
                    gap: 2,
                    borderTopWidth: index ? 1 : 0,
                    borderColor: c.line,
                  }}
                >
                  <Text style={[text.muted, { fontSize: 12, lineHeight: 16 }]}>
                    {row.label}
                  </Text>
                  <Text style={[text.body, { fontSize: 15, lineHeight: 22 }]}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {plan.activityType === "group" &&
          (plan.isOwner || plan.interestStatus === "accepted") && (
            <PlanGroupEntry plan={plan} />
          )}

        {plan.isOwner && !plan.privatePlan && (
          <Section label="Manage plan">
            {ended && plan.ownerState !== "successful" && (
              <View style={{ marginTop: -10, marginBottom: 2 }}>
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
                  color: danger,
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
                    paddingVertical: 13,
                    borderTopWidth: index ? 1 : 0,
                    borderColor: c.line,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <IconTile
                    icon={item.icon}
                    color={item.color}
                    background={item.color + "14"}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[text.label, { color: item.color }]}>
                      {item.label}
                    </Text>
                    <Text
                      style={[text.muted, { fontSize: 12, lineHeight: 16 }]}
                    >
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
          </Section>
        )}

        {/* Safety */}
        <View
          style={{
            backgroundColor: "#E9EFE7",
            padding: 16,
            borderRadius: 22,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", gap: 12 }}>
            <IconTile icon="shield-checkmark-outline" background={c.white} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[text.label, { color: c.teal }]}>
                Good plans start with feeling safe.
              </Text>
              <Text style={[text.muted, { fontSize: 12, lineHeight: 18 }]}>
                Meet in public, arrange your own transport, and share your plans
                with someone you trust. Joining a plan is never romantic
                consent.
              </Text>
            </View>
          </View>
          {!plan.isOwner && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <SafetyAction
                icon="flag-outline"
                label="Report"
                onPress={() =>
                  router.push(
                    `/safety?target=${organizer._id}&activity=${plan._id}`,
                  )
                }
              />
              <SafetyAction
                icon="ban-outline"
                label="Block organizer"
                active={confirmBlock}
                onPress={() => setConfirmBlock(!confirmBlock)}
              />
            </View>
          )}
          {confirmBlock && !plan.isOwner && (
            <View
              style={{
                backgroundColor: c.white,
                borderRadius: 16,
                padding: 14,
                gap: 12,
              }}
            >
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
        </View>
      </ScrollView>

      {/* Action bar */}
      <View
        style={{
          paddingHorizontal: GUTTER,
          paddingTop: 12,
          paddingBottom: 12 + insets.bottom,
          backgroundColor: c.ivory,
          borderTopWidth: 1,
          borderColor: c.line,
          gap: 10,
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
          <Text
            accessibilityRole="alert"
            style={{ color: danger, fontSize: 13, textAlign: "center" }}
          >
            {error}
          </Text>
        )}
        {!plan.isOwner && plan.interestStatus === "pending" && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Ionicons name="time-outline" size={14} color={c.muted} />
            <Text style={[text.muted, { fontSize: 12, lineHeight: 16 }]}>
              The organizer was notified and can accept and message you first.
            </Text>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          {canSave && (
            <IconButton
              icon={plan.saved ? "bookmark" : "bookmark-outline"}
              label={plan.saved ? "Unsave plan" : "Save plan"}
              color={plan.saved ? c.coralBright : c.teal}
              onPress={() => {
                if (!busy) void act(() => save(plan));
              }}
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                backgroundColor: c.soft,
                borderWidth: 1,
                borderColor: c.line,
              }}
            />
          )}
          <View style={{ flex: 1 }}>
            <Button
              variant="coral"
              icon={requestIcon}
              loading={busy}
              disabled={
                plan.privatePlan
                  ? !plan.conversationId
                  : (plan.isOwner &&
                      (plan.ownerState === "successful" ||
                        plan.publicationStatus === "paused")) ||
                    (!plan.isOwner &&
                      (plan.interestStatus === "pending" ||
                        plan.interestStatus === "declined" ||
                        (plan.availability === "full" &&
                          plan.interestStatus !== "accepted")))
              }
              onPress={() =>
                plan.privatePlan
                  ? plan.conversationId &&
                    router.push(`/conversation?id=${plan.conversationId}`)
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

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Pill({
  icon,
  label,
  color,
  background,
  dot = false,
}: {
  icon?: IconName;
  label: string;
  color: string;
  background: string;
  dot?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: background,
      }}
    >
      {dot && (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: color,
          }}
        />
      )}
      {!!icon && <Ionicons name={icon} size={14} color={color} />}
      <Text style={{ color, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function IconTile({
  icon,
  color = c.teal,
  background = c.soft,
}: {
  icon: IconName;
  color?: string;
  background?: string;
}) {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 13,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={19} color={color} />
    </View>
  );
}

function SafetyAction({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 42,
        borderRadius: 14,
        backgroundColor: active ? c.teal : c.white,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={16} color={active ? c.white : c.teal} />
      <Text
        style={{
          color: active ? c.white : c.teal,
          fontSize: 13,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
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
