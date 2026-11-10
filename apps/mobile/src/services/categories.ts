import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { api, demoMode } from "./api";
import {
  categories as previewCategories,
  type IconName,
} from "../features/data";
type RemoteCategory = {
  slug: string;
  name: string;
  icon?: string;
  allowedTypes?: string[];
  cities?: string[];
};
type ActivityCategory = {
  id: string;
  name: string;
  label: string;
  icon: IconName;
  allowedTypes?: string[];
  cities?: string[];
};
export function useCategories() {
  const query = useQuery({
    queryKey: ["categories"],
    enabled: !demoMode,
    queryFn: () => api<RemoteCategory[]>("/categories"),
    refetchInterval: 15000,
  });
  const categories: ActivityCategory[] = demoMode
    ? previewCategories
    : (query.data ?? []).map((value) => ({
        id: value.slug,
        name: value.name,
        label: value.name,
        allowedTypes: value.allowedTypes,
        cities: value.cities,
        icon:
          value.icon && value.icon in Ionicons.glyphMap
            ? (value.icon as IconName)
            : ("sparkles-outline" as IconName),
      }));
  return { ...query, categories };
}
