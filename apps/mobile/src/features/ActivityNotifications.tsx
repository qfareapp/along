import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
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
import {
  useProfileLikeNotifications,
  type ProfileLikeNotification,
} from "../services/profileLikes";

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
  const notifications = useActivityNotifications();
  const social = useSocialNotifications();
  const profileLikes = useProfileLikeNotifications();
  const unread =
    (notifications.data?.filter((n) => !n.readAt).length ?? 0) +
    (social.data?.filter((n) => !n.readAt).length ?? 0) +
    (profileLikes.data?.filter((n) => !n.readAt).length ?? 0);
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
export default function ActivityNotifications() {
  const notifications = useActivityNotifications();
  const social = useSocialNotifications();
  const profileLikes = useProfileLikeNotifications();
  const client = useQueryClient();
  const refreshPlans = useRefreshPlans();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
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
  return (
    <Screen>
      <Header
        title="Your little updates"
        subtitle="See who likes you and your plans."
        back
      />
      <Button variant="outline" onPress={() => router.push("/social-updates")}>
        Social updates
        {social.data?.some((n) => !n.readAt)
          ? ` · ${social.data.filter((n) => !n.readAt).length} unread`
          : ""}
      </Button>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#BA4034" }}>
          {error}
        </Text>
      )}
      {profileLikes.isPending && !demoMode && (
        <ActivityIndicator color={c.teal} />
      )}
      {profileLikes.error && (
        <Empty
          title="Profile likes unavailable"
          description={profileLikes.error.message}
        >
          <Button onPress={() => void profileLikes.refetch()}>Try again</Button>
        </Empty>
      )}
      {profileLikes.data?.map((item) => (
        <View
          key={`profile-${item.id}`}
          style={[
            card,
            {
              padding: 16,
              marginTop: 14,
              gap: 10,
              backgroundColor: item.readAt ? c.white : "#F9DFCE",
            },
          ]}
        >
          <Text style={text.label}>{item.member.name} liked your profile</Text>
          <Text style={text.body}>
            Take a look and decide if you want to connect.
          </Text>
          <Button
            disabled={!!busy}
            loading={busy === item.id}
            onPress={() => void openProfileLike(item)}
          >
            View profile
          </Button>
        </View>
      ))}
      {notifications.isLoading ? (
        <ActivityIndicator color={c.teal} />
      ) : notifications.error ? (
        <Empty
          title="Updates unavailable"
          description={notifications.error.message}
        >
          <Button onPress={() => void notifications.refetch()}>
            Try Again
          </Button>
        </Empty>
      ) : !notifications.data?.length && !profileLikes.data?.length ? (
        <Empty
          icon="notifications-outline"
          title="You're all caught up"
          description="Profile likes and updates about your plans appear here."
        />
      ) : (
        (notifications.data ?? []).map((item) => (
          <View
            key={item.id}
            style={[
              card,
              {
                padding: 16,
                marginTop: 14,
                backgroundColor: item.readAt ? c.white : "#F9DFCE",
                gap: 10,
              },
            ]}
          >
            <Text style={text.label}>
              {item.role === "applicant"
                ? `${item.member.name} ${item.status} your request`
                : `${item.member.name} liked your activity`}
            </Text>
            <Text style={text.body}>{item.activityTitle}</Text>
            <Text style={text.muted}>
              {item.role === "applicant"
                ? item.status === "accepted"
                  ? "You're in. The organizer will say hello first."
                  : "There will be other plans to share."
                : item.status === "accepted"
                  ? "Accepted. Send the first message to start a chat."
                  : item.status === "declined"
                    ? "You declined this request."
                    : "Accept their request, then send the first message."}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onPress={() => void open(item, false)}
                >
                  View activity
                </Button>
              </View>
              {item.status !== "declined" && (
                <View style={{ flex: 1 }}>
                  <Button
                    disabled={!!busy}
                    loading={busy === item.id}
                    onPress={() => void open(item, true)}
                  >
                    {item.status === "accepted"
                      ? "Open chat"
                      : "Accept & Message"}
                  </Button>
                </View>
              )}
            </View>
            {item.role === "owner" && item.status === "pending" && (
              <Button
                variant="outline"
                disabled={!!busy}
                onPress={() => {
                  setBusy(item.id);
                  setError("");
                  void api(
                    `/activities/${item.activityId}/interests/${item.id}/decline`,
                    { method: "POST" },
                  )
                    .then(() => refreshPlans())
                    .catch((e: Error) => setError(e.message))
                    .finally(() => setBusy(null));
                }}
              >
                Decline request
              </Button>
            )}
          </View>
        ))
      )}
    </Screen>
  );
}
