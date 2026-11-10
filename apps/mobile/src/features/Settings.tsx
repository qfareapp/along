import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  DemoNotice,
  Empty,
  Field,
  Header,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { useAlong } from "../store/useAlong";
import { api, clearSession, demoMode } from "../services/api";
import { colors as c } from "../theme";
import { useOnboarding } from "../store/useOnboarding";
import { useQueryClient } from "@tanstack/react-query";
import ActivityNotifications from "./ActivityNotifications";

export function Settings() {
  const client = useQueryClient();
  const state = useAlong();
  const [confirm, setConfirm] = useState(false);
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
        Blocked preview profiles
      </Text>
      {state.blocked.length ? (
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
      <DemoNotice />
    </Screen>
  );
}
export function Safety() {
  const { target, activity } = useLocalSearchParams<{
    target?: string;
    activity?: string;
  }>();
  const state = useAlong();
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  async function report() {
    if (reason.trim().length < 10) {
      setError(
        "Please add at least 10 characters so we understand what happened.",
      );
      return;
    }
    if (!target) {
      setError("Open a profile and choose Report to report a specific member.");
      return;
    }
    try {
      if (!demoMode)
        await api("/reports", {
          method: "POST",
          body: JSON.stringify({
            userId: target,
            reason,
            activityId: activity,
          }),
        });
      setSubmitted(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
    }
  }
  return (
    <Screen>
      <Header
        title="Safety Centre"
        subtitle="Your comfort comes first. Always."
        back
      />
      <View
        style={{
          alignItems: "center",
          backgroundColor: "#E9EFE7",
          borderRadius: 24,
          padding: 30,
          marginVertical: 14,
        }}
      >
        <Ionicons name="shield-checkmark-outline" size={52} color={c.teal} />
        <Text
          style={[text.title, { color: c.teal, fontSize: 22, marginTop: 13 }]}
        >
          Good plans. Safe beginnings.
        </Text>
      </View>
      {[
        {
          title: "Meet somewhere public",
          description:
            "Choose a busy café or familiar public place. Arrange your own transport and tell someone you trust about your plan.",
        },
        {
          title: "Shared plans don’t imply consent",
          description:
            "A ride, a ticket or a shared bill never creates an obligation. Romantic interest must always be mutual and freely agreed.",
        },
        {
          title: "Protect your personal information",
          description:
            "Keep exact addresses, financial details and daily routines private. Never send money to someone you haven’t met.",
        },
        {
          title: "Trust your comfort level",
          description:
            "You can leave, decline, unmatch or block at any time. You never need to justify a boundary.",
        },
      ].map((tip, i) => (
        <View
          key={tip.title}
          style={{ flexDirection: "row", gap: 13, marginTop: 18 }}
        >
          <Text
            style={{ color: c.coralBright, fontWeight: "700", fontSize: 18 }}
          >
            0{i + 1}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={text.label}>{tip.title}</Text>
            <Text style={[text.muted, { marginTop: 7 }]}>
              {tip.description}
            </Text>
          </View>
        </View>
      ))}
      {target && (
        <View style={{ marginTop: 26 }}>
          <Text style={[text.title, { fontSize: 21, marginBottom: 13 }]}>
            Report a concern
          </Text>
          {submitted ? (
            <Notice>
              {demoMode
                ? "Preview only: your report was not sent to a moderator."
                : "Your report was received for review."}
            </Notice>
          ) : (
            <>
              <Field
                label="What happened?"
                placeholder="Share details about the concern."
                value={reason}
                onChangeText={setReason}
                maxLength={1500}
                multiline
              />
              {error && (
                <Text style={{ color: "#BA4034", marginBottom: 12 }}>
                  {error}
                </Text>
              )}
              <Button
                onPress={() => {
                  void report();
                }}
              >
                {demoMode ? "Preview Report" : "Submit Report"}
              </Button>
            </>
          )}
          <View style={{ marginTop: 12 }}>
            <Button
              variant="outline"
              onPress={() => {
                state.update({
                  blocked: [...new Set([...state.blocked, target])],
                  matched: target === "ananya" ? false : state.matched,
                });
                router.replace("/(tabs)");
              }}
            >
              Block Preview Profile
            </Button>
          </View>
        </View>
      )}
      <DemoNotice />
    </Screen>
  );
}
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
