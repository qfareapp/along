import React from "react";
import { EligibilityGate } from "../features/AlongHome";
import { CommunityParticipants } from "../features/Communities";
export default function Participants() {
  return (
    <EligibilityGate>
      <CommunityParticipants />
    </EligibilityGate>
  );
}
