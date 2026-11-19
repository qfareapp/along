import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { type MemberCard } from "../services/discovery";
import {
  Button,
  Chip,
  Empty,
  Field,
  Header,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { MemberPhoto, ProfileAccess } from "./LiveDiscover";
import { MemberProfileView } from "./MemberProfile";
import { Ionicons } from "@expo/vector-icons";
import { colors as c } from "../theme";
import {
  SectionLabel,
  airportIntents,
  airportPanel,
  intentLabel,
} from "../components/AirportUI";

export function AirportPerson({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["airport-profile", id],
    queryFn: () =>
      api<MemberCard & { sharedIntentions: string[] }>(
        `/airports/profiles/${id}`,
      ),
    retry: false,
  });
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState(""),
    [reporting, setReporting] = useState(false),
    [intent, setIntent] = useState("conversation");
  const p = query.data;
  const selected = p?.sharedIntentions.includes(intent)
    ? intent
    : p?.sharedIntentions[0];
  async function act(action: "connect" | "block" | "report") {
    setBusy(true);
    setError("");
    try {
      if (action === "connect") {
        if (!selected)
          throw new Error("No shared intention is available for this visit.");
        const result = await api<{ conversationId?: string }>(
          "/airports/connections",
          {
            method: "POST",
            body: JSON.stringify({ userId: id, intent: selected }),
          },
        );
        setNotice("Invitation sent. Chat opens when they accept.");
        if (result.conversationId)
          router.push(`/chat?id=${result.conversationId}`);
      } else {
        await api(action === "block" ? "/blocks" : "/reports", {
          method: "POST",
          body: JSON.stringify({
            userId: id,
            ...(action === "report" ? { reason } : {}),
          }),
        });
        setNotice(
          action === "block" ? "Profile blocked." : "Report sent for review.",
        );
        if (action === "block") {
          await client.invalidateQueries({ queryKey: ["airport-discover"] });
          router.back();
        }
      }
      await client.invalidateQueries({ queryKey: ["airport-connections"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!p)
    return (
      <Screen>
        <Header title="Airport traveller" back />
        <Empty
          title={query.isPending ? "Loading profile…" : "Profile unavailable"}
          description={query.error?.message ?? ""}
        />
      </Screen>
    );
  return (
    <ProfileAccess>
      <MemberProfileView
        profile={{
          name: p.name,
          age: p.age,
          verified: p.identityVerified,
          occupation: p.occupation,
          location: p.city,
          bio: p.bio,
          vibes: p.vibes,
          prompt: p.personalityPrompt,
          details: p.details,
        }}
        photos={(style) =>
          p.photoIds.map((photo) => (
            <MemberPhoto key={photo} id={photo} style={style} />
          ))
        }
        busy={busy}
        mutual={!!p.conversationId}
        onLike={() => void act("connect")}
        onChat={
          p.conversationId
            ? () => router.push(`/chat?id=${p.conversationId}`)
            : undefined
        }
        onReport={() => {
          setReporting(true);
          setNotice("Describe your concern below and tap Send report.");
        }}
        onBlock={() => void act("block")}
      >
        <View style={{ gap: 12 }}>
          <View style={[airportPanel, { marginBottom: 0 }]}>
            <View
              style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  backgroundColor: c.teal,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="airplane" size={18} color={c.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={text.label}>Airport connection</Text>
                <Text style={[text.muted, { fontSize: 12 }]}>
                  Temporary until you both choose to stay connected.
                </Text>
              </View>
            </View>
            {!!error && <Notice>{error}</Notice>}
            {!!notice && <Notice>{notice}</Notice>}
            {p.sharedIntentions.length ? (
              <>
                <SectionLabel icon="sparkles-outline">Connect for</SectionLabel>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {p.sharedIntentions.map((v) => (
                    <Chip
                      key={v}
                      icon={airportIntents[v]?.icon}
                      selected={selected === v}
                      onPress={() => setIntent(v)}
                    >
                      {intentLabel(v)}
                    </Chip>
                  ))}
                </View>
              </>
            ) : (
              <Text style={text.muted}>
                You don&apos;t share an intention with this traveller on this visit.
              </Text>
            )}
            {!p.conversationId && (
              <Button
                icon="paper-plane-outline"
                disabled={!selected}
                loading={busy}
                onPress={() => void act("connect")}
              >
                Send connection request
              </Button>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: reporting }}
            onPress={() => setReporting((v) => !v)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingVertical: 10,
            }}
          >
            <Ionicons name="flag-outline" size={16} color={c.muted} />
            <Text style={[text.muted, { flex: 1 }]}>Report a concern</Text>
            <Ionicons
              name={reporting ? "chevron-up" : "chevron-down"}
              size={16}
              color={c.muted}
            />
          </Pressable>
          {reporting && (
            <View>
              <Field
                label="What happened?"
                value={reason}
                onChangeText={setReason}
                multiline
                placeholder="Describe what happened (at least 10 characters)"
              />
              <Button
                variant="outline"
                disabled={busy || reason.trim().length < 10}
                onPress={() => void act("report")}
              >
                Send report
              </Button>
            </View>
          )}
        </View>
      </MemberProfileView>
    </ProfileAccess>
  );
}
