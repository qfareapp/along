import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Button, Notice, card, text } from "../components/ui";
import { colors as c } from "../theme";
import {
  playWrite,
  usePlayQuery,
  usePlayRoom,
  type ChatPlayContext,
  type PlayState,
} from "../services/play";

function useChatGame(conversationId: string, poll = false) {
  const query = usePlayQuery<ChatPlayContext>(
    `/conversation/${conversationId}`,
    true,
    poll ? 10000 : false,
  );
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(path: string, body = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await playWrite<PlayState | { sessionId?: string }>(
        path,
        body,
      );
      if (path.startsWith("/sessions/") && result && "id" in result) {
        client.setQueryData(["play", `/sessions/${result.id}`], result);
        client.setQueryData<ChatPlayContext>(
          ["play", `/conversation/${conversationId}`],
          (old) =>
            old
              ? {
                  ...old,
                  sessions: old.sessions.map((game) =>
                    game.id === result.id ? result : game,
                  ),
                }
              : old,
        );
      } else {
        await client.invalidateQueries({
          queryKey: ["play", `/conversation/${conversationId}`],
        });
      }
      // The chat already polls every four seconds. Socket chat notices also
      // refresh it; don't refetch the whole app after every choice.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { ...query, busy, error, act };
}

const native = Platform.OS !== "web";
const fun = {
  sunrise: ["#FF9A6B", "#F2557A", "#9B6CF0"] as const,
  optionA: ["#FF9A6B", "#F2557A"] as const,
  optionB: ["#35C2B0", "#17676E"] as const,
  match: ["#3CCB9A", "#1E8C7A"] as const,
  differ: ["#A88BFA", "#6E52E0"] as const,
  sun: "#FFC857",
  pink: "#F2557A",
  violet: "#7C5CF0",
  mint: "#3CCB9A",
};
const CONFETTI = ["#FFC857", "#F2557A", "#35C2B0", "#9B6CF0", "#FF9A6B"];
// Celebrations play once per app run, not every time the chat is reopened.
const celebrated = new Set<string>();

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (r) => live && setReduced(r),
    );
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
/** Springs 0 → 1 whenever `trigger` changes. */
function useAppear(trigger: unknown, reduced: boolean, delay = 0) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return v.setValue(1);
    v.setValue(0);
    const anim = Animated.spring(v, {
      toValue: 1,
      friction: 7,
      tension: 60,
      delay,
      useNativeDriver: native,
    });
    anim.start();
    return () => anim.stop();
  }, [trigger, reduced, delay, v]);
  return v;
}
/** Ping-pongs 0 ↔ 1 forever while active. */
function useLoop(reduced: boolean, duration = 800, active = true) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced || !active) return v.setValue(0);
    const step = (toValue: number) =>
      Animated.timing(v, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: native,
      });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => loop.stop();
  }, [reduced, duration, active, v]);
  return v;
}
const range = (v: Animated.Value, from: number, to: number) =>
  v.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
const rise = (v: Animated.Value) => ({
  opacity: v,
  transform: [{ translateY: range(v, 22, 0) }],
});
const pop = (v: Animated.Value) => ({
  opacity: v,
  transform: [{ scale: range(v, 0.8, 1) }],
});

