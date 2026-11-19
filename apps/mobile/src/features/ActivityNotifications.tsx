import React, { useState, type ReactNode } from "react";
import { AirportRequests } from "./AirportMode";
import { AirportNotifications } from "./AirportNotifications";
import { useAirportNotices } from "../services/airports";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  Empty,
  Header,
  IconButton,
  Screen,
  card,
  text,
} from "../components/ui";
import { api, demoMode } from "../services/api";
import { useCompletion } from "../services/onboarding";
import { colors as c } from "../theme";
import { useRefreshPlans } from "../services/plans";
import { useSocialNotifications } from "../services/social";
import { useVibeInbox } from "../services/vibeChecks";
import {
  useProfileLikeNotifications,
  type ProfileLikeNotification,
} from "../services/profileLikes";
import type { IconName } from "./data";
import { timeAgo } from "./Likes";

type ActivityNotification = {
  id: string;
  activityId: string;
  activityTitle: string;
  member: { id: string; name: string };
  createdAt: string;
  readAt: string | null;
  role: "owner" | "applicant";
  status: "pending" | "accepted" | "declined";
  conversationId: string | null;
};
type FeedItem =
  | { kind: "profile"; item: ProfileLikeNotification }
  | { kind: "plan"; item: ActivityNotification };
type Filter = "all" | "profile" | "plan";
const avatarColors = ["#F47768", "#30786D", "#E2A04A", "#6C7BD0", "#B46AA8", "#174F54"];
const avatarColor = (name: string) =>
  avatarColors[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % avatarColors.length];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
