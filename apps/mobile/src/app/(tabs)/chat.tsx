import React from "react";
import { ChatList } from "../../features/Chat";
import { EligibilityGate } from "../../features/AlongHome";
export default function Chat() {
  return (
    <EligibilityGate>
      <ChatList />
    </EligibilityGate>
  );
}
