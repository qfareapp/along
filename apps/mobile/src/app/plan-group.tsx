import React from "react";
import { EligibilityGate } from "../features/AlongHome";
import PlanGroupChat from "../features/PlanGroupChat";
import { useLocalSearchParams } from "expo-router";
export default function GroupChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <EligibilityGate>
      <PlanGroupChat key={id} />
    </EligibilityGate>
  );
}
