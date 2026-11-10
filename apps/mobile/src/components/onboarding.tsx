import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { compressPhoto } from "../services/compressPhoto";
import { Button, Field, Header, Notice, Screen, text } from "./ui";
import { colors as c } from "../theme";
import {
  FIRST_PLANS,
  RELATIONSHIPS,
  VIBES,
  type Draft,
} from "../services/onboarding";
import { getAccessToken, apiBaseUrl, api } from "../services/api";
import { useOnboarding } from "../store/useOnboarding";
import type { IconName } from "../features/data";

export function SelectionCard({
  label,
  description,
  icon,
  selected,
  onPress,
  compact = false,
}: {
  label: string;
  description?: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const reduced = useRef(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduced.current = v;
    });
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        reduced.current = v;
      },
    );
    return () => listener.remove();
  }, []);
  return (
    <Animated.View
      style={{ width: compact ? "48%" : "100%", transform: [{ scale }] }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        aria-pressed={selected}
        accessibilityLabel={label}
        onPress={() => {
          if (!reduced.current)
            Animated.sequence([
              Animated.timing(scale, {
                toValue: 0.97,
                duration: 70,
                useNativeDriver: true,
              }),
              Animated.timing(scale, {
                toValue: 1,
                duration: 110,
                useNativeDriver: true,
              }),
            ]).start();
          onPress();
        }}
        style={{
          minHeight: compact ? 110 : 85,
          padding: 18,
          borderRadius: 21,
          borderWidth: 1.5,
          borderColor: selected ? c.teal : "#EBDDD2",
          backgroundColor: selected ? "#E1EFEB" : "#FFFDF9",
          justifyContent: "center",
          gap: 9,
        }}
      >
        <Ionicons
          name={icon}
          size={27}
          color={selected ? c.teal : c.coralBright}
        />
        <Text style={[text.label, { color: c.teal, paddingRight: 12 }]}>
          {label}
        </Text>
        {description && <Text style={text.muted}>{description}</Text>}
        {selected && (
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={c.teal}
            style={{ position: "absolute", right: 10, top: 10 }}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}
export function OnboardingLayout({
  step,
  title,
  description,
  children,
  onBack,
  error,
}: {
  step: number;
  title: string;
  description: string;
  children: ReactNode;
  onBack: () => void;
  error?: string;
}) {
  return (
    <Screen width="reading">
      <View>
        <Header
          right={
            <Pressable
              accessibilityRole="button"
              onPress={onBack}
              style={{ padding: 14 }}
            >
              <Text style={{ color: c.teal }}>Back</Text>
            </Pressable>
          }
        />
        <View
          accessibilityLabel={`Step ${Math.min(step, 5)} of 5`}
          style={{
            flexDirection: "row",
            gap: 6,
            marginTop: 10,
            marginBottom: 28,
          }}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 4,
                backgroundColor: i <= step ? c.coral : "#EADFD6",
              }}
            />
          ))}
        </View>
        <Text
          style={{
            color: "#9B483D",
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.7,
            marginBottom: 12,
          }}
        >
          {step <= 5
            ? `0${step} · ${["YOUR VIBE", "YOUR FIRST PLAN", "THE SPARK", "YOUR WORLD", "MAKE IT YOU"][step - 1]}`
            : "YOU'RE IN"}
        </Text>
        <Text
          style={[text.title, { color: c.teal, fontSize: 30, lineHeight: 36 }]}
        >
          {title}
        </Text>
        <Text
          style={[
            text.muted,
            { marginTop: 12, marginBottom: 25, fontSize: 15, lineHeight: 23 },
          ]}
        >
          {description}
        </Text>
        {children}
        {!!error && (
          <Text
            accessibilityRole="alert"
            style={{ color: "#A83229", marginVertical: 15 }}
          >
            {error}
          </Text>
        )}
      </View>
    </Screen>
  );
}
export function CitySelector({
  city,
  area,
  onCity,
  onArea,
}: {
  city: string;
  area: string;
  onCity: (value: string) => void;
  onArea: (value: string) => void;
}) {
  return (
    <>
      <Field
        label="Your city"
        value={city}
        onChangeText={onCity}
        placeholder="e.g. Kolkata"
        maxLength={100}
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 20,
        }}
      >
        {["Kolkata", "Bengaluru", "Mumbai", "Delhi", "Pune", "Hyderabad"]
          .filter(
            (v) =>
              !city ||
              v.toLowerCase().includes(city.toLowerCase()) ||
              v === city,
          )
          .map((v) => (
            <Pressable
              key={v}
              accessibilityRole="button"
              onPress={() => onCity(v)}
              style={{
                padding: 12,
                backgroundColor: city === v ? "#E1EFEB" : "#F4E9DF",
                borderRadius: 20,
              }}
            >
              <Text style={{ color: c.teal }}>{v}</Text>
            </Pressable>
          ))}
      </View>
      <Field
        label="Approximate neighbourhood (optional)"
        placeholder="e.g. South Kolkata"
        maxLength={80}
        value={area}
        onChangeText={onArea}
      />
      <Notice>
        <Text style={{ fontWeight: "700" }}>Keep it approximate.{"\n"}</Text>
        Your exact home or office location is never shown on your public
        profile. No GPS permission is needed.
      </Notice>
    </>
  );
}
export async function uploadPhoto(
  uri: string,
  _mime: string,
  progress: (value: number) => void,
): Promise<string> {
  // Validate/refresh the existing session before a potentially slow upload.
  await api("/profile/completion");
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in again before uploading your photo.");
  progress(0);
  let jpegUri: string;
  try {
    jpegUri = (await compressPhoto(uri)).uri;
  } catch {
    throw new Error(
      "This photo could not be opened on your device. Select it again or choose another photo.",
    );
  }
  const body = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(jpegUri)).blob();
    if (!blob.size || blob.size >= 100_000)
      throw new Error(
        "This photo could not be compressed under 100 KB. Choose another photo.",
      );
    body.append("photo", blob, "profile.jpg");
  } else {
    // React Native reads this file directly. Fetching a file:// URI as a Blob can corrupt the transfer.
    body.append("photo", {
      uri: jpegUri,
      type: "image/jpeg",
      name: "profile.jpg",
    } as unknown as Blob);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl}/profile/photos`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Let the networking implementation set the multipart boundary.
    xhr.timeout = 45000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error("Upload failed. Check your connection and retry."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Please retry."));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body.data.id);
        else reject(new Error(body.error?.message ?? "Upload failed."));
      } catch {
        reject(new Error("Upload failed. Please retry."));
      }
    };
    xhr.send(body);
  });
}
const PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
];
/** Opens the library and returns validated photos. One square-cropped photo by default, or up to `limit` uncropped photos. */
export async function pickPhotos(
  limit = 1,
): Promise<{ uri: string; mime: string }[]> {
  if (Platform.OS !== "web") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      throw new Error(
        "Photo permission is needed to choose a picture. You can allow it in device settings, or skip for now.",
      );
  }
  const multiple = limit > 1;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: !multiple,
    aspect: [1, 1],
    allowsMultipleSelection: multiple,
    selectionLimit: limit,
    orderedSelection: multiple,
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map((asset) => {
    const mime = asset.mimeType ?? "image/jpeg";
    if (!PHOTO_TYPES.includes(mime))
      throw new Error("Choose a JPEG, PNG or WebP photo.");
    if (asset.fileSize && asset.fileSize > 30 * 1024 * 1024)
      throw new Error(
        "Choose a source photo up to 30 MB. Along will resize it before upload.",
      );
    return { uri: asset.uri, mime };
  });
}
export function PhotoUploader({
  uri,
  count = 0,
  authenticated,
  onPhoto,
}: {
  uri: string | null;
  count?: number;
  authenticated: boolean;
  onPhoto: (uri: string, mime: string, id?: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const [pending, setPending] = useState<{ uri: string; mime: string } | null>(
    null,
  );
  async function send(photo: { uri: string; mime: string }) {
    setBusy(true);
    setError("");
    try {
      const id = await uploadPhoto(photo.uri, photo.mime, setProgress);
      onPhoto(photo.uri, photo.mime, id);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.");
      void api("/onboarding/events", {
        method: "POST",
        body: JSON.stringify({ name: "photo_upload_failure" }),
      }).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function select() {
    if (busy || count >= 6) return;
    setError("");
    try {
      const [photo] = await pickPhotos();
      if (!photo) return;
      setPending(photo);
      if (authenticated) await send(photo);
      else {
        const compressed = await compressPhoto(photo.uri);
        onPhoto(compressed.uri, compressed.mimeType);
        setPending(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't select photo.");
    }
  }
  return (
    <View style={{ alignItems: "center", gap: 16, marginBottom: 24 }}>
      <View
        style={{
          width: 126,
          height: 126,
          borderRadius: 63,
          backgroundColor: "#F8E3D3",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: c.peach,
          overflow: "hidden",
        }}
      >
        {uri || pending?.uri ? (
          <Image
            accessibilityLabel="Your selected profile photo"
            source={{ uri: pending?.uri ?? uri! }}
            style={{ width: 126, height: 126 }}
          />
        ) : (
          <Ionicons
            name={count ? "checkmark-circle-outline" : "camera-outline"}
            color={c.teal}
            size={42}
          />
        )}
      </View>
      {count > 0 && (
        <Text style={text.muted}>
          {count} private photo{count === 1 ? "" : "s"} saved
        </Text>
      )}
      {!!uri && authenticated && count === 0 && !pending && (
        <Button
          loading={busy}
          variant="outline"
          onPress={() => void send({ uri, mime: "image/jpeg" })}
        >
          Upload Selected Photo
        </Button>
      )}
      <Button
        loading={busy}
        disabled={count >= 6}
        onPress={() => void select()}
        variant="outline"
      >
        {busy
          ? `Uploading ${progress}%`
          : count >= 6
            ? "6 photos added"
            : "Add Photo"}
      </Button>
      {busy && (
        <Text
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: progress }}
          style={text.muted}
        >
          {progress < 100 ? `Uploading ${progress}%` : "Processing your photo…"}
        </Text>
      )}
      <Text style={[text.muted, { textAlign: "center" }]}>
        Up to 6 photos · automatically compressed under 100 KB each{"\n"}Private
        until you activate discovery.
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#A83229" }}>
          {error}
        </Text>
      )}
      {!!pending && !!error && (
        <Button onPress={() => void send(pending)}>Retry Upload</Button>
      )}
    </View>
  );
}
export function AlongVibeCard({ draft }: { draft: Draft }) {
  return (
    <View
      style={{
        backgroundColor: c.teal,
        padding: 25,
        borderRadius: 26,
        gap: 18,
        marginVertical: 20,
      }}
    >
      <Text style={{ color: c.peach, letterSpacing: 1.3, fontSize: 11 }}>
        YOUR ALONG STARTER PROFILE
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {VIBES.filter((v) => draft.vibes.includes(v.id)).map((v) => (
          <Text
            key={v.id}
            style={{
              color: "white",
              backgroundColor: "#FFFFFF18",
              borderRadius: 12,
              padding: 9,
            }}
          >
            {v.label}
          </Text>
        ))}
      </View>
      <Text style={{ color: "white", fontSize: 21, fontWeight: "600" }}>
        {FIRST_PLANS.find((v) => v.id === draft.firstPlanIntent)?.label}
      </Text>
      <Text style={{ color: "#D6E5DF" }}>
        {draft.city} ·{" "}
        {RELATIONSHIPS.find((v) => v.id === draft.relationshipIntent)?.label}
      </Text>
    </View>
  );
}
export function ProfileCompletionPrompt({
  kind = "profile",
}: {
  kind?: string;
}) {
  const state = useOnboarding();
  const [now] = useState(() => Date.now());
  if ((state.dismissals[kind] ?? 0) > now) return null;
  const message =
    kind === "commute"
      ? "Want better commute matches? Add your usual travel window."
      : kind === "fitness"
        ? "Add your preferred workout time to find people who fit your routine."
        : "Your vibe is looking good. Want to add another photo?";
  return (
    <View
      style={{
        padding: 18,
        borderRadius: 20,
        backgroundColor: "#F6E6D9",
        gap: 12,
        marginVertical: 15,
      }}
    >
      <Text style={text.body}>{message}</Text>
      <Button variant="outline" onPress={() => router.push("/profile-edit")}>
        Update Profile
      </Button>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => state.dismiss(kind, false)}
          style={{ padding: 10 }}
        >
          <Text style={{ color: c.teal }}>Remind me later</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => state.dismiss(kind, true)}
          style={{ padding: 10 }}
        >
          <Text style={{ color: c.teal }}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
