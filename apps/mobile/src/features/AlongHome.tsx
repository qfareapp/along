import React, { type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Header, Notice, Screen, text } from "../components/ui";
import {
  AlongVibeCard,
  ProfileCompletionPrompt,
} from "../components/onboarding";
import { useOnboarding } from "../store/useOnboarding";
import { useAlong } from "../store/useAlong";
import {
  useCompletion,
  draftFromServer,
  FIRST_PLANS,
  syncDraft,
  VIBES,
} from "../services/onboarding";
import { demoMode } from "../services/api";
import { colors as c } from "../theme";
import { assets } from "./data";
import { useState } from "react";

export function AlongHome({ restricted = false }: { restricted?: boolean }) {
  const welcomed = useAlong((s) => s.welcomed),
    local = useOnboarding(),
    result = useCompletion(welcomed),
    client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const draft = result.data?.profile?.onboarding?.vibes.length
    ? { ...local.draft, ...draftFromServer(result.data) }
    : local.draft;
  const ready = result.data?.activated;
  const everyday = draft.firstPlanIntent === "everyday_person";
  const selected = new Set(draft.vibes);
  const ranked = [...VIBES].sort(
    (a, b) =>
      (selected.has(b.id)
        ? 10
        : everyday && ["fitness", "commute", "learning"].includes(b.category)
          ? 5
          : !everyday && ["food", "travel", "events"].includes(b.category)
            ? 4
            : 0) -
      (selected.has(a.id)
        ? 10
        : everyday && ["fitness", "commute", "learning"].includes(a.category)
          ? 5
          : !everyday && ["food", "travel", "events"].includes(a.category)
            ? 4
            : 0),
  );
  return (
    <Screen>
      <Header
        title={ready ? "Your kind of together" : "A little look at Along"}
        subtitle={draft.city || "Plans that fit your vibe"}
      />
      <Text style={[text.title, { color: c.teal, marginTop: 24 }]}>
        {FIRST_PLANS.find((v) => v.id === draft.firstPlanIntent)?.label ??
          "Your next story starts here."}
      </Text>
      <Text style={[text.muted, { marginTop: 10, marginBottom: 12 }]}>
        {ready
          ? "Start with a shared plan. Let the connection grow."
          : "A private preview, inspired by your vibe. These are ideas, not posts by real members."}
      </Text>
      {!ready && (
        <Notice>
          Your profile stays hidden. Complete your safety checks before viewing
          member profiles, posting or joining plans.
        </Notice>
      )}
      {result.error && (
        <>
          <Text accessibilityRole="alert" style={{ color: "#A83229" }}>
            {result.error.message}
          </Text>
          <Button onPress={() => void result.refetch()}>
            Retry Connection
          </Button>
        </>
      )}
      {welcomed &&
        local.draft.completed &&
        !result.data?.checks.quickStart &&
        result.data && (
          <>
            <Button
              loading={busy}
              onPress={() => {
                setBusy(true);
                setError("");
                void syncDraft(local.draft)
                  .then(() => client.invalidateQueries())
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Save My Starter Profile
            </Button>
            {!!error && <Text accessibilityRole="alert">{error}</Text>}
          </>
        )}
      <View style={{ marginVertical: 14 }}>
        <Button
          onPress={() =>
            router.push(
              !welcomed
                ? "/auth?mode=register"
                : ready
                  ? "/(tabs)/plans"
                  : result.data?.checks.quickStart
                    ? "/profile-unlock"
                    : "/onboarding",
            )
          }
        >
          {ready ? "Explore Plans" : "Complete Profile to Connect"}
        </Button>
      </View>
      {ranked
        .slice(0, draft.firstPlanIntent === "just_exploring" ? 8 : 4)
        .map((v) => (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            accessibilityLabel={`${v.label}, ${ready ? "browse plans" : "preview inspiration"}`}
            onPress={() => {
              if (ready) router.push(`/(tabs)/plans?category=${v.category}`);
            }}
            style={{
              backgroundColor: "#FFFDF9",
              borderWidth: 1,
              borderColor: "#EADDD2",
              borderRadius: 23,
              overflow: "hidden",
              marginBottom: 14,
            }}
          >
            <Image
              source={
                v.category === "travel"
                  ? assets.travel
                  : v.category === "commute"
                    ? assets.carpool
                    : assets.coffee
              }
              accessibilityLabel="Activity inspiration"
              style={{ width: "100%", height: 125 }}
            />
            <View style={{ padding: 18, gap: 8 }}>
              <Text
                style={{ color: "#9B483D", fontSize: 10, letterSpacing: 1.5 }}
              >
                {ready ? "FIND A SHARED PLAN" : "INSPIRATION · NO MEMBER DATA"}
              </Text>
              <Text style={[text.label, { color: c.teal, fontSize: 19 }]}>
                {v.label}
              </Text>
              <Text style={text.muted}>
                {draft.city
                  ? `Imagine your next ${v.label.toLowerCase()} in ${draft.city}.`
                  : "A shared experience could be the start of something."}
              </Text>
            </View>
          </Pressable>
        ))}
      {ready && (
        <ProfileCompletionPrompt kind={everyday ? "commute" : "fitness"} />
      )}
      {!restricted && draft.vibes.length > 0 && <AlongVibeCard draft={draft} />}
      <Button variant="outline" onPress={() => router.push("/onboarding")}>
        Edit My Vibe
      </Button>
    </Screen>
  );
}
export function EligibilityGate({ children }: { children: ReactNode }) {
  const result = useCompletion();
  if (demoMode) return <>{children}</>;
  if (!result.data?.activated) return <AlongHome restricted />;
  return <>{children}</>;
}
