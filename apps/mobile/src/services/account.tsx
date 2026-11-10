import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { AppState } from "react-native";
import { api, ApiError, clearSession, demoMode } from "./api";
import { useAlong } from "../store/useAlong";
import type { Completion } from "./onboarding";
export type Account = {
  completion?: Completion;
  user: {
    name: string;
    email?: string;
    emailVerified?: boolean;
    identityVerified: boolean;
    status: string;
    restrictions?: { posting: boolean; messaging: boolean };
    age?: number | null;
    createdAt?: string;
  };
  profile?: Completion["profile"] & {
    interests?: string[];
    preferences?: { maxDistanceKm?: number; intention?: string };
  };
};
export function useCurrentAccount() {
  const welcomed = useAlong((s) => s.welcomed);
  return useQuery({
    queryKey: ["current-account"],
    enabled: !demoMode && welcomed,
    queryFn: () => api<Account>("/users/me"),
    retry: false,
    refetchInterval: 15000,
  });
}
export function AccountSync() {
  const account = useCurrentAccount();
  const client = useQueryClient();
  useEffect(() => {
    if (account.error instanceof ApiError && account.error.status === 401) {
      void clearSession();
      useAlong.getState().update({ welcomed: false });
      client.clear();
      router.replace("/auth?reason=access_changed");
    }
  }, [account.error, client]);
  useEffect(() => {
    if (demoMode) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void client.invalidateQueries();
    });
    return () => subscription.remove();
  }, [client]);
  return null;
}
