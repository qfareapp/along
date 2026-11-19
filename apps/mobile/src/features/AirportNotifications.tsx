import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { presentAirportNotice, useAirportNotices } from "../services/airports";
import { Button, Notice, text } from "../components/ui";
import { colors as c } from "../theme";

export function AirportNotifications() {
  const notices = useAirportNotices(),
    client = useQueryClient();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  async function open(id: string, conversationId: string | null) {
    setBusy(id);
    setError("");
    try {
      await presentAirportNotice(id);
      await client.invalidateQueries({ queryKey: ["airport-notices"] });
      if (conversationId) router.push(`/chat?id=${conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy("");
    }
  }
  if (!notices.data?.length && !notices.isError) return null;
  return (
    <View style={{ gap: 12, marginBottom: 18 }}>
      <Text style={text.label}>Airport connection updates</Text>
      {!!error && <Notice>{error}</Notice>}
      {notices.isError && <Notice>{notices.error.message}</Notice>}
      {notices.data?.map((notice) => (
        <View
          key={notice.id}
          style={{
            padding: 18,
            borderRadius: 20,
            backgroundColor: c.white,
            borderWidth: 1,
            borderColor: notice.readAt ? c.line : c.peach,
            gap: 10,
          }}
        >
          <Text style={text.label}>{notice.title}</Text>
          <Text style={text.body}>{notice.body}</Text>
          {(!notice.readAt || notice.conversationId) && (
            <Button
              variant="outline"
              loading={busy === notice.id}
              disabled={!!busy && busy !== notice.id}
              onPress={() => void open(notice.id, notice.conversationId)}
            >
              {notice.conversationId ? "Open conversation" : "Mark as read"}
            </Button>
          )}
        </View>
      ))}
    </View>
  );
}
