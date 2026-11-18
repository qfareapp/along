import React from "react";
import { useLocalSearchParams } from "expo-router";
import { EligibilityGate } from "../features/AlongHome";
import VibeCheck from "../features/VibeCheck";

export default function VibeCheckRoute() {
  const { id, tab, onboarding } = useLocalSearchParams<{ id?: string; tab?: string; onboarding?: string }>();
  return <EligibilityGate><VibeCheck key={id ?? "mine"} target={id} initialTab={tab} fromOnboarding={onboarding === "true"} /></EligibilityGate>;
}
