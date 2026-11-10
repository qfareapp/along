import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, demoMode } from "./api";
import { useCompletion } from "./onboarding";
import { useAlong } from "../store/useAlong";
export type PlanCategory = {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  coverAssetKey?: string;
  coverImageUrl?: string;
  liveCount: number;
  ownPastCount?: number;
  ownManagedCount?: number;
};
export type PlanRecord = {
  audience?: PlanAudience | null;
  privatePlan?: boolean;
  _id: string;
  title: string;
  category: string;
  zone: string;
  highlight: string;
  description?: string;
  startsAt: string;
  endsAt: string | null;
  schedule?: import("../features/PlanSchedule").PlanSchedule | null;
  recurring?: boolean;
  budget?: string;
  categoryDetails?: import("../../../../packages/plan-details/index.js").PlanDetails;
  type: "need" | "offer" | "together";
  activityType: "one_on_one" | "group";
  capacity: number | null;
  placesLeft: number | null;
  availability: "open" | "full";
  expired?: boolean;
  ownerState?: "live" | "paused" | "successful" | "closed" | "expired";
  publicationStatus?: "active" | "paused";
  saved: boolean;
  interested: boolean;
  interestStatus: "pending" | "accepted" | "declined" | null;
  conversationId: string | null;
  isOwner: boolean;
  creator: {
    _id: string;
    name: string;
    age: number | null;
    identityVerified: boolean;
    photoId: string | null;
    occupation?: string;
  };
};
export type PlanAudience = {
  minAge: number;
  maxAge: number;
  gender: "male" | "female" | "both";
  maxDistanceKm: number | null;
  distanceUnit: "km" | "mi";
};
type PlanPage = {
  items: PlanRecord[];
  total: number;
  nextOffset: number | null;
};
export function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}
export function usePlanCategories(q = "") {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["plan-categories", q],
    enabled: !demoMode && !!completion.data?.activated,
    queryFn: () =>
      api<PlanCategory[]>(`/activities/categories?q=${encodeURIComponent(q)}`),
    refetchInterval: 15000,
  });
}
export function usePlanFeed(filters: Record<string, string>, enabled = true) {
  const completion = useCompletion();
  return useInfiniteQuery({
    queryKey: ["plans", filters],
    enabled: !demoMode && !!completion.data?.activated && enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<PlanPage>(
        `/activities/browse?${new URLSearchParams({
          ...filters,
          timezoneOffset: String(new Date().getTimezoneOffset()),
          offset: String(pageParam),
        })}`,
      ),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    refetchInterval: 15000,
  });
}
export type ExpiringPlan = Pick<
  PlanRecord,
  "_id" | "title" | "category" | "startsAt" | "endsAt" | "schedule"
>;
/** The member's own plans whose dates have passed and still need a decision. */
export function useExpiringPlans() {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["activities", "expiring"],
    enabled: !demoMode && !!completion.data?.activated,
    queryFn: () => api<ExpiringPlan[]>("/activities/expiring"),
  });
}
export function useRefreshPlans() {
  const client = useQueryClient();
  return async () => {
    await Promise.all(
      [
        "plans",
        "plan-categories",
        "activities",
        "activity",
        "activity-notifications",
        "conversations",
        "social",
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
  };
}
export function useSavePlan() {
  const refresh = useRefreshPlans();
  return async (plan: PlanRecord) => {
    await api(`/activities/${plan._id}/save`, {
      method: plan.saved ? "DELETE" : "POST",
    });
    await refresh();
  };
}
// Preserve live bookmarks saved by older app versions on this device.
export function useLegacyPlanSaves() {
  const saved = useAlong((s) => s.saved);
  const completion = useCompletion();
  const client = useQueryClient();
  const activated = !!completion.data?.activated;
  useEffect(() => {
    if (demoMode || !activated) return;
    const ids = saved.filter((id) => /^[a-f0-9]{24}$/i.test(id));
    if (!ids.length) return;
    let cancelled = false;
    void Promise.allSettled(
      ids.map((id) => api(`/activities/${id}/save`, { method: "POST" })),
    ).then((results) => {
      if (cancelled) return;
      const migrated = new Set(
        ids.filter((_, index) => results[index].status === "fulfilled"),
      );
      if (!migrated.size) return;
      useAlong.getState().update({
        saved: useAlong.getState().saved.filter((id) => !migrated.has(id)),
      });
      void client.invalidateQueries({ queryKey: ["plans"] });
    });
    return () => {
      cancelled = true;
    };
  }, [activated, saved, client]);
}
