import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  card,
  text,
  useKeyboardVisible,
} from "../components/ui";
import { api } from "../services/api";
import { formatChatTime } from "../services/chat";
import {
  usePlanGroups,
  usePlanGroupThread,
  type GroupMessage,
  type GroupMode,
  type PlanGroupSummary,
  type PlanGroupThread,
} from "../services/planGroups";
import { colors as c } from "../theme";

export function PlanGroupList() {
  const query = usePlanGroups();
  return (
    <View style={{ gap: 10 }}>
      {query.isPending && query.fetchStatus !== "idle" && (
        <ActivityIndicator color={c.teal} />
      )}
      {query.isError && (
        <>
          <Notice>Could not load plan group chats.</Notice>
          <Button variant="outline" onPress={() => void query.refetch()}>
            Retry group chats
          </Button>
        </>
      )}
      {!!query.data?.length && (
        <Text style={[text.label, { marginTop: 10 }]}>Plan groups</Text>
      )}
      {query.data?.map((group) => (
        <Pressable
          key={group.id}
          accessibilityRole="button"
          accessibilityLabel={`Group chat: ${group.title}${group.unread ? `, ${group.unread} unread` : ""}`}
          onPress={() => router.push(`/plan-group?id=${group.id}`)}
          style={[
            card,
            {
              padding: 16,
              flexDirection: "row",
              gap: 12,
              alignItems: "center",
            },
          ]}
        >
          <View
            style={{
              backgroundColor: "#DDECE8",
              width: 48,
              height: 48,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="people" size={24} color={c.teal} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={text.label} numberOfLines={1}>
              {group.title}
            </Text>
            <Text style={text.muted} numberOfLines={1}>
              {group.lastMessage?.text ?? `${group.memberCount} members`}
            </Text>
            <Text style={[text.muted, { fontSize: 11 }]}>
              {group.memberCount} members
              {group.messagingMode === "organiser_only"
                ? " · Announcements"
                : ""}
            </Text>
          </View>
          {!!group.unread && (
            <View
              style={{
                padding: 7,
                borderRadius: 14,
                backgroundColor: c.coralBright,
              }}
            >
              <Text style={{ color: c.white, fontWeight: "700" }}>
                {group.unread > 99 ? "99+" : group.unread}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

export default function PlanGroupChat() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const [focused, setFocused] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  const active = focused && appState === "active";
  const query = usePlanGroupThread(id, active);
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false),
    [settingsBusy, setSettingsBusy] = useState(false);
  const [error, setError] = useState(""),
    [settings, setSettings] = useState(false);
  const [older, setOlder] = useState<{
    messages: GroupMessage[];
    nextBefore: number | null;
  } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pending = useRef<{ text: string; clientId: string } | null>(null);
  const lastMarked = useRef(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const atBottom = useRef(true);
  const insets = useSafeAreaInsets(),
    keyboard = useKeyboardVisible();
  const data = query.data;
  const messages = useMemo(
    () =>
      [
        ...new Map(
          [...(older?.messages ?? []), ...(data?.messages ?? [])].map(
            (message) => [message.sequence, message],
          ),
        ).values(),
      ].sort((a, b) => a.sequence - b.sequence),
    [older, data?.messages],
  );
  useEffect(() => {
    if (!active || !data || data.lastSequence <= lastMarked.current) return;
    const throughSequence = data.lastSequence;
    let cancelled = false;
    void api(`/plan-groups/${id}/read`, {
      method: "POST",
      body: JSON.stringify({ throughSequence }),
    })
      .then(() => {
        if (cancelled) return;
        lastMarked.current = throughSequence;
        client.setQueryData<PlanGroupSummary[]>(["plan-groups"], (groups) =>
          groups?.map((group) =>
            group.id === id
              ? { ...group, unread: 0, lastReadSequence: throughSequence }
              : group,
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, data, id, client]);
  async function send() {
    if (!data?.canSend || !draft.trim() || sending) return;
    const body = draft.trim();
    setSending(true);
    setError("");
    if (pending.current?.text !== body)
      pending.current = {
        text: body,
        clientId: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
      };
    try {
      await api<GroupMessage>(`/plan-groups/${id}/messages`, {
        method: "POST",
        body: JSON.stringify(pending.current),
      });
      setDraft((current) => (current.trim() === body ? "" : current));
      pending.current = null;
      atBottom.current = true;
      await query.refetch();
      void client.invalidateQueries({ queryKey: ["plan-groups"] });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Message not sent. Your draft is saved.",
      );
      void query.refetch();
    } finally {
      setSending(false);
    }
  }
  async function changeMode(messagingMode: GroupMode) {
    if (!data?.isOrganiser || settingsBusy) return;
    setSettingsBusy(true);
    setError("");
    try {
      await api(`/plan-groups/${id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ messagingMode }),
      });
      await query.refetch();
      void client.invalidateQueries({ queryKey: ["plan-groups"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not change permissions.",
      );
    } finally {
      setSettingsBusy(false);
    }
  }
  async function loadOlder() {
    const before = older ? older.nextBefore : data?.nextBefore;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    setError("");
    atBottom.current = false;
    try {
      const page = await api<PlanGroupThread>(
        `/plan-groups/${id}?before=${before}`,
      );
      setOlder((current) => ({
        messages: [...page.messages, ...(current?.messages ?? [])],
        nextBefore: page.nextBefore,
      }));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load earlier messages.",
      );
    } finally {
      setLoadingOlder(false);
    }
  }
  if (!data || query.isError)
    return (
      <Screen>
        <Header title="Plan group" back />
        {query.isPending ? (
          <ActivityIndicator color={c.teal} />
        ) : (
          <Empty
            title="Group chat unavailable"
            description={
              query.error?.message ??
              "Only the organiser and selected attendees can open this chat."
            }
          >
            <Button onPress={() => void query.refetch()}>Try again</Button>
          </Empty>
        )}
      </Screen>
    );
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: c.ivory }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : Platform.OS === "web"
              ? undefined
              : "height"
        }
      >
        <View
          style={{
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            borderBottomWidth: 1,
            borderBottomColor: c.line,
            gap: 6,
          }}
        >
          <IconButton
            icon="arrow-back"
            label="Go back"
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/chat")
            }
          />
          <View style={{ flex: 1 }}>
            <Text style={text.label} numberOfLines={1}>
              {data.title}
            </Text>
            <Text style={text.muted}>
              {data.memberCount} members
              {data.isOrganiser ? " · You are the organiser" : ""}
            </Text>
          </View>
          <IconButton
            icon="people-outline"
            label="Group members and settings"
            onPress={() => setSettings(!settings)}
          />
        </View>
        {settings && (
          <ScrollView
            style={{ maxHeight: 310, backgroundColor: c.white }}
            contentContainerStyle={{ padding: 18, gap: 12 }}
          >
            <Text style={text.label}>Group members</Text>
            {data.members.map((member) => (
              <View
                key={member.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text style={text.body}>{member.name}</Text>
                {member.isOrganiser && (
                  <Text style={{ color: c.teal, fontWeight: "700" }}>
                    Organiser · Admin
                  </Text>
                )}
              </View>
            ))}
            <Text style={text.muted}>
              Selected attendees are added automatically when their plan request
              is accepted.
            </Text>
            {data.isOrganiser && (
              <>
                <Text style={text.label}>Who can send messages?</Text>
                <Button
                  variant={
                    data.messagingMode === "everyone" ? "primary" : "outline"
                  }
                  disabled={settingsBusy || data.messagingMode === "everyone"}
                  onPress={() => void changeMode("everyone")}
                >
                  Everyone can message
                </Button>
                <Button
                  variant={
                    data.messagingMode === "organiser_only"
                      ? "primary"
                      : "outline"
                  }
                  disabled={
                    settingsBusy || data.messagingMode === "organiser_only"
                  }
                  onPress={() => void changeMode("organiser_only")}
                >
                  Only organiser can message
                </Button>
              </>
            )}
            <Button
              variant="outline"
              onPress={() => router.push(`/activity?id=${data.activityId}`)}
            >
              View plan
            </Button>
          </ScrollView>
        )}
        <View
          style={{
            paddingHorizontal: 18,
            paddingVertical: 8,
            backgroundColor: "#E4EFEB",
          }}
        >
          <Text style={{ fontSize: 12, color: c.teal }}>
            {data.messagingMode === "organiser_only"
              ? "Announcements · Only the organiser can send messages"
              : "Group chat · Everyone can send messages"}
          </Text>
        </View>
        <ScrollView
          ref={scroll}
          onScroll={(event) => {
            const e = event.nativeEvent;
            atBottom.current =
              e.contentSize.height -
                e.contentOffset.y -
                e.layoutMeasurement.height <
              100;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atBottom.current)
              scroll.current?.scrollToEnd({ animated: true });
          }}
          contentContainerStyle={{ padding: 18, gap: 12, flexGrow: 1 }}
        >
          {(older ? older.nextBefore : data.nextBefore) != null && (
            <Button
              variant="outline"
              loading={loadingOlder}
              onPress={() => void loadOlder()}
            >
              Load earlier messages
            </Button>
          )}
          {messages.map((message) =>
            message.kind !== "message" ? (
              <Text
                key={message.id}
                style={[
                  text.muted,
                  { textAlign: "center", fontSize: 12, paddingVertical: 6 },
                ]}
              >
                {message.text}
              </Text>
            ) : (
              <View
                key={message.id}
                style={{
                  maxWidth: "88%",
                  alignSelf: message.own ? "flex-end" : "flex-start",
                  gap: 4,
                }}
              >
                <View
                  style={{
                    padding: 14,
                    borderRadius: 18,
                    borderBottomRightRadius: message.own ? 4 : 18,
                    backgroundColor: message.own ? c.coralBright : "#F1E7DE",
                    gap: 6,
                  }}
                >
                  {!message.own && (
                    <Text
                      style={{ color: c.teal, fontWeight: "700", fontSize: 12 }}
                    >
                      {message.sender.name}
                      {message.sender.isOrganiser ? " · Organiser" : ""}
                    </Text>
                  )}
                  <Text
                    style={[
                      text.body,
                      { color: message.own ? c.white : c.charcoal },
                    ]}
                  >
                    {message.text}
                  </Text>
                </View>
                <Text
                  style={[
                    text.muted,
                    {
                      fontSize: 10,
                      alignSelf: message.own ? "flex-end" : "flex-start",
                    },
                  ]}
                >
                  {formatChatTime(message.createdAt)}
                </Text>
              </View>
            ),
          )}
        </ScrollView>
        {!!error && (
          <View style={{ paddingHorizontal: 16 }}>
            <Notice>{error}</Notice>
          </View>
        )}
        <View
          style={{
            padding: 12,
            paddingBottom: keyboard ? 12 : Math.max(insets.bottom, 12),
            borderTopWidth: 1,
            borderTopColor: c.line,
          }}
        >
          {data.canSend ? (
            <View
              style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}
            >
              <TextInput
                accessibilityLabel="Group message"
                placeholder="Message the group…"
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={2000}
                style={{
                  flex: 1,
                  maxHeight: 120,
                  minHeight: 46,
                  backgroundColor: "#F2E9E1",
                  borderRadius: 20,
                  padding: 14,
                  color: c.charcoal,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send group message"
                disabled={!draft.trim() || sending}
                onPress={() => void send()}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: draft.trim() ? c.coralBright : "#DDCFC3",
                }}
              >
                {sending ? (
                  <ActivityIndicator color={c.white} />
                ) : (
                  <Ionicons name="send" size={20} color={c.white} />
                )}
              </Pressable>
            </View>
          ) : (
            <Text style={[text.muted, { textAlign: "center" }]}>
              {data.messagingMode === "organiser_only" && !data.isOrganiser
                ? "Only the organiser can send messages. You can read updates here."
                : "Sending messages is currently restricted."}
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
