import { create } from "zustand";
import type { ImageSourcePropType } from "react-native";

export type CelebratedMatch = {
  name: string;
  /** Live member photo id. */
  photoId?: string | null;
  /** Bundled preview image. */
  image?: ImageSourcePropType;
  /** Live conversation to open; preview matches open the local demo chat. */
  conversationId?: string | null;
};
export const useMatchCelebration = create<{
  match: CelebratedMatch | null;
  show: (match: CelebratedMatch) => void;
  hide: () => void;
}>()((set) => ({
  match: null,
  show: (match) => set({ match }),
  hide: () => set({ match: null }),
}));
