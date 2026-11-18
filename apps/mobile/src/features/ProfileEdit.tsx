import React, { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Header, Notice, Screen, card, text } from "../components/ui";
import { PhotoUploader } from "../components/onboarding";
import { PhotoGrid } from "../components/PhotoGrid";
import { api, demoMode } from "../services/api";
import {
  PROFILE_DETAILS,
  RELATIONSHIPS,
  VIBES,
  useCompletion,
  type Completion,
} from "../services/onboarding";
import { useOnboarding } from "../store/useOnboarding";
import { colors as c } from "../theme";
import type { IconName } from "./data";
const fields = PROFILE_DETAILS;
const hints: Record<string, string> = {
  education: "e.g. Design degree, still learning Spanish",
  hobbies: "e.g. Pottery, board games, film photography",
  fitness: "e.g. Evening runs, weekend yoga",
  food: "e.g. Vegetarian, always up for street food",
  availability: "e.g. Weekday evenings and Sunday mornings",
  commute: "e.g. Around 8am, city centre direction",
  budget: "e.g. Happy to keep it under ₹1,000",
  travel: "e.g. Mountain treks, slow city trips",
  weekend: "e.g. Farmers' market, then a long brunch",
  lifestyle: "e.g. Early riser, non-smoker",
};
export default function ProfileEdit() {
  const result = useCompletion();
  if (!result.data)
    return (
      <Screen>
        <Header title="Make it more you" back />
        <Notice>{result.error?.message ?? "Loading your profile…"}</Notice>
        {!!result.error && (
          <Button onPress={() => void result.refetch()}>Try Again</Button>
        )}
      </Screen>
    );
  return <ProfileEditForm initial={result.data} />;
}
function Section({
  icon,
  title,
  meta,
  children,
}: {
  icon: IconName;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.sectionHead}>
        <View style={s.iconBox}>
          <Ionicons name={icon} size={18} color={c.teal} />
        </View>
        <Text style={[text.label, { flex: 1, fontSize: 16 }]}>{title}</Text>
        {!!meta && <Text style={s.meta}>{meta}</Text>}
      </View>
      {children}
    </View>
  );
}
function LinkRow({
  icon,
  label,
  title,
  description,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  title: string;
  description: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.link,
        !last && s.linkLine,
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: "#FDE8E2" }]}>
        <Ionicons name={icon} size={18} color={c.coralBright} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={text.label}>{title}</Text>
        <Text style={text.muted} numberOfLines={1}>
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.muted} />
    </Pressable>
  );
}
function Counter({ value, max }: { value: string; max: number }) {
  return (
    <Text style={[s.counter, value.length > max * 0.9 && { color: c.coralBright }]}>
      {value.length}/{max}
    </Text>
  );
}
function ProfileEditForm({ initial }: { initial: Completion }) {
  const result = useCompletion(),
    client = useQueryClient(),
    local = useOnboarding();
  const [details, setDetails] = useState<Record<string, string>>(
      initial.profile.optionalDetails ?? {},
    ),
    [bio, setBio] = useState(initial.profile.bio ?? ""),
    [occupation, setOccupation] = useState(initial.profile.occupation ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [dirty, setDirty] = useState(false);
  const profile = result.data?.profile ?? initial.profile;
  const photos = profile.photos ?? [];
  const onboarding = profile.onboarding;
  const vibes = (onboarding?.vibes ?? [])
    .map((id) => VIBES.find((v) => v.id === id)?.label)
    .filter(Boolean);
  const intent = RELATIONSHIPS.find(
    (r) => r.id === onboarding?.relationshipIntent,
  )?.label;
  const prefs = profile.preferences;
  const filledDetails = fields.filter((f) => details[f.id]?.trim()).length;
  // Same checklist as the Profile tab so both screens show one score.
  const steps = [
    [photos.length > 0, "add a photo"],
    [!!bio.trim(), "write a short bio"],
    [!!occupation.trim(), "add what you do"],
    [vibes.length > 0, "pick your vibes"],
    [!!onboarding?.personalityPrompt?.answer?.trim(), "answer a personality prompt"],
    [!!profile.city, "add your city"],
    [!!onboarding?.relationshipIntent, "share what you're looking for"],
    [filledDetails >= 3, "fill in a few details"],
  ] as const;
  const strength = Math.round(
    (steps.filter(([done]) => done).length / steps.length) * 100,
  );
  const next = steps.find(([done]) => !done)?.[1];
  const edit = (apply: () => void) => {
    apply();
    setSaved(false);
    setDirty(true);
  };
  return (
    <Screen width="reading">
      <Header title="Make it more you" back />
      <LinearGradient colors={["#1A6065", "#08484F"]} style={s.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={s.heroIcon}>
            <Ionicons name="person-circle-outline" size={24} color={c.peach} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Profile strength</Text>
            <Text style={s.heroSub}>
              {next
                ? `Next: ${next} to stand out.`
                : "Looking great. People can really see you."}
            </Text>
          </View>
          <Text style={s.heroScore}>{strength}%</Text>
        </View>
        <View style={s.heroTrack}>
          <View style={[s.heroFill, { width: `${strength}%` }]} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="shield-checkmark-outline" size={14} color="#CFE3E0" />
          <Text style={[s.heroSub, { flex: 1 }]}>
            Everything here is optional. Share only what feels right. Your
            activity history is never added automatically.
          </Text>
        </View>
      </LinearGradient>

      <View style={[s.card, { paddingVertical: 4 }]}>
        <LinkRow
          icon="sparkles-outline"
          label="Edit Vibe, Intention & City"
          title="Vibe, intention & city"
          description={
            [vibes.slice(0, 2).join(", "), intent, profile.city]
              .filter(Boolean)
              .join(" · ") || "Tell people what you're into"
          }
          onPress={() => router.push("/onboarding")}
        />
        <LinkRow
          icon="heart-outline"
          label="Edit Dating Preferences"
          title="Dating preferences"
          description={
            prefs?.minAge && prefs?.maxAge
              ? `Ages ${prefs.minAge}–${prefs.maxAge}${
                  prefs.maxDistanceKm
                    ? ` · within ${prefs.maxDistanceKm} ${prefs.distanceUnit ?? "km"}`
                    : ""
                }`
              : "Who you'd like to meet"
          }
          onPress={() => router.push("/profile-unlock?edit=true")}
          last={demoMode}
        />
        {!demoMode && (
          <LinkRow
            icon="chatbubbles-outline"
            label="Edit Vibe Check"
            title="Vibe Check"
            description="Shared-choice questions on your profile"
            onPress={() => router.push("/vibe-check")}
            last
          />
        )}
      </View>

      {/* PhotoGrid renders its own heading and count. */}
      <View style={s.card}>
        {demoMode ? (
          <PhotoUploader
            authenticated={false}
            uri={local.draft.photoUri}
            onPhoto={(photoUri, photoType) =>
              local.patch({ photoUri, photoType })
            }
          />
        ) : (
          <PhotoGrid
            photoIds={photos}
            onChange={async ({ added = [], removed }) => {
              const ids = local.draft.photoIds.filter((v) => v !== removed);
              local.patch({
                photoIds: [...ids, ...added],
                ...(removed ? { photoUri: null } : {}),
              });
              await client.invalidateQueries();
            }}
          />
        )}
      </View>

      <Section icon="person-outline" title="About you">
        <Field
          label="Occupation"
          placeholder="e.g. Product designer at a small studio"
          value={occupation}
          onChangeText={(v) => edit(() => setOccupation(v))}
          maxLength={100}
        />
        <View>
          <Field
            label="Your biography"
            placeholder="A few lines about you, what you love and what you're looking for."
            value={bio}
            onChangeText={(v) => edit(() => setBio(v))}
            multiline
            maxLength={600}
          />
          <Counter value={bio} max={600} />
        </View>
      </Section>

      <Section
        icon="list-outline"
        title="The details"
        meta={`${filledDetails}/${fields.length} added`}
      >
        <Text style={[text.muted, { marginBottom: 6 }]}>
          Small things make it easier to find your people. Skip anything you
          like.
        </Text>
        {fields.map((f) => {
          const filled = !!details[f.id]?.trim();
          return (
            <View key={f.id}>
              <View style={s.detailLabel}>
                <Ionicons
                  name={f.icon as IconName}
                  size={16}
                  color={filled ? c.teal : c.muted}
                />
                <Text style={[text.label, { flex: 1 }]}>{f.label}</Text>
                {filled && (
                  <Ionicons name="checkmark-circle" size={16} color={c.green} />
                )}
              </View>
              <Field
                accessibilityLabel={f.label}
                placeholder={hints[f.id] ?? "Add a few words"}
                value={details[f.id] ?? ""}
                maxLength={160}
                onChangeText={(v) =>
                  edit(() => setDetails({ ...details, [f.id]: v }))
                }
              />
            </View>
          );
        })}
      </Section>

      {!!error && (
        <View style={[s.status, { backgroundColor: "#FBE9E6" }]}>
          <Ionicons name="alert-circle" size={17} color="#A83229" />
          <Text accessibilityRole="alert" style={{ color: "#A83229", flex: 1 }}>
            {error}
          </Text>
        </View>
      )}
      {saved && (
        <View style={[s.status, { backgroundColor: "#E3F1EC" }]}>
          <Ionicons name="checkmark-circle" size={17} color={c.green} />
          <Text style={[text.body, { color: c.green, flex: 1 }]}>
            Your changes are saved.
          </Text>
        </View>
      )}
      {dirty && !saved && !error && (
        <Text style={[text.muted, { textAlign: "center", marginBottom: 10 }]}>
          You have unsaved changes.
        </Text>
      )}
      <Button
        icon="checkmark"
        loading={busy}
        onPress={() => {
          setBusy(true);
          setError("");
          void api("/profile/optional", {
            method: "PATCH",
            body: JSON.stringify({ bio, occupation, details }),
          })
            .then(() => {
              setSaved(true);
              setDirty(false);
              return client.invalidateQueries();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Save Changes
      </Button>
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: { borderRadius: 22, padding: 18, gap: 12, marginBottom: 16 },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: c.white, fontSize: 18, fontWeight: "700" },
  heroSub: { color: "#CFE3E0", fontSize: 12, lineHeight: 18 },
  heroScore: { color: c.white, fontSize: 26, fontWeight: "800" },
  heroTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  heroFill: { height: 8, borderRadius: 4, backgroundColor: c.coralBright },
  card: { ...card, padding: 16, marginBottom: 16 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: { fontSize: 12, fontWeight: "600", color: c.teal },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  linkLine: { borderBottomWidth: 1, borderBottomColor: c.line },
  counter: {
    position: "absolute",
    right: 2,
    top: 0,
    fontSize: 11,
    color: c.muted,
  },
  detailLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 7,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
});
