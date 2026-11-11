import { useQuery } from "@tanstack/react-query";
import { api, demoMode } from "./api";
import { useCompletion } from "./onboarding";

export type ProfileLikeNotification = {
  id: string;
  member: { id: string; name: string };
  createdAt: string;
  readAt: string | null;
};

export function useProfileLikeNotifications() {
  const completion = useCompletion();
  return useQuery({
    queryKey: ["profile-like-notifications"],
    enabled: !demoMode && !!completion.data?.activated,
    queryFn: () =>
      api<ProfileLikeNotification[]>("/discovery/like-notifications"),
    refetchInterval: 10000,
    retry: false,
  });
}
