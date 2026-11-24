import React from "react";
import { useLocalSearchParams } from "expo-router";
import { EligibilityGate } from "../features/AlongHome";
import { CommunityScreen } from "../features/Communities";
export default function Community() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <EligibilityGate>
      <CommunityScreen key={id} />
    </EligibilityGate>
  );
}
