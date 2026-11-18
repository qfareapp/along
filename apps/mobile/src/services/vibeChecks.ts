import { useQuery } from "@tanstack/react-query";
import { api, demoMode } from "./api";
import { useCompletion } from "./onboarding";

export type VibeQuestion = { id: string; prompt: string; options: string[] };
export type OwnVibeQuestion = VibeQuestion & { answer: number };
export type VibeSettings = {
  revision: number; enabled: boolean; autoMatch: boolean;
  threshold: number; questions: OwnVibeQuestion[];
};
export type VibeResult = {
  id: string; revision: number; score: number; matches: number; total: number;
  threshold: number; passed: boolean;
  status: "failed" | "pending" | "matched" | "declined" | "superseded";
  conversationId: string | null;
};
export type VibeInboxItem = VibeResult & {
  incoming: boolean; member: { id: string; name: string };
  readAt: string | null; createdAt: string;
};
export type PublicVibeCheck = {
  owner: { id: string; name: string }; revision: number;
  threshold: number; autoMatch: boolean; questions: VibeQuestion[];
  attempt: VibeResult | null; conversationId: string | null;
};
export type OwnVibeCheck = { presets: VibeQuestion[]; settings: VibeSettings };
export function useVibeInbox(poll = false) {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["vibe-checks", "inbox"],
    queryFn: () => api<VibeInboxItem[]>("/vibe-checks/inbox"),
    enabled: !demoMode && !!completion.data?.activated,
    retry: false,
    refetchInterval: poll ? 20000 : false,
  });
}
export const vibeWrite = <T,>(path: string, body?: unknown, method = "POST") =>
  api<T>(`/vibe-checks${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
