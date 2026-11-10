import React, { useEffect, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, text } from "../components/ui";
import DateTimeField from "../components/DateTimeField";
import { localDate, localTime } from "../components/dateTime";
import { api } from "../services/api";
import {
  type ExpiringPlan,
  useExpiringPlans,
  useRefreshPlans,
} from "../services/plans";
import { formatSchedule } from "./PlanSchedule";
import { colors as c, shadow } from "../theme";
/** Asks the owner to extend or close each plan whose dates have passed. */
export function ExpiredPlanPrompt() {
  const expiring = useExpiringPlans();
  const { refetch } = expiring;
  // Re-check whenever the member comes back to the app.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetch();
    });
    return () => subscription.remove();
  }, [refetch]);
  const plan = expiring.data?.[0];
  return plan ? <PlanDecision key={plan._id} plan={plan} /> : null;
}
function PlanDecision({ plan }: { plan: ExpiringPlan }) {
  const refresh = useRefreshPlans();
  const [extending, setExtending] = useState(false),
    [date, setDate] = useState(""),
    [time, setTime] = useState(() => localTime(new Date(plan.startsAt))),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      setBusy(false);
    }
  }
  const setState = (state: "closed" | "expired") =>
    act(() =>
      api(`/activities/${plan._id}/state`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      }),
    );
  const extend = () =>
    act(async () => {
      const start = new Date(`${date}T${time}:00`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(start.getTime()) ||
        start <= new Date()
      )
        throw new Error("Choose a valid future date and time.");
      // Keep the plan's original length so date and time ranges carry over.
      const duration = plan.endsAt
        ? new Date(plan.endsAt).getTime() - new Date(plan.startsAt).getTime()
        : 0;
      await api(`/activities/${plan._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          startsAt: start.toISOString(),
          endsAt:
            duration > 0
              ? new Date(start.getTime() + duration).toISOString()
              : null,
        }),
      });
    });
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => void setState("expired")}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(20,34,38,0.55)",
          justifyContent: "center",
          padding: 22,
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.ivory,
            borderRadius: 28,
            padding: 22,
            maxWidth: 440,
            width: "100%",
            alignSelf: "center",
            ...shadow,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 18,
              backgroundColor: "#FFE1D5",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Ionicons
              name="hourglass-outline"
              size={26}
              color={c.coralBright}
            />
          </View>
          <Text
            style={{
              color: c.teal,
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            Your plan has ended
          </Text>
          <Text style={[text.title, { fontSize: 22, marginTop: 6 }]}>
            {plan.title}
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
            }}
          >
            <Ionicons name="calendar-outline" size={14} color={c.muted} />
            <Text style={[text.muted, { fontSize: 12 }]}>
              {formatSchedule(plan.startsAt, plan.endsAt, plan.schedule)}
            </Text>
          </View>
          <Text style={[text.body, { marginTop: 14 }]}>
            Want to keep it going? Extend it to a new date, or close it if
            you&apos;re done. If you skip, we&apos;ll mark it as expired.
          </Text>
          {extending && (
            <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
              <View style={{ flex: 1 }}>
                <DateTimeField
                  label="New date"
                  mode="date"
                  minimumDate={localDate()}
                  value={date}
                  onChange={setDate}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DateTimeField
                  label="Time"
                  mode="time"
                  value={time}
                  onChange={setTime}
                />
              </View>
            </View>
          )}
          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{ color: "#BA4034", marginTop: 10 }}
            >
              {error}
            </Text>
          )}
          <View style={{ gap: 10, marginTop: extending ? 4 : 20 }}>
            <Button
              variant="coral"
              icon="calendar-number-outline"
              loading={busy && extending}
              disabled={busy || (extending && !date)}
              onPress={() => (extending ? void extend() : setExtending(true))}
            >
              {extending ? "Save new date" : "Extend plan"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onPress={() => void setState("closed")}
            >
              Close plan
            </Button>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void setState("expired")}
              style={{ paddingVertical: 8 }}
            >
              <Text
                style={{
                  textAlign: "center",
                  color: c.muted,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                Not now · Mark as expired
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