const statusStyle = {
  pending: { label: "Waiting", color: "#B7702A", bg: "#FDF0DF" },
  accepted: { label: "Accepted", color: c.green, bg: "#E3F1EC" },
  declined: { label: "Declined", color: c.muted, bg: c.soft },
} as const;
function useActivityNotifications() {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["activity-notifications"],
    enabled: !demoMode && !!completion.data?.activated,
    queryFn: () => api<ActivityNotification[]>("/notifications"),
    refetchInterval: 10000,
    retry: false,
  });
}
export function NotificationBell() {
  const airport = useAirportNotices();
  const notifications = useActivityNotifications();
  const social = useSocialNotifications();
  const profileLikes = useProfileLikeNotifications();
  const vibes = useVibeInbox(true);
  const unread =
    (notifications.data?.filter((n) => !n.readAt).length ?? 0) +
    (social.data?.filter((n) => !n.readAt).length ?? 0) +
    (profileLikes.data?.filter((n) => !n.readAt).length ?? 0) +
    (vibes.data?.filter(n => !n.readAt).length ?? 0) +
    (airport.data?.filter(n => !n.readAt).length ?? 0);
  return (
    <View>
      <IconButton
        icon="notifications-outline"
        label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onPress={() => router.push("/notifications")}
      />
      {!!unread && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: 3,
            top: 1,
            backgroundColor: c.coralBright,
            borderRadius: 10,
            minWidth: 18,
            alignItems: "center",
          }}
        >
          <Text style={{ color: c.white, fontSize: 11 }}>
            {unread > 9 ? "9+" : unread}
          </Text>
        </View>
      )}
    </View>
  );
}
function Shortcut({
  icon,
  title,
  description,
  unread,
  onPress,
}: {
  icon: IconName;
  title: string;
  description: string;
  unread: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${unread ? `, ${unread} unread` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [s.shortcut, pressed && { opacity: 0.7 }]}
    >
      <View style={s.shortcutIcon}>
        <Ionicons name={icon} size={20} color={c.coralBright} />
        {unread > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        )}
      </View>
      <Text style={text.label}>{title}</Text>
      <Text style={[text.muted, { fontSize: 12, lineHeight: 17 }]}>
        {description}
      </Text>
    </Pressable>
  );
}
function NotificationCard({
  name,
  badge,
  accent,
  title,
  readAt,
  createdAt,
  children,
}: {
  name: string;
  badge: IconName;
  accent: string;
  title: string;
  readAt: string | null;
  createdAt: string;
  children: ReactNode;
}) {
  return (
    <View style={[s.card, !readAt && s.unread]}>
      <View style={[s.accent, { backgroundColor: accent }]} />
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View>
          <View style={[s.avatar, { backgroundColor: avatarColor(name) }]}>
            <Text style={s.avatarText}>{initials(name)}</Text>
          </View>
          <View style={[s.typeBadge, { backgroundColor: accent }]}>
            <Ionicons name={badge} size={11} color={c.white} />
          </View>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[text.label, { fontSize: 15 }]}>{title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {!readAt && <View style={s.dot} />}
            <Text style={[text.muted, { fontSize: 12 }]}>
              {!readAt ? "New · " : ""}
              {timeAgo(createdAt)}
            </Text>
          </View>
        </View>
      </View>
      {children}
    </View>
  );
}
export default function ActivityNotifications() {
  const airport = useAirportNotices();
  const notifications = useActivityNotifications();
  const social = useSocialNotifications();
  const profileLikes = useProfileLikeNotifications();
  const vibes = useVibeInbox();
  const client = useQueryClient();
  const refreshPlans = useRefreshPlans();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  async function openProfileLike(item: ProfileLikeNotification) {
    setBusy(item.id);
    setError("");
    try {
      await api(`/discovery/like-notifications/${item.id}/read`, {
        method: "POST",
      });
      await client.invalidateQueries({
        queryKey: ["profile-like-notifications"],
      });
      router.push(`/person?id=${item.member.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }
  async function open(item: ActivityNotification, message: boolean) {
    setBusy(item.id);
    setError("");
    try {
      if (message) {
        if (item.role === "applicant" && item.conversationId) {
          await api(`/notifications/${item.id}/read`, { method: "POST" });
          router.push(`/conversation?id=${item.conversationId}`);
          await refreshPlans();
          return;
        }
        const conversation = await api<{ id: string }>(
          `/notifications/${item.id}/conversation`,
          { method: "POST" },
        );
        void client.invalidateQueries({ queryKey: ["conversations"] });
        router.push(`/conversation?id=${conversation.id}`);
      } else {
        await api(`/notifications/${item.id}/read`, { method: "POST" });
        router.push(`/activity?id=${item.activityId}`);
      }
      void client.invalidateQueries({ queryKey: ["activity-notifications"] });
      await refreshPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }
  function decline(item: ActivityNotification) {
    setBusy(item.id);
    setError("");
    void api(`/activities/${item.activityId}/interests/${item.id}/decline`, {
      method: "POST",
    })
      .then(() => refreshPlans())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }

  const likes = profileLikes.data ?? [];
  const plans = notifications.data ?? [];
  const feed: FeedItem[] = [
    ...likes.map((item) => ({ kind: "profile" as const, item })),
    ...plans.map((item) => ({ kind: "plan" as const, item })),
  ]
    .filter((entry) => filter === "all" || entry.kind === filter)
    .sort((a, b) => +new Date(b.item.createdAt) - +new Date(a.item.createdAt));
  const fresh = feed.filter((entry) => !entry.item.readAt);
  const earlier = feed.filter((entry) => entry.item.readAt);
  const socialUnread = social.data?.filter((n) => !n.readAt).length ?? 0;
  const vibeUnread = vibes.data?.filter((n) => !n.readAt).length ?? 0;
  const newLikes = likes.filter((n) => !n.readAt).length;
  const newPlans = plans.filter((n) => !n.readAt).length;
  const waiting = plans.filter(
    (n) => n.role === "owner" && n.status === "pending",
  ).length;
  const totalNew = newLikes + newPlans + socialUnread + vibeUnread + (airport.data?.filter(n => !n.readAt).length ?? 0);

  function renderEntry(entry: FeedItem) {
    if (entry.kind === "profile") {
      const item = entry.item;
      return (
        <NotificationCard
          key={`profile-${item.id}`}
          name={item.member.name}
          badge="heart"
          accent={c.coralBright}
          title={`${item.member.name} liked your profile`}
          readAt={item.readAt}
          createdAt={item.createdAt}
        >
          <Text style={text.body}>
            Take a look and decide if you want to connect.
          </Text>
          <Button
            icon="person-outline"
            variant={item.readAt ? "outline" : "coral"}
            disabled={!!busy}
            loading={busy === item.id}
            onPress={() => void openProfileLike(item)}
          >
            View profile
          </Button>
        </NotificationCard>
      );
    }
    const item = entry.item;
    const applicant = item.role === "applicant";
    const status =
      !applicant && item.status === "pending"
        ? { ...statusStyle.pending, label: "Needs reply" }
        : statusStyle[item.status];
    return (
      <NotificationCard
        key={item.id}
        name={item.member.name}
        badge={
          applicant
            ? item.status === "accepted"
              ? "checkmark"
              : "close"
            : "hand-left"
        }
        accent={
          item.status === "declined"
            ? "#B9B1AA"
            : applicant
              ? c.green
              : c.teal
        }
        title={
          applicant
            ? `${item.member.name} ${item.status} your request`
            : `${item.member.name} liked your activity`
        }
        readAt={item.readAt}
        createdAt={item.createdAt}
      >
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`View activity: ${item.activityTitle}`}
          disabled={!!busy}
          onPress={() => void open(item, false)}
          style={({ pressed }) => [s.plan, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="calendar-outline" size={16} color={c.teal} />
          <Text style={[text.label, { flex: 1 }]} numberOfLines={1}>
            {item.activityTitle}
          </Text>
          <View style={[s.pill, { backgroundColor: status.bg }]}>
            <Text style={[s.pillText, { color: status.color }]}>
              {status.label}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.muted} />
        </Pressable>
        <Text style={text.muted}>
          {applicant
            ? item.status === "accepted"
              ? "You're in. The organizer will say hello first."
              : "There will be other plans to share."
            : item.status === "accepted"
              ? "Accepted. Send the first message to start a chat."
              : item.status === "declined"
                ? "You declined this request."
                : "Accept their request, then send the first message."}
        </Text>
        {item.status !== "declined" && (
          <Button
            icon={item.status === "accepted" ? "chatbubble-outline" : "chatbubbles-outline"}
            disabled={!!busy}
            loading={busy === item.id}
            onPress={() => void open(item, true)}
          >
            {item.status === "accepted" ? "Open chat" : "Accept & Message"}
          </Button>
        )}
        {item.role === "owner" && item.status === "pending" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decline request"
            disabled={!!busy}
            onPress={() => decline(item)}
            style={({ pressed }) => [s.textButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close-circle-outline" size={16} color={c.muted} />
            <Text style={{ color: c.muted, fontWeight: "600" }}>
              Decline request
            </Text>
          </Pressable>
        )}
      </NotificationCard>
    );
  }

  const loading =
    !demoMode && (profileLikes.isPending || notifications.isLoading);
  return (
    <Screen>
      <Header
        title="Your little updates"
        subtitle="See who likes you and your plans."
        back
      />
      <AirportNotifications />
      <AirportRequests />
      <LinearGradient colors={["#1A6065", "#08484F"]} style={s.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={s.heroIcon}>
            <Ionicons
              name={totalNew ? "notifications" : "checkmark-done"}
              size={22}
              color={c.peach}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>
              {totalNew
                ? `${totalNew} new ${totalNew === 1 ? "update" : "updates"}`
                : "You're all caught up"}
            </Text>
            <Text style={s.heroSub}>
              {waiting
                ? `${waiting} ${waiting === 1 ? "person is" : "people are"} waiting for your reply`
                : "Likes, requests and plan news land here."}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(
            [
              ["heart", newLikes, "Likes"],
              ["calendar", newPlans, "Plans"],
              ["people", socialUnread, "Social"],
              ["sparkles", vibeUnread, "Vibes"],
            ] as const
          ).map(([icon, count, label]) => (
            <View key={label} style={[s.stat, !count && { opacity: 0.55 }]}>
              <Ionicons name={icon} size={14} color={c.peach} />
              <Text style={s.statValue}>{count}</Text>
              <Text style={s.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
        <Shortcut
          icon="people-outline"
          title="Social updates"
          description="Posts and replies from your circle"
          unread={socialUnread}
          onPress={() => router.push("/social-updates")}
        />
        <Shortcut
          icon="sparkles-outline"
          title="Vibe Check results"
          description="Scores and match requests"
          unread={vibeUnread}
          onPress={() => router.push("/vibe-check?tab=requests")}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
        <Chip selected={filter === "all"} onPress={() => setFilter("all")}>
          All · {likes.length + plans.length}
        </Chip>
        <Chip
          icon="heart-outline"
          selected={filter === "profile"}
          onPress={() => setFilter("profile")}
        >
          Profile likes · {likes.length}
        </Chip>
        <Chip
          icon="calendar-outline"
          selected={filter === "plan"}
          onPress={() => setFilter("plan")}
        >
          Plans · {plans.length}
        </Chip>
      </View>
      {!!error && (
        <View style={s.error}>
          <Ionicons name="alert-circle" size={17} color="#BA4034" />
          <Text accessibilityRole="alert" style={{ color: "#BA4034", flex: 1 }}>
            {error}
          </Text>
        </View>
      )}
      {profileLikes.error && (
        <Empty
          title="Profile likes unavailable"
          description={profileLikes.error.message}
        >
          <Button onPress={() => void profileLikes.refetch()}>Try again</Button>
        </Empty>
      )}
      {notifications.error && (
        <Empty
          title="Updates unavailable"
          description={notifications.error.message}
        >
          <Button onPress={() => void notifications.refetch()}>
            Try Again
          </Button>
        </Empty>
      )}
      {loading ? (
        <ActivityIndicator color={c.teal} style={{ marginTop: 24 }} />
      ) : !feed.length && !notifications.error && !profileLikes.error ? (
        <Empty
          icon="notifications-outline"
          title={filter === "all" ? "Nothing here yet" : "Nothing in this filter"}
          description="Profile likes and updates about your plans appear here."
        >
          {filter !== "all" && (
            <Button variant="outline" onPress={() => setFilter("all")}>
              Show all updates
            </Button>
          )}
        </Empty>
      ) : (
        <>
          {fresh.length > 0 && (
            <Text style={s.section}>New · {fresh.length}</Text>
          )}
          {fresh.map(renderEntry)}
          {earlier.length > 0 && <Text style={s.section}>Earlier</Text>}
          {earlier.map(renderEntry)}
        </>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: { borderRadius: 22, padding: 18, gap: 14, marginBottom: 14 },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: c.white, fontSize: 20, fontWeight: "700" },
  heroSub: { color: "#CFE3E0", fontSize: 13, lineHeight: 19 },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  statValue: { color: c.white, fontSize: 17, fontWeight: "700" },
  statLabel: { color: "#CFE3E0", fontSize: 11 },
  shortcut: { ...card, flex: 1, padding: 14, gap: 4 },
  shortcutIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FDE8E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -7,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#FFFDF9",
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: c.white, fontSize: 10, fontWeight: "700" },
  section: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: c.muted,
    textTransform: "uppercase",
    marginTop: 18,
  },
  card: {
    ...card,
    padding: 16,
    paddingLeft: 20,
    marginTop: 12,
    gap: 12,
    overflow: "hidden",
  },
  unread: { borderColor: "#F6C3B5", backgroundColor: "#FFF6F1" },
  accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: c.white, fontWeight: "700", fontSize: 16 },
  typeBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#FFFDF9",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.coralBright },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: c.soft,
  },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "700" },
  textButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: "#FBE9E6",
  },
});
