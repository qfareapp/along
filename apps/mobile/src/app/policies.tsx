import React from "react";
import { Text } from "react-native";
import { Header, Screen, text } from "../components/ui";
export default function Policies() {
  return (
    <Screen>
      <Header title="Terms & Community Guidelines" back />
      <Text style={[text.title, { marginVertical: 24 }]}>Be good company.</Text>
      <Text
        style={text.body}
      >{`Version: 26 October 2026\n\nAlong is for adults aged 18 and over. Provide accurate information, use photographs you have permission to share, and keep your account secure. Do not impersonate someone or use Along for fraud, solicitation or illegal activity.\n\nA shared plan never implies romantic or physical consent. Ask clearly, respect a no, and stop contact when asked. Harassment, hate, threats, sexual exploitation and sharing someone else's private information are prohibited.\n\nMeet in public, tell someone you trust about your plans and avoid posting exact home or office addresses. You control whether to publish an activity. Report or block accounts that make you uncomfortable.\n\nAlong may review reported content and restrict or suspend accounts to enforce these guidelines. No match or meeting is guaranteed. You can update your preferences, remove your photos or contact support through the app's safety settings.\n\nThese rules apply to every plan, profile and conversation. Your full birth date and verification codes are private; your public profile becomes visible only after eligibility checks and your activation.`}</Text>
    </Screen>
  );
}
