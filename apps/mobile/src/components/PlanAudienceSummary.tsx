import React from "react";
import { Text, View } from "react-native";
import type { PlanAudience } from "../services/plans";
import { distanceRange } from "./DistancePreference";
import { text } from "./ui";
import { colors as c } from "../theme";

export function PlanAudienceSummary({
  audience,
}: {
  audience?: PlanAudience | null;
}) {
  if (!audience) return null;
  return (
    <View
      style={{
        padding: 16,
        marginTop: 18,
        marginBottom: 18,
        borderRadius: 18,
        backgroundColor: c.soft,
        gap: 8,
      }}
    >
      <Text style={text.label}>Who this plan is for</Text>
      <Text style={text.body}>
        Ages {audience.minAge}–{audience.maxAge} ·{" "}
        {audience.gender === "male"
          ? "Male"
          : audience.gender === "female"
            ? "Female"
            : "Both (all genders)"}
      </Text>
      <Text style={text.muted}>
        {audience.maxDistanceKm == null
          ? "Any distance"
          : `Within ${distanceRange(audience.maxDistanceKm, audience.distanceUnit)} ${audience.distanceUnit} of the organizer's approximate plan location`}
      </Text>
    </View>
  );
}
