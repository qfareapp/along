import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initialPlans, type Plan } from "../features/data";

export type ChatMessage = {
  id: string;
  text: string;
  own: boolean;
  time: string;
};
const initialMessages: ChatMessage[] = [
  {
    id: "1",
    text: "Hey! Are you still looking for a coffee partner this week?",
    own: false,
    time: "9:18 AM",
  },
  {
    id: "2",
    text: "Yes! How about Thursday evening at a café in Park Street?",
    own: true,
    time: "9:20 AM",
  },
  {
    id: "3",
    text: "Sounds great! I know a nice place. Shall we meet at 6?",
    own: false,
    time: "9:21 AM",
  },
  {
    id: "4",
    text: "Perfect! See you there. ☕ 🙌",
    own: true,
    time: "9:22 AM",
  },
];
type State = {
  hydrated: boolean;
  welcomed: boolean;
  name: string;
  bio: string;
  photo: string | null;
  preferences: string[];
  plans: Plan[];
  saved: string[];
  interests: string[];
  likes: string[];
  passed: string[];
  blocked: string[];
  matched: boolean;
  messages: ChatMessage[];
  notificationRead: boolean;
  update: (value: Partial<Omit<State, "update">>) => void;
  toggleSaved: (id: string) => void;
  addPlan: (plan: Plan) => void;
  sendMessage: (text: string) => void;
  reset: () => void;
};
const initial = {
  welcomed: false,
  name: "You",
  bio: "Here for shared experiences and meaningful connections.",
  photo: null,
  preferences: [],
  plans: initialPlans,
  saved: [],
  interests: [],
  likes: [],
  passed: [],
  blocked: [],
  matched: false,
  messages: initialMessages,
  notificationRead: false,
};
export const useAlong = create<State>()(
  persist(
    (set) => ({
      ...initial,
      hydrated: false,
      update: (value) => set(value),
      toggleSaved: (id) =>
        set((s) => ({
          saved: s.saved.includes(id)
            ? s.saved.filter((v) => v !== id)
            : [...s.saved, id],
        })),
      addPlan: (plan) => set((s) => ({ plans: [plan, ...s.plans] })),
      sendMessage: (text) =>
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: `${Date.now()}-${Math.random()}`,
              text,
              own: true,
              time: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            },
          ],
        })),
      reset: () => set(initial),
    }),
    {
      name: "along-preview-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated, ...state }) => state,
      onRehydrateStorage: () => (state) => state?.update({ hydrated: true }),
    },
  ),
);
