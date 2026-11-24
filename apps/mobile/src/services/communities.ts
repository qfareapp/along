import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { io } from "socket.io-client";
import { api, apiBaseUrl, demoMode, getAccessToken } from "./api";
import { useCompletion } from "./onboarding";
export type Community = {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  coverImage?: string;
  rules?: string;
  memberCount: number;
  upcomingEvents: number;
  joined: boolean;
  muted: boolean;
  moderator?: boolean;
  unread?: number;
  lastSequence?: number;
  visibilityKey?: string;
};
export type CommunityMessage = {
  id: string;
  sequence: number;
  text: string;
  deleted: boolean;
  own: boolean;
  pinned: boolean;
  createdAt: string;
  sender: { id: string; name: string; photoId?: string | null };
  reply: { name: string; text: string } | null;
  reactions: { emoji: string; count: number; own: boolean }[];
};
export type CommunityPage<T> = { items: T[]; next: string | null };
export const communityWrite = <T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
) =>
  api<T>(`/communities${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
export function useCommunities(scope = "all", search = "", enabled = true) {
  const completion = useCompletion();
  return useInfiniteQuery({
    queryKey: ["communities", scope, search],
    initialPageParam: "",
    enabled: enabled && !demoMode && !!completion.data?.activated,
    queryFn: ({ pageParam }) =>
      api<CommunityPage<Community>>(
        `/communities?scope=${scope}&q=${encodeURIComponent(search)}${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    staleTime: 15000,
    retry: false,
  });
}
export function useCommunity(id: string) {
  return useQuery({
    queryKey: ["community", id],
    enabled: !!id && !demoMode,
    queryFn: () => api<Community>(`/communities/${id}`),
    retry: false,
    refetchInterval: 10000,
  });
}
export function useCommunityLive(id: string, enabled: boolean) {
  const client = useQueryClient();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    if (!enabled || !focused || !id || !apiBaseUrl) return;
    const socket = io(
      `${apiBaseUrl.replace(/\/api\/v1\/?$/, "")}/communities`,
      {
        autoConnect: false,
        transports: ["websocket"],
        auth: async (callback) => callback({ token: await getAccessToken() }),
      },
    );
    const changed = () => {
      void client.invalidateQueries({ queryKey: ["community", id] });
      void client.invalidateQueries({ queryKey: ["community-messages", id] });
      void client.invalidateQueries({ queryKey: ["community-members", id] });
      void client.invalidateQueries({ queryKey: ["community-notices"] });
    };
    socket.on("connect", () => {
      socket.emit("community:subscribe", { communityId: id });
      changed();
    });
    socket.on("community:changed", changed);
    const retry = setInterval(() => {
      if (!socket.connected && AppState.currentState === "active")
        socket.connect();
    }, 15000);
    socket.on("community:access-revoked", () => {
      client.removeQueries({ queryKey: ["community-messages", id] });
      changed();
      socket.disconnect();
    });
    const connect = () => {
      if (AppState.currentState === "active") socket.connect();
    };
    connect();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        connect();
        changed();
      } else socket.disconnect();
    });
    return () => {
      clearInterval(retry);
      sub.remove();
      socket.disconnect();
    };
  }, [client, enabled, focused, id]);
  return focused;
}
export function useEventGroupLive(id: string, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!id || !enabled || !apiBaseUrl || demoMode) return;
    const socket = io(
      `${apiBaseUrl.replace(/\/api\/v1\/?$/, "")}/communities`,
      {
        transports: ["websocket"],
        auth: async (callback) => callback({ token: await getAccessToken() }),
      },
    );
    const changed = () => {
      void client.invalidateQueries({ queryKey: ["plan-group", id] });
      void client.invalidateQueries({ queryKey: ["plan-groups"] });
    };
    socket.on("connect", () => {
      socket.emit("event:subscribe", { groupId: id });
      changed();
    });
    socket.on("event:changed", changed);
    const retry = setInterval(() => {
      if (!socket.connected) socket.connect();
    }, 15000);
    socket.on("event:access-revoked", () => {
      client.removeQueries({ queryKey: ["plan-group", id] });
      changed();
      socket.disconnect();
    });
    return () => {
      clearInterval(retry);
      socket.disconnect();
    };
  }, [client, enabled, id]);
}
