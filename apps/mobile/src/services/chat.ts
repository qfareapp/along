import { compressPhoto } from "./compressPhoto";
import { useQuery } from "@tanstack/react-query";
import { Platform } from "react-native";
import { api, apiBaseUrl, demoMode } from "./api";
import { useCompletion } from "./onboarding";

export type ChatMember = {
  id: string;
  name: string;
  identityVerified: boolean;
  photoId: string | null;
};
export type ChatAttachment = {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  path: string;
};
export type ChatMessage = {
  socialMomentId?: string | null;
  attachment?: ChatAttachment | null;
  id: string;
  text: string;
  own: boolean;
  createdAt: string;
  readAt: string | null;
};
export type ConversationSummary = {
  activityConnection?: boolean;
  id: string;
  matchedAt: string;
  member: ChatMember;
  lastMessage: ChatMessage | null;
  unread: number;
};
export type ConversationThread = {
  activityConnection?: boolean;
  id: string;
  matchedAt: string;
  canSend: boolean;
  waitingForOwner?: boolean;
  member: ChatMember;
  messages: ChatMessage[];
};
export function useConversations() {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["conversations"],
    enabled: !demoMode && !!completion.data?.activated,
    queryFn: () => api<ConversationSummary[]>("/conversations"),
    retry: false,
    refetchInterval: 10000,
  });
}
export function useUnreadCount() {
  const { data } = useConversations();
  return data?.reduce((sum, c) => sum + c.unread, 0) ?? 0;
}
export function useThread(id?: string) {
  return useQuery({
    queryKey: ["conversation", id],
    enabled: !demoMode && !!id,
    queryFn: () => api<ConversationThread>(`/conversations/${id}`),
    retry: false,
    refetchInterval: 4000,
  });
}
export const sendChatMessage = (id: string, text: string) =>
  api<ChatMessage>(`/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
export type OutgoingAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  kind: "image" | "file";
  file?: Blob;
};
export async function sendChatAttachment(
  id: string,
  attachment: OutgoingAttachment,
  text: string,
) {
  if (attachment.kind === "image" || attachment.mimeType.startsWith("image/")) {
    const photo = await compressPhoto(attachment.uri);
    attachment = {
      ...attachment,
      ...photo,
      kind: "image",
      name: attachment.name.replace(/\.[^.]+$/, "") + ".jpg",
      file: undefined,
    };
  }
  const form = new FormData();
  if (text.trim()) form.append("text", text.trim());
  if (Platform.OS === "web")
    form.append(
      "file",
      attachment.file ?? (await (await fetch(attachment.uri)).blob()),
      attachment.name,
    );
  else
    form.append("file", {
      uri: attachment.uri,
      name: attachment.name,
      type: attachment.mimeType,
    } as unknown as Blob);
  return api<ChatMessage>(`/conversations/${id}/attachments`, {
    method: "POST",
    body: form,
  });
}
/** A short-lived download URL, so files open without sharing the session token. */
export async function attachmentUrl(conversationId: string, messageId: string) {
  const { path } = await api<{ path: string }>(
    `/conversations/${conversationId}/messages/${messageId}/attachment-link`,
    { method: "POST" },
  );
  return `${apiBaseUrl}${path}`;
}
export const attachmentLabel = (message: ChatMessage) =>
  message.text ||
  (message.attachment?.kind === "image"
    ? "📷 Photo"
    : message.attachment
      ? `📎 ${message.attachment.name}`
      : "");
export const formatFileSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
export const unmatch = (id: string) =>
  api(`/conversations/${id}/unmatch`, { method: "POST" });
export const formatChatTime = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
