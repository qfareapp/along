import React, { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Avatar,
  Button,
  card,
  DemoNotice,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { useAlong } from "../store/useAlong";
import { assets, people, type Plan } from "./data";
import { MemberPhoto } from "./LiveDiscover";
import { api, demoMode } from "../services/api";
import { mapPlan, type RemotePlan } from "./Plans";
import { colors as c } from "../theme";
import LiveActivityDetail from "./LiveActivityDetail";
import { CategoryPlanSummary } from "./CategoryPlanFields";
import { PlanStatusControl } from "./PlanStatusControl";
import { PlanTypeBadge } from "../components/PlanTypeBadge";
import { PlanAudienceSummary } from "../components/PlanAudienceSummary";

export default function ActivityDetail() {
  return demoMode ? <PreviewActivityDetail /> : <LiveActivityDetail />;
}
function PreviewActivityDetail() {
  const params = useLocalSearchParams<{ id: string; created?: string }>();
  const state = useAlong();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const remote = useQuery({
    queryKey: ["activity", params.id],
    enabled: !demoMode,
    queryFn: () => api<RemotePlan>(`/activities/${params.id}`),
  });
  const plan = demoMode
    ? state.plans.find((p) => p.id === params.id)
    : remote.data
      ? mapPlan(remote.data)
      : undefined;
  if (!demoMode && remote.isLoading)
    return (
      <Screen>
        <Header back />
        <ActivityIndicator color={c.teal} />
      </Screen>
    );
  if (!plan)
    return (
      <Screen>
        <Header back />
        <Empty
          title="Plan unavailable"
          description={
            remote.error?.message ?? "This plan may have been removed."
          }
        />
      </Screen>
    );
  const interested =
    state.interests.includes(plan.id) || !!remote.data?.interested;
  const own = demoMode ? plan.id.startsWith("local-") : !!remote.data?.isOwner;
  async function interest() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      if (!demoMode)
        await api(`/activities/${plan.id}/interests`, { method: "POST" });
      state.update({ interests: [...state.interests, plan.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Header
        back
        title="A plan worth sharing"
        right={
          <IconButton
            icon="shield-checkmark-outline"
            label="Safety centre"
            onPress={() => router.push("/safety")}
          />
        }
      />
      <Image
        source={plan.image}
        style={{
          height: 245,
          width: "100%",
          borderRadius: 23,
          marginBottom: 21,
        }}
      />
      {params.created && (
        <Notice>
          Your {demoMode ? "preview " : ""}plan is published. Find it in Explore
          Plans.
        </Notice>
      )}
      <Text style={[text.title, { fontSize: 25, marginBottom: 15 }]}>
        {plan.title}
        {plan.id === "carpool" ? " to Sector V" : ""}
      </Text>
      <View style={{ marginBottom: 15 }}>
        <PlanTypeBadge type={plan.type} />
      </View>
      <PlanAudienceSummary audience={plan.audience} />
      {own && (
        <PlanStatusControl
          state={plan.ownerState}
          onChange={(ownerState) =>
            state.update({
              plans: state.plans.map((item) =>
                item.id === plan.id ? { ...item, ownerState } : item,
              ),
            })
          }
        />
      )}
      {(
        [
          { icon: "location-outline", value: plan.zone },
          { icon: "time-outline", value: plan.time },
          {
            icon: "people-outline",
            value:
              plan.id === "carpool"
                ? "1 seat available"
                : "Good company welcome",
          },
          {
            icon: "wallet-outline",
            value:
              plan.id === "carpool"
                ? "Share fuel cost (₹)"
                : "Agree on costs together",
          },
        ] as const
      ).map((row) => (
        <View
          key={row.icon}
          style={{
            flexDirection: "row",
            gap: 10,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Ionicons name={row.icon} size={18} color={c.coralBright} />
          <Text style={text.body}>{row.value}</Text>
        </View>
      ))}
      <Text style={[text.body, { marginTop: 7 }]}>{plan.description}</Text>
      <View style={{ marginTop: 24 }}>
        <CategoryPlanSummary
          category={plan.category}
          details={plan.categoryDetails}
        />
      </View>
      <CreatorCard plan={plan} own={own} />
      {interested && (
        <Notice>
          {demoMode
            ? "Preview interest saved locally."
            : "The activity owner has been notified and can message you first."}{" "}
          A shared plan becomes a romantic connection only with mutual
          agreement.
        </Notice>
      )}
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: "#BA4034", marginBottom: 12 }}
        >
          {error}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            variant="coral"
            loading={busy}
            disabled={interested || own}
            onPress={() => {
              void interest();
            }}
          >
            {own
              ? "Your Plan"
              : interested
                ? "Interest Sent ✓"
                : "I’m Interested"}
          </Button>
        </View>
        <IconButton
          icon={state.saved.includes(plan.id) ? "bookmark" : "bookmark-outline"}
          label="Save plan"
          onPress={() => state.toggleSaved(plan.id)}
          style={{
            width: 52,
            height: 52,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 16,
          }}
        />
      </View>
      {own && demoMode && (
        <View style={{ marginTop: 13 }}>
          <Button
            variant="outline"
            onPress={() => {
              state.update({
                plans: state.plans.filter((p) => p.id !== plan.id),
                saved: state.saved.filter((id) => id !== plan.id),
              });
              router.replace("/(tabs)/plans");
            }}
          >
            Delete Preview Plan
          </Button>
        </View>
      )}
      <DemoNotice />
    </Screen>
  );
}
function CreatorCard({ plan, own }: { plan: Plan; own: boolean }) {
  const state = useAlong();
  const preview = demoMode
    ? people.find((p) => p.name === plan.creator)
    : undefined;
  const id = demoMode ? preview?.id : plan.creatorId;
  const name = own ? state.name : plan.creator;
  const verified = demoMode ? !!preview : plan.creatorVerified;
  const subtitle = own
    ? "That's you"
    : demoMode
      ? preview
        ? `${preview.occupation} · ${preview.distance}`
        : "Along member"
      : plan.creatorOccupation || "Along member";
  const canOpen = own || !!id;
  const size = 57;
  const photo = own ? (
    state.photo ? (
      <Avatar source={{ uri: state.photo }} size={size} />
    ) : (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.peach,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: c.teal, fontSize: 22, fontWeight: "800" }}>
          {name.trim().charAt(0).toUpperCase() || "?"}
        </Text>
      </View>
    )
  ) : demoMode ? (
    <Avatar
      source={plan.creator === "Ananya" ? assets.ananya : assets.rohan}
      size={size}
    />
  ) : (
    <MemberPhoto
      id={plan.creatorPhotoId ?? undefined}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: c.ivory,
      }}
    />
  );
  return (
    <View style={{ marginVertical: 21 }}>
      <Text style={[text.label, { marginBottom: 10 }]}>Shared by</Text>
      <Pressable
        accessibilityRole={canOpen ? "button" : undefined}
        accessibilityLabel={
          canOpen ? `View ${own ? "your" : `${name}'s`} profile` : undefined
        }
        disabled={!canOpen}
        onPress={() =>
          own ? router.push("/(tabs)/profile") : router.push(`/person?id=${id}`)
        }
        style={({ pressed }) => [
          card,
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 13,
            padding: 14,
          },
          pressed && { opacity: 0.75 },
        ]}
      >
        <View
          style={{
            borderRadius: size,
            borderWidth: 2,
            borderColor: c.coralBright,
            padding: 2,
          }}
        >
          {photo}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={text.label}>
              {name}
              {demoMode && preview ? `, ${preview.age}` : ""}
            </Text>
            {verified && (
              <Ionicons name="checkmark-circle" color="#1597F5" size={15} />
            )}
          </View>
          <Text style={text.muted} numberOfLines={1}>
            {subtitle}
          </Text>
          {canOpen && (
            <Text
              style={{
                color: c.teal,
                fontSize: 12,
                fontWeight: "600",
                marginTop: 3,
              }}
            >
              View profile
            </Text>
          )}
        </View>
        {canOpen && (
          <Ionicons name="chevron-forward" size={20} color="#C4B5A9" />
        )}
      </Pressable>
    </View>
  );
}
