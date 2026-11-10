import React, { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Header, Notice, Screen, text } from "../components/ui";
import { PhotoUploader } from "../components/onboarding";
import { PhotoGrid } from "../components/PhotoGrid";
import { api, demoMode } from "../services/api";
import {
  PROFILE_DETAILS,
  useCompletion,
  type Completion,
} from "../services/onboarding";
import { useOnboarding } from "../store/useOnboarding";
const fields = PROFILE_DETAILS;
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
    [saved, setSaved] = useState(false);
  return (
    <Screen width="reading">
      <Header title="Make it more you" back />
      <Notice>
        Everything here is optional. Share only what feels right. Your activity
        history is never added automatically.
      </Notice>
      <Button variant="outline" onPress={() => router.push("/onboarding")}>
        Edit Vibe, Intention & City
      </Button>
      <View style={{ marginVertical: 14 }}>
        <Button
          variant="outline"
          onPress={() => router.push("/profile-unlock?edit=true")}
        >
          Edit Dating Preferences
        </Button>
      </View>
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
          photoIds={result.data?.profile.photos ?? []}
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
      <Field
        label="Occupation (optional)"
        value={occupation}
        onChangeText={setOccupation}
        maxLength={100}
      />
      <Field
        label="Your biography (optional)"
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={600}
      />
      {fields.map((f) => (
        <Field
          key={f.id}
          label={`${f.label} (optional)`}
          value={details[f.id] ?? ""}
          maxLength={160}
          onChangeText={(v) => {
            setDetails({ ...details, [f.id]: v });
            setSaved(false);
          }}
        />
      ))}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#A83229" }}>
          {error}
        </Text>
      )}
      {saved && <Text style={text.body}>Your changes are saved.</Text>}
      <Button
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
