import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Location from "expo-location";
import { Button, Chip, Field, text } from "./ui";

export type DistanceChoice = {
  range: string;
  unit: "km" | "mi";
  location?: { latitude: number; longitude: number };
};
export function distanceRange(km: number, unit: DistanceChoice["unit"]) {
  const range = km / (unit === "mi" ? 1.609344 : 1);
  return String(
    Math.abs(range - Math.round(range)) < 0.001
      ? Math.round(range)
      : Number(range.toFixed(4)),
  );
}
export const distanceKm = (value: DistanceChoice) =>
  value.range.trim() === ""
    ? null
    : Math.round(
        Number(value.range) * (value.unit === "mi" ? 1.609344 : 1) * 1000,
      ) / 1000;
export function validDistance(value: DistanceChoice) {
  const km = distanceKm(value);
  return (
    km === null ||
    (Number.isFinite(km) && km >= 1 && km <= 500 && !!value.location)
  );
}

export function DistancePreference({
  value,
  onChange,
  context = "profile",
}: {
  value: DistanceChoice;
  onChange: (value: DistanceChoice) => void;
  context?: "profile" | "plan";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);
  async function locate() {
    setBusy(true);
    setError("");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Allow location access in your device settings, then try again.",
        );
      const position = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  "Couldn't find your location. Check that location services are on and try again.",
                ),
              ),
            20000,
          );
        }),
      ]);
      onChange({
        ...latestValue.current,
        location: {
          latitude: Math.round(position.coords.latitude * 1000) / 1000,
          longitude: Math.round(position.coords.longitude * 1000) / 1000,
        },
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't get your location. Try again.",
      );
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }
  const maximum = value.unit === "km" ? "500" : "310.68";
  return (
    <View style={{ gap: 12, marginBottom: 22 }}>
      <Text style={text.label}>
        {context === "plan"
          ? "Distance for this plan"
          : "Distance from your location"}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["km", "mi"] as const).map((unit) => (
          <Chip
            key={unit}
            selected={value.unit === unit}
            onPress={() => {
              const km = distanceKm(value);
              onChange({
                ...value,
                unit,
                range: km === null ? "" : distanceRange(km, unit),
              });
            }}
          >
            {unit === "km" ? "Kilometres (km)" : "Miles (mi)"}
          </Chip>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip
          selected={value.range === ""}
          onPress={() => onChange({ ...value, range: "" })}
        >
          Any distance
        </Chip>
        {[5, 10, 25, 50, 100, 250].map((range) => (
          <Chip
            key={range}
            selected={Number(value.range) === range}
            onPress={() => onChange({ ...value, range: String(range) })}
          >
            Within {range} {value.unit}
          </Chip>
        ))}
      </View>
      <Field
        label={`Custom maximum distance (${value.unit})`}
        value={value.range}
        onChangeText={(range) => onChange({ ...value, range })}
        placeholder={`Up to ${maximum} ${value.unit}; leave blank for any distance`}
        keyboardType="decimal-pad"
        maxLength={10}
      />
      {distanceKm(value) !== null &&
        !validDistance({
          ...value,
          location: { latitude: 0, longitude: 0 },
        }) && (
          <Text accessibilityRole="alert" style={{ color: "#A83229" }}>
            Choose a distance from{" "}
            {value.unit === "km" ? "1–500 km" : "0.622–310.68 mi"}.
          </Text>
        )}
      <Button variant="outline" loading={busy} onPress={() => void locate()}>
        {value.location ? "Update My Location" : "Use My Location"}
      </Button>
      <Text style={text.muted}>
        {context === "plan" ? (
          "Set an approximate location for this plan when choosing a distance. Only people within that radius can find and request it; your coordinates are never shown. This does not update your profile location."
        ) : (
          <>
            {value.location
              ? "Location ready. Save your preferences to apply changes. "
              : "Set your location to use a distance range. "}
            Your radius includes nearby cities. Only an approximate location is
            saved; it is never shown on your profile. Update it here when you
            move.
          </>
        )}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#A83229" }}>
          {error}
        </Text>
      )}
    </View>
  );
}
