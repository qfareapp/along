import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { api, apiBaseUrl, demoMode, getAccessToken } from "./api";
import { useCompletion } from "./onboarding";

export const playCategoryLabels: Record<string, string> = {
  lifestyle: "Lifestyle & Personality",
  food: "Food & Drinks",
  travel: "Travel & Adventure",
  entertainment: "Entertainment & Hobbies",
  connection: "Relationships & Connection",
};
export type PlayConnection = {
  id: string;
  name: string;
  photoId: string | null;
};
export type PlayDefinition = {
  key: string;
  name: string;
  tagline: string;
  active: boolean;
  totalQuestions: number;
  disclaimer: string;
};
export type PlayInvitation = {
  id: string;
  host: PlayConnection;
  own: boolean;
  caption: string;
  expiresAt: string | null;
  recipientId: string | null;
  status: "open" | "accepted" | "declined" | "expired" | "cancelled";
  sessionId: string | null;
  sessionStatus: string | null;
  requests: {
    id: string;
    userId: string;
    name: string;
    status: "pending" | "accepted" | "declined" | "unavailable";
  }[];
};
export type PlayQuestion = {
  questionId: string;
  category: string;
  text: string;
  optionA: string;
  optionB: string;
};
export type PlayState = {
  id: string;
  game: string;
  invitationId: string;
  conversationId: string;
  status: "waiting" | "playing" | "completed" | "abandoned" | "cancelled";
  currentQuestionIndex: number;
  totalQuestions: number;
  startsAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  players: (PlayConnection & { own: boolean; ready: boolean })[];
  question: PlayQuestion | null;
  ownAnswer: "A" | "B" | null;
  opponentAnswered: boolean;
  result: {
    score: number;
    matchedAnswers: number;
    totalQuestions: number;
    categoryScores: Record<string, number>;
    label: string;
  } | null;
  rounds: (PlayQuestion & {
    questionIndex: number;
    ownChoice: "A" | "B";
    otherChoice: "A" | "B";
    matched: boolean;
  })[];
  comparison: (PlayQuestion & {
    ownChoice: "A" | "B";
    otherChoice: "A" | "B";
  })[];
  disclaimer: string;
};
export type ChatPlayContext = {
  recipientId: string;
  invitations: PlayInvitation[];
  sessions: PlayState[];
};
export function usePlayQuery<T>(
  path: string,
  enabled = true,
  refetchInterval: number | false = 10000,
) {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["play", path],
    queryFn: () => api<T>(`/games${path}`),
    enabled: enabled && !demoMode && !!completion.data?.activated,
    retry: false,
    refetchInterval,
  });
}
export const playWrite = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(`/games${path}`, { method: "POST", body: JSON.stringify(body) });
export function usePlayRoom(id: string) {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  const query = usePlayQuery<PlayState>(
    `/sessions/${id}`,
    !!id,
    connected ? false : 10000,
  );
  const [presence, setPresence] = useState("");
  useEffect(() => {
    if (!apiBaseUrl || !id || demoMode) return;
    const socket = io(`${new URL(apiBaseUrl).origin}/play`, {
      autoConnect: false,
      transports: ["websocket"],
      auth: async (callback) => callback({ token: await getAccessToken() }),
      reconnection: true,
    });
    const update = (state: PlayState) => {
      if (state.id === id) {
        client.setQueryData(["play", `/sessions/${id}`], state);
        client.setQueryData<ChatPlayContext>(
          ["play", `/conversation/${state.conversationId}`],
          (old) =>
            old
              ? {
                  ...old,
                  sessions: old.sessions.map((game) =>
                    game.id === state.id ? state : game,
                  ),
                }
              : old,
        );
        setPresence("");
      }
    };
    socket.on("connect", () => {
      setConnected(true);
      socket.emit(
        "game:join",
        { sessionId: id },
        (reply: { data?: PlayState }) => {
          if (reply.data) update(reply.data);
        },
      );
    });
    socket.on("game:state", update);
    socket.on("game:completed", update);
    socket.on(
      "game:chat_updated",
      ({ conversationId }: { conversationId: string }) => {
        void client.invalidateQueries({
          queryKey: ["conversation", conversationId],
          refetchType: "none",
        });
        void client.invalidateQueries({
          queryKey: ["conversations"],
          refetchType: "none",
        });
      },
    );
    socket.on("game:player_disconnected", () =>
      setPresence("Your match disconnected. Their answers are saved."),
    );
    socket.on("game:error", () => {
      void client.invalidateQueries({ queryKey: ["play", `/sessions/${id}`] });
    });
    socket.on("connect_error", () => setConnected(false));
    socket.on("disconnect", () => setConnected(false));
    socket.connect();
    const retry = setInterval(() => {
      if (!socket.connected) socket.connect();
    }, 10000);
    return () => {
      clearInterval(retry);
      socket.disconnect();
    };
  }, [client, id]);
  return { ...query, connected, presence };
}
