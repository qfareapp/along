import { useQuery } from "@tanstack/react-query";
import { api, demoMode } from "./api";
import { useCompletion } from "./onboarding";
export type GroupMode = "everyone" | "organiser_only";
export type GroupMessage = {
  id: string;
  sequence: number;
  text: string;
  createdAt: string;
  own: boolean;
  kind: "message" | "created" | "joined" | "permissions";
  sender: { id: string; name: string; isOrganiser: boolean };
};
export type PlanGroupSummary = {
  id: string;
  activityId: string;
  title: string;
  messagingMode: GroupMode;
  isOrganiser: boolean;
  canSend: boolean;
  memberCount: number;
  unread: number;
  lastSequence: number;
  lastReadSequence: number;
  updatedAt: string;
  lastMessage: GroupMessage | null;
};
export type PlanGroupThread = PlanGroupSummary & {
  members: { id: string; name: string; isOrganiser: boolean }[];
  messages: GroupMessage[];
  nextBefore: number | null;
};
export function usePlanGroups(poll = false) {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["plan-groups"],
    enabled: !demoMode && !!completion.data?.activated,
    queryFn: () => api<PlanGroupSummary[]>("/plan-groups"),
    retry: false,
    refetchInterval: poll ? 10000 : false,
  });
}
export function usePlanGroupThread(id: string, active: boolean) {
  return useQuery({
    queryKey: ["plan-group", id],
    enabled: !demoMode && !!id && active,
    queryFn: () => api<PlanGroupThread>(`/plan-groups/${id}`),
    retry: false,
    refetchInterval: 4000,
  });
}
