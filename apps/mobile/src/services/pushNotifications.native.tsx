import React from "react";
import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import { demoMode } from "./api";

// Expo Go (opened via QR code) no longer supports remote push on Android and
// warns as soon as expo-notifications is imported, so only load it in real builds.
const enabled =
  Platform.OS === "android" &&
  !demoMode &&
  !isRunningInExpoGo();

type Impl = typeof import("./pushNotificationsAndroid");
const impl: Impl | null = enabled
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("./pushNotificationsAndroid") as Impl)
  : null;

export function PushNotifications() {
  const Component = impl?.PushNotifications;
  return Component ? <Component /> : null;
}

export async function openPhoneNotificationSettings() {
  await impl?.openPhoneNotificationSettings();
}