function Burst({
  run,
  count = 14,
  size = 9,
  distance = 90,
}: {
  run: boolean;
  count?: number;
  size?: number;
  distance?: number;
}) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!run) return;
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [run, v]);
  if (!run) return null;
  return (
    <View pointerEvents="none" style={s.burst}>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const far = distance * (0.75 + (i % 3) * 0.18);
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              width: size,
              height: i % 2 ? size : size * 1.6,
              borderRadius: i % 2 ? size : 2,
              backgroundColor: CONFETTI[i % CONFETTI.length],
              opacity: v.interpolate({
                inputRange: [0, 0.1, 0.75, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                { translateX: range(v, 0, Math.cos(angle) * far) },
                { translateY: range(v, 0, Math.sin(angle) * far) },
                {
                  rotate: v.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", `${(i % 2 ? 1 : -1) * 360}deg`],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

function GameBanner({
  subtitle,
  onClose,
}: {
  subtitle?: string;
  onClose?: () => void;
}) {
  const reduced = useReducedMotion();
  const wobble = useLoop(reduced, 650);
  const twinkle = useLoop(reduced, 1100);
  return (
    <LinearGradient
      colors={fun.sunrise}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.banner}
    >
      <Animated.View
        style={[
          s.bannerIcon,
          {
            transform: [
              {
                rotate: wobble.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["-12deg", "12deg"],
                }),
              },
            ],
          },
        ]}
      >
        <Ionicons name="game-controller" size={22} color={fun.pink} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={s.bannerTitle}>
          This <Text style={s.bannerOr}>or</Text> That
        </Text>
        {!!subtitle && <Text style={s.bannerSub}>{subtitle}</Text>}
      </View>
      <Animated.Text
        style={{
          fontSize: 22,
          opacity: range(twinkle, 0.55, 1),
          transform: [{ scale: range(twinkle, 0.85, 1.15) }],
        }}
      >
        ✨
      </Animated.Text>
      {!!onClose && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close This or That"
          hitSlop={10}
          onPress={onClose}
          style={s.bannerClose}
        >
          <Ionicons name="close" size={18} color={c.white} />
        </Pressable>
      )}
    </LinearGradient>
  );
}

/** Something in the game is waiting on this person. */
function needsYou(data: ChatPlayContext | undefined) {
  return (
    !!data?.invitations.some((i) => i.status === "open" && !i.own) ||
    !!data?.sessions.some((s) => s.status === "playing" && !s.ownAnswer)
  );
}

/** Changes whenever either player does something in this chat's games. */
function activity(data: ChatPlayContext | undefined) {
  if (!data) return undefined;
  const invitations = data.invitations.map((i) => `${i.id}:${i.status}`);
  const sessions = data.sessions.map(
    (s) =>
      `${s.id}:${s.status}:${s.currentQuestionIndex}:${s.opponentAnswered}`,
  );
  return `${invitations.join()}|${sessions.join()}`;
}

export function ChatPlayButton({
  conversationId,
  open,
  onToggle,
}: {
  conversationId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const game = useChatGame(conversationId);
  const reduced = useReducedMotion();
  const alert = needsYou(game.data);
  const wiggle = useLoop(reduced, 500, !open && alert);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? "Close This or That" : "Open This or That"}
      accessibilityHint={alert ? "Your turn in This or That" : undefined}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={{ padding: 6 }}
    >
      <LinearGradient
        colors={open ? fun.optionB : fun.optionA}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.playPill}
      >
        <Animated.View
          style={{
            transform: [
              {
                rotate: wiggle.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["-12deg", "12deg"],
                }),
              },
            ],
          }}
        >
          <Ionicons
            name={open ? "close" : "game-controller"}
            size={18}
            color={c.white}
          />
        </Animated.View>
        <Text style={{ color: c.white, fontWeight: "800", fontSize: 12 }}>
          Play
        </Text>
      </LinearGradient>
      {alert && !open && <View style={s.dot} />}
    </Pressable>
  );
}

function FunButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const [press] = useState(() => new Animated.Value(1));
  const glow = useLoop(reduced, 900, !disabled);
  const to = (toValue: number) =>
    Animated.spring(press, {
      toValue,
      friction: 5,
      tension: 180,
      useNativeDriver: native,
    }).start();
  return (
    <Animated.View
      style={{
        opacity: disabled ? 0.5 : 1,
        transform: [{ scale: Animated.multiply(press, range(glow, 1, 1.025)) }],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPressIn={() => to(0.95)}
        onPressOut={() => to(1)}
        onPress={onPress}
      >
        <LinearGradient
          colors={fun.sunrise}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={s.funButton}
        >
          <Ionicons name={icon} size={20} color={c.white} />
          <Text style={s.funButtonText}>{label}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export function ChatPlay({
  conversationId,
  canSend,
  name,
  open,
  onOpen,
  onClose,
}: {
  conversationId: string;
  canSend: boolean;
  name: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  // Stays mounted while closed so polling keeps the Play button's badge fresh.
  const game = useChatGame(conversationId, true);
  const reduced = useReducedMotion();
  const pending = game.data?.invitations.find((i) => i.status === "open");
  // Game activity (an invitation, an answer, a reveal, the final score) opens
  // the panel by itself, once per change, so closing it isn't undone by the
  // next poll. On arrival it only opens if something is waiting on you.
  const signature = activity(game.data);
  const attention = needsYou(game.data);
  const seen = useRef<string>(undefined);
  useEffect(() => {
    if (signature === undefined || signature === seen.current) return;
    const first = seen.current === undefined;
    seen.current = signature;
    if (!first || attention) onOpen();
  }, [signature, attention, onOpen]);
  const session =
    game.data?.sessions.find((s) =>
      ["playing", "waiting"].includes(s.status),
    ) ?? game.data?.sessions.find((s) => s.status === "completed");
  const live = !!session && session.status !== "completed";
  const enter = useAppear(`${open}:${pending?.id}`, reduced);
  const float = useLoop(reduced, 1200, open && !live);
  if (!open) return null;
  if (!game.data)
    return game.isError ? (
      <Notice>
        {game.error ||
          "Couldn't load the game in this chat. Try reopening the conversation."}
      </Notice>
    ) : (
      <ActivityIndicator style={{ marginTop: 16 }} color={fun.pink} />
    );
  const invite = () =>
    void game.act("/invitations", { recipientId: game.data!.recipientId });
  return (
    <View style={{ marginTop: 16, gap: 12 }}>
      {!!game.error && <Notice>{game.error}</Notice>}
      {pending ? (
        <Animated.View
          style={[card, s.gameCard, rise(enter)]}
          testID="chat-play-invitation"
        >
          <GameBanner
            subtitle={pending.own ? "Invitation sent" : "You're invited!"}
            onClose={onClose}
          />
          <View style={s.cardBody}>
            <Animated.Text
              style={{
                fontSize: 40,
                textAlign: "center",
                transform: [{ translateY: range(float, 0, -8) }],
              }}
            >
              {pending.own ? "💌" : "🎲"}
            </Animated.Text>
            <Text style={[text.body, s.center, { fontWeight: "600" }]}>
              {pending.own
                ? `Invitation sent to ${name}. They can accept whenever they come back.`
                : `${pending.host.name} invited you to play This or That.`}
            </Text>
            <Text style={[text.muted, s.center]}>
              Pick your favourites, one question at a time. You do not need to
              be online together.
            </Text>
            {pending.own ? (
              <Button
                variant="outline"
                disabled={game.busy}
                onPress={() =>
                  void game.act(`/invitations/${pending.id}/cancel`)
                }
              >
                Cancel invitation
              </Button>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <FunButton
                    label="Accept game"
                    icon="sparkles"
                    disabled={game.busy || !canSend}
                    onPress={() =>
                      void game.act(`/invitations/${pending.id}/accept`)
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    variant="outline"
                    disabled={game.busy || !canSend}
                    onPress={() =>
                      void game.act(`/invitations/${pending.id}/decline`)
                    }
                  >
                    Reject game
                  </Button>
                </View>
              </View>
            )}
          </View>
        </Animated.View>
      ) : session ? (
        <ChatGameSession
          key={session.id}
          initial={session}
          canSend={canSend}
          name={name}
          onClose={onClose}
        />
      ) : (
        <Animated.View
          style={[card, s.gameCard, rise(enter)]}
          testID="chat-play-start"
        >
          <GameBanner subtitle="Find out how alike you are" onClose={onClose} />
          <View style={s.cardBody}>
            <Animated.Text
              style={{
                fontSize: 40,
                textAlign: "center",
                transform: [{ translateY: range(float, 0, -8) }],
              }}
            >
              🤔
            </Animated.Text>
            <Text style={[text.body, s.center, { fontWeight: "600" }]}>
              Challenge {name} to This or That
            </Text>
            <Text style={[text.muted, s.center]}>
              You both pick favourites, one question at a time. Answers are
              revealed once you have both chosen, and you get a matching score
              at the end.
            </Text>
            {!canSend && (
              <Text style={[text.muted, s.center]}>
                You can not send invitations in this chat right now.
              </Text>
            )}
          </View>
        </Animated.View>
      )}
      {!pending && !live && canSend && (
        <FunButton
          icon="paper-plane"
          label={session ? "Play again" : "Send play invitation"}
          disabled={game.busy}
          onPress={invite}
        />
      )}
    </View>
  );
}

type Round = PlayState["rounds"][number];
const optionLabel = (
  round: Round | PlayState["question"],
  choice: "A" | "B",
) => (round ? (choice === "A" ? round.optionA : round.optionB) : "");

function Progress({ state }: { state: PlayState }) {
  const reduced = useReducedMotion();
  const blink = useLoop(reduced, 600, state.status === "playing");
  const rounds = new Map(state.rounds.map((r) => [r.questionIndex, r]));
  return (
    <View
      style={s.progress}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: state.totalQuestions }, (_, i) => {
        const round = rounds.get(i);
        const current =
          state.status === "playing" && i === state.currentQuestionIndex;
        return (
          <Animated.View
            key={i}
            style={[
              s.segment,
              {
                backgroundColor: round
                  ? round.matched
                    ? fun.mint
                    : fun.violet
                  : current
                    ? fun.sun
                    : "#EFE3D9",
                opacity: current ? range(blink, 0.5, 1) : 1,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function OptionCard({
  choice,
  label,
  selected,
  dimmed,
  disabled,
  onPress,
}: {
  choice: "A" | "B";
  label: string;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const enter = useAppear(label, reduced, choice === "A" ? 0 : 110);
  const [press] = useState(() => new Animated.Value(1));
  const [chosen] = useState(() => new Animated.Value(selected ? 1 : 0));
  useEffect(() => {
    if (reduced) return chosen.setValue(selected ? 1 : 0);
    Animated.spring(chosen, {
      toValue: selected ? 1 : 0,
      friction: 4,
      tension: 120,
      useNativeDriver: native,
    }).start();
  }, [selected, reduced, chosen]);
  const to = (toValue: number) =>
    Animated.spring(press, {
      toValue,
      friction: 5,
      tension: 200,
      useNativeDriver: native,
    }).start();
  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          { translateX: range(enter, choice === "A" ? -40 : 40, 0) },
          { scale: Animated.multiply(press, range(chosen, 1, 1.04)) },
        ],
      }}
    >
      <Pressable
        testID={`play-option-${choice}`}
        accessibilityRole="button"
        accessibilityLabel={`Choose ${choice}: ${label}`}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPressIn={() => to(0.94)}
        onPressOut={() => to(1)}
        onPress={onPress}
        style={{ opacity: dimmed ? 0.4 : 1 }}
      >
        <LinearGradient
          colors={choice === "A" ? fun.optionA : fun.optionB}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.option, selected && s.optionSelected]}
        >
          <View style={s.optionLetter}>
            <Text
              style={[
                s.optionLetterText,
                { color: choice === "A" ? fun.pink : c.teal },
              ]}
            >
              {choice}
            </Text>
          </View>
          <Text style={s.optionText}>
            {label}
            {selected ? " ✓" : ""}
          </Text>
          <Animated.View
            style={{
              opacity: chosen,
              transform: [{ scale: range(chosen, 0.2, 1) }],
            }}
          >
            <Ionicons name="heart" size={24} color={c.white} />
          </Animated.View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

function VsBadge() {
  const reduced = useReducedMotion();
  const spin = useLoop(reduced, 900);
  return (
    <View style={s.vsRow} pointerEvents="none">
      <Animated.View
        style={[
          s.vs,
          {
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["-10deg", "10deg"],
                }),
              },
              { scale: range(spin, 0.95, 1.08) },
            ],
          },
        ]}
      >
        <Text style={s.vsText}>OR</Text>
      </Animated.View>
    </View>
  );
}

function RoundReveal({
  sessionId,
  round,
  name,
}: {
  sessionId: string;
  round: Round;
  name: string;
}) {
  const reduced = useReducedMotion();
  const enter = useAppear(round.questionIndex, reduced);
  const key = `${sessionId}:${round.questionIndex}`;
  const [fresh] = useState(() => !celebrated.has(key));
  useEffect(() => {
    celebrated.add(key);
  }, [key]);
  const beat = useLoop(reduced, 450, round.matched);
  return (
    <Animated.View style={pop(enter)} testID="chat-play-round-result">
      <LinearGradient
        colors={round.matched ? fun.match : fun.differ}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.reveal}
      >
        <Burst run={fresh && round.matched && !reduced} distance={130} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Animated.View
            style={[
              s.revealIcon,
              { transform: [{ scale: range(beat, 1, 1.18) }] },
            ]}
          >
            <Ionicons
              name={round.matched ? "heart" : "shuffle"}
              size={20}
              color={round.matched ? fun.match[1] : fun.differ[1]}
            />
          </Animated.View>
          <Text style={s.revealTitle}>
            Question {round.questionIndex + 1}:{" "}
            {round.matched ? "It's a match!" : "Different choices!"}
          </Text>
        </View>
        <Text style={s.revealQuestion}>{round.text}</Text>
        <View style={s.chips}>
          <Text style={s.chip}>You: {optionLabel(round, round.ownChoice)}</Text>
          <Text style={s.chip}>
            {name}: {optionLabel(round, round.otherChoice)}
          </Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

function ScoreReveal({ state }: { state: PlayState }) {
  const reduced = useReducedMotion();
  const result = state.result!;
  const key = `${state.id}:score`;
  const [fresh] = useState(() => !celebrated.has(key));
  const [shown, setShown] = useState(fresh && !reduced ? 0 : result.score);
  const enter = useAppear(state.id, reduced);
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    celebrated.add(key);
    if (reduced) return;
    const count = new Animated.Value(fresh ? 0 : result.score);
    const id = count.addListener(({ value }) => setShown(Math.round(value)));
    Animated.timing(count, {
      toValue: result.score,
      duration: 1400,
      delay: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: native,
      }),
    );
    loop.start();
    return () => {
      count.removeListener(id);
      loop.stop();
    };
  }, [key, fresh, reduced, result.score, spin]);
  const emoji = result.score >= 80 ? "🔥" : result.score >= 50 ? "💫" : "🌱";
  const categories = Object.entries(result.categoryScores ?? {});
  return (
    <Animated.View style={[s.score, pop(enter)]} testID="chat-play-score">
      <Text style={s.scoreKicker}>Your matching score</Text>
      <View style={s.ringWrap}>
        <Burst run={fresh && !reduced} count={18} distance={120} size={10} />
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                {
                  rotate: spin.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "360deg"],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={["#FFC857", "#F2557A", "#9B6CF0", "#35C2B0"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.ring}
          />
        </Animated.View>
        <View style={s.ringInner}>
          <Text style={{ fontSize: 22 }}>{emoji}</Text>
          <Text style={s.scoreValue}>{reduced ? result.score : shown}%</Text>
        </View>
      </View>
      {!!result.label && <Text style={s.scoreLabel}>{result.label}</Text>}
      <Text style={[text.body, s.center]}>
        {result.matchedAnswers} of {state.totalQuestions} choices matched
      </Text>
      {categories.length > 0 && (
        <View style={{ alignSelf: "stretch", gap: 8, marginTop: 4 }}>
          {categories.map(([category, value], i) => (
            <CategoryBar
              key={category}
              category={category}
              value={value}
              color={CONFETTI[i % CONFETTI.length]}
              delay={500 + i * 120}
            />
          ))}
        </View>
      )}
      <Text style={[text.muted, s.center]}>{state.disclaimer}</Text>
    </Animated.View>
  );
}

function CategoryBar({
  category,
  value,
  color,
  delay,
}: {
  category: string;
  value: number;
  color: string;
  delay: number;
}) {
  const reduced = useReducedMotion();
  const [fill] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return fill.setValue(value);
    Animated.timing(fill, {
      toValue: value,
      duration: 900,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, delay, reduced, fill]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[text.label, { textTransform: "capitalize" }]}>
          {category}
        </Text>
        <Text style={[text.label, { color }]}>{value}%</Text>
      </View>
      <View style={s.track}>
        <Animated.View
          style={[
            s.fill,
            {
              backgroundColor: color,
              width: fill.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
                extrapolate: "clamp",
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

function ChatGameSession({
  initial,
  canSend,
  name,
  onClose,
}: {
  initial: PlayState;
  canSend: boolean;
  name: string;
  onClose: () => void;
}) {
  const room = usePlayRoom(initial.id);
  const state = room.data ?? initial;
  const actions = useChatGame(initial.conversationId);
  const reduced = useReducedMotion();
  const [history, setHistory] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const last = state.rounds.at(-1);
  const question = state.question;
  const enterQuestion = useAppear(state.currentQuestionIndex, reduced);
  const waiting = useLoop(reduced, 700, !!state.ownAnswer);
  return (
    <View style={[card, s.gameCard]} testID="chat-play-game">
      <GameBanner
        subtitle={
          state.status === "playing"
            ? `${state.rounds.filter((r) => r.matched).length} matches so far`
            : state.status === "completed"
              ? "Game complete!"
              : undefined
        }
        onClose={onClose}
      />
      <View style={s.cardBody}>
        <Progress state={state} />
        {room.isError && (
          <Notice>
            Could not refresh your game. Your saved answers are safe. Reopen the
            chat to retry.
          </Notice>
        )}
        {!!actions.error && <Notice>{actions.error}</Notice>}
        {!!last && (
          <RoundReveal
            key={last.questionIndex}
            sessionId={state.id}
            round={last}
            name={name}
          />
        )}
        {state.status === "playing" && question ? (
          <>
            <Animated.View style={[rise(enterQuestion), { gap: 6 }]}>
              <View style={s.counter}>
                <Text style={s.counterText}>
                  Question {state.currentQuestionIndex + 1} of{" "}
                  {state.totalQuestions}
                </Text>
              </View>
              <Text style={[text.title, { fontSize: 22, textAlign: "center" }]}>
                {question.text}
              </Text>
            </Animated.View>
            <View>
              {(["A", "B"] as const).map((choice, i) => (
                <React.Fragment key={`${state.currentQuestionIndex}-${choice}`}>
                  {i === 1 && <VsBadge />}
                  <OptionCard
                    choice={choice}
                    label={optionLabel(question, choice)}
                    selected={state.ownAnswer === choice}
                    dimmed={!!state.ownAnswer && state.ownAnswer !== choice}
                    disabled={!!state.ownAnswer || actions.busy || !canSend}
                    onPress={() =>
                      void actions.act(`/sessions/${state.id}/answers`, {
                        questionIndex: state.currentQuestionIndex,
                        choice,
                      })
                    }
                  />
                </React.Fragment>
              ))}
            </View>
            <View style={s.status}>
              {(state.ownAnswer || state.opponentAnswered) && (
                <Animated.View
                  style={{
                    opacity: range(waiting, 0.5, 1),
                    transform: [{ scale: range(waiting, 0.9, 1.1) }],
                  }}
                >
                  <Ionicons
                    name={state.ownAnswer ? "hourglass" : "flash"}
                    size={18}
                    color={state.ownAnswer ? fun.violet : fun.pink}
                  />
                </Animated.View>
              )}
              <Text
                accessibilityLiveRegion="polite"
                style={[text.muted, { flex: 1 }]}
              >
                {state.ownAnswer
                  ? `Your choice is saved. ${name} will see a chat notification and can answer later.`
                  : state.opponentAnswered
                    ? `${name} has answered. Choose yours to reveal this round.`
                    : "Choose whenever you like. Both answers are revealed after you both pick."}
              </Text>
            </View>
            {confirmEnd ? (
              <View style={{ gap: 8 }}>
                <Text style={text.body}>End this game for both of you?</Text>
                <Button
                  disabled={actions.busy}
                  onPress={() =>
                    void actions.act(`/sessions/${state.id}/leave`)
                  }
                >
                  End game
                </Button>
                <Button variant="outline" onPress={() => setConfirmEnd(false)}>
                  Keep playing
                </Button>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmEnd(true)}
                style={{ paddingVertical: 6, alignSelf: "center" }}
              >
                <Text style={text.muted}>End this game</Text>
              </Pressable>
            )}
          </>
        ) : state.status === "completed" && state.result ? (
          <ScoreReveal state={state} />
        ) : (
          <Text style={[text.muted, s.center]}>
            This game has ended. Send a new invitation to play again.
          </Text>
        )}
        {!!state.rounds.length && (
          <>
            <Button variant="outline" onPress={() => setHistory(!history)}>
              {history ? "Hide previous answers" : "See previous answers"}
            </Button>
            {history &&
              state.rounds.map((round) => (
                <View
                  key={round.questionIndex}
                  style={[
                    s.historyRow,
                    {
                      borderLeftColor: round.matched ? fun.mint : fun.violet,
                    },
                  ]}
                >
                  <Text style={text.label}>
                    {round.questionIndex + 1}. {round.text}
                  </Text>
                  <Text style={text.muted}>
                    You: {optionLabel(round, round.ownChoice)} · {name}:{" "}
                    {optionLabel(round, round.otherChoice)} ·{" "}
                    {round.matched ? "Match 💚" : "Different 💜"}
                  </Text>
                </View>
              ))}
          </>
        )}
      </View>
    </View>
  );
}

const RING = 156;
const s = StyleSheet.create({
  center: { textAlign: "center" },
  gameCard: { padding: 0, overflow: "hidden" },
  cardBody: { padding: 18, gap: 14 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.white,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: {
    color: c.white,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  bannerOr: { color: fun.sun, fontStyle: "italic" },
  bannerSub: { color: "#FFEFF3", fontSize: 12, fontWeight: "600" },
  bannerClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: fun.sun,
    borderWidth: 2,
    borderColor: c.white,
  },
  playPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  funButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  funButtonText: { color: c.white, fontWeight: "800", fontSize: 15 },
  progress: { flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 8, borderRadius: 4 },
  counter: {
    alignSelf: "center",
    backgroundColor: "#FFF1D6",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  counterText: { color: "#B7791F", fontWeight: "800", fontSize: 12 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 72,
    padding: 16,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: "transparent",
  },
  optionSelected: { borderColor: fun.sun },
  optionLetter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.white,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLetterText: { fontWeight: "900", fontSize: 16 },
  optionText: { flex: 1, color: c.white, fontSize: 17, fontWeight: "800" },
  vsRow: {
    alignItems: "center",
    marginVertical: -12,
    zIndex: 2,
    elevation: 6,
  },
  vs: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: fun.sun,
    borderWidth: 3,
    borderColor: c.white,
    alignItems: "center",
    justifyContent: "center",
  },
  vsText: { color: "#7A4B00", fontWeight: "900", fontSize: 13 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  reveal: { padding: 14, borderRadius: 18, gap: 8, overflow: "hidden" },
  revealIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.white,
    alignItems: "center",
    justifyContent: "center",
  },
  revealTitle: { flex: 1, color: c.white, fontWeight: "900", fontSize: 15 },
  revealQuestion: { color: c.white, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    color: c.white,
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  burst: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  score: { alignItems: "center", gap: 10 },
  scoreKicker: {
    color: fun.pink,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  ringWrap: {
    width: RING,
    height: RING,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 6,
  },
  ring: { width: RING, height: RING, borderRadius: RING / 2 },
  ringInner: {
    position: "absolute",
    width: RING - 22,
    height: RING - 22,
    borderRadius: (RING - 22) / 2,
    backgroundColor: "#FFFDF9",
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: {
    fontSize: 46,
    fontWeight: "900",
    color: c.teal,
    letterSpacing: -1.5,
  },
  scoreLabel: {
    color: fun.violet,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "#F3E8DF",
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 5 },
  historyRow: {
    gap: 4,
    paddingLeft: 10,
    borderLeftWidth: 4,
    borderRadius: 2,
  },
});
