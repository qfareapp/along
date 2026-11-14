import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Button, Chip, Notice, card, text } from "../components/ui";
import { api } from "../services/api";
import { colors as c } from "../theme";
import type { PlanRecord } from "../services/plans";
import type { GroupMode } from "../services/planGroups";

export function PlanGroupEntry({ plan }: { plan: PlanRecord }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<GroupMode>("everyone");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["plan-group-for", plan._id],
    queryFn: () =>
      api<{
        groupId: string | null;
        acceptedCount: number;
        isOrganiser: boolean;
        canCreate: boolean;
      }>(`/plan-groups/for-plan/${plan._id}`),
    retry: false,
    refetchInterval: 10000,
  });
  async function create() {
    setBusy(true);
    setError("");
    try {
      const group = await api<{ id: string }>("/plan-groups", {
        method: "POST",
        body: JSON.stringify({ activityId: plan._id, messagingMode: mode }),
      });
      await client.invalidateQueries({ queryKey: ["plan-groups"] });
      await query.refetch();
      router.push(`/plan-group?id=${group.id}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create the group chat.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[card, { padding: 18, gap: 12, marginTop: 22 }]}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Ionicons name="people" size={21} color={c.teal} />
        <Text style={text.label}>Plan group chat</Text>
      </View>
      {query.isError ? (
        <>
          <Notice>{query.error.message}</Notice>
          <Button variant="outline" onPress={() => void query.refetch()}>
            Retry group chat
          </Button>
        </>
      ) : query.data?.groupId ? (
        <>
          <Text style={text.muted}>
            Coordinate with the organiser and the selected attendees.
          </Text>
          <Button
            icon="chatbubbles-outline"
            onPress={() => router.push(`/plan-group?id=${query.data!.groupId}`)}
          >
            Open group chat
          </Button>
        </>
      ) : plan.isOwner ? (
        <>
          <Text style={text.body}>
            {query.data?.acceptedCount ?? 0} selected attendees. All selected
            people will be added with you as the group admin.
          </Text>
          <Text style={text.label}>Who can send messages?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip
              selected={mode === "everyone"}
              onPress={() => setMode("everyone")}
            >
              Everyone
            </Chip>
            <Chip
              selected={mode === "organiser_only"}
              onPress={() => setMode("organiser_only")}
            >
              Only organiser
            </Chip>
          </View>
          <Button
            icon="people-outline"
            loading={busy}
            disabled={!query.data?.canCreate || busy}
            onPress={() => void create()}
          >
            Create group chat
          </Button>
          {!query.data?.acceptedCount && (
            <Text style={text.muted}>
              Accept at least one join request to create your group.
            </Text>
          )}
        </>
      ) : (
        <Text style={text.muted}>
          The organiser can create a group chat for the selected attendees. It
          will also appear in your Chat tab.
        </Text>
      )}
      {!!error && <Notice>{error}</Notice>}
    </View>
  );
}
