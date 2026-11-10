import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlongVibeCard,
  CitySelector,
  OnboardingLayout,
  PhotoUploader,
  SelectionCard,
} from "../components/onboarding";
import { Button, Field, Notice, text } from "../components/ui";
import { useOnboarding } from "../store/useOnboarding";
import { useAlong } from "../store/useAlong";
import { api, demoMode } from "../services/api";
import {
  draftFromServer,
  FIRST_PLANS,
  RELATIONSHIPS,
  saveStep,
  restoreOnboarding,
  VIBES,
} from "../services/onboarding";
import { colors as c } from "../theme";

const titles = [
  "What's your kind of together?",
  "What sounds good right now?",
  "Who could be your kind of person?",
  "Where should the good stuff happen?",
  "Give people a glimpse of you.",
  "Your next story starts here.",
];
const descriptions = [
  "Pick a few things you'd genuinely enjoy doing with someone.",
  "Choose the kind of connection you'd like to start with.",
  "Just enough to make recommendations feel right.",
  "Keep it local, or explore beyond your neighbourhood.",
  "No essays. No pressure. Just you.",
  "Your Along is ready. Discover plans and people who fit your vibe.",
];
export default function QuickStart() {
  const { draft: d, patch, hydrated } = useOnboarding();
  const welcomed = useAlong((s) => s.welcomed);
  const authenticated = welcomed && !demoMode;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(!authenticated);
  const client = useQueryClient();
  const entered = useRef(0);
  const step = d.step;
  useEffect(() => {
    if (hydrated && !d.startedAt) patch({ startedAt: Date.now() });
  }, [hydrated, d.startedAt, patch]);
  async function load() {
    try {
      const value = await restoreOnboarding(useOnboarding.getState().draft);
      patch(draftFromServer(value));
      setLoaded(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't restore progress.");
    }
  }
  useEffect(() => {
    if (!authenticated || !hydrated) return;
    let cancelled = false;
    void restoreOnboarding(useOnboarding.getState().draft)
      .then((value) => {
        if (cancelled) return;
        patch(draftFromServer(value));
        setLoaded(true);
        setError("");
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Couldn't restore progress.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, hydrated, patch]);
  useEffect(() => {
    entered.current = Date.now();
  }, [step]);
  useEffect(() => {
    if (!authenticated) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background")
        void api("/onboarding/events", {
          method: "POST",
          body: JSON.stringify({ name: "onboarding_abandoned", step }),
        }).catch(() => {});
    });
    return () => sub.remove();
  }, [step, authenticated]);
  const valid =
    step === 1
      ? d.vibes.length > 0
      : step === 2
        ? !!d.firstPlanIntent
        : step === 3
          ? !!d.relationshipIntent
          : step === 4
            ? d.city.trim().length >= 2
            : true;
  async function next(skip = false) {
    if (!valid || busy) return;
    setError("");
    setBusy(true);
    const draft = skip ? { ...d, personalityPrompt: null } : d;
    try {
      if (authenticated) {
        await saveStep(step, draft);
        void api("/onboarding/events", {
          method: "POST",
          body: JSON.stringify({
            name: "step_timing",
            step,
            durationMs: Math.min(86400000, Date.now() - entered.current),
            skipped: skip,
          }),
        }).catch(() => {});
        if (step === 5)
          await api("/onboarding/complete-quick-start", { method: "POST" });
        await client.invalidateQueries({ queryKey: ["profile-completion"] });
      }
      patch({ ...draft, step: step + 1, completed: step === 5 || d.completed });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't save. Your selections are kept. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!hydrated) return null;
  return (
    <OnboardingLayout
      step={step}
      title={titles[step - 1]}
      description={descriptions[step - 1]}
      error={error}
      onBack={() => {
        if (busy) return;
        if (step > 1) patch({ step: step - 1 });
        else router.replace("/");
      }}
    >
      {!loaded ? (
        <Button onPress={() => void load()}>Retry Restoring Progress</Button>
      ) : (
        <>
          {step === 1 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {VIBES.map((v) => (
                <SelectionCard
                  key={v.id}
                  compact
                  label={v.label}
                  icon={v.icon}
                  selected={d.vibes.includes(v.id)}
                  onPress={() => {
                    patch({
                      vibes: d.vibes.includes(v.id)
                        ? d.vibes.filter((x) => x !== v.id)
                        : [...d.vibes, v.id],
                    });
                    if (authenticated)
                      void api("/onboarding/events", {
                        method: "POST",
                        body: JSON.stringify({
                          name: "onboarding_vibe_selected",
                          step: 1,
                        }),
                      }).catch(() => {});
                  }}
                />
              ))}
            </View>
          )}
          {step === 2 && (
            <View style={{ gap: 14 }}>
              {FIRST_PLANS.map((v) => (
                <SelectionCard
                  key={v.id}
                  {...v}
                  selected={d.firstPlanIntent === v.id}
                  onPress={() => patch({ firstPlanIntent: v.id })}
                />
              ))}
            </View>
          )}
          {step === 3 && (
            <View style={{ gap: 12 }}>
              {RELATIONSHIPS.map((v) => (
                <SelectionCard
                  key={v.id}
                  {...v}
                  selected={d.relationshipIntent === v.id}
                  onPress={() => patch({ relationshipIntent: v.id })}
                />
              ))}
            </View>
          )}
          {step === 4 && (
            <CitySelector
              city={d.city}
              area={d.area}
              onCity={(city) => patch({ city })}
              onArea={(area) => patch({ area })}
            />
          )}
          {step === 5 && (
            <>
              <PhotoUploader
                authenticated={authenticated}
                uri={d.photoUri}
                count={d.photoIds.length}
                onPhoto={(photoUri, photoType, id) =>
                  patch({
                    photoUri,
                    photoType,
                    photoIds: id ? [...d.photoIds, id] : d.photoIds,
                  })
                }
              />
              <Text style={[text.label, { marginBottom: 12 }]}>
                A little personality (optional)
              </Text>
              <View style={{ gap: 8, marginBottom: 18 }}>
                {[
                  {
                    id: "perfect_sunday",
                    label: "A perfect Sunday looks like...",
                  },
                  { id: "get_along", label: "We'd get along if..." },
                  { id: "want_to_try", label: "One thing I want to try..." },
                ].map((v) => (
                  <Pressable
                    key={v.id}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: d.personalityPrompt?.type === v.id,
                    }}
                    onPress={() =>
                      patch({
                        personalityPrompt: {
                          type: v.id,
                          answer: d.personalityPrompt?.answer ?? "",
                        },
                      })
                    }
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      backgroundColor:
                        d.personalityPrompt?.type === v.id
                          ? "#E1EFEB"
                          : "#F7EBDD",
                    }}
                  >
                    <Text style={{ color: c.teal }}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
              {d.personalityPrompt && (
                <Field
                  label="Your answer (optional, 160 characters)"
                  value={d.personalityPrompt.answer}
                  multiline
                  maxLength={160}
                  onChangeText={(answer) =>
                    patch({
                      personalityPrompt: {
                        type: d.personalityPrompt!.type,
                        answer,
                      },
                    })
                  }
                />
              )}
              <Button
                variant="outline"
                onPress={() => void next(true)}
                disabled={busy}
              >
                Skip for Now
              </Button>
            </>
          )}
          {step === 6 ? (
            <>
              <Text
                style={{ textAlign: "center", fontSize: 50, color: c.coral }}
              >
                ♥
              </Text>
              <AlongVibeCard draft={d} />
              <Notice>
                Your starter profile is saved
                {authenticated ? " to your account" : " on this device"}.
                Complete the safety checks before people can see you or you
                connect.
              </Notice>
              <Button
                onPress={() => {
                  if (demoMode) {
                    useAlong.getState().update({ welcomed: true });
                    router.replace("/(tabs)");
                  } else
                    router.replace(
                      authenticated
                        ? "/(tabs)"
                        : "/auth?mode=register&onboarding=true",
                    );
                }}
              >
                Explore Along
              </Button>
              <Pressable
                accessibilityRole="button"
                onPress={() => patch({ step: 1 })}
                style={{ padding: 20 }}
              >
                <Text style={{ color: c.teal, textAlign: "center" }}>
                  Edit My Vibe
                </Text>
              </Pressable>
            </>
          ) : (
            <View style={{ marginTop: 24, marginBottom: 20 }}>
              <Button
                loading={busy}
                disabled={!valid}
                onPress={() => void next()}
              >
                Continue
              </Button>
            </View>
          )}
        </>
      )}
    </OnboardingLayout>
  );
}
