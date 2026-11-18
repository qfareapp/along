import { useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import {
  router,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
} from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, apiBaseUrl, demoMode, getAccessToken } from "./api";
import { useCurrentAccount } from "./account";
import { setPushCleanup } from "./pushSession";

const supported =
  Platform.OS === "android" &&
  !demoMode &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
let foreground: { userId?: string; path?: string; id?: string } = {};
let refreshRegistration: (() => void) | undefined;
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data ?? {};
    const sameChat =
      (data.kind === "message" &&
        foreground.path === "/conversation" &&
        foreground.id === data.conversationId) ||
      (data.kind === "group" &&
        foreground.path === "/plan-group" &&
        foreground.id === data.groupId);
    const show =
      !!foreground.userId &&
      data.recipientId === foreground.userId &&
      !sameChat;
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: false,
    };
  },
});

async function installationId() {
  const key = "along.push.installation";
  let id = await AsyncStorage.getItem(key);
  if (!id) {
    id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(key, id);
  }
  return id;
}
async function unregister(id: string) {
  const token = await getAccessToken();
  if (token && apiBaseUrl)
    await fetch(`${apiBaseUrl}/push-devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2500),
    });
}
export async function openPhoneNotificationSettings() {
  if (!supported) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    await Notifications.requestPermissionsAsync();
    refreshRegistration?.();
  } else await Linking.openSettings();
}

export function PushNotifications() {
  const userId = useCurrentAccount().data?.user._id;
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string }>();
  const navigation = useRootNavigationState();
  const response = Notifications.useLastNotificationResponse();
  const client = useQueryClient();
  useEffect(() => {
    foreground = {
      userId,
      path: pathname,
      id: typeof params.id === "string" ? params.id : undefined,
    };
    return () => {
      foreground = {};
    };
  }, [userId, pathname, params.id]);
  useEffect(() => {
    if (!supported || !userId) return;
    let cancelled = false;
    let running = false;
    let disposeCleanup: (() => void) | undefined;
    async function register() {
      if (running || cancelled) return;
      running = true;
      try {
        const id = await installationId();
        // Register cleanup even if permission was revoked while the app was closed.
        disposeCleanup?.();
        disposeCleanup = setPushCleanup(async () => {
          cancelled = true;
          await unregister(id).catch(() => {});
          await Notifications.dismissAllNotificationsAsync().catch(() => {});
        });
        await Notifications.setNotificationChannelAsync("messages", {
          name: "Messages",
          importance: AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 180, 80, 180],
        });
        await Notifications.setNotificationChannelAsync("updates", {
          name: "Along notifications",
          importance: AndroidImportance.DEFAULT,
          sound: "default",
        });
        let permission = await Notifications.getPermissionsAsync();
        const prompted = await AsyncStorage.getItem("along.push.prompted");
        if (
          !permission.granted &&
          permission.status === "undetermined" &&
          !prompted
        ) {
          await AsyncStorage.setItem("along.push.prompted", "true");
          permission = await Notifications.requestPermissionsAsync();
        }
        if (cancelled) return;
        if (!permission.granted) {
          await unregister(id);
          return;
        }
        const projectId =
          Constants.easConfig?.projectId ??
          Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) return;
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        if (cancelled) return;
        await api("/push-devices", {
          method: "PUT",
          body: JSON.stringify({
            installationId: id,
            token: token.data,
            platform: "android",
          }),
        });
        // Logout may have started while registration was in flight.
        if (cancelled) await unregister(id);
      } catch {
        // Offline registration retries on resume and periodically while signed in.
        console.warn(
          "Phone notification registration will retry when connected.",
        );
      } finally {
        running = false;
      }
    }
    const refresh = () => {
      void register();
    };
    refreshRegistration = refresh;
    void register();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void register();
    });
    const tokenListener = Notifications.addPushTokenListener(() => {
      void register();
    });
    const retry = setInterval(() => {
      if (AppState.currentState === "active") void register();
    }, 10 * 60000);
    return () => {
      cancelled = true;
      if (refreshRegistration === refresh) refreshRegistration = undefined;
      clearInterval(retry);
      appState.remove();
      tokenListener.remove();
      disposeCleanup?.();
    };
  }, [userId]);
  useEffect(() => {
    if (!supported) return;
    const listener = Notifications.addNotificationReceivedListener(() => {
      void client.invalidateQueries({
        predicate: (query) =>
          [
            "conversations",
            "conversation",
            "plan-groups",
            "plan-group",
            "activity-notifications",
            "profile-like-notifications",
            "liked-me",
            "social",
            "vibe-checks",
          ].includes(String(query.queryKey[0])),
      });
    });
    return () => listener.remove();
  }, [client]);
  useEffect(() => {
    if (!supported || !response || !userId || !navigation?.key) return;
    const data = response.notification.request.content.data ?? {};
    Notifications.clearLastNotificationResponse();
    if (
      data.recipientId !== userId ||
      response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    )
      return;
    const validId = (value: unknown): value is string =>
      typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
    if (data.kind === "message" && validId(data.conversationId))
      router.push(`/conversation?id=${data.conversationId}`);
    else if (data.kind === "group" && validId(data.groupId))
      router.push(`/plan-group?id=${data.groupId}`);
    else router.push("/notifications");
  }, [response, userId, navigation?.key]);
  return null;
}
