import React, { useState } from "react";
import DateTimeField from "../components/DateTimeField";
import { adultBirthDateLimit } from "../components/dateTime";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Header, Notice, Screen, text } from "../components/ui";
import { PhotoUploader, SelectionCard } from "../components/onboarding";
import {
  GENDERS,
  useCompletion,
  type Completion,
} from "../services/onboarding";
import { api } from "../services/api";
import { useOnboarding } from "../store/useOnboarding";
import { colors as c } from "../theme";
import {
  DistancePreference,
  distanceKm,
  distanceRange,
  validDistance,
  type DistanceChoice,
} from "../components/DistancePreference";

const genders = GENDERS;
export default function ProfileUnlock() {
  const result = useCompletion();
  if (!result.data)
    return (
      <Screen>
        <Header title="Complete Profile to Connect" back />
        <Notice>
          {result.error?.message ?? "Loading your safety checks…"}
        </Notice>
        {!!result.error && (
          <Button onPress={() => void result.refetch()}>Try Again</Button>
        )}
      </Screen>
    );
  return <UnlockForm initial={result.data} />;
}
function UnlockForm({ initial }: { initial: Completion }) {
  const completion = useCompletion();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const client = useQueryClient(),
    draftStore = useOnboarding();
  const [page, setPage] = useState(
      edit === "true"
        ? 2
        : initial.checks.adult &&
            initial.checks.gender &&
            initial.checks.preferences &&
            initial.checks.consent
          ? 3
          : 1,
    ),
    [name, setName] = useState(initial.user.name),
    [birthDate, setBirth] = useState(""),
    [gender, setGender] = useState(initial.profile.gender ?? ""),
    [preferences, setPreferences] = useState<string[]>(
      initial.profile.preferences?.genders ?? [],
    ),
    [minAge, setMin] = useState(
      String(initial.profile.preferences?.minAge ?? 18),
    ),
    [maxAge, setMax] = useState(
      String(initial.profile.preferences?.maxAge ?? 60),
    ),
    [terms, setTerms] = useState(false),
    [guidelines, setGuidelines] = useState(false),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [distance, setDistance] = useState<DistanceChoice>(() => {
    const unit = initial.profile.preferences?.distanceUnit ?? "km";
    const km = initial.profile.preferences?.maxDistanceKm;
    const coordinates = initial.profile.approximateLocation?.coordinates;
    return {
      unit,
      range: km == null ? "" : distanceRange(km, unit),
      location:
        coordinates?.length === 2
          ? { longitude: coordinates[0], latitude: coordinates[1] }
          : undefined,
    };
  });
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await client.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const data = completion.data;
  const needsBirthDate = !(
    data?.user.hasBirthDate ?? initial.user.hasBirthDate
  );
  return (
    <Screen width="reading">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Header
          title={
            edit === "true"
              ? "Dating Preferences"
              : "Complete Profile to Connect"
          }
          back
        />
        <Text style={[text.title, { color: c.teal, marginVertical: 18 }]}>
          A little trust. A better together.
        </Text>
        {edit !== "true" && (
          <Text style={text.muted}>
            Your profile stays private until you finish these checks. Your birth
            date is never shown publicly.
          </Text>
        )}
        {edit !== "true" && (
          <View style={{ flexDirection: "row", gap: 6, marginVertical: 22 }}>
            {[1, 2, 3].map((i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 5,
                  backgroundColor: i <= page ? c.coral : "#E9DCD1",
                }}
              />
            ))}
          </View>
        )}
        {completion.isPending && (
          <Text style={text.muted}>Loading your saved checks…</Text>
        )}
        {completion.error && (
          <>
            <Text accessibilityRole="alert">{completion.error.message}</Text>
            <Button onPress={() => void completion.refetch()}>Try Again</Button>
          </>
        )}
        {data && (
          <>
            {page === 1 && (
              <>
                <Field
                  label="Display name"
                  value={name}
                  onChangeText={setName}
                  maxLength={60}
                />
                {needsBirthDate && (
                  <DateTimeField
                    label="Date of birth"
                    mode="date"
                    value={birthDate}
                    onChange={setBirth}
                    maximumDate={adultBirthDateLimit()}
                  />
                )}
                <Text style={[text.label, { marginBottom: 12 }]}>
                  Your gender identity
                </Text>
                <View style={{ gap: 10 }}>
                  {genders.map((v) => (
                    <SelectionCard
                      key={v.id}
                      label={v.label}
                      icon="person-outline"
                      selected={gender === v.id}
                      onPress={() => setGender(v.id)}
                    />
                  ))}
                </View>
                <View style={{ marginTop: 22 }}>
                  <Button
                    disabled={
                      !name.trim() ||
                      (needsBirthDate &&
                        !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) ||
                      !gender
                    }
                    onPress={() => setPage(2)}
                  >
                    Continue
                  </Button>
                </View>
              </>
            )}
            {page === 2 && (
              <>
                <Text style={[text.label, { marginBottom: 16 }]}>
                  Who are you open to dating?
                </Text>
                <View style={{ gap: 10 }}>
                  {genders.map((v) => (
                    <SelectionCard
                      key={v.id}
                      label={v.label}
                      icon="heart-outline"
                      selected={preferences.includes(v.id)}
                      onPress={() =>
                        setPreferences(
                          preferences.includes(v.id)
                            ? preferences.filter((x) => x !== v.id)
                            : [...preferences, v.id],
                        )
                      }
                    />
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 15, marginTop: 20 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Minimum age"
                      value={minAge}
                      onChangeText={setMin}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Maximum age"
                      value={maxAge}
                      onChangeText={setMax}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                  </View>
                </View>
                <DistancePreference value={distance} onChange={setDistance} />
                {edit !== "true" && (
                  <>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Switch
                        accessibilityLabel="Accept Terms"
                        value={terms}
                        onValueChange={setTerms}
                        trackColor={{ true: c.teal }}
                      />
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => router.push("/policies?section=terms")}
                        style={{ flex: 1, paddingVertical: 12 }}
                      >
                        <Text style={{ color: c.teal }}>
                          I accept the Terms of Use · Read
                        </Text>
                      </Pressable>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Switch
                        accessibilityLabel="Accept Community Guidelines"
                        value={guidelines}
                        onValueChange={setGuidelines}
                        trackColor={{ true: c.teal }}
                      />
                      <Pressable
                        accessibilityRole="link"
                        onPress={() =>
                          router.push("/policies?section=guidelines")
                        }
                        style={{ flex: 1, paddingVertical: 12 }}
                      >
                        <Text style={{ color: c.teal }}>
                          I accept the Community Guidelines · Read
                        </Text>
                      </Pressable>
                    </View>
                  </>
                )}
                <Button
                  loading={busy}
                  disabled={
                    !preferences.length ||
                    !validDistance(distance) ||
                    (edit !== "true" && (!terms || !guidelines))
                  }
                  onPress={() =>
                    void action(async () => {
                      await api(
                        edit === "true"
                          ? "/profile/dating-preferences"
                          : "/profile/eligibility",
                        {
                          method: "PATCH",
                          body: JSON.stringify({
                            ...(edit === "true"
                              ? {}
                              : {
                                  name,
                                  ...(needsBirthDate && { birthDate }),
                                  gender,
                                  acceptTerms: terms,
                                  acceptGuidelines: guidelines,
                                }),
                            genders: preferences,
                            minAge: Number(minAge),
                            maxAge: Number(maxAge),
                            maxDistanceKm: distanceKm(distance),
                            distanceUnit: distance.unit,
                            location: distance.location,
                          }),
                        },
                      );
                      if (edit === "true") router.back();
                      else setPage(3);
                    })
                  }
                >
                  {edit === "true"
                    ? "Save Dating Preferences"
                    : "Save Safety Details"}
                </Button>
              </>
            )}
            {page === 3 && (
              <>
                <Notice>
                  {!data.contactVerificationRequired
                    ? "Email verification is temporarily optional. You can continue without a code."
                    : data.user.emailVerified
                      ? "Email verified ✓"
                      : "Verify your email so people know there's a real person behind the plan."}
                </Notice>
                {data.contactVerificationRequired &&
                  !data.user.emailVerified && (
                    <>
                      <Button
                        loading={busy}
                        variant="outline"
                        onPress={() =>
                          void action(async () => {
                            await api("/auth/contact/request", {
                              method: "POST",
                            });
                            setMessage(
                              "A six-digit code has been sent to your email. It expires in 10 minutes.",
                            );
                          })
                        }
                      >
                        Send Verification Code
                      </Button>
                      <Field
                        label="Email verification code"
                        value={code}
                        onChangeText={setCode}
                        keyboardType="number-pad"
                        maxLength={6}
                      />
                      <Button
                        disabled={code.length !== 6}
                        loading={busy}
                        onPress={() =>
                          void action(async () => {
                            await api("/auth/contact/verify", {
                              method: "POST",
                              body: JSON.stringify({ code }),
                            });
                            setMessage("Email verified.");
                          })
                        }
                      >
                        Verify Email
                      </Button>
                    </>
                  )}
                <View style={{ marginTop: 26 }}>
                  <PhotoUploader
                    authenticated
                    uri={draftStore.draft.photoUri}
                    count={data.profile.photos?.length ?? 0}
                    onPhoto={(photoUri, photoType, id) => {
                      draftStore.patch({
                        photoUri,
                        photoType,
                        photoIds: id
                          ? [...draftStore.draft.photoIds, id]
                          : draftStore.draft.photoIds,
                      });
                      void client.invalidateQueries();
                    }}
                  />
                </View>
                <Text style={[text.label, { marginBottom: 12 }]}>
                  Your safety checklist
                </Text>
                {Object.entries(data.checks).map(([key, ok]) => (
                  <Text key={key} style={[text.body, { marginBottom: 8 }]}>
                    {ok ? "✓" : "○"}{" "}
                    {
                      (
                        {
                          quickStart: "Starter vibe",
                          displayName: "Display name",
                          adult: "Age 18+",
                          gender: "Gender identity",
                          preferences: "Dating preferences",
                          contact: data.contactVerificationRequired
                            ? "Email verified"
                            : "Email verification (temporarily optional)",
                          photo: "Profile photo",
                          consent: "Terms and guidelines",
                        } as Record<string, string>
                      )[key]
                    }
                  </Text>
                ))}
                <Button
                  loading={busy}
                  disabled={!data.eligible}
                  onPress={() =>
                    void action(async () => {
                      await api("/profile/activate-discovery", {
                        method: "POST",
                      });
                      router.replace("/(tabs)");
                    })
                  }
                >
                  {data.activated ? "Back to Along" : "Activate Discovery"}
                </Button>
              </>
            )}
            {page > 1 && edit !== "true" && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPage(page - 1)}
                style={{ padding: 22 }}
              >
                <Text style={{ textAlign: "center", color: c.teal }}>Back</Text>
              </Pressable>
            )}
          </>
        )}
        {!!error && (
          <Text
            accessibilityRole="alert"
            style={{ color: "#A83229", marginVertical: 16 }}
          >
            {error}
          </Text>
        )}
        {!!message && <Notice>{message}</Notice>}
      </KeyboardAvoidingView>
    </Screen>
  );
}
