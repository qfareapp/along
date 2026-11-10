import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { blankDraft, type Draft } from "../services/onboarding";
type State = {
  draft: Draft;
  hydrated: boolean;
  patch: (value: Partial<Draft>) => void;
  reset: () => void;
  dismissals: Record<string, number>;
  dismiss: (key: string, forever: boolean) => void;
};
export const useOnboarding = create<State>()(
  persist(
    (set) => ({
      draft: { ...blankDraft },
      hydrated: false,
      dismissals: {},
      patch: (value) => set((s) => ({ draft: { ...s.draft, ...value } })),
      reset: () => set({ draft: { ...blankDraft }, dismissals: {} }),
      dismiss: (key, forever) =>
        set((s) => ({
          dismissals: {
            ...s.dismissals,
            [key]: forever
              ? Number.MAX_SAFE_INTEGER
              : Date.now() + 7 * 86400000,
          },
        })),
    }),
    {
      name: "along-onboarding-v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ draft, dismissals }) => ({ draft, dismissals }),
      onRehydrateStorage: () => () =>
        useOnboarding.setState({ hydrated: true }),
    },
  ),
);
