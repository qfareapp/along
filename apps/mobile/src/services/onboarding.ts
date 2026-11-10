import { useQuery } from "@tanstack/react-query";
import { api, demoMode } from "./api";

export const VIBES = [
  {
    id: "coffee_dates",
    label: "Coffee dates",
    icon: "cafe-outline",
    category: "food",
  },
  {
    id: "weekend_exploring",
    label: "Weekend exploring",
    icon: "compass-outline",
    category: "travel",
  },
  {
    id: "fitness_buddies",
    label: "Fitness buddies",
    icon: "barbell-outline",
    category: "fitness",
  },
  {
    id: "movies_shows",
    label: "Movies & shows",
    icon: "film-outline",
    category: "movies",
  },
  {
    id: "commute_together",
    label: "Commute together",
    icon: "car-outline",
    category: "commute",
  },
  {
    id: "live_events",
    label: "Live events",
    icon: "musical-notes-outline",
    category: "events",
  },
  {
    id: "food_adventures",
    label: "Food adventures",
    icon: "restaurant-outline",
    category: "food",
  },
  {
    id: "learn_something",
    label: "Learn something",
    icon: "book-outline",
    category: "learning",
  },
] as const;
export const FIRST_PLANS = [
  {
    id: "do_something",
    label: "Let's do something",
    description: "Coffee, a concert, a walk or a spontaneous plan.",
    icon: "calendar-outline",
  },
  {
    id: "everyday_person",
    label: "Find my everyday person",
    description: "Commutes, gym sessions, routines and shared interests.",
    icon: "navigate-outline",
  },
  {
    id: "just_exploring",
    label: "Just exploring",
    description: "See what's happening without posting anything.",
    icon: "compass-outline",
  },
] as const;
export const RELATIONSHIPS = [
  {
    id: "serious",
    label: "Looking for something serious",
    icon: "heart-outline",
  },
  {
    id: "meaningful",
    label: "Open to something meaningful",
    icon: "sparkles-outline",
  },
  {
    id: "casual",
    label: "Keeping it casual, respectfully",
    icon: "sunny-outline",
  },
  { id: "exploring", label: "Still figuring it out", icon: "compass-outline" },
] as const;
export const GENDERS = [
  { id: "woman", label: "Woman" },
  { id: "man", label: "Man" },
  { id: "nonbinary", label: "Non-binary" },
  { id: "self_described", label: "Self-described" },
] as const;
export const PERSONALITY_PROMPTS = [
  { id: "perfect_sunday", label: "A perfect Sunday looks like..." },
  { id: "get_along", label: "We'd get along if..." },
  { id: "want_to_try", label: "One thing I want to try..." },
] as const;
export const PROFILE_DETAILS = [
  {
    id: "education",
    label: "Education",
    short: "Education",
    icon: "school-outline",
  },
  {
    id: "hobbies",
    label: "Hobbies",
    short: "Hobbies",
    icon: "color-palette-outline",
  },
  {
    id: "fitness",
    label: "Workout time and fitness interests",
    short: "Fitness",
    icon: "barbell-outline",
  },
  {
    id: "food",
    label: "Food preferences",
    short: "Food",
    icon: "restaurant-outline",
  },
  {
    id: "availability",
    label: "Typical availability",
    short: "Availability",
    icon: "time-outline",
  },
  {
    id: "commute",
    label: "Usual travel window (no exact addresses)",
    short: "Commute",
    icon: "car-outline",
  },
  {
    id: "budget",
    label: "Preferred activity budget",
    short: "Budget",
    icon: "wallet-outline",
  },
  {
    id: "travel",
    label: "Travel interests",
    short: "Travel",
    icon: "airplane-outline",
  },
  {
    id: "weekend",
    label: "Weekend routines",
    short: "Weekends",
    icon: "sunny-outline",
  },
  {
    id: "lifestyle",
    label: "Lifestyle preferences",
    short: "Lifestyle",
    icon: "leaf-outline",
  },
] as const;
export type Draft = {
  step: number;
  vibes: string[];
  firstPlanIntent: string | null;
  relationshipIntent: string | null;
  city: string;
  area: string;
  country: string;
  personalityPrompt: { type: string; answer: string } | null;
  photoUri: string | null;
  photoType: string;
  photoIds: string[];
  completed: boolean;
  startedAt: number;
};
export const blankDraft: Draft = {
  step: 1,
  vibes: [],
  firstPlanIntent: null,
  relationshipIntent: null,
  city: "",
  area: "",
  country: "India",
  personalityPrompt: null,
  photoUri: null,
  photoType: "image/jpeg",
  photoIds: [],
  completed: false,
  startedAt: 0,
};
export type Completion = {
  contactVerificationRequired: boolean;
  state: string;
  eligible: boolean;
  activated: boolean;
  checks: Record<string, boolean>;
  missing: string[];
  user: { name: string; emailVerified: boolean; hasBirthDate: boolean };
  profile: {
    city?: string;
    area?: string;
    country?: string;
    gender?: string;
    photos?: string[];
    preferences?: {
      genders?: string[];
      minAge?: number;
      maxAge?: number;
      maxDistanceKm?: number | null;
      distanceUnit?: "km" | "mi";
    };
    approximateLocation?: { type: "Point"; coordinates: [number, number] };
    optionalDetails?: Record<string, string>;
    occupation?: string;
    bio?: string;
    onboarding?: {
      currentStep: number;
      vibes: string[];
      firstPlanIntent: string | null;
      relationshipIntent: string | null;
      quickStartCompleted: boolean;
      personalityPrompt?: Draft["personalityPrompt"];
    };
  };
};
export function useCompletion(enabled = true) {
  return useQuery({
    queryKey: ["profile-completion"],
    enabled: !demoMode && enabled,
    queryFn: () => api<Completion>("/profile/completion"),
    retry: false,
    refetchInterval: 30000,
  });
}
export function draftFromServer(value: Completion): Partial<Draft> {
  const p = value.profile,
    o = p?.onboarding;
  return {
    step: o?.currentStep ?? 1,
    vibes: o?.vibes ?? [],
    firstPlanIntent: o?.firstPlanIntent ?? null,
    relationshipIntent: o?.relationshipIntent ?? null,
    city: p?.city ?? "",
    area: p?.area ?? "",
    country: p?.country ?? "India",
    personalityPrompt: o?.personalityPrompt ?? null,
    photoIds: p?.photos ?? [],
    completed: o?.quickStartCompleted ?? false,
  };
}
export async function saveStep(step: number, d: Draft) {
  const paths = [
    "vibes",
    "first-plan",
    "relationship-intent",
    "location",
    "personality",
  ];
  const bodies = [
    { vibes: d.vibes },
    { firstPlanIntent: d.firstPlanIntent },
    { relationshipIntent: d.relationshipIntent },
    { city: d.city, area: d.area || null, country: d.country },
    { personalityPrompt: d.personalityPrompt },
  ];
  await api(`/onboarding/${paths[step - 1]}`, {
    method: "PATCH",
    body: JSON.stringify(bodies[step - 1]),
  });
}
export async function syncDraft(draft: Draft) {
  await api("/onboarding");
  for (let step = 1; step <= 5; step++) await saveStep(step, draft);
  return api<Completion>("/onboarding/complete-quick-start", {
    method: "POST",
  });
}
export async function restoreOnboarding(draft: Draft) {
  const value = await api<Completion>("/onboarding");
  return draft.completed && !value.checks.quickStart ? syncDraft(draft) : value;
}
