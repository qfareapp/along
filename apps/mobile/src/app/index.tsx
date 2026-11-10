import React from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAlong } from "../store/useAlong";
import Welcome from "../features/Welcome";
import { demoMode } from "../services/api";
import { useCompletion } from "../services/onboarding";
export default function Index() {
  const { hydrated, welcomed } = useAlong();
  const progress = useCompletion(hydrated && welcomed);
  if (!hydrated || (welcomed && !demoMode && progress.isPending))
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#174F54" />
      </View>
    );
  if (
    welcomed &&
    !demoMode &&
    progress.data?.state === "quick_start_incomplete"
  )
    return <Redirect href="/onboarding" />;
  return welcomed ? <Redirect href="/(tabs)" /> : <Welcome />;
}
