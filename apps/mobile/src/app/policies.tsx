import React, { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { policies, policyVersion, supportEmail } from "../../../../packages/policies/index.js";
import { Header, Screen, text } from "../components/ui";
import { apiBaseUrl } from "../services/api";
import { colors as c } from "../theme";
export default function Policies() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const key = section && Object.hasOwn(policies, section) ? section as keyof typeof policies : "terms";
  const policy = policies[key];
  const [error, setError] = useState("");
  async function open(url: string) {
    try { await Linking.openURL(url); } catch { setError(`Could not open the link. Contact ${supportEmail} for help.`); }
  }
  return (
    <Screen width="reading">
      <Header title={policy.title} back />
      <Text style={[text.muted, { marginVertical: 15 }]}>Along · Updated {policyVersion}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
        {(Object.keys(policies) as (keyof typeof policies)[]).map(item => <Pressable key={item} accessibilityRole="link" onPress={() => router.setParams({ section: item })} style={{ padding: 10, borderRadius: 10, backgroundColor: key === item ? "#DDECE8" : "#F5E9DF" }}><Text style={[text.label, { color: c.teal, fontSize: 12 }]}>{policies[item].title}</Text></Pressable>)}
      </View>
      {policy.sections.map(s => <View key={s.title} style={{ gap: 8, marginBottom: 22 }}><Text style={[text.title, { fontSize: 19 }]}>{s.title}</Text><Text style={text.body}>{s.body}</Text></View>)}
      <Pressable accessibilityRole="link" onPress={() => void open(`mailto:${supportEmail}`)} style={{ paddingVertical: 16 }}><Text style={{ color: c.teal }}>{supportEmail}</Text></Pressable>
      {!!apiBaseUrl && <Pressable accessibilityRole="link" onPress={() => void open(`${new URL(apiBaseUrl).origin}/${key}`)} style={{ paddingVertical: 16 }}><Text style={{ color: c.teal }}>Open public {policy.title.toLowerCase()} page</Text></Pressable>}
      {!!error && <Text accessibilityRole="alert" style={text.body}>{error}</Text>}
    </Screen>
  );
}
