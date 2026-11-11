import { api } from "./api";
export type MemberCard = {
  id: string;
  name: string;
  age: number;
  identityVerified: boolean;
  occupation: string;
  city: string;
  bio: string;
  vibes: string[];
  photoIds: string[];
  personalityPrompt?: { type?: string; answer?: string } | null;
  action?: "like" | "save";
  mutual?: boolean;
  conversationId?: string | null;
  likedAt?: string | null;
  likedYou?: boolean;
  /** Both people fit each other's age and gender preferences. */
  mutualMatch?: boolean;
  relationshipIntent?: string | null;
  firstPlanIntent?: string | null;
  details?: Record<string, string>;
  memberSince?: string | null;
  plans?: {
    _id: string;
    title: string;
    category: string;
    zone: string;
    startsAt: string;
    type: string;
  }[];
};
export type SwipeAction = "like" | "pass" | "save";
export const actOnProfile = (id: string, action: SwipeAction) =>
  api<{
    action: SwipeAction;
    mutual: boolean;
    conversationId?: string | null;
  }>(`/discovery/${id}/action`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
