import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { api, demoMode } from "./api";
import { useCurrentAccount } from "./account";
import { useAlong } from "../store/useAlong";

export type AirportZone = {
  id: string;
  name: string;
  compatibleWith: string[];
};
export type NearbyAirport = {
  id: string;
  name: string;
  city: string;
  iataCode: string;
  zones: AirportZone[];
  approximate: boolean;
};
export type AirportState = {
  active: boolean;
  session: {
    visitId: string;
    zoneId: string;
    intentions: string[];
    availableUntil: string;
  } | null;
  airport: { name: string; iataCode: string; zones: AirportZone[] } | null;
};
export type AirportConnection = {
  id: string;
  name: string;
  intent: string;
  state: string;
  incoming: boolean;
  needsDecision: boolean;
  kept: boolean;
  otherKept?: boolean;
  conversationId: string | null;
};
export type AirportDecisionNotice = {
  id: string;
  connectionId: string;
  kind: "keep" | "connected" | "ended";
  name: string;
  own: boolean;
  title: string;
  body: string;
  conversationId: string | null;
  presentedAt: string | null;
  readAt: string | null;
  createdAt: string;
};
export function useAirportNotices() {
  const account = useCurrentAccount();
  const welcomed = useAlong((s) => s.welcomed);
  const query = useQuery({
    queryKey: ["airport-notices", account.data?.user._id],
    queryFn: () => api<AirportDecisionNotice[]>("/airports/notices"),
    enabled: !demoMode && welcomed && !!account.data?.completion?.activated,
    retry: false,
    refetchInterval: 10000,
  });
  return { ...query, data: welcomed ? query.data : undefined };
}
export const presentAirportNotice = (id: string) =>
  api<void>(`/airports/notices/${id}/presented`, { method: "POST" });
export function useAirportState() {
  const account = useCurrentAccount();
  const welcomed = useAlong((s) => s.welcomed);
  const query = useQuery({
    queryKey: ["airport-state", account.data?.user._id],
    queryFn: () => api<AirportState>("/airports/me"),
    enabled: !demoMode && welcomed && !!account.data?.completion?.activated,
    retry: false,
    refetchInterval: 30000,
  });
  return { ...query, data: welcomed ? query.data : undefined };
}
export function useAirportConnections() {
  const account = useCurrentAccount();
  const welcomed = useAlong((s) => s.welcomed);
  const query = useQuery({
    queryKey: ["airport-connections", account.data?.user._id],
    queryFn: () => api<AirportConnection[]>("/airports/connections"),
    enabled: !demoMode && welcomed && !!account.data?.completion?.activated,
    retry: false,
    refetchInterval: 15000,
  });
  return { ...query, data: welcomed ? query.data : undefined };
}
export async function airportLocation(requestPermission = false) {
  const permission = requestPermission
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Allow location while using Along to find your airport. You can enable it in your phone settings.",
    );
  const reading = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  if (reading.coords.accuracy == null || reading.coords.accuracy > 150)
    throw new Error(
      "Your location is not accurate enough yet. Move near a window and try again.",
    );
  return {
    latitude: reading.coords.latitude,
    longitude: reading.coords.longitude,
    accuracy: reading.coords.accuracy,
    timestamp: reading.timestamp,
  };
}
export const airportDecision = (
  id: string,
  action: "accept" | "end" | "keep",
) =>
  api<{ conversationId: string | null }>(
    `/airports/connections/${id}/decision`,
    { method: "POST", body: JSON.stringify({ action }) },
  );
