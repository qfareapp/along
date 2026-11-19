import React, { useEffect, useState } from "react";
import { AppState, Modal, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { api } from "../services/api";
import {
  airportDecision,
  airportLocation,
  useAirportConnections,
  useAirportState,
  useAirportNotices,
  presentAirportNotice,
} from "../services/airports";
import { Ionicons } from "@expo/vector-icons";
import { Button, Notice, text } from "./ui";
import { colors } from "../theme";
import { AirportDecisionFeedback } from "./AirportDecisionFeedback";

export function AirportLifecycle() {
  const state = useAirportState(),
    connections = useAirportConnections(),
    notices = useAirportNotices(),
    client = useQueryClient();
  const active = state.data?.active ?? false;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = notices.data?.find((v) => !v.presentedAt);
  const outcome = update && update.kind !== "keep" ? update : undefined;
  const invitation = update?.kind === "keep" ? update : undefined;
  const pending = invitation
    ? connections.data?.find(
        (v) => v.id === invitation.connectionId && v.needsDecision && !v.kept,
      )
    : connections.data?.find((v) => v.needsDecision && !v.kept);
  useEffect(() => {
    if (!active) return;
    let disposed = false,
      running = false;
    async function refreshPresence() {
      if (disposed || running || AppState.currentState !== "active") return;
      running = true;
      try {
        const location = await airportLocation();
        if (disposed) return;
        const result = await api<{ active: boolean }>("/airports/presence", {
          method: "POST",
          body: JSON.stringify(location),
        });
        if (!result.active) {
          await client.invalidateQueries({ queryKey: ["airport-state"] });
          await client.invalidateQueries({ queryKey: ["airport-connections"] });
          await client.invalidateQueries({ queryKey: ["conversations"] });
        }
      } catch {
        /* No background permission or silent reactivation. The server presence lease expires. */
      } finally {
        running = false;
      }
    }
    void refreshPresence();
    const timer = setInterval(() => void refreshPresence(), 60000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refreshPresence();
    });
    return () => {
      disposed = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, client]);
  async function decide(action: "keep" | "end") {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      await airportDecision(pending.id, action);
      await client.invalidateQueries({ queryKey: ["airport-connections"] });
      await client.invalidateQueries({ queryKey: ["airport-notices"] });
      await client.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function acknowledge(openChat = false) {
    if (!update || busy) return;
    setBusy(true);
    setError("");
    try {
      await presentAirportNotice(update.id);
      await client.invalidateQueries({ queryKey: ["airport-notices"] });
      await client.invalidateQueries({ queryKey: ["conversations"] });
      if (openChat && update.conversationId)
        router.push(`/chat?id=${update.conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      visible={!!pending || !!update}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (update && (outcome || !pending)) void acknowledge();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#0008",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            borderRadius: 28,
            backgroundColor: colors.ivory,
            padding: 24,
            gap: 16,
            width: "100%",
            maxWidth: 420,
            alignSelf: "center",
          }}
        >
          {outcome ? (
            <AirportDecisionFeedback
              key={outcome.id}
              notice={outcome}
              busy={busy}
              error={error}
              onDone={() => void acknowledge()}
              onChat={() => void acknowledge(true)}
            />
          ) : (
            <>
              <View style={{ alignItems: "center", gap: 14 }}>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ flexDirection: "row", alignItems: "center" }}
                >
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: colors.teal,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 3,
                      borderColor: colors.ivory,
                    }}
                  >
                    <Ionicons name="person" size={24} color={colors.white} />
                  </View>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      marginHorizontal: -8,
                      zIndex: 1,
                      backgroundColor: colors.white,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 3,
                      borderColor: colors.ivory,
                    }}
                  >
                    <Ionicons name="airplane" size={15} color={colors.coral} />
                  </View>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      backgroundColor: colors.peach,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 3,
                      borderColor: colors.ivory,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.teal,
                        fontSize: 21,
                        fontWeight: "700",
                      }}
                    >
                      {(pending?.name ?? invitation?.name ?? "?")
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text
                  accessibilityRole="header"
                  style={[text.title, { textAlign: "center" }]}
                >
                  {invitation ? invitation.title : "Stay connected?"}
                </Text>
                <Text style={[text.body, { textAlign: "center" }]}>
                  {invitation
                    ? invitation.body
                    : pending?.otherKept
                      ? `${pending.name} chose Stay connected. Would you like to keep talking too?`
                      : `Your airport visit together has ended. Would you like to keep talking with ${pending?.name}?`}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: colors.soft,
                }}
              >
                <Ionicons name="time-outline" size={17} color={colors.teal} />
                <Text style={[text.muted, { flex: 1, fontSize: 12 }]}>
                  Chat continues when you both choose Stay connected. Decide
                  within 24 hours. The other person will be notified of your
                  choice.
                </Text>
              </View>
              {!!error && <Notice>{error}</Notice>}
              {pending ? (
                <>
                  <Button
                    icon="heart-outline"
                    loading={busy}
                    onPress={() => void decide("keep")}
                  >
                    Stay connected
                  </Button>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onPress={() => void decide("end")}
                  >
                    End connection
                  </Button>
                </>
              ) : (
                <Button loading={busy} onPress={() => void acknowledge()}>
                  Got it
                </Button>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
