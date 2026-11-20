import React, { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Header, Notice, Screen, text } from "../components/ui";
import { api, demoMode } from "../services/api";
import { useAlong } from "../store/useAlong";
import { supportEmail } from "../../../../packages/policies/index.js";
import { colors as c } from "../theme";

const categories = [
  ["other", "Other concern"], ["harassment", "Harassment or threats"],
  ["scam", "Scam or impersonation"], ["explicit_content", "Explicit content"],
  ["child_safety", "Child safety"], ["privacy", "Privacy or data"],
  ["account", "Account or appeal"], ["support", "App support"],
] as const;
export default function Safety() {
  const { target, activity, conversation, message, group, groupMessage, category: initial } = useLocalSearchParams<{ target?: string; activity?: string; conversation?: string; message?: string; group?: string; groupMessage?: string; category?: string }>();
  const [category, setCategory] = useState(categories.some(([k]) => k === initial) ? initial! : "other");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [error, setError] = useState("");
  const client = useQueryClient();
  async function report() {
    if (busy) return;
    if (reason.trim().length < 10) { setError("Please add at least 10 characters so we understand the concern."); return; }
    setBusy(true); setError("");
    try {
      if (demoMode) setSubmitted("Preview only: no report was sent.");
      else {
        const result = await api<{ received: boolean; reference: string }>("/reports", { method: "POST", body: JSON.stringify({ userId: target, activityId: activity, conversationId: conversation, messageId: message, groupId: group, groupMessageId: groupMessage, reason, category }) });
        setSubmitted(`Your concern was received for review. Reference: ${result.reference}. Reporting does not block the member automatically.`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit. Please try again."); }
    finally { setBusy(false); }
  }
  async function block() {
    if (!target || busy) return;
    setBusy(true); setError("");
    try {
      if (demoMode) useAlong.getState().update({ blocked: [...new Set([...useAlong.getState().blocked, target])] });
      else {
        await api("/blocks", { method: "POST", body: JSON.stringify({ userId: target }) });
        client.clear();
      }
      router.replace("/(tabs)");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not block. Try again."); setBusy(false); }
  }
  return <Screen width="reading">
    <Header title="Safety Centre" subtitle="Your comfort comes first." back />
    <Notice>Meet in public, arrange your own transport and tell someone you trust. A shared plan never implies consent. Keep exact addresses and financial details private. Along is not an emergency service.</Notice>
    <Text style={[text.title, { fontSize: 21, marginVertical: 20 }]}>{target ? "Report this member or content" : "Tell us about a concern"}</Text>
    {!!(message || groupMessage) && <Notice>The selected message reference and its text will be included privately for moderators.</Notice>}
    {submitted ? <Notice>{submitted}</Notice> : <>
      <Text style={[text.label, { marginVertical: 12 }]}>Concern type</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {categories.map(([id, label]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: category === id }} onPress={() => setCategory(id)} style={{ padding: 12, borderRadius: 12, backgroundColor: category === id ? "#DDECE8" : "#F5E9DF" }}><Text style={{ color: c.teal }}>{label}</Text></Pressable>)}
      </View>
      {category === "child_safety" && <Notice>Child-safety concerns are prioritised. Never download, forward or attach suspected child sexual abuse material. Describe the concern and identify the account or message.</Notice>}
      <Field label="What happened?" placeholder="Describe the concern. Do not include passwords or financial details." value={reason} onChangeText={setReason} maxLength={1500} multiline />
      <Button loading={busy} disabled={busy} onPress={() => void report()}>{demoMode ? "Preview report" : "Submit concern"}</Button>
    </>}
    {!!target && <View style={{ gap: 12, marginTop: 22 }}>
      <Text style={text.body}>Blocking stops direct contact and hides each other&apos;s messages in shared plan groups. Blocking the organiser also closes access to that organiser&apos;s group. You can manage blocked members in Settings.</Text>
      {confirmBlock ? <><Notice>Block this member? Existing direct connections will close. Unblocking will not restore them.</Notice><Button variant="coral" loading={busy} disabled={busy} onPress={() => void block()}>Confirm block</Button><Button variant="outline" disabled={busy} onPress={() => setConfirmBlock(false)}>Cancel</Button></> : <Button variant="outline" disabled={busy} onPress={() => setConfirmBlock(true)}>{demoMode ? "Block preview profile" : "Block member"}</Button>}
    </View>}
    {!!error && <Notice>{error}</Notice>}
    <View style={{ gap: 12, marginTop: 24 }}>
      <Button variant="outline" onPress={() => router.push("/policies?section=child-safety")}>Child Safety Standards</Button>
      <Button variant="outline" onPress={() => router.push("/policies?section=privacy")}>Privacy Policy</Button>
      <Pressable accessibilityRole="link" style={{ paddingVertical: 14 }} onPress={() => void Linking.openURL(`mailto:${supportEmail}`).catch(() => setError(`Email ${supportEmail} for help.`))}><Text style={{ color: c.teal }}>Contact {supportEmail}</Text></Pressable>
    </View>
  </Screen>;
}
