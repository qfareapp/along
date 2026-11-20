import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Button,
  card,
  DemoNotice,
  Empty,
  Header,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { useAlong } from "../store/useAlong";
import { api, clearSession, demoMode } from "../services/api";
import { colors as c } from "../theme";
import { useOnboarding } from "../store/useOnboarding";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ActivityNotifications from "./ActivityNotifications";
import { openPhoneNotificationSettings } from "../services/pushNotifications";

export function Settings() {
  const client = useQueryClient();
  const state = useAlong();
  const [confirm, setConfirm] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  async function signout() {
    await clearSession();
    useOnboarding.getState().reset();
    client.clear();
    state.reset();
    router.replace("/");
  }
  return (
    <Screen>
      <Header title="Settings" back />
      {!demoMode && Platform.OS === "android" && (
        <View style={{ marginBottom: 12 }}>
          <Button
            variant="outline"
            onPress={() => {
              setNotificationError("");
              void openPhoneNotificationSettings().catch(() =>
                setNotificationError(
                  "Could not open notification settings. Please try again.",
                ),
              );
            }}
          >
            Phone notification settings
          </Button>
          {!!notificationError && <Notice>{notificationError}</Notice>}
        </View>
      )}
      <Button variant="outline" onPress={() => router.push("/social-settings")}>
        Social privacy & Close Circle
      </Button>
      <Text style={[text.label, { marginVertical: 18 }]}>
        Privacy & peace of mind
      </Text>
      <Pressable onPress={() => router.push("/safety")} style={row}>
        <Ionicons name="shield-checkmark-outline" color={c.teal} size={22} />
        <Text style={[text.body, { flex: 1 }]}>Safety Centre</Text>
        <Ionicons name="chevron-forward" color={c.muted} size={17} />
      </Pressable>
      <Pressable onPress={() => router.push("/notifications")} style={row}>
        <Ionicons name="notifications-outline" color={c.teal} size={22} />
        <Text style={[text.body, { flex: 1 }]}>Notification Centre</Text>
        <Ionicons name="chevron-forward" color={c.muted} size={17} />
      </Pressable>
      <Text style={[text.label, { marginTop: 28, marginBottom: 12 }]}>
        Blocked members
      </Text>
      {!demoMode ? <BlockedMembers /> : state.blocked.length ? (
        state.blocked.map((id) => (
          <View key={id} style={row}>
            <Text style={[text.body, { flex: 1, textTransform: "capitalize" }]}>
              {id}
            </Text>
            <Pressable
              onPress={() =>
                state.update({ blocked: state.blocked.filter((v) => v !== id) })
              }
            >
              <Text style={{ color: c.coralBright }}>Unblock</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={text.muted}>You haven’t blocked anyone.</Text>
      )}
      <Notice>
        Along shows approximate areas. Exact addresses and daily routes should
        stay private.
      </Notice>
      <View style={{ gap: 10, marginTop: 20 }}>
        <Button variant="outline" onPress={() => router.push("/policies?section=privacy")}>Privacy Policy</Button>
        <Button variant="outline" onPress={() => router.push("/policies?section=terms")}>Terms & Community Guidelines</Button>
        <Button variant="outline" onPress={() => router.push("/policies?section=child-safety")}>Child Safety Standards</Button>
        <Button variant="outline" onPress={() => router.push("/safety?category=support")}>Contact support</Button>
      </View>
      <View style={{ marginTop: 25, gap: 12 }}>
        <Button
          variant="outline"
          onPress={() => {
            void signout();
          }}
        >
          Sign Out
        </Button>
        {demoMode && (
          <Button variant="outline" onPress={() => setConfirm(!confirm)}>
            Reset Preview Data
          </Button>
        )}
      </View>
      {confirm && (
        <View style={{ marginTop: 16 }}>
          <Notice>
            This clears plans, messages, likes and profile details saved in this
            preview on this device.
          </Notice>
          <Button
            variant="coral"
            onPress={() => {
              void signout();
            }}
          >
            Clear Data & Start Again
          </Button>
        </View>
      )}
      {!demoMode && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          onPress={() => router.push("/delete-account")}
          style={({ pressed }) => [
            card,
            {
              flexDirection: "row",
              alignItems: "center",
              gap: 13,
              marginTop: 16,
              borderColor: "#F3CFC8",
            },
            pressed && { backgroundColor: "#FBE9E6" },
          ]}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#FBE9E6",
            }}
          >
            <Ionicons name="trash-outline" size={18} color="#BA4034" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[text.label, { color: "#BA4034" }]}>
              Delete account
            </Text>
            <Text style={[text.muted, { fontSize: 12, lineHeight: 17 }]}>
              Permanently remove your profile and photos
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#C4B5A9" />
        </Pressable>
      )}
      <DemoNotice />
    </Screen>
  );
}
function BlockedMembers() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["blocked-members"], queryFn: () => api<{ id: string; name: string }[]>("/blocks") });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function unblock(id: string) {
    setBusy(id); setError("");
    try {
      await api(`/blocks/${id}`, { method: "DELETE" });
      await client.invalidateQueries();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not unblock."); }
    finally { setBusy(""); }
  }
  return <View style={{ gap: 10 }}>
    {query.isPending ? <Text style={text.muted}>Loading blocked members…</Text> : query.isError ? <><Notice>Could not load blocked members.</Notice><Button variant="outline" onPress={() => void query.refetch()}>Try again</Button></> : !query.data?.length ? <Text style={text.muted}>You haven&apos;t blocked anyone.</Text> : query.data.map(member => <View key={member.id} style={row}><Text style={[text.body, { flex: 1 }]}>{member.name}</Text><Button variant="outline" loading={busy === member.id} disabled={!!busy} onPress={() => void unblock(member.id)}>Unblock</Button></View>)}
    {!!error && <Notice>{error}</Notice>}
  </View>;
}
export { default as Safety } from "./Safety";
export function Notifications() {
  const state = useAlong();
  if (!demoMode) return <ActivityNotifications />;
  return (
    <Screen>
      <Header
        title="Your little updates"
        subtitle="All the good things, in one place."
        back
      />
      {state.matched && demoMode ? (
        <Pressable
          onPress={() => {
            state.update({ notificationRead: true });
            router.push("/conversation");
          }}
          style={[
            row,
            {
              marginTop: 20,
              backgroundColor: state.notificationRead ? "#FCF2E8" : "#F9DFCE",
              borderRadius: 18,
              padding: 18,
            },
          ]}
        >
          <Ionicons name="heart" color={c.coralBright} size={25} />
          <View style={{ flex: 1 }}>
            <Text style={text.label}>A new preview connection</Text>
            <Text style={text.muted}>
              You and Ananya connected over coffee.
            </Text>
          </View>
          <Ionicons name="chevron-forward" color={c.teal} size={18} />
        </Pressable>
      ) : (
        <Empty
          icon="notifications-outline"
          title="You’re all caught up"
          description="New matches, messages and plan updates will appear here."
        />
      )}
      <Notice>
        In-app notifications are the baseline. Remote push notifications require
        service setup and a development build on supported platforms.
      </Notice>
      <DemoNotice />
    </Screen>
  );
}
const row = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 13,
  paddingVertical: 18,
  borderBottomWidth: 1,
  borderBottomColor: "#F0E3D8",
};
