import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { GroupMessage } from "../services/planGroups";
import { Notice, text } from "../components/ui";
export function GroupMessageTools({
  groupId,
  message,
  organiser,
  onReply,
}: {
  groupId: string;
  message: GroupMessage;
  organiser: boolean;
  onReply: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function action(body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/plan-groups/${groupId}/messages/${message.id}/action`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await client.invalidateQueries({ queryKey: ["plan-group", groupId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (message.deleted) return null;
  return (
    <View style={{ gap: 8 }}>
      {!!message.reactions?.length && (
        <Text style={text.muted}>
          {message.reactions.map((r) => `${r.emoji} ${r.count}`).join("  ")}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 18 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onReply}
          style={{ paddingVertical: 6 }}
        >
          <Text style={[text.muted, { fontSize: 12 }]}>Reply</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(!open)}
          style={{ paddingVertical: 6 }}
        >
          <Text style={[text.muted, { fontSize: 12 }]}>Reactions & more</Text>
        </Pressable>
      </View>
      {open && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {["❤️", "👍", "😂", "🎉", "🔥"].map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={`React ${emoji}`}
                disabled={busy}
                onPress={() =>
                  void action({
                    action: "react",
                    emoji: message.reactions?.some(
                      (r) => r.emoji === emoji && r.own,
                    )
                      ? null
                      : emoji,
                  })
                }
                style={{ padding: 8 }}
              >
                <Text style={{ fontSize: 22 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {organiser && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void action({ action: "pin", pinned: !message.pinned })
                }
              >
                <Text style={text.muted}>
                  {message.pinned ? "Unpin" : "Pin announcement"}
                </Text>
              </Pressable>
            )}
            {(message.own || organiser) && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void action({ action: "delete" })}
              >
                <Text style={text.muted}>Remove message</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
      {!!error && <Notice>{error}</Notice>}
    </View>
  );
}
