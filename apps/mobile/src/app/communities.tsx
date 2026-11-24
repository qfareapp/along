import React from "react";
import { EligibilityGate } from "../features/AlongHome";
import { CommunitiesScreen } from "../features/Communities";
export default function Communities() {
  return (
    <EligibilityGate>
      <CommunitiesScreen />
    </EligibilityGate>
  );
}
