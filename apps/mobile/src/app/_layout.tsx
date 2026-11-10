import React, { useEffect, useState } from "react";
import { AccessibilityInfo, View, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "../theme";
import { AccountSync } from "../services/account";
import { MatchCelebration } from "../components/MatchCelebration";
import { APP_MAX_WIDTH } from "../components/layout";
import ScreenProtection from "../components/ScreenProtection";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});
export default function RootLayout() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => sub.remove();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ScreenProtection />
        <AccountSync />
        <StatusBar style="dark" />
        <View
          style={{
            flex: 1,
            backgroundColor: colors.ivory,
            alignItems: "center",
          }}
        >
          <View testID="app-shell" style={styles.app}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.ivory },
                animation: reducedMotion ? "none" : "slide_from_right",
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="match"
                options={{
                  presentation: "modal",
                  animation: "fade_from_bottom",
                }}
              />
            </Stack>
            <MatchCelebration />
          </View>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
const styles = StyleSheet.create({
  app: {
    flex: 1,
    width: "100%",
    maxWidth: APP_MAX_WIDTH,
    backgroundColor: colors.ivory,
  },
});
