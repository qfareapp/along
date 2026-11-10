import { useEffect } from "react";
import { Platform } from "react-native";
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from "expo-screen-capture";

// Protect native screens by default; only an explicit development override disables it.
export default function ScreenProtection() {
  return process.env.EXPO_PUBLIC_SCREEN_CAPTURE_PROTECTION === "false" ? null : (
    <ProtectedScreen />
  );
}

/** Lives above navigation, so route changes never release capture protection. */
function ProtectedScreen() {
  usePreventScreenCapture("along-app");

  useEffect(() => {
    // Android's capture protection also blanks the recent-apps preview.
    if (Platform.OS !== "ios") return;
    void enableAppSwitcherProtectionAsync(1).catch((error) => {
      console.error("Unable to protect the app-switcher preview:", error);
    });
    return () => {
      void disableAppSwitcherProtectionAsync().catch((error) => {
        console.error("Unable to release app-switcher protection:", error);
      });
    };
  }, []);

  return null;
}
