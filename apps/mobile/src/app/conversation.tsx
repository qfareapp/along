import React from "react";
import { Conversation } from "../features/Chat";
import { EligibilityGate } from "../features/AlongHome";
export default function Chat() {
  return (
    <EligibilityGate>
      <Conversation />
    </EligibilityGate>
  );
}
