import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  Empty,
  Field,
  Header,
  Notice,
  Screen,
  card,
  text,
} from "../components/ui";
import { colors as c } from "../theme";
import { MemberPhoto, ProfileAccess } from "./LiveDiscover";
import { demoMode } from "../services/api";
import {
  usePlayQuery,
  usePlayRoom,
  playWrite,
  playCategoryLabels,
  type PlayConnection,
  type PlayDefinition,
  type PlayInvitation,
  type PlayState,
} from "../services/play";
import { sendChatMessage, useThread, useConversations } from "../services/chat";
import DateTimeField from "../components/DateTimeField";
import { localDate, localTime } from "../components/dateTime";

const roomPath = (id: string) => `/play/this-or-that/${id}` as const;
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
function PlayAccess({ children }: { children: React.ReactNode }) {
  return demoMode ? (
    <Screen>
      <Header title="Along Play" back />
      <Empty
        title="Discover your vibe together"
        description="Sign in and make a mutual connection to play This or That."
      >
        <Button onPress={() => router.push("/auth")}>Sign in</Button>
      </Empty>
    </Screen>
  ) : (
    <ProfileAccess title="Along Play">{children}</ProfileAccess>
  );
}
export function PlayTogetherCard() {
  const sessions = usePlayQuery<PlayState[]>("/sessions");
  const invites = usePlayQuery<PlayInvitation[]>("/invitations");
  const now = useNow();
  const active = sessions.data?.find(
    (s) => s.status === "waiting" || s.status === "playing",
  );
  const open =
    invites.data
      ?.filter((i) => i.status === "open" && +new Date(i.expiresAt) > now)
      .slice(0, 3) ?? [];
  return (
    <View style={{ marginTop: 18, gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Along Play. Play Together"
        onPress={() => router.push("/play")}
      >
        <LinearGradient
          colors={[c.teal, "#266F70"]}
          style={{ borderRadius: 24, padding: 20, gap: 9 }}
        >
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Ionicons name="game-controller" size={26} color={c.peach} />
            <Text style={[text.title, { color: c.white, fontSize: 22 }]}>
              Play Together
            </Text>
          </View>
          <Text style={{ color: c.ivory, lineHeight: 21 }}>
            This or That · 2 players · 3–5 minutes
          </Text>
          <Text style={{ color: c.peach }}>
            Two choices. Two people. One vibe.
          </Text>
        </LinearGradient>
      </Pressable>
      {active && (
        <Button icon="play" onPress={() => router.push(roomPath(active.id))}>
          Continue your game with {active.players.find((p) => !p.own)?.name}
        </Button>
      )}
      {open.map((invite) => (
        <PlayInvitationCard key={invite.id} invite={invite} />
      ))}
    </View>
  );
}
function PlayInvitationCard({ invite }: { invite: PlayInvitation }) {
  const client = useQueryClient(),
    now = useNow();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const expired =
    invite.status === "open" && +new Date(invite.expiresAt) <= now;
  async function act(path: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await playWrite<{ sessionId?: string }>(path);
      await client.invalidateQueries({ queryKey: ["play"] });
      await client.invalidateQueries({ queryKey: ["social", "notifications"] });
      if (result?.sessionId) router.push(roomPath(result.sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const closed = expired || invite.status !== "open";
  return (
    <View style={[card, { padding: 18, gap: 12 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <MemberPhoto
          id={invite.host.photoId ?? undefined}
          style={{ width: 42, height: 42, borderRadius: 21 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={text.label}>
            {invite.own
              ? "Your play invitation"
              : `${invite.host.name} wants to play`}
          </Text>
          <Text style={text.muted}>This or That · 2 players · 3–5 minutes</Text>
        </View>
        <Ionicons name="game-controller-outline" size={23} color={c.teal} />
      </View>
      <Text style={text.body}>{invite.caption}</Text>
      <Text style={text.muted}>
        {expired
          ? "Expired"
          : invite.status === "open"
            ? `Open · ${Math.max(1, Math.ceil((+new Date(invite.expiresAt) - now) / 60000))} min left`
            : (invite.sessionStatus ?? invite.status)}
      </Text>
      {!!error && <Notice>{error}</Notice>}
      {invite.sessionId && (
        <Button onPress={() => router.push(roomPath(invite.sessionId!))}>
          Open game
        </Button>
      )}
      {!closed && !invite.own && (
        <Button
          disabled={busy || !!invite.requests.length}
          loading={busy}
          onPress={() => void act(`/invitations/${invite.id}/requests`)}
        >
          {invite.requests[0]?.status === "pending"
            ? "Request pending"
            : invite.requests.length
              ? "Request unavailable"
              : "Request to Play"}
        </Button>
      )}
      {!closed &&
        invite.own &&
        invite.requests
          .filter((r) => r.status === "pending")
          .map((r) => (
            <View key={r.id} style={{ gap: 8 }}>
              <Text style={text.label}>{r.name} wants to play with you</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    disabled={busy}
                    onPress={() => void act(`/requests/${r.id}/accept`)}
                  >
                    Accept
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onPress={() => void act(`/requests/${r.id}/decline`)}
                  >
                    Decline
                  </Button>
                </View>
              </View>
            </View>
          ))}
      {!closed && invite.own && (
        <Button
          variant="outline"
          disabled={busy}
          onPress={() => void act(`/invitations/${invite.id}/cancel`)}
        >
          Cancel invitation
        </Button>
      )}
    </View>
  );
}
export function AlongPlayHome() {
  return (
    <PlayAccess>
      <PlayHub />
    </PlayAccess>
  );
}
function PlayHub() {
  const params = useLocalSearchParams<{
    conversation?: string;
    recipient?: string;
  }>();
  const client = useQueryClient();
  const definitions = usePlayQuery<PlayDefinition[]>("");
  const connections = usePlayQuery<PlayConnection[]>("/connections");
  const invites = usePlayQuery<PlayInvitation[]>("/invitations");
  const history = usePlayQuery<PlayState[]>("/sessions");
  const conversation = usePlayQuery<{
    recipientId: string;
    invitations: PlayInvitation[];
    sessions: PlayState[];
  }>(`/conversation/${params.conversation}`, !!params.conversation);
  const [chosenRecipient, setRecipient] = useState(params.recipient ?? ""),
    [caption, setCaption] = useState("Want to see what we have in common?");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const recipient = params.conversation
    ? (conversation.data?.recipientId ?? "")
    : chosenRecipient;
  const definition = definitions.data?.[0];
  const invitationList = params.conversation
    ? conversation.data?.invitations
    : invites.data;
  const sessions = params.conversation
    ? conversation.data?.sessions
    : history.data;
  async function create() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await playWrite("/invitations", {
        caption,
        ...(recipient ? { recipientId: recipient } : {}),
      });
      await client.invalidateQueries({ queryKey: ["play"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create an invitation.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      width="reading"
      refreshing={invites.isRefetching}
      onRefresh={() => void client.invalidateQueries({ queryKey: ["play"] })}
    >
      <Header
        back
        title="Along Play"
        subtitle="Two choices. Two people. One vibe."
      />
      <LinearGradient
        colors={[c.teal, "#276D70"]}
        style={{ padding: 24, borderRadius: 28, gap: 12 }}
      >
        <Ionicons name="game-controller" size={38} color={c.peach} />
        <Text style={[text.title, { color: c.white }]}>This or That</Text>
        <Text style={{ color: c.ivory, lineHeight: 23 }}>
          {definition?.totalQuestions ?? 15} questions. Five categories.
          Discover shared favourites and delightful differences.
        </Text>
        <Text style={{ color: c.peach }}>
          2 players · 3–5 minutes · No timer
        </Text>
      </LinearGradient>
      {(definitions.isPending || connections.isPending) && (
        <ActivityIndicator color={c.teal} />
      )}
      {definition?.active === false && (
        <Notice>
          This or That is taking a break. Your existing games and results remain
          available.
        </Notice>
      )}
      {(error ||
        definitions.error ||
        connections.error ||
        conversation.error) && (
        <Notice>
          {error ||
            definitions.error?.message ||
            connections.error?.message ||
            conversation.error?.message}
        </Notice>
      )}
      <View style={[card, { padding: 18, marginTop: 18, gap: 12 }]}>
        <Text style={text.title}>Invite someone to play</Text>
        <Text style={text.muted}>
          Private invitations for your mutual connections.
        </Text>
        {!params.conversation && (
          <Chip selected={!recipient} onPress={() => setRecipient("")}>
            My matches
          </Chip>
        )}
        <View style={{ gap: 8 }}>
          {connections.data
            ?.filter(
              (p) =>
                !params.conversation || p.id === conversation.data?.recipientId,
            )
            .map((p) => (
              <Chip
                key={p.id}
                selected={recipient === p.id}
                onPress={() => setRecipient(p.id)}
              >
                {p.name}
              </Chip>
            ))}
        </View>
        <Field
          label="Invitation caption"
          value={caption}
          onChangeText={setCaption}
          maxLength={200}
        />
        <Button
          icon="game-controller"
          disabled={
            busy ||
            !definition?.active ||
            !connections.data?.length ||
            (!!params.conversation && !conversation.data)
          }
          loading={busy}
          onPress={() => void create()}
        >
          Create Play Invitation
        </Button>
        {!connections.isPending && !connections.data?.length && (
          <Text style={text.muted}>
            Your mutual matches will appear here once you connect.
          </Text>
        )}
      </View>
      <Text style={[text.title, { marginTop: 24, marginBottom: 12 }]}>
        Play invitations
      </Text>
      {invites.error && <Notice>{invites.error.message}</Notice>}
      {invitationList?.map((invite) => (
        <View key={invite.id} style={{ marginBottom: 12 }}>
          <PlayInvitationCard invite={invite} />
        </View>
      ))}
      {!invites.isPending && !invitationList?.length && (
        <Text style={text.muted}>
          Invite a match or respond to their invitation here.
        </Text>
      )}
      <Text style={[text.title, { marginTop: 24, marginBottom: 12 }]}>
        Your games
      </Text>
      {history.error && <Notice>{history.error.message}</Notice>}
      {sessions?.map((session) => (
        <Pressable
          key={session.id}
          accessibilityRole="button"
          onPress={() => router.push(roomPath(session.id))}
          style={[card, { padding: 18, marginBottom: 12, gap: 6 }]}
        >
          <Text style={text.label}>
            This or That with {session.players.find((p) => !p.own)?.name}
          </Text>
          <Text style={text.body}>
            {session.status === "completed"
              ? `${session.result?.score}% · ${session.result?.label}`
              : session.status === "abandoned"
                ? "Unfinished · No score"
                : "Continue your game"}
          </Text>
          <Text style={text.muted}>
            {session.completedAt
              ? new Date(session.completedAt).toLocaleDateString()
              : session.status}
          </Text>
        </Pressable>
      ))}
    </Screen>
  );
}
export function ThisOrThatGame({ id }: { id: string }) {
  return (
    <PlayAccess>
      <GameRoom id={id} />
    </PlayAccess>
  );
}
function GameRoom({ id }: { id: string }) {
  const room = usePlayRoom(id),
    client = useQueryClient(),
    now = useNow();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [chat, setChat] = useState(false),
    [compare, setCompare] = useState(false);
  const state = room.data;
  const conversations = useConversations();
  const unread =
    conversations.data?.find(
      (conversation) => conversation.id === state?.conversationId,
    )?.unread ?? 0;
  async function act(
    action: "ready" | "answers" | "leave",
    body: unknown = {},
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await playWrite<PlayState>(
        `/sessions/${id}/${action}`,
        body,
      );
      client.setQueryData(["play", `/sessions/${id}`], result);
      await client.invalidateQueries({ queryKey: ["play", "/sessions"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      void room.refetch();
    } finally {
      setBusy(false);
    }
  }
  function leave() {
    const message =
      "You can use the back button to resume later. End this game for both players?";
    if (Platform.OS === "web") {
      if (window.confirm(message)) void act("leave");
    } else
      Alert.alert("End this game?", message, [
        { text: "Keep playing", style: "cancel" },
        {
          text: "End game",
          style: "destructive",
          onPress: () => void act("leave"),
        },
      ]);
  }
  async function rematch() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await playWrite(`/sessions/${id}/rematch`);
      await client.invalidateQueries({ queryKey: ["play"] });
      router.push("/play");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (room.error)
    return (
      <Screen>
        <Header back title="This or That" />
        <Empty title="Game unavailable" description={room.error.message}>
          <Button onPress={() => void room.refetch()}>Try again</Button>
        </Empty>
      </Screen>
    );
  if (!state)
    return (
      <Screen>
        <Header back title="This or That" />
        <ActivityIndicator color={c.teal} />
      </Screen>
    );
  const mine = state.players.find((p) => p.own),
    other = state.players.find((p) => !p.own);
  const countdown = state.startsAt
    ? Math.max(0, Math.ceil((+new Date(state.startsAt) - now) / 1000))
    : 0;
  const isActive = state.status === "waiting" || state.status === "playing";
  return (
    <Screen
      key={state.status === "completed" ? "results" : "game"}
      width="reading"
    >
      <Header
        back
        title={
          state.status === "completed" ? "Your Vibe Match!" : "This or That"
        }
        subtitle={
          isActive
            ? `${state.totalQuestions} questions · Two people, one vibe`
            : "Your shared little discoveries"
        }
        right={
          isActive ? (
            <Pressable accessibilityRole="button" onPress={leave}>
              <Text style={{ color: c.coralBright }}>End game</Text>
            </Pressable>
          ) : undefined
        }
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          marginVertical: 20,
          minHeight: 110,
          flexShrink: 0,
        }}
      >
        {state.players.map((player) => (
          <View
            key={player.id}
            style={{ alignItems: "center", gap: 7, flex: 1 }}
          >
            <MemberPhoto
              id={player.photoId ?? undefined}
              style={{ width: 76, height: 76, borderRadius: 38 }}
            />
            <Text style={text.label}>{player.own ? "You" : player.name}</Text>
            {state.status === "waiting" && (
              <Text style={text.muted}>
                {player.ready ? "Ready" : "Getting ready"}
              </Text>
            )}
          </View>
        ))}
      </View>
      {!!error && <Notice>{error}</Notice>}
      {isActive && !room.connected && (
        <Text style={text.muted}>
          Reconnecting live updates. Your answers are saved.
        </Text>
      )}
      {isActive && !!room.presence && (
        <Text style={text.muted}>{room.presence}</Text>
      )}
      {state.status === "waiting" && (
        <View style={[card, { padding: 24, gap: 16 }]}>
          <Text style={text.title}>Discover your vibe together</Text>
          <Text style={text.body}>
            {state.totalQuestions} questions across five categories. Your
            choices stay hidden until the final reveal. Take your time.
          </Text>
          <Button
            disabled={busy || mine?.ready}
            onPress={() => void act("ready")}
          >
            {mine?.ready
              ? "Waiting for your match to get ready…"
              : "Ready to play"}
          </Button>
        </View>
      )}
      {state.status === "playing" && countdown > 0 && (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={text.title}>Here we go!</Text>
          <Text
            accessibilityLiveRegion="polite"
            style={{ fontSize: 80, fontWeight: "800", color: c.coralBright }}
          >
            {countdown}
          </Text>
        </View>
      )}
      {state.status === "playing" && !countdown && state.question && (
        <View style={{ gap: 18 }}>
          <Text style={text.muted}>
            Question {state.currentQuestionIndex + 1} of {state.totalQuestions}{" "}
            · {playCategoryLabels[state.question.category]}
          </Text>
          <View
            style={{ backgroundColor: c.peach, height: 7, borderRadius: 4 }}
          >
            <View
              style={{
                height: 7,
                borderRadius: 4,
                backgroundColor: c.teal,
                width: `${(state.currentQuestionIndex / state.totalQuestions) * 100}%`,
              }}
            />
          </View>
          <Text
            accessibilityRole="header"
            style={[text.title, { fontSize: 29, marginVertical: 12 }]}
          >
            {state.question.text}
          </Text>
          {(["A", "B"] as const).map((choice) => (
            <Pressable
              key={`${state.currentQuestionIndex}-${choice}`}
              testID={`play-option-${choice}`}
              accessibilityRole="button"
              accessibilityState={{
                selected: state.ownAnswer === choice,
                disabled: busy || !!state.ownAnswer,
              }}
              disabled={busy || !!state.ownAnswer}
              onPress={() =>
                void act("answers", {
                  questionIndex: state.currentQuestionIndex,
                  choice,
                })
              }
              style={({ pressed }) => [
                {
                  borderRadius: 24,
                  borderWidth: 2,
                  borderColor:
                    state.ownAnswer === choice ? c.coralBright : c.teal,
                  padding: 26,
                  minHeight: 100,
                  justifyContent: "center",
                  backgroundColor:
                    state.ownAnswer === choice ? "#FCE0D7" : c.white,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[text.label, { color: c.teal, fontSize: 20 }]}>
                {choice === "A"
                  ? state.question!.optionA
                  : state.question!.optionB}
              </Text>
              {state.ownAnswer === choice && (
                <Text style={text.muted}>Locked in ✓</Text>
              )}
            </Pressable>
          ))}
          <Text accessibilityLiveRegion="polite" style={text.muted}>
            {busy
              ? "Saving your choice…"
              : state.ownAnswer
                ? "Waiting for your match…"
                : state.opponentAnswered
                  ? `${other?.name} has answered. Your choice stays private.`
                  : "Choose what feels most like you."}
          </Text>
        </View>
      )}
      {state.status === "completed" && state.result && (
        <View style={{ gap: 20 }}>
          <View style={{ alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 180,
                height: 180,
                borderRadius: 90,
                borderWidth: 10,
                borderColor: c.coralBright,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 46, fontWeight: "800", color: c.teal }}>
                {state.result.score}%
              </Text>
              <Text style={text.label}>Vibe Match</Text>
            </View>
            <Text style={text.title}>{state.result.label}</Text>
            <Text style={text.body}>
              You agreed on {state.result.matchedAnswers} out of{" "}
              {state.result.totalQuestions} choices.
            </Text>
          </View>
          <Text style={text.muted}>{state.disclaimer}</Text>
          {Object.entries(state.result.categoryScores).map(
            ([category, value]) => (
              <View key={category} style={{ gap: 7 }}>
                <Text style={text.label}>
                  {playCategoryLabels[category]} · {value}%
                </Text>
                <View
                  style={{
                    height: 8,
                    backgroundColor: c.peach,
                    borderRadius: 4,
                  }}
                >
                  <View
                    style={{
                      height: 8,
                      backgroundColor: c.teal,
                      borderRadius: 4,
                      width: `${value}%`,
                    }}
                  />
                </View>
              </View>
            ),
          )}
          <Button
            variant="coral"
            icon="calendar"
            onPress={() => router.push(`/play/plan?sessionId=${id}`)}
          >
            Make a Plan Together
          </Button>
          <Button
            icon="chatbubbles"
            onPress={() =>
              router.push(`/conversation?id=${state.conversationId}`)
            }
          >
            Chat About It
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => void rematch()}
          >
            Play Again
          </Button>
          <Button variant="outline" onPress={() => setCompare(!compare)}>
            {compare ? "Hide choices" : "Compare our choices"}
          </Button>
          {compare &&
            state.comparison.map((question) => (
              <View
                key={question.questionId}
                style={[card, { padding: 18, gap: 8 }]}
              >
                <Text style={text.label}>{question.text}</Text>
                <Text style={text.body}>
                  {question.ownChoice === question.otherChoice
                    ? `You both chose ${question.ownChoice === "A" ? question.optionA : question.optionB}.`
                    : `You chose ${question.ownChoice === "A" ? question.optionA : question.optionB}. ${other?.name} chose ${question.otherChoice === "A" ? question.optionA : question.optionB}.`}
                </Text>
              </View>
            ))}
          <Button
            variant="outline"
            onPress={() => router.replace("/(tabs)/social")}
          >
            Back to Social
          </Button>
        </View>
      )}
      {(state.status === "abandoned" || state.status === "cancelled") && (
        <Empty
          title="This round is unfinished"
          description="There is no score for an unfinished game. You can invite your match to start a fresh round."
        >
          <Button disabled={busy} onPress={() => void rematch()}>
            Invite for another round
          </Button>
        </Empty>
      )}
      {isActive && (
        <View style={{ marginTop: 24 }}>
          <Button
            variant="outline"
            icon="chatbubble-ellipses-outline"
            onPress={() => setChat(!chat)}
          >
            {chat
              ? "Close game chat"
              : `Chat with your match${unread ? ` · ${unread} new` : ""}`}
          </Button>
          {chat && <GameChat id={state.conversationId} />}
        </View>
      )}
    </Screen>
  );
}
function GameChat({ id }: { id: string }) {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const thread = useThread(id),
    client = useQueryClient();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send() {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendChatMessage(id, message.trim());
      setMessage("");
      await client.invalidateQueries({ queryKey: ["conversation", id] });
      await client.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[card, { padding: 16, marginTop: 12, gap: 10 }]}>
      <Text style={text.label}>Your private conversation</Text>
      {thread.error && <Notice>{thread.error.message}</Notice>}
      {!!error && <Notice>{error}</Notice>}
      <ScrollView
        ref={scroll}
        style={{ maxHeight: 260 }}
        nestedScrollEnabled
        onContentSizeChange={() =>
          scroll.current?.scrollToEnd({ animated: true })
        }
      >
        {!thread.error &&
          thread.data?.messages.slice(-30).map((m) => (
            <View
              key={m.id}
              style={{
                padding: 10,
                borderRadius: 12,
                backgroundColor: m.own ? "#DCEDE7" : "#FAE8D8",
              }}
            >
              <Text style={text.muted}>
                {m.own ? "You" : thread.data?.member.name}
              </Text>
              <Text style={text.body}>
                {m.text || (m.attachment ? "Shared an attachment" : "")}
              </Text>
            </View>
          ))}
      </ScrollView>
      <Field
        label="Message"
        value={message}
        onChangeText={setMessage}
        maxLength={2000}
      />
      <Button
        disabled={
          busy || !message.trim() || !thread.data?.canSend || !!thread.error
        }
        onPress={() => void send()}
      >
        Send
      </Button>
    </View>
  );
}
export function PlayMakePlan() {
  return (
    <PlayAccess>
      <GamePlanForm />
    </PlayAccess>
  );
}
function GamePlanForm() {
  const { sessionId = "" } = useLocalSearchParams<{ sessionId: string }>();
  const suggestions = usePlayQuery<
    { category: string; name: string; title: string }[]
  >(`/sessions/${sessionId}/plan-suggestions`, !!sessionId);
  if (suggestions.error)
    return (
      <Screen>
        <Header back title="Make a Plan Together" />
        <Notice>{suggestions.error.message}</Notice>
      </Screen>
    );
  if (!suggestions.data)
    return (
      <Screen>
        <Header back title="Make a Plan Together" />
        <ActivityIndicator color={c.teal} />
      </Screen>
    );
  return (
    <GamePlanFields
      key={sessionId}
      sessionId={sessionId}
      suggestions={suggestions.data}
    />
  );
}
function GamePlanFields({
  sessionId,
  suggestions,
}: {
  sessionId: string;
  suggestions: { category: string; name: string; title: string }[];
}) {
  const client = useQueryClient();
  const [category, setCategory] = useState(suggestions[0]?.category ?? ""),
    [title, setTitle] = useState(suggestions[0]?.title ?? ""),
    [zone, setZone] = useState("");
  const [date, setDate] = useState(() =>
      localDate(new Date(Date.now() + 86400000)),
    ),
    [time, setTime] = useState(() =>
      localTime(new Date(Date.now() + 86400000)),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function propose() {
    setBusy(true);
    setError("");
    try {
      const startsAt = new Date(`${date}T${time}`);
      if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date())
        throw new Error("Choose a future date and time.");
      await playWrite(`/sessions/${sessionId}/make-plan`, {
        title,
        category,
        zone,
        startsAt: startsAt.toISOString(),
      });
      await client.invalidateQueries({ queryKey: ["social"] });
      router.replace("/social-invitations");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not propose this plan.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen width="reading">
      <Header
        back
        title="Make a Plan Together"
        subtitle="Turn your conversation into a private plan."
      />
      <Text style={text.body}>
        Your match must accept before the plan is confirmed.
      </Text>
      {!!error && <Notice>{error}</Notice>}
      <View style={{ gap: 12, marginTop: 20 }}>
        {suggestions.map((suggestion) => (
          <Chip
            key={suggestion.category}
            selected={category === suggestion.category}
            onPress={() => {
              setCategory(suggestion.category);
              setTitle(suggestion.title);
            }}
          >
            {suggestion.name}
          </Chip>
        ))}
        <Field
          label="Plan title"
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />
        <Field
          label="Meeting place"
          value={zone}
          onChangeText={setZone}
          maxLength={100}
        />
        <DateTimeField
          label="Date"
          mode="date"
          value={date}
          onChange={setDate}
          minimumDate={localDate()}
        />
        <DateTimeField
          label="Time"
          mode="time"
          value={time}
          onChange={setTime}
        />
        <Button
          disabled={busy || !category || !title.trim() || !zone.trim()}
          loading={busy}
          onPress={() => void propose()}
        >
          Send private plan invitation
        </Button>
      </View>
    </Screen>
  );
}
