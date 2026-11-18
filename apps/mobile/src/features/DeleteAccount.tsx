import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Header, Notice, Screen, card, text } from "../components/ui";
import { api, clearSession, demoMode } from "../services/api";
import { useAlong } from "../store/useAlong";
import { useOnboarding } from "../store/useOnboarding";
import { colors as c } from "../theme";
import type { IconName } from "./data";

const danger = "#BA4034";
const effects: { icon: IconName; text: string }[] = [
  { icon: "eye-off-outline", text: "Your profile disappears from Discover, Social, plans and Vibe Checks right away." },
  { icon: "images-outline", text: "Your photos, bio, details and location are erased." },
  { icon: "calendar-outline", text: "Plans you organise are cancelled and your Vibe Check is switched off." },
  { icon: "log-out-outline", text: "You're signed out on every device and can't sign back in." },
];
export default function DeleteAccount() {
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/users/me", {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      await clearSession();
      useOnboarding.getState().reset();
      client.clear();
      useAlong.getState().reset();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <Screen width="reading">
      <Header title="Delete profile" back />
      {demoMode ? (
        <Notice>Sign in to manage your account.</Notice>
      ) : (
        <>
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <Ionicons name="trash-outline" size={26} color={danger} />
            </View>
            <Text style={[text.title, { fontSize: 21, textAlign: "center" }]}>
              We&apos;re sorry to see you go
            </Text>
            <Text style={[text.muted, { textAlign: "center" }]}>
              Deleting your profile is permanent and can&apos;t be undone.
            </Text>
          </View>
          <View style={s.card}>
            <Text style={text.label}>What happens</Text>
            {effects.map((effect) => (
              <View key={effect.icon} style={s.effect}>
                <Ionicons name={effect.icon} size={18} color={danger} />
                <Text style={[text.body, { flex: 1 }]}>{effect.text}</Text>
              </View>
            ))}
            <Text style={[text.muted, { fontSize: 12, lineHeight: 18 }]}>
              Safety reports and a minimal account record are kept so we can
              keep the community safe. Your email can&apos;t be reused for a
              new account.
            </Text>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: understood, disabled: busy }}
            accessibilityLabel="I understand this can't be undone"
            disabled={busy}
            onPress={() => setUnderstood(!understood)}
            style={s.check}
          >
            <Ionicons
              name={understood ? "checkbox" : "square-outline"}
              size={22}
              color={understood ? danger : c.muted}
            />
            <Text style={[text.body, { flex: 1 }]}>
              I understand this can&apos;t be undone
            </Text>
          </Pressable>
          <Field
            label="Enter your password to confirm"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setError("");
            }}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!busy}
            maxLength={200}
          />
          {!!error && (
            <View style={s.error}>
              <Ionicons name="alert-circle" size={17} color={danger} />
              <Text accessibilityRole="alert" style={{ color: danger, flex: 1 }}>
                {error}
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete my profile"
            accessibilityState={{ disabled: !understood || !password || busy }}
            disabled={!understood || !password || busy}
            onPress={() => void remove()}
            style={({ pressed }) => [
              s.delete,
              (!understood || !password) && { opacity: 0.45 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="trash" size={18} color={c.white} />
            <Text style={{ color: c.white, fontWeight: "700", fontSize: 15 }}>
              {busy ? "Deleting…" : "Delete my profile"}
            </Text>
          </Pressable>
          <View style={{ marginTop: 12 }}>
            <Button variant="outline" disabled={busy} onPress={() => router.back()}>
              Keep my profile
            </Button>
          </View>
        </>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: { alignItems: "center", gap: 8, marginBottom: 18 },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FBE9E6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  card: { ...card, padding: 16, gap: 12, marginBottom: 16 },
  effect: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    marginBottom: 8,
  },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: "#FBE9E6",
  },
  delete: {
    minHeight: 51,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: danger,
  },
});
