import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  Empty,
  Header,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { api } from "../services/api";
import {
  airportDecision,
  airportLocation,
  useAirportConnections,
  useAirportState,
  type AirportConnection,
  type NearbyAirport,
} from "../services/airports";
import { type MemberCard, type SwipeAction } from "../services/discovery";
import { colors as c, shadow } from "../theme";
import { ProfileCard } from "../components/DiscoveryCard";
import { useAppLayout } from "../components/layout";
import {
  AirportModeToggle,
  BoardingPass,
  IntentTile,
  RevealOnMount,
  MetaPill,
  PrivacyPoint,
  SectionLabel,
  StepHeader,
  airportIntents,
  airportPanel,
  formatMinutes,
  intentLabel,
  useMinutesLeft,
} from "../components/AirportUI";

type Traveller = MemberCard & {
  zone: string;
  intentions: string[];
  availableUntil: string;
  availableMinutes: number;
  canMeet: boolean;
  canDate: boolean;
};
export function AirportHeaderButton() {
  const [open, setOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [motion] = useState(() => new Animated.Value(0));
  const anchor = useRef<React.ComponentRef<typeof View>>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [position, setPosition] = useState({ x: 16, bottom: insets.top + 60 });
  const nearby = useQuery({
    queryKey: ["airport-nearby"],
    queryFn: async () => {
      if (AppState.currentState !== "active") return [];
      const location = await airportLocation();
      return api<NearbyAirport[]>("/airports/nearby", {
        method: "POST",
        body: JSON.stringify(location),
      });
    },
    retry: false,
    staleTime: 60000,
    refetchInterval: 60000,
  });
  const airport = nearby.isError ? undefined : nearby.data?.[0];
  const { refetch } = nearby;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
      if (next === "active") void refetch();
      else setOpen(false);
    });
    return () => subscription.remove();
  }, [refetch]);
  useEffect(() => {
    if (!airport || reducedMotion || !appActive) {
      motion.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(motion, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
        Animated.timing(motion, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== "web",
          isInteraction: false,
        }),
        Animated.delay(600),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      motion.setValue(0);
    };
  }, [airport, reducedMotion, appActive, motion]);
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    anchor.current?.measureInWindow((x, y, _width, anchorHeight) => {
      setPosition({ x, bottom: y + anchorHeight });
      setOpen(true);
    });
  }
  const cardWidth = Math.min(360, width - 32);
  const left = Math.max(
    16,
    Math.min(position.x + 44 - cardWidth, width - cardWidth - 16),
  );
  const top = Math.min(
    Math.max(insets.top + 8, position.bottom + 10),
    Math.max(insets.top + 8, height - insets.bottom - 240),
  );
  return (
    <>
      <View ref={anchor} collapsable={false}>
        <Pressable
          testID="airport-header-button"
          accessibilityRole="button"
          accessibilityLabel="Airport Mode"
          accessibilityHint="Opens the airport activation card"
          accessibilityState={{ expanded: open }}
          accessibilityValue={{
            text: airport ? "Airport nearby" : "No supported airport nearby",
          }}
          onPress={toggle}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.65 : 1,
          })}
        >
          {airport && (
            <>
              <Animated.View
                testID="airport-flight-glyph"
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: c.coral,
                  opacity: motion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.12, 0.3],
                  }),
                  transform: [
                    {
                      scale: motion.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.3],
                      }),
                    },
                  ],
                }}
              />
              <LinearGradient
                testID="airport-nearby-colour"
                colors={[c.teal, "#327E78", c.coral]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: "absolute",
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                }}
              />
            </>
          )}
          <Animated.View
            pointerEvents="none"
            style={{
              transform: [
                {
                  translateY: motion.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -3],
                  }),
                },
                {
                  rotate: motion.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "-9deg"],
                  }),
                },
              ],
            }}
          >
            <Ionicons
              name={airport ? "airplane" : "airplane-outline"}
              size={23}
              color={airport ? c.white : c.charcoal}
            />
          </Animated.View>
        </Pressable>
      </View>
      <Modal
        visible={open}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close airport card"
            onPress={() => setOpen(false)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "#102C3026",
            }}
          />
          <View
            testID="airport-floating-card"
            accessibilityViewIsModal
            style={{
              position: "absolute",
              top,
              left,
              width: cardWidth,
              borderRadius: 20,
              backgroundColor: c.white,
              ...shadow,
            }}
          >
            <ScrollView
              style={{
                maxHeight: Math.max(120, height - top - insets.bottom - 16),
              }}
              bounces={false}
            >
              <AirportEntryCard
                airport={airport}
                onPress={() => {
                  setOpen(false);
                  router.push("/airport");
                }}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
