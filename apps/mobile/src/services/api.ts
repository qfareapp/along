import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { apiRequest } from "./apiRequest";

export const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE !== "false";
const baseUrl = process.env.EXPO_PUBLIC_API_URL;
export const apiBaseUrl = baseUrl;
let webAccessToken: string | null = null;
let webRefreshToken: string | null = null;
export async function getAccessToken() {
  return Platform.OS === "web"
    ? webAccessToken
    : SecureStore.getItemAsync("along.access");
}
let refreshPending: Promise<boolean> | null = null;
async function refreshAccess() {
  if (!refreshPending)
    refreshPending = (async () => {
      const token =
        Platform.OS === "web"
          ? webRefreshToken
          : await SecureStore.getItemAsync("along.refresh");
      if (!token || !baseUrl) return false;
      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: token }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) return false;
      const { data } = await response.json();
      await storeSession(data.accessToken, data.refreshToken);
      return true;
    })().finally(() => {
      refreshPending = null;
    });
  return refreshPending;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function storeSession(accessToken: string, refreshToken: string) {
  if (Platform.OS === "web") {
    webAccessToken = accessToken;
    webRefreshToken = refreshToken;
    return;
  }
  await SecureStore.setItemAsync("along.access", accessToken);
  await SecureStore.setItemAsync("along.refresh", refreshToken);
}
export async function clearSession() {
  webAccessToken = null;
  webRefreshToken = null;
  if (Platform.OS !== "web")
    await Promise.all([
      SecureStore.deleteItemAsync("along.access"),
      SecureStore.deleteItemAsync("along.refresh"),
    ]);
}
// Image requests need the same session refresh as JSON requests. Keep the
// authenticated bytes local instead of delegating bearer tokens to Image caches.
export async function apiPhoto(
  id: string,
  signal: AbortSignal,
  path?: string,
): Promise<Blob> {
  if (!baseUrl) throw new Error("The API connection is not configured.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 30000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getAccessToken();
      if (!token) throw new ApiError("Please sign in again.", 401);
      const response = await fetch(
        `${baseUrl}${path ?? `/profile/photos/${encodeURIComponent(id)}`}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      if (response.status === 401 && attempt === 0 && (await refreshAccess()))
        continue;
      if (!response.ok)
        throw new ApiError("Photo unavailable. Tap to retry.", response.status);
      if (!response.headers.get("content-type")?.startsWith("image/"))
        throw new Error("The server did not return a photo.");
      return await response.blob();
    }
    throw new ApiError("Please sign in again.", 401);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  if (!baseUrl)
    throw new Error(
      "Set EXPO_PUBLIC_API_URL in apps/mobile/.env to connect the backend.",
    );
  const access = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.body instanceof FormData ? 45000 : 12000,
  );
  try {
    const response = await apiRequest(
      `${baseUrl}${path}`,
      {
        ...options,
        signal: controller.signal,
        headers: {
          ...(options.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
          ...options.headers,
        },
      },
      Platform.OS !== "web",
    );
    if (
      response.status === 401 &&
      access &&
      !retried &&
      !path.startsWith("/auth/") &&
      (await refreshAccess())
    )
      return api<T>(path, options, true);
    if (response.status === 204) return undefined as T;
    const body = await response.json();
    if (!response.ok)
      throw new ApiError(
        body.error?.message ?? "Unable to connect. Please try again.",
        response.status,
      );
    return body.data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The connection timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
