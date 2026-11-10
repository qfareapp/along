import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors as c } from "../theme";
export type ScheduleMode = "exact" | "range";
export type PlanSchedule = { dateMode: ScheduleMode; timeMode: ScheduleMode };
export function ScheduleModeToggle({
  value,
  onChange,
  labels,
}: {
  value: ScheduleMode;
  onChange: (mode: ScheduleMode) => void;
  labels: [exact: string, range: string];
}) {
  return (
    <View
      role="radiogroup"
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 3,
        borderRadius: 13,
        backgroundColor: c.soft,
        borderWidth: 1,
        borderColor: c.line,
        marginBottom: 12,
      }}
    >
      {(["exact", "range"] as const).map((mode, index) => {
        const selected = value === mode;
        return (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(mode)}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? c.teal : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                color: selected ? c.white : c.teal,
              }}
            >
              {labels[index]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
/** Turns the picked dates and times into startsAt/endsAt, or explains what is wrong. */
export function scheduleRange({
  schedule,
  date,
  endDate,
  time,
  endTime,
}: {
  schedule: PlanSchedule;
  date: string;
  endDate?: string;
  time: string;
  endTime?: string;
}): { startsAt: Date; endsAt?: Date } | { error: string } {
  const dateRange = schedule.dateMode === "range",
    timeRange = schedule.timeMode === "range";
  const startsAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date())
    return { error: "Choose a valid date and time in the future." };
  if (dateRange && (!endDate || endDate <= date))
    return { error: "The last date must be after the first date." };
  if (timeRange && (!endTime || endTime <= time))
    return { error: "The end time must be after the start time." };
  if (!dateRange && !timeRange) return { startsAt };
  const endsAt = new Date(
    `${dateRange ? endDate : date}T${timeRange ? endTime : time}:00`,
  );
  if (Number.isNaN(endsAt.getTime()))
    return { error: "Choose a valid end date and time." };
  return { startsAt, endsAt };
}
const dayLabel = (date: Date) =>
  date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const timeLabel = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** Human-readable "when" for a plan, honouring its exact/range schedule. */
export function formatSchedule(
  startsAt: string,
  endsAt: string | null,
  schedule?: PlanSchedule | null,
) {
  const start = new Date(startsAt),
    end = endsAt ? new Date(endsAt) : undefined;
  if (!schedule || !end) return `${dayLabel(start)} · ${timeLabel(start)}`;
  const days =
    schedule.dateMode === "range"
      ? `${dayLabel(start)} – ${dayLabel(end)}`
      : dayLabel(start);
  const times =
    schedule.timeMode === "range"
      ? `${timeLabel(start)} – ${timeLabel(end)}`
      : timeLabel(start);
  return `${days} · ${times}`;
}