function AirportEntryCard({
  airport,
  onPress,
}: {
  airport?: NearbyAirport;
  onPress: () => void;
}) {
  const body = (
    <>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: airport ? "#FFFFFF1F" : c.white,
        }}
      >
        <Ionicons
          name="airplane"
          size={24}
          color={airport ? c.peach : c.teal}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[text.label, { color: airport ? c.white : c.teal }]}>
            Airport Mode
          </Text>
          {!!airport?.iataCode && (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 7,
                backgroundColor: c.coral,
              }}
            >
              <Text style={{ color: c.white, fontSize: 11, fontWeight: "700" }}>
                {airport.iataCode}
              </Text>
            </View>
          )}
        </View>
        <Text style={[text.muted, { color: airport ? c.ivory : c.muted }]}>
          {airport
            ? "At the airport? Meet people waiting Along."
            : "Waiting for your flight? Check airport availability."}
        </Text>
      </View>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: airport ? c.white : c.teal,
        }}
      >
        <Ionicons
          name="arrow-forward"
          size={16}
          color={airport ? c.teal : c.white}
        />
      </View>
    </>
  );
  const row = {
    minHeight: 104,
    padding: 18,
    gap: 14,
    flexDirection: "row",
    alignItems: "center",
  } as const;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open Airport Mode setup"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {airport ? (
        <LinearGradient
          colors={[c.tealDark, c.teal, "#2F7A73"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ ...row, borderRadius: 20 }}
        >
          {body}
        </LinearGradient>
      ) : (
        <View style={{ ...row, borderRadius: 20, backgroundColor: c.soft }}>
          {body}
        </View>
      )}
    </Pressable>
  );
}
function goHome() {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
}
export function AirportSetup() {
  const client = useQueryClient(),
    state = useAirportState();
  const [nearby, setNearby] = useState<NearbyAirport[]>([]),
    [selected, setSelected] = useState<NearbyAirport | null>(null);
  const [zone, setZone] = useState(""),
    [minutes, setMinutes] = useState(60),
    [chosen, setChosen] = useState<string[]>(["conversation"]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState(false),
    [consent, setConsent] = useState(false);
  async function detect() {
    setBusy(true);
    setError("");
    try {
      const location = await airportLocation(true);
      const rows = await api<NearbyAirport[]>("/airports/nearby", {
        method: "POST",
        body: JSON.stringify(location),
      });
      setNearby(rows);
      setChecked(true);
      setSelected(rows.length === 1 ? rows[0] : null);
      setZone("");
      await client.invalidateQueries({ queryKey: ["airport-nearby"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't detect your airport.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function activate() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const location = await airportLocation();
      await api("/airports/check-in", {
        method: "POST",
        body: JSON.stringify({
          airportId: selected.id,
          zoneId: zone,
          minutes,
          intentions: chosen,
          consent,
          location,
        }),
      });
      await client.invalidateQueries({ queryKey: ["airport-state"] });
      goHome();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't turn on Airport Mode.",
      );
    } finally {
      setBusy(false);
    }
  }
  const missing = !zone
    ? "Pick the zone you're waiting in"
    : !chosen.length
      ? "Choose at least one thing you're up for"
      : !consent
        ? "Confirm you're happy to be visible"
        : "";
  return (
    <Screen width="reading">
      <Header title="Airport Mode" back />
      <View style={{ borderRadius: 26, marginBottom: 18, ...shadow }}>
        <LinearGradient
          colors={[c.tealDark, c.teal, "#2F7A73"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 26, padding: 22, overflow: "hidden", gap: 10 }}
        >
          <Ionicons
            name="airplane"
            size={170}
            color="#FFFFFF0F"
            style={{
              position: "absolute",
              right: -30,
              bottom: -36,
              transform: [{ rotate: "-25deg" }],
            }}
          />
          <View
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 12,
              backgroundColor: "#FFFFFF1F",
            }}
          >
            <Ionicons name="time-outline" size={13} color={c.peach} />
            <Text style={{ color: c.ivory, fontSize: 12, fontWeight: "600" }}>
              Turn layovers into good company
            </Text>
          </View>
          <Text
            style={[
              text.title,
              { color: c.white, fontSize: 27, lineHeight: 33 },
            ]}
          >
            Same airport.{"\n"}A new connection.
          </Text>
          <Text style={{ color: "#D6E6E3", fontSize: 14, lineHeight: 21 }}>
            Use your Along profile to meet adults waiting at your airport. You
            choose when to become visible.
          </Text>
        </LinearGradient>
      </View>
      {!!error && <Notice>{error}</Notice>}
      {state.data?.active ? (
        <BoardingPass
          code={state.data.airport?.iataCode ?? ""}
          title={state.data.airport?.name ?? "Your airport"}
          subtitle="You're visible to travellers here."
          footer={
            <Button variant="coral" icon="people-outline" onPress={goHome}>
              See people at my airport
            </Button>
          }
        />
      ) : (
        <>
          <View style={airportPanel}>
            <StepHeader
              step={1}
              done={!!selected}
              title="Find your airport"
              description="We'll check which supported airport you're at."
            />
            <Button
              icon="locate-outline"
              variant={checked && nearby.length ? "outline" : "primary"}
              loading={busy && !selected}
              onPress={() => void detect()}
            >
              {checked ? "Detect again" : "Detect my airport"}
            </Button>
            {checked && !nearby.length && (
              <Empty
                icon="airplane-outline"
                title="No supported airport nearby"
                description="Airport Mode becomes available near an airport configured by Along. Try again inside the terminal. Imported airports stay unavailable until configured."
              />
            )}
            {nearby.map((airport) => {
              const active = selected?.id === airport.id;
              return (
                <Pressable
                  key={airport.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${airport.city} · ${airport.iataCode}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setSelected(airport);
                    setZone("");
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    padding: 14,
                    borderRadius: 18,
                    borderWidth: 1.5,
                    borderColor: active ? c.teal : "#EFE3D8",
                    backgroundColor: active ? "#F1F7F5" : "#FFFBF7",
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View
                    style={{
                      minWidth: 62,
                      paddingVertical: 10,
                      paddingHorizontal: 8,
                      borderRadius: 14,
                      alignItems: "center",
                      backgroundColor: active ? c.teal : c.soft,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "800",
                        letterSpacing: 0.5,
                        color: active ? c.white : c.teal,
                      }}
                    >
                      {airport.iataCode}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={text.label}>{airport.city}</Text>
                    <Text style={text.muted} numberOfLines={2}>
                      {airport.name}
                    </Text>
                    {airport.approximate && (
                      <Text
                        style={[text.muted, { fontSize: 11, lineHeight: 15 }]}
                      >
                        Approximate airport proximity, not verified terminal
                        access.
                      </Text>
                    )}
                  </View>
                  <Ionicons
                    name={active ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={active ? c.teal : "#D8CBBF"}
                  />
                </Pressable>
              );
            })}
          </View>
          {selected && (
            <>
              <View style={airportPanel}>
                <StepHeader
                  step={2}
                  done={!!zone && !!chosen.length}
                  title="Set up your visit"
                  description="Tell travellers where you are and what you're up for."
                />
                <SectionLabel icon="location-outline">
                  Where are you waiting?
                </SectionLabel>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {selected.zones.map((v) => (
                    <Chip
                      key={v.id}
                      icon={zone === v.id ? "checkmark" : "pin-outline"}
                      selected={zone === v.id}
                      onPress={() => setZone(v.id)}
                    >
                      {v.name}
                    </Chip>
                  ))}
                </View>
                <Text style={[text.muted, { fontSize: 12, marginTop: -6 }]}>
                  Coffee is available only between configured compatible zones.
                </Text>
                <SectionLabel icon="hourglass-outline">
                  How much time do you have?
                </SectionLabel>
                <View
                  style={{
                    flexDirection: "row",
                    padding: 4,
                    borderRadius: 16,
                    backgroundColor: c.soft,
                  }}
                >
                  {[30, 60, 90, 120].map((n) => {
                    const on = minutes === n;
                    return (
                      <Pressable
                        key={n}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${n} minutes`}
                        onPress={() => setMinutes(n)}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          paddingVertical: 10,
                          borderRadius: 12,
                          backgroundColor: on ? c.white : "transparent",
                          ...(on ? shadow : {}),
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: "700",
                            color: on ? c.teal : c.muted,
                          }}
                        >
                          {formatMinutes(n)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <SectionLabel icon="sparkles-outline">
                  What are you up for?
                </SectionLabel>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                >
                  {Object.keys(airportIntents).map((key) => (
                    <IntentTile
                      key={key}
                      intent={key}
                      selected={chosen.includes(key)}
                      onPress={() =>
                        setChosen((v) =>
                          v.includes(key)
                            ? v.filter((x) => x !== key)
                            : [...v, key],
                        )
                      }
                    />
                  ))}
                </View>
              </View>
              <View style={airportPanel}>
                <StepHeader
                  step={3}
                  done={consent}
                  title="Your privacy"
                  description="You stay in control the whole time."
                />
                <PrivacyPoint icon="navigate-circle-outline">
                  Location is checked only while Along is open. No background
                  tracking.
                </PrivacyPoint>
                <PrivacyPoint icon="eye-off-outline">
                  Your exact coordinates are never shown to other people.
                </PrivacyPoint>
                <PrivacyPoint icon="timer-outline">
                  You disappear automatically after {formatMinutes(minutes)}, or
                  whenever you leave.
                </PrivacyPoint>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: consent }}
                  onPress={() => setConsent((v) => !v)}
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: 1.5,
                    borderColor: consent ? c.teal : "#EFE3D8",
                    backgroundColor: consent ? "#F1F7F5" : "#FFFBF7",
                  }}
                >
                  <Ionicons
                    name={consent ? "checkbox" : "square-outline"}
                    size={24}
                    color={c.teal}
                  />
                  <Text style={[text.body, { flex: 1 }]}>
                    Show my profile to eligible travellers during this visit.
                    Airport connections continue only if we both choose to stay
                    connected.
                  </Text>
                </Pressable>
              </View>
              {!!missing && (
                <Text
                  style={[
                    text.muted,
                    { textAlign: "center", marginBottom: 10 },
                  ]}
                >
                  {missing}
                </Text>
              )}
              <Button
                icon="airplane"
                variant="coral"
                disabled={!!missing}
                loading={busy}
                onPress={() => void activate()}
              >
                Turn on Airport Mode
              </Button>
            </>
          )}
        </>
      )}
      <AirportRequests />
    </Screen>
  );
}
function connectionStatus(row: AirportConnection): {
  label: string;
  detail: string;
  tone: string;
  bg: string;
} {
  if (row.needsDecision)
    return row.kept
      ? {
          label: "Waiting",
          detail: "Waiting for their choice to stay connected.",
          tone: "#9A6A1F",
          bg: "#FBEFD9",
        }
      : {
          label: "Visit ended",
          detail: "Your airport visit together has ended.",
          tone: c.muted,
          bg: "#EFEAE5",
        };
  if (row.state === "pending")
    return row.incoming
      ? {
          label: "New request",
          detail: "Would you like to connect?",
          tone: c.coralBright,
          bg: "#FDE6E1",
        }
      : {
          label: "Invited",
          detail: "Invitation sent. Waiting for their reply.",
          tone: "#9A6A1F",
          bg: "#FBEFD9",
        };
  return {
    label: "Connected",
    detail: "Connected during this airport visit.",
    tone: c.green,
    bg: "#E3EFEC",
  };
}
export function AirportRequests() {
  const rows = useAirportConnections(),
    client = useQueryClient();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function decide(id: string, action: "accept" | "end") {
    setBusy(id);
    setError("");
    try {
      const result = await airportDecision(id, action);
      await client.invalidateQueries({ queryKey: ["airport-connections"] });
      await client.invalidateQueries({ queryKey: ["airport-notices"] });
      await client.invalidateQueries({ queryKey: ["conversations"] });
      if (result.conversationId && action === "accept")
        router.push(`/chat?id=${result.conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy("");
    }
  }
  if (!rows.data?.length && !rows.isError) return null;
  return (
    <View style={{ marginTop: 22, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="airplane-outline" size={18} color={c.teal} />
        <Text
          accessibilityRole="header"
          style={[text.label, { fontSize: 16, flex: 1 }]}
        >
          Airport connections
        </Text>
        {!!rows.data?.length && (
          <View
            style={{
              minWidth: 24,
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 12,
              backgroundColor: c.teal,
              alignItems: "center",
            }}
          >
            <Text style={{ color: c.white, fontSize: 12, fontWeight: "700" }}>
              {rows.data.length}
            </Text>
          </View>
        )}
      </View>
      {!!error && <Notice>{error}</Notice>}
      {rows.isError && <Notice>{rows.error.message}</Notice>}
      {rows.data?.map((row) => {
        const status = connectionStatus(row);
        const meta = airportIntents[row.intent];
        const incoming = row.state === "pending" && row.incoming;
        return (
          <View key={row.id} style={[airportPanel, { marginBottom: 0 }]}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: meta?.tint ?? c.soft,
                }}
              >
                <Text
                  style={{ color: c.teal, fontSize: 18, fontWeight: "700" }}
                >
                  {row.name.charAt(0).toUpperCase()}
                </Text>
                <View
                  style={{
                    position: "absolute",
                    right: -3,
                    bottom: -3,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: c.white,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={meta?.icon ?? "airplane"}
                    size={11}
                    color={c.teal}
                  />
                </View>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={text.label}>
                  {row.name} · {intentLabel(row.intent)}
                </Text>
                <Text style={text.muted}>{status.detail}</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 10,
                  backgroundColor: status.bg,
                }}
              >
                <Text
                  style={{
                    color: status.tone,
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {status.label}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onPress={() => void decide(row.id, "end")}
                >
                  {incoming ? "Not now" : "End connection"}
                </Button>
              </View>
              {incoming ? (
                <View style={{ flex: 1 }}>
                  <Button
                    icon="checkmark"
                    loading={busy === row.id}
                    onPress={() => void decide(row.id, "accept")}
                  >
                    Accept connection
                  </Button>
                </View>
              ) : (
                !!row.conversationId && (
                  <View style={{ flex: 1 }}>
                    <Button
                      icon="chatbubble-ellipses-outline"
                      onPress={() =>
                        router.push(`/chat?id=${row.conversationId}`)
                      }
                    >
                      Open chat
                    </Button>
                  </View>
                )
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
// Remembered for the session so the card stays as the traveller left it
// when they open a profile or chat and come back.
let airportCardExpanded = true;
export function AirportDiscovery() {
  const layout = useAppLayout();
  const [cardOpen, setCardOpen] = useState(airportCardExpanded);
  const toggleCard = () =>
    setCardOpen((open) => {
      airportCardExpanded = !open;
      return !open;
    });
  const state = useAirportState(),
    client = useQueryClient();
  const [dismissed, setDismissed] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [intent, setIntent] = useState("conversation"),
    [busy, setBusy] = useState(false);
  const minutesLeft = useMinutesLeft(state.data?.session?.availableUntil);
  const zoneName = state.data?.airport?.zones.find(
    (z) => z.id === state.data?.session?.zoneId,
  )?.name;
  const feed = useQuery({
    queryKey: ["airport-discover", state.data?.session?.visitId],
    queryFn: () =>
      api<{ items: Traveller[]; nextCursor: string | null }>(
        "/airports/discover",
      ),
    enabled: !!state.data?.active,
    retry: false,
    refetchInterval: 30000,
  });
  const candidates =
      feed.data?.items.filter((v) => !dismissed.includes(v.id)) ?? [],
    member = candidates[0];
  const shared =
    member?.intentions.filter(
      (v) =>
        state.data?.session?.intentions.includes(v) &&
        (v !== "dating" || member.canDate) &&
        (v !== "coffee" || member.canMeet),
    ) ?? [];
  const selectedIntent = shared.includes(intent) ? intent : shared[0];
  async function leave() {
    setBusy(true);
    setError("");
    try {
      await api("/airports/check-out", { method: "POST" });
      await client.invalidateQueries({ queryKey: ["airport-state"] });
      await client.invalidateQueries({ queryKey: ["airport-connections"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function act(person: MemberCard, action: SwipeAction) {
    if (action === "pass") {
      setDismissed((v) => [...v, person.id]);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setDismissed((v) => [...v, person.id]);
    try {
      if (!selectedIntent)
        throw new Error(
          "You don't have a shared intention with this traveller.",
        );
      const result = await api<{ existing?: boolean; conversationId?: string }>(
        "/airports/connections",
        {
          method: "POST",
          body: JSON.stringify({ userId: person.id, intent: selectedIntent }),
        },
      );
      setNotice(
        `Connection request sent to ${person.name}. Chat opens when they accept.`,
      );
      await client.invalidateQueries({ queryKey: ["airport-connections"] });
      if (result.existing && result.conversationId)
        router.push(`/chat?id=${result.conversationId}`);
    } catch (e) {
      setDismissed((v) => v.filter((id) => id !== person.id));
      setError(e instanceof Error ? e.message : "Please try again.");
      void feed.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen width="reading">
      <Header
        title="People at your airport"
        subtitle={
          candidates.length
            ? `${candidates.length} traveller${candidates.length === 1 ? "" : "s"} nearby`
            : undefined
        }
        right={<AirportModeToggle expanded={cardOpen} onPress={toggleCard} />}
      />
      {cardOpen && (
        <RevealOnMount>
          <BoardingPass
            code={state.data?.airport?.iataCode ?? ""}
            title={state.data?.airport?.name ?? "Your airport"}
            subtitle="Temporary connections · location updates while Along is open."
            footer={
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
                  {state.data?.session?.intentions.map((v) => (
                    <View
                      key={v}
                      accessibilityLabel={intentLabel(v)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 11,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#FFFFFF1F",
                      }}
                    >
                      <Ionicons
                        name={airportIntents[v]?.icon ?? "ellipse-outline"}
                        size={16}
                        color={c.peach}
                      />
                    </View>
                  ))}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Leave Airport Mode"
                  disabled={busy}
                  onPress={() => void leave()}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#FFFFFF55",
                    opacity: busy ? 0.5 : pressed ? 0.75 : 1,
                  })}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={c.white} />
                  ) : (
                    <Ionicons
                      name="log-out-outline"
                      size={16}
                      color={c.white}
                    />
                  )}
                  <Text
                    style={{ color: c.white, fontSize: 13, fontWeight: "600" }}
                  >
                    Leave Airport Mode
                  </Text>
                </Pressable>
              </View>
            }
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {!!zoneName && (
                <MetaPill light icon="location-outline">
                  {zoneName}
                </MetaPill>
              )}
              {minutesLeft !== undefined && (
                <MetaPill light icon="time-outline">
                  {minutesLeft > 0
                    ? `${formatMinutes(minutesLeft)} left`
                    : "Ending soon"}
                </MetaPill>
              )}
            </View>
          </BoardingPass>
        </RevealOnMount>
      )}
      {!!error && <Notice>{error}</Notice>}
      {!!notice && <Notice>{notice}</Notice>}
      {feed.isPending ? (
        <View style={{ paddingVertical: 60, alignItems: "center", gap: 12 }}>
          <ActivityIndicator color={c.teal} />
          <Text style={text.muted}>Looking for travellers nearby…</Text>
        </View>
      ) : feed.isError ? (
        <Empty
          icon="cloud-offline-outline"
          title="Couldn't load travellers"
          description={feed.error.message}
        >
          <Button icon="refresh" onPress={() => void feed.refetch()}>
            Try again
          </Button>
        </Empty>
      ) : member ? (
        <>
          <View style={{ gap: 8, marginBottom: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <MetaPill icon="location-outline">{member.zone}</MetaPill>
              <MetaPill icon="time-outline">
                {formatMinutes(member.availableMinutes)} available
              </MetaPill>
            </View>
            {shared.length > 0 && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Text style={[text.muted, { fontSize: 12 }]}>Invite for</Text>
                {shared.map((v) => (
                  <Chip
                    key={v}
                    icon={airportIntents[v]?.icon}
                    selected={selectedIntent === v}
                    onPress={() => setIntent(v)}
                  >
                    {intentLabel(v)}
                  </Chip>
                ))}
              </View>
            )}
            <Text style={text.muted}>
              {selectedIntent
                ? `Swipe right to invite for ${intentLabel(selectedIntent).toLowerCase()}.`
                : "No shared intention. Swipe left to pass."}
            </Text>
          </View>
          <View
            style={{
              height:
                (layout.isTablet
                  ? Math.max(340, Math.min(640, layout.height - 280))
                  : 505) + 42,
              marginBottom: 8,
            }}
          >
            {candidates.slice(0, 3).map((person, depth) => (
              <View
                key={person.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  zIndex: 3 - depth,
                }}
              >
                <ProfileCard
                  member={{ ...person, vibeCheck: null }}
                  depth={depth}
                  busy={busy}
                  onAction={(profile, action) => void act(profile, action)}
                  onOpen={() => router.push(`/airport-person?id=${person.id}`)}
                />
              </View>
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Ionicons name="hourglass-outline" size={13} color={c.muted} />
            <Text style={text.muted}>
              An invitation is temporary. It does not create a permanent match.
            </Text>
          </View>
        </>
      ) : (
        <Empty
          icon="airplane-outline"
          title="Your next airport connection is on the way"
          description="Only eligible travellers who turned on Airport Mode appear here. We'll refresh every 30 seconds."
        >
          <Button
            icon="refresh"
            onPress={() => {
              setDismissed([]);
              void feed.refetch();
            }}
          >
            Refresh travellers
          </Button>
          {!!feed.data?.nextCursor && (
            <Button
              variant="outline"
              onPress={() => {
                void api<{ items: Traveller[]; nextCursor: string | null }>(
                  `/airports/discover?after=${feed.data!.nextCursor}`,
                )
                  .then((data) =>
                    client.setQueryData(
                      ["airport-discover", state.data?.session?.visitId],
                      data,
                    ),
                  )
                  .catch((e) => setError(e.message));
              }}
            >
              More travellers
            </Button>
          )}
        </Empty>
      )}
      <AirportRequests />
    </Screen>
  );
}
