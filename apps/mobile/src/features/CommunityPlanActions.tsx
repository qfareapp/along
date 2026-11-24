import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors as c } from "../theme";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Notice, text } from "../components/ui";
import { api } from "../services/api";
import { PlanRecord } from "../services/plans";
import { useCurrentAccount } from "../services/account";
import { communityWrite, useCommunity } from "../services/communities";
export function CommunityPlanActions({ plan }: { plan: PlanRecord }) {
  const client = useQueryClient(),
    account = useCurrentAccount();
  const community = useCommunity(plan.communityId!);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmLeave, setConfirmLeave] = useState(false);
  const [moderating, setModerating] = useState(false),
    [reason, setReason] = useState("");
  const group = useQuery({
    queryKey: ["plan-group-for", plan._id],
    enabled: plan.isOwner || plan.interestStatus === "accepted",
    queryFn: () =>
      api<{ groupId: string | null }>(`/plan-groups/for-plan/${plan._id}`),
  });
  async function act(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await client.invalidateQueries({ queryKey: ["activity", plan._id] });
      await client.invalidateQueries({
        queryKey: ["community-plans", plan.communityId],
      });
      setConfirmLeave(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const pending = plan.interestStatus === "pending",
    waiting = plan.interestStatus === "waitlisted",
    accepted = plan.interestStatus === "accepted";
  const closed =
    !!plan.expired ||
    plan.ownerState !== "live" ||
    plan.publicationStatus !== "active";
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#E3EEEC",
          }}
        >
          <Ionicons name="people-outline" size={17} color={c.teal} />
        </View>
        <Text style={[text.label, { flex: 1 }]}>Community event</Text>
        <View
          style={{
            paddingHorizontal: 9,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor:
              plan.participationPolicy === "open" ? "#E2F0EC" : "#FDE6E1",
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: plan.participationPolicy === "open" ? c.green : "#C9503F",
            }}
          >
            {plan.participationPolicy === "open"
              ? "Open RSVP"
              : "Organiser approval"}
          </Text>
        </View>
      </View>
      {plan.isOwner ? (
        <Button
          onPress={() =>
            router.push(
              `/community-participants?id=${plan.communityId}&planId=${plan._id}`,
            )
          }
        >
          Manage participants
        </Button>
      ) : !community.data?.joined && !accepted ? (
        <Button
          onPress={() => router.push(`/community?id=${plan.communityId}`)}
        >
          Join community to participate
        </Button>
      ) : accepted ? (
        <Button
          disabled={!group.data?.groupId}
          onPress={() => {
            if (group.data?.groupId)
              router.push(`/plan-group?id=${group.data.groupId}`);
          }}
        >
          Open event chat
        </Button>
      ) : (
        <Button
          loading={busy}
          disabled={
            closed ||
            waiting ||
            plan.interestStatus === "declined" ||
            (pending && plan.participationPolicy !== "open")
          }
          onPress={() =>
            void act(() =>
              api(`/activities/${plan._id}/interests`, { method: "POST" }),
            )
          }
        >
          {closed
            ? "Registration closed"
            : waiting
              ? "On the waiting list"
              : plan.interestStatus === "declined"
                ? "Request declined"
                : pending
                  ? plan.participationPolicy === "open"
                    ? "Confirm your place"
                    : "Request sent"
                  : plan.availability === "full"
                    ? "Join waiting list"
                    : plan.participationPolicy === "open"
                      ? "Join plan"
                      : "Request to join"}
        </Button>
      )}
      {!plan.isOwner && (pending || waiting || accepted) && (
        <Button
          variant="outline"
          onPress={() => setConfirmLeave(!confirmLeave)}
        >
          {accepted ? "Leave event" : "Cancel request"}
        </Button>
      )}
      {confirmLeave && (
        <>
          <Notice>
            Leaving releases your place and removes event chat access.
          </Notice>
          <Button
            loading={busy}
            onPress={() =>
              void act(() =>
                communityWrite(
                  `/${plan.communityId}/plans/${plan._id}/participants/${account.data?.user._id}`,
                  undefined,
                  "DELETE",
                ),
              )
            }
          >
            Confirm leave
          </Button>
        </>
      )}
      {!!error && <Notice>{error}</Notice>}
      {community.data?.moderator && (
        <Button variant="outline" onPress={() => setModerating(!moderating)}>
          Moderate community plan
        </Button>
      )}
      {moderating && (
        <View style={{ gap: 10 }}>
          <Field
            label="Reason for removing this plan"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={1500}
          />
          <Button
            disabled={busy || reason.trim().length < 10}
            onPress={() =>
              void act(async () => {
                await communityWrite(
                  `/${plan.communityId}/plans/${plan._id}/remove`,
                  { reason },
                );
                router.replace(`/community?id=${plan.communityId}`);
              })
            }
          >
            Remove unsafe or spam plan
          </Button>
        </View>
      )}
    </View>
  );
}
