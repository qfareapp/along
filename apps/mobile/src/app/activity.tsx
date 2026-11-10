import React from "react";
import ActivityDetail from "../features/ActivityDetail";
import { EligibilityGate } from "../features/AlongHome";
export default function Activity() {
  return (
    <EligibilityGate>
      <ActivityDetail />
    </EligibilityGate>
  );
}
