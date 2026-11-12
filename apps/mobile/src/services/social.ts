import { useQuery } from "@tanstack/react-query";
import { api, demoMode } from "./api";
import { useCompletion } from "./onboarding";
import type { PlanRecord } from "./plans";
export type SocialFeedItem =
  | { kind: "moment"; id: string; moment: Moment }
  | { kind: "plan"; id: string; plan: PlanRecord };
export type Moment = {
  id: string;
  own: boolean;
  canReply?: boolean;
  author: { id: string; name: string; photoId: string | null };
  type: "text" | "photo" | "question" | "along_now";
  text: string;
  caption: string;
  theme: "teal" | "coral" | "peach" | "night";
  category?: string;
  audience?: string;
  allowReshare: boolean;
  publishedAt: string;
  expiresAt: string;
  status: string;
  viewed: boolean;
  reaction: string | null;
  mediaPath: string | null;
};
export type SocialSettings = {
  enabled: boolean;
  audience: "matches" | "discover" | "close_circle" | "only_me";
  closeCircle: string[];
  hidden: string[];
  muted: string[];
  allowReshare: boolean;
  viewReceipts: boolean;
  archive: boolean;
  notifications: boolean;
};
export type SocialNotification = {
  actor: { id: string; name: string };
  id: string;
  kind: string;
  momentId: string | null;
  invitationId: string | null;
  gameInvitationId?: string | null;
  gameSessionId?: string | null;
  readAt: string | null;
  createdAt: string;
};
export type Connection = { id: string; name: string };
export type Invitation = {
  id: string;
  title: string;
  category: string;
  zone: string;
  startsAt: string;
  status: string;
  version: number;
  incoming: boolean;
  member: string;
  activityId: string | null;
};
export function useSocialQuery<T>(path: string, enabled = true) {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["social", ...path.split("?")],
    queryFn: () => api<T>(`/social/${path}`),
    enabled: !demoMode && !!completion.data?.activated && enabled,
    retry: false,
    refetchInterval: /^(tray|notifications|invitations|feed|moments\/)/.test(
      path,
    )
      ? 10000
      : false,
  });
}
export const useMomentTray = (scope: "matches" | "discover" = "matches") =>
  useSocialQuery<Moment[]>(`tray?scope=${scope}`);
export const useSocialNotifications = () =>
  useSocialQuery<SocialNotification[]>("notifications");
export const socialWrite = <T = void>(
  path: string,
  body?: unknown,
  method = "POST",
) =>
  api<T>(`/social/${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
