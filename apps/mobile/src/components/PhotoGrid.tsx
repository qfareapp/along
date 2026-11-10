import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, text } from "./ui";
import { pickPhotos, uploadPhoto } from "./onboarding";
import { MemberPhoto } from "../features/LiveDiscover";
import { api } from "../services/api";
import { colors as c } from "../theme";

export const MAX_PHOTOS = 6;

export function PhotoGrid({
  photoIds,
  onChange,
}: {
  photoIds: string[];
  onChange: (change: { added?: string[]; removed?: string }) => Promise<void>;
}) {
  const [uploading, setUploading] = useState<{
    done: number;
    total: number;
    progress: number;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState("");
  const remaining = MAX_PHOTOS - photoIds.length;
  const pendingSlots = uploading ? uploading.total - uploading.done : 0;

  async function add() {
    if (uploading || remaining <= 0) return;
    setError("");
    let picked: { uri: string; mime: string }[];
    try {
      picked = await pickPhotos(remaining);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't select photos.");
      return;
    }
    if (!picked.length) return;
    const added: string[] = [];
    setUploading({ done: 0, total: picked.length, progress: 0 });
    try {
      for (const photo of picked) {
        added.push(
          await uploadPhoto(photo.uri, photo.mime, (progress) =>
            setUploading((u) => u && { ...u, progress }),
          ),
        );
        setUploading((u) => u && { ...u, done: u.done + 1, progress: 0 });
      }
    } catch (e) {
      setError(
        `${added.length ? `${added.length} of ${picked.length} uploaded. ` : ""}${
          e instanceof Error ? e.message : "Photo upload failed."
        }`,
      );
    } finally {
      setUploading(null);
      if (added.length) await onChange({ added });
    }
  }
  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }
  const remove = (id: string) =>
    run(id, async () => {
      await api(`/profile/photos/${id}`, { method: "DELETE" });
      setConfirmRemove(null);
      await onChange({ removed: id });
    });
  const makeMain = (id: string) =>
    run(id, async () => {
      await api(`/profile/photos/${id}/main`, { method: "POST" });
      await onChange({});
    });

  const slots = Array.from({ length: MAX_PHOTOS }, (_, i) => i);
  return (
    <View style={{ marginBottom: 22 }}>
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Text style={text.label}>Your photos</Text>
        <Text style={{ color: c.coralBright, fontWeight: "700", fontSize: 13 }}>
          {photoIds.length}/{MAX_PHOTOS}
        </Text>
      </View>
      <Text
        style={[text.muted, { fontSize: 12, marginTop: 2, marginBottom: 12 }]}
      >
        Add up to {MAX_PHOTOS}. Your first photo is the one people see first.
        {"\n"}Photos are automatically compressed under 100 KB each.
      </Text>
      <View style={s.grid}>
        {slots.map((i) => {
          const id = photoIds[i];
          if (id)
            return (
              <View key={id} style={s.slot}>
                <MemberPhoto id={id} style={s.fill} />
                {i === 0 ? (
                  <View style={s.mainBadge}>
                    <Ionicons name="star" size={10} color={c.white} />
                    <Text style={s.mainText}>Main</Text>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Make photo ${i + 1} your main photo`}
                    disabled={!!busyId}
                    onPress={() => void makeMain(id)}
                    style={[s.corner, { left: 6 }]}
                  >
                    <Ionicons name="star-outline" size={14} color={c.white} />
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  disabled={!!busyId}
                  onPress={() =>
                    photoIds.length === 1
                      ? setConfirmRemove(id)
                      : void remove(id)
                  }
                  style={[s.corner, { right: 6 }]}
                >
                  <Ionicons name="close" size={15} color={c.white} />
                </Pressable>
                {busyId === id && (
                  <View style={s.overlay}>
                    <ActivityIndicator color={c.white} />
                  </View>
                )}
              </View>
            );
          if (i < photoIds.length + pendingSlots)
            return (
              <View key={`pending-${i}`} style={[s.slot, s.empty]}>
                <ActivityIndicator color={c.teal} />
                {i === photoIds.length && (
                  <Text style={s.progress}>{uploading?.progress ?? 0}%</Text>
                )}
              </View>
            );
          return (
            <Pressable
              key={`empty-${i}`}
              accessibilityRole="button"
              accessibilityLabel="Add photos"
              disabled={!!uploading}
              onPress={() => void add()}
              style={({ pressed }) => [
                s.slot,
                s.empty,
                pressed && { opacity: 0.6 },
              ]}
            >
              <View style={s.plus}>
                <Ionicons name="add" size={20} color={c.white} />
              </View>
            </Pressable>
          );
        })}
      </View>
      {!!uploading && (
        <Text
          accessibilityRole="progressbar"
          style={[text.muted, { marginTop: 10 }]}
        >
          Uploading {uploading.done + 1} of {uploading.total}…
        </Text>
      )}
      {!!confirmRemove && (
        <View style={s.confirm}>
          <Text style={[text.body, { color: c.teal }]}>
            This is your only photo. Removing it hides you from discovery until
            you add another.
          </Text>
          <View style={[s.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Button variant="outline" onPress={() => setConfirmRemove(null)}>
                Keep
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                loading={busyId === confirmRemove}
                onPress={() => void remove(confirmRemove)}
              >
                Remove
              </Button>
            </View>
          </View>
        </View>
      )}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{ color: "#A83229", marginTop: 10 }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  slot: {
    width: "31%",
    flexGrow: 1,
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: "hidden",
  },
  fill: { width: "100%", height: "100%" },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#F2C4B2",
    backgroundColor: "#FFFBF7",
  },
  plus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  corner: {
    position: "absolute",
    top: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#093E43AA",
    alignItems: "center",
    justifyContent: "center",
  },
  mainBadge: {
    position: "absolute",
    left: 6,
    top: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: c.coralBright,
  },
  mainText: { color: c.white, fontSize: 10, fontWeight: "700" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#093E4366",
    alignItems: "center",
    justifyContent: "center",
  },
  progress: { color: c.teal, fontSize: 11, marginTop: 6 },
  confirm: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#E9F0EB",
    gap: 12,
  },
});
