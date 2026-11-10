import React from "react";
import { useLocalSearchParams } from "expo-router";
import CreatePlan from "../features/CreatePlan";
import { EligibilityGate } from "../features/AlongHome";
export default function Create() {
  const { category } = useLocalSearchParams<{ category?: string }>();
  return (
    <EligibilityGate>
      <CreatePlan key={category ?? "default"} />
    </EligibilityGate>
  );
}
