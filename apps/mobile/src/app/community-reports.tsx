import React from "react";
import { EligibilityGate } from "../features/AlongHome";
import { CommunityReports } from "../features/Communities";
export default function Reports() {
  return (
    <EligibilityGate>
      <CommunityReports />
    </EligibilityGate>
  );
}
