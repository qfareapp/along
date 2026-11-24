import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Chip,
  Empty,
  Field,
  Header,
  IconButton,
  Notice,
  Screen,
  card,
  text,
  useKeyboardVisible,
} from "../components/ui";
import { colors as c } from "../theme";
import { api } from "../services/api";
import { formatChatTime } from "../services/chat";
import {
  Community,
  CommunityMessage,
  CommunityPage,
  communityWrite,
  useCommunities,
  useCommunity,
  useCommunityLive,
} from "../services/communities";
import { PlanRecord, useDebounced, usePlanCategories } from "../services/plans";
import DateTimeField from "../components/DateTimeField";
import { MemberPhoto } from "./LiveDiscover";
import { PeoplePlanCard, categoryCovers } from "./PlanComponents";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
const communityIcon = (icon: string): IconName =>
  Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, icon)
    ? (icon as IconName)
    : "people-outline";
const danger = "#BA4034";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- Small building blocks shared by the community screens ---------- */

function SearchBar({
  value,
  onChangeText,
  placeholder,
  label,
  icon = "search",
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  label: string;
  icon?: IconName;
  style?: ViewStyle;
}) {
  return (
    <View style={[s.search, style]}>
      <Ionicons name={icon} size={18} color={c.muted} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#95928D"
        returnKeyType="search"
        style={s.searchInput}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLowerCase()}`}
          hitSlop={10}
          onPress={() => onChangeText("")}
        >
          <Ionicons name="close-circle" size={18} color="#B9AEA5" />
        </Pressable>
      )}
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; icon?: IconName; badge?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              o.badge ? `${o.label}, ${o.badge} unread` : o.label
            }
            onPress={() => onChange(o.value)}
            style={[s.segment, active && s.segmentActive]}
          >
            {o.icon && (
              <Ionicons
                name={o.icon}
                size={15}
                color={active ? c.teal : c.muted}
              />
            )}
            <Text
              numberOfLines={1}
              style={[s.segmentText, active && s.segmentTextActive]}
            >
              {o.label}
            </Text>
            {!!o.badge && (
              <View style={s.badge}>
                <Text style={s.badgeText}>
                  {o.badge > 99 ? "99+" : o.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

type Tone = "teal" | "coral" | "green" | "muted" | "danger";
const tones: Record<Tone, { bg: string; fg: string }> = {
  teal: { bg: "#E3EEEC", fg: c.teal },
  coral: { bg: "#FDE6E1", fg: "#C9503F" },
  green: { bg: "#E2F0EC", fg: c.green },
  muted: { bg: "#F2EAE3", fg: c.muted },
  danger: { bg: "#F9E1DE", fg: danger },
};
function Pill({
  children,
  tone = "teal",
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: IconName;
}) {
  const t = tones[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg }]}>
      {icon && <Ionicons name={icon} size={12} color={t.fg} />}
      <Text style={[s.pillText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onPress,
  tone = "teal",
  disabled,
  last,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  tone?: "teal" | "danger";
  disabled?: boolean;
  last?: boolean;
}) {
  const color = tone === "danger" ? danger : c.teal;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.actionRow,
        !last && s.actionRowDivider,
        { opacity: disabled ? 0.45 : pressed ? 0.6 : 1 },
      ]}
    >
      <View
        style={[
          s.actionIcon,
          { backgroundColor: tone === "danger" ? "#F9E1DE" : "#E3EEEC" },
        ]}
      >
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={[text.label, tone === "danger" && { color: danger }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {hint && (
          <Text style={[text.muted, { fontSize: 12, lineHeight: 17 }]}>
            {hint}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#C5B8AD" />
    </Pressable>
  );
}

function Sheet({
  visible,
  onClose,
  label,
  children,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={`Close ${label.toLowerCase()}`}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          role="dialog"
          accessibilityLabel={label}
          style={[
            s.sheet,
            { paddingBottom: Math.max(20, insets.bottom + 8) },
            style,
          ]}
        >
          <View style={s.grabber} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={s.sectionLabel}>{children}</Text>;
}

function Loading() {
  return (
    <View style={{ paddingVertical: 28, alignItems: "center" }}>
      <ActivityIndicator color={c.teal} />
    </View>
  );
}

/* ---------------------------- Community card ---------------------------- */

function CommunityCover({
  item,
  height,
  children,
}: {
  item: Community;
  height: number;
  children?: ReactNode;
}) {
  return (
    <LinearGradient
      colors={[c.teal, "#326B69"]}
      style={{ height, overflow: "hidden" }}
    >
      {item.coverImage ? (
        <Image
          source={{ uri: item.coverImage }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Image
          source={
            categoryCovers[
              item.category === "hangouts" ? "coffee" : item.category
            ] ?? categoryCovers.hobbies
          }
          style={[
            StyleSheet.absoluteFill,
            { opacity: 0.28, width: "100%", height: "100%" },
          ]}
        />
      )}
      <LinearGradient
        colors={["rgba(9,62,67,0.05)", "rgba(9,62,67,0.72)"]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </LinearGradient>
  );
}

function CommunityCard({
  item,
  onOpen,
}: {
  item: Community;
  onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}${item.joined ? ", joined" : ""}`}
      onPress={onOpen}
      style={({ pressed }) => [
        card,
        s.communityCard,
        pressed && { transform: [{ scale: 0.99 }], opacity: 0.95 },
      ]}
    >
      <CommunityCover item={item} height={104}>
        <View style={s.coverTop}>
          <View style={s.coverIcon}>
            <Ionicons
              name={communityIcon(item.icon)}
              size={22}
              color={c.white}
            />
          </View>
          {item.joined && (
            <View style={s.joined}>
              <Ionicons name="checkmark" size={12} color={c.teal} />
              <Text style={s.joinedText}>Joined</Text>
            </View>
          )}
        </View>
        <Text style={s.coverTitle} numberOfLines={1}>
          {item.name}
        </Text>
      </CommunityCover>
      <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
        {!!item.description && (
          <Text style={text.muted} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <View style={s.metaRow}>
          <View style={s.meta}>
            <Ionicons name="people-outline" size={14} color={c.teal} />
            <Text style={s.metaText}>{plural(item.memberCount, "member")}</Text>
          </View>
          <View style={s.metaDot} />
          <View style={s.meta}>
            <Ionicons name="calendar-outline" size={14} color={c.teal} />
            <Text style={s.metaText}>
              {plural(item.upcomingEvents, "upcoming plan")}
            </Text>
          </View>
          {!!item.unread && item.joined && (
            <View style={{ marginLeft: "auto" }}>
              <Pill tone="coral">{item.unread} new</Pill>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/* ------------------------- Floating community button ------------------------- */

const nativeDriver = Platform.OS !== "web";
const FAB_SIZE = 64;

/**
 * Floating button that opens the community picker. It pops in on mount, then
 * gently floats with a soft ripple and an occasional icon wave. Motion pauses
 * while the picker is open, while the app is in the background, and whenever
 * the system "reduce motion" setting is on.
 */
export function CommunityFab({
  onPress,
  expanded,
}: {
  onPress: () => void;
  expanded: boolean;
}) {
  const [entrance] = useState(() => new Animated.Value(0));
  const [float] = useState(() => new Animated.Value(0));
  const [ripple] = useState(() => new Animated.Value(0));
  const [wave] = useState(() => new Animated.Value(0));
  const [press] = useState(() => new Animated.Value(1));
  const [reducedMotion, setReducedMotion] = useState(false);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    const motionSub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    const appSub = AppState.addEventListener("change", (next) =>
      setAppActive(next === "active"),
    );
    return () => {
      mounted = false;
      motionSub.remove();
      appSub.remove();
    };
  }, []);
  useEffect(() => {
    if (reducedMotion) {
      entrance.setValue(1);
      return;
    }
    const pop = Animated.spring(entrance, {
      toValue: 1,
      friction: 5,
      tension: 70,
      delay: 250,
      useNativeDriver: nativeDriver,
    });
    pop.start();
    return () => pop.stop();
  }, [entrance, reducedMotion]);
  useEffect(() => {
    if (reducedMotion || !appActive || expanded) {
      float.setValue(0);
      ripple.setValue(0);
      wave.setValue(0);
      return;
    }
    const timing = (
      value: Animated.Value,
      toValue: number,
      duration: number,
      easing = Easing.inOut(Easing.sin),
    ) =>
      Animated.timing(value, {
        toValue,
        duration,
        easing,
        useNativeDriver: nativeDriver,
        isInteraction: false,
      });
    const floating = Animated.loop(
      Animated.sequence([timing(float, 1, 1600), timing(float, 0, 1600)]),
    );
    const rippling = Animated.loop(
      Animated.sequence([
        timing(ripple, 1, 1800, Easing.out(Easing.quad)),
        Animated.delay(1400),
      ]),
    );
    const waving = Animated.loop(
      Animated.sequence([
        Animated.delay(3200),
        timing(wave, 1, 140),
        timing(wave, -1, 200),
        timing(wave, 0.6, 180),
        timing(wave, 0, 160),
      ]),
    );
    floating.start();
    rippling.start();
    waving.start();
    return () => {
      floating.stop();
      rippling.stop();
      waving.stop();
    };
  }, [appActive, expanded, float, reducedMotion, ripple, wave]);
  const springTo = (toValue: number) =>
    Animated.spring(press, {
      toValue,
      friction: 4,
      tension: 160,
      useNativeDriver: nativeDriver,
    }).start();
  return (
    <Animated.View
      style={{
        width: FAB_SIZE,
        height: FAB_SIZE,
        opacity: entrance,
        transform: [
          {
            translateY: float.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -5],
            }),
          },
          { scale: Animated.multiply(entrance, press) },
        ],
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          s.fabRipple,
          {
            opacity: ripple.interpolate({
              inputRange: [0, 0.15, 1],
              outputRange: [0, 0.4, 0],
            }),
            transform: [
              {
                scale: ripple.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.7],
                }),
              },
            ],
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Along Communities"
        accessibilityHint="Browse interest groups and open community chats"
        accessibilityState={{ expanded }}
        onPress={onPress}
        onPressIn={() => springTo(0.9)}
        onPressOut={() => springTo(1)}
        style={s.fabPressable}
      >
        <LinearGradient
          colors={["#1F6A6F", c.tealDark]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={s.fab}
        >
          <Animated.View
            style={{
              transform: [
                {
                  rotate: wave.interpolate({
                    inputRange: [-1, 1],
                    outputRange: ["-14deg", "14deg"],
                  }),
                },
              ],
            }}
          >
            <Ionicons name="people" size={29} color={c.ivory} />
          </Animated.View>
          <View style={s.fabSpark}>
            <Ionicons name="sparkles" size={10} color={c.white} />
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/* --------------------------- Community picker --------------------------- */

export function CommunityPicker({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const query = useCommunities("all", "", visible);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      label="Along Communities"
      style={{ maxHeight: "88%" }}
    >
      <View style={s.sheetHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[text.title, { fontSize: 22 }]}>Find your people</Text>
          <Text style={text.muted}>Join a community. Make plans together.</Text>
        </View>
        <IconButton
          icon="close"
          label="Close communities"
          onPress={onClose}
          style={s.closeButton}
        />
      </View>
      {query.isPending && <Loading />}
      {query.error && (
        <View style={{ gap: 10 }}>
          <Notice>{query.error.message}</Notice>
          <Button onPress={() => void query.refetch()}>Try again</Button>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 14, paddingVertical: 6 }}
        showsVerticalScrollIndicator={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        renderItem={({ item }) => (
          <CommunityCard
            item={item}
            onOpen={() => {
              onClose();
              router.push(`/community?id=${item.id}`);
            }}
          />
        )}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage)
            void query.fetchNextPage();
        }}
        ListEmptyComponent={
          !query.isPending && !query.error ? (
            <Empty
              icon="people-outline"
              title="Coming soon"
              description="Communities are on their way. Pull down to refresh."
            />
          ) : undefined
        }
      />
      <Button
        variant="outline"
        icon="grid-outline"
        onPress={() => {
          onClose();
          router.push("/communities");
        }}
      >
        Browse all communities
      </Button>
    </Sheet>
  );
}

/* --------------------------- Communities list --------------------------- */

export function CommunitiesScreen() {
  const [scope, setScope] = useState("all"),
    [search, setSearch] = useState("");
  const query = useCommunities(scope, useDebounced(search));
  return (
    <Screen scroll={false}>
      <FlatList
        data={query.data?.pages.flatMap((p) => p.items) ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 18 }}>
            <Header
              back
              title="Communities"
              subtitle="Find your people. Make plans together."
              right={
                <IconButton
                  icon="notifications-outline"
                  label="Community updates"
                  onPress={() => router.push("/community-updates")}
                  style={s.headerAction}
                  color={c.teal}
                />
              }
            />
            <SearchBar
              label="Search communities"
              value={search}
              onChangeText={setSearch}
              placeholder="Travel, food, fitness…"
            />
            <Segmented
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All", icon: "compass-outline" },
                { value: "mine", label: "Joined", icon: "heart-outline" },
                {
                  value: "suggested",
                  label: "For you",
                  icon: "sparkles-outline",
                },
              ]}
            />
            {query.error && <Notice>{query.error.message}</Notice>}
            {query.isPending && <Loading />}
          </View>
        }
        renderItem={({ item }) => (
          <CommunityCard
            item={item}
            onOpen={() => router.push(`/community?id=${item.id}`)}
          />
        )}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage)
            void query.fetchNextPage();
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Loading /> : undefined}
        ListEmptyComponent={
          !query.isPending && !query.error ? (
            <Empty
              icon="people-outline"
              title={
                scope === "mine"
                  ? "You haven't joined any yet"
                  : "No communities found"
              }
              description={
                scope === "mine"
                  ? "Browse All to find a community that fits you."
                  : "Try another search or browse All."
              }
            >
              {scope !== "all" && (
                <Button variant="outline" onPress={() => setScope("all")}>
                  Browse all
                </Button>
              )}
            </Empty>
          ) : undefined
        }
      />
    </Screen>
  );
}

/* --------------------------- Community detail --------------------------- */

export function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useCommunity(id);
  const client = useQueryClient();
  const [tab, setTab] = useState("chat"),
    [rules, setRules] = useState(false),
    [leave, setLeave] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const focused = useCommunityLive(id, !!query.data?.joined && !query.isError);
  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["communities"] });
      await query.refetch();
      setLeave(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const community = query.data;
  if (!community || query.error)
    return (
      <Screen>
        <Header back title="Community" />
        {query.isPending ? (
          <Loading />
        ) : (
          <Empty
            icon="cloud-offline-outline"
            title="Community unavailable"
            description={query.error?.message ?? "Please try again."}
          >
            <Button onPress={() => void query.refetch()}>Retry</Button>
          </Empty>
        )}
      </Screen>
    );
  const join = () => void act(() => communityWrite(`/${id}/join`));
  return (
    <Screen scroll={false}>
      <View style={s.topBar}>
        <IconButton
          icon="chevron-back"
          label="Go back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/communities")
          }
        />
        <LinearGradient colors={[c.teal, "#2E6E6B"]} style={s.topBarIcon}>
          <Ionicons
            name={communityIcon(community.icon)}
            size={19}
            color={c.white}
          />
        </LinearGradient>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[text.label, { fontSize: 16 }]} numberOfLines={1}>
            {community.name}
          </Text>
          <Text style={[text.muted, { fontSize: 12 }]} numberOfLines={1}>
            {plural(community.memberCount, "member")} ·{" "}
            {plural(community.upcomingEvents, "plan")}
            {community.muted ? " · Muted" : ""}
          </Text>
        </View>
        <IconButton
          icon={rules ? "close" : "information-circle-outline"}
          label={rules ? "Hide community info" : "Community info and rules"}
          onPress={() => {
            setRules(!rules);
            setLeave(false);
          }}
          color={c.teal}
          style={rules ? s.headerActionActive : undefined}
        />
      </View>
      {(!!error || community.joined) && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          {!!error && <Notice>{error}</Notice>}
          {community.joined && (
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: "chat",
                  label: "Chat",
                  icon: "chatbubbles-outline",
                  badge: tab === "chat" ? 0 : community.unread,
                },
                { value: "events", label: "Plans", icon: "calendar-outline" },
                { value: "members", label: "Members", icon: "people-outline" },
              ]}
            />
          )}
        </View>
      )}
      {!community.joined && tab !== "events" ? (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 36 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[card, s.communityCard]}>
            <CommunityCover item={community} height={150}>
              <View style={[s.coverTop, { padding: 18 }]}>
                <View style={[s.coverIcon, { width: 48, height: 48 }]}>
                  <Ionicons
                    name={communityIcon(community.icon)}
                    size={26}
                    color={c.white}
                  />
                </View>
              </View>
              <Text style={[s.coverTitle, { fontSize: 24, padding: 18 }]}>
                {community.name}
              </Text>
            </CommunityCover>
            <View style={{ padding: 18, gap: 12 }}>
              {!!community.description && (
                <Text style={text.body}>{community.description}</Text>
              )}
              <View style={s.metaRow}>
                <Pill icon="people-outline">
                  {plural(community.memberCount, "member")}
                </Pill>
                <Pill icon="calendar-outline">
                  {plural(community.upcomingEvents, "upcoming plan")}
                </Pill>
              </View>
            </View>
          </View>
          <View style={[card, { paddingVertical: 6, paddingHorizontal: 16 }]}>
            {(
              [
                [
                  "chatbubbles-outline",
                  "Chat with the community",
                  "Share ideas with people who love the same things.",
                ],
                [
                  "calendar-outline",
                  "Make plans together",
                  "Join or host community plans, each with its own chat.",
                ],
                [
                  "shield-checkmark-outline",
                  "Stay in control",
                  "Joining never creates a dating match or opens private messages.",
                ],
              ] as [IconName, string, string][]
            ).map(([icon, title, body], i) => (
              <View
                key={title}
                style={[s.feature, i < 2 && s.actionRowDivider]}
              >
                <View style={s.actionIcon}>
                  <Ionicons name={icon} size={18} color={c.teal} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={text.label}>{title}</Text>
                  <Text style={[text.muted, { fontSize: 12, lineHeight: 18 }]}>
                    {body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <View style={{ gap: 10 }}>
            <Button icon="person-add-outline" loading={busy} onPress={join}>
              Join community
            </Button>
            <Button
              variant="outline"
              icon="calendar-outline"
              onPress={() => setTab("events")}
            >
              Browse community plans
            </Button>
          </View>
        </ScrollView>
      ) : !community.joined ? (
        <View style={{ flex: 1 }}>
          <View style={s.joinStrip}>
            <View style={{ flex: 1 }}>
              <Text style={text.label}>Join to take part</Text>
              <Text style={[text.muted, { fontSize: 12 }]}>
                Members can request places on community plans.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Join community"
              disabled={busy}
              onPress={join}
              style={({ pressed }) => [
                s.smallButton,
                { opacity: busy ? 0.5 : pressed ? 0.8 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={c.white} size="small" />
              ) : (
                <Text style={s.smallButtonText}>Join</Text>
              )}
            </Pressable>
          </View>
          <CommunityEvents id={id} joined={false} />
        </View>
      ) : tab === "chat" ? (
        <CommunityChat
          key={`${id}:${community.visibilityKey}`}
          id={id}
          community={community}
          focused={focused}
        />
      ) : tab === "events" ? (
        <CommunityEvents id={id} joined />
      ) : (
        <CommunityMembers id={id} moderator={!!community.moderator} />
      )}
      <Sheet
        visible={rules}
        onClose={() => {
          setRules(false);
          setLeave(false);
        }}
        label="Community info"
      >
        <View style={s.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[text.title, { fontSize: 21 }]} numberOfLines={2}>
              {community.name}
            </Text>
            <Text style={text.muted}>Community info and rules</Text>
          </View>
          <IconButton
            icon="close"
            label="Close"
            onPress={() => setRules(false)}
            style={s.closeButton}
          />
        </View>
        <ScrollView
          contentContainerStyle={{ gap: 16, paddingBottom: 4 }}
          showsVerticalScrollIndicator={false}
        >
          {!!community.description && (
            <Text style={text.body}>{community.description}</Text>
          )}
          {!!community.rules && (
            <View style={[card, { padding: 16, gap: 8, shadowOpacity: 0 }]}>
              <View style={s.inlineRow}>
                <Ionicons
                  name="document-text-outline"
                  size={17}
                  color={c.teal}
                />
                <Text style={text.label}>Community rules</Text>
              </View>
              <Text style={[text.body, { color: "#4D5A60" }]}>
                {community.rules}
              </Text>
            </View>
          )}
          <Notice>
            Group chats are shared spaces. Keep personal details private and
            meet in public.
          </Notice>
          {(community.joined || community.moderator) && (
            <View style={[card, { paddingHorizontal: 14, shadowOpacity: 0 }]}>
              {community.joined && (
                <ActionRow
                  icon={
                    community.muted
                      ? "notifications-outline"
                      : "notifications-off-outline"
                  }
                  label={
                    community.muted
                      ? "Unmute message alerts"
                      : "Mute message alerts"
                  }
                  disabled={busy}
                  onPress={() =>
                    void act(() =>
                      communityWrite(
                        `/${id}/preferences`,
                        { muted: !community.muted },
                        "PATCH",
                      ),
                    )
                  }
                />
              )}
              {community.moderator && (
                <ActionRow
                  icon="flag-outline"
                  label="Review community reports"
                  onPress={() => {
                    setRules(false);
                    router.push(`/community-reports?id=${id}`);
                  }}
                  last={!community.joined}
                />
              )}
              {community.joined && (
                <ActionRow
                  icon="exit-outline"
                  label="Leave community"
                  tone="danger"
                  onPress={() => setLeave(!leave)}
                  last
                />
              )}
            </View>
          )}
          {leave && (
            <View style={s.confirmBox}>
              <Text style={[text.label, { color: danger }]}>
                Leave {community.name}?
              </Text>
              <Text style={[text.muted, { fontSize: 12 }]}>
                Your approved event participation remains. Leave individual
                events separately.
              </Text>
              <View style={s.buttonRow}>
                <View style={{ flex: 1 }}>
                  <Button variant="outline" onPress={() => setLeave(false)}>
                    Stay
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    variant="coral"
                    loading={busy}
                    onPress={() =>
                      void act(() => communityWrite(`/${id}/leave`))
                    }
                  >
                    Leave
                  </Button>
                </View>
              </View>
            </View>
          )}
          {!!error && <Notice>{error}</Notice>}
        </ScrollView>
      </Sheet>
    </Screen>
  );
}

/* ------------------------------- Chat tab ------------------------------- */

function CommunityChat({
  id,
  community,
  focused,
}: {
  id: string;
  community: Community;
  focused: boolean;
}) {
  const client = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const query = useInfiniteQuery({
    queryKey: ["community-messages", id, community.visibilityKey],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{ items: CommunityMessage[]; nextBefore: number | null }>(
        `/communities/${id}/messages${pageParam ? `?before=${pageParam}` : ""}`,
      ),
    getNextPageParam: (p) => p.nextBefore ?? undefined,
    retry: false,
    refetchInterval: focused ? 15000 : false,
  });
  const [draft, setDraft] = useState(""),
    [replyTo, setReplyTo] = useState<CommunityMessage | null>(null),
    [selected, setSelected] = useState<CommunityMessage | null>(null),
    [reason, setReason] = useState(""),
    [report, setReport] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{
    text: string;
    replyTo?: string;
    clientId: string;
  } | null>(null);
  const list = useRef<FlatList<CommunityMessage>>(null);
  const items = query.isError
    ? []
    : [...(query.data?.pages ?? [])].reverse().flatMap((p) => p.items);
  const last = items.at(-1)?.sequence ?? 0;
  useEffect(() => {
    if (focused && last)
      void communityWrite(`/${id}/read`, { sequence: last }).catch(() => {});
  }, [focused, id, last]);
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await client.invalidateQueries({ queryKey: ["community-messages", id] });
      setSelected(null);
      setReport(false);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!draft.trim() || busy) return;
    if (
      !pending.current ||
      pending.current.text !== draft.trim() ||
      pending.current.replyTo !== replyTo?.id
    )
      pending.current = {
        text: draft.trim(),
        clientId: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        ...(replyTo ? { replyTo: replyTo.id } : {}),
      };
    await action(async () => {
      await communityWrite(`/${id}/messages`, pending.current);
      pending.current = null;
      setDraft("");
      setReplyTo(null);
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 200);
    });
  }
  const closeSheet = () => {
    setSelected(null);
    setReport(false);
  };
  return (
    <View style={{ flex: 1 }}>
      {query.error && (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Notice>{query.error.message}</Notice>
          <Button variant="outline" onPress={() => void query.refetch()}>
            Retry chat
          </Button>
        </View>
      )}
      {query.isPending && <Loading />}
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 12,
          gap: 14,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ListHeaderComponent={
          query.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load earlier messages"
              disabled={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              style={s.earlier}
            >
              {query.isFetchingNextPage ? (
                <ActivityIndicator color={c.teal} size="small" />
              ) : (
                <>
                  <Ionicons name="arrow-up" size={14} color={c.teal} />
                  <Text style={s.earlierText}>Earlier messages</Text>
                </>
              )}
            </Pressable>
          ) : items.length ? (
            <View style={s.chatIntro}>
              <Ionicons name="lock-closed-outline" size={13} color={c.muted} />
              <Text style={s.chatIntroText}>
                You see messages from when you joined. Be kind and keep private
                details private.
              </Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          !query.isPending && !query.error ? (
            <Empty
              icon="chatbubbles-outline"
              title="Start the conversation"
              description="Say hello to your community. Be kind and keep private details private."
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <View
            style={[s.messageRow, item.own && { flexDirection: "row-reverse" }]}
          >
            {!item.own && (
              <MemberPhoto
                id={item.sender.photoId ?? undefined}
                style={s.messageAvatar}
              />
            )}
            <View
              style={{
                maxWidth: "80%",
                gap: 4,
                alignItems: item.own ? "flex-end" : "flex-start",
              }}
            >
              {!item.own && (
                <Text style={s.senderName} numberOfLines={1}>
                  {item.sender.name}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Message from ${item.sender.name}. ${item.text}. Tap for actions.`}
                accessibilityHint={item.deleted ? undefined : "Opens actions"}
                disabled={item.deleted}
                onPress={() => {
                  setSelected(item);
                  setReport(false);
                }}
                style={({ pressed }) => [
                  s.bubble,
                  item.own ? s.bubbleOwn : s.bubbleOther,
                  item.pinned && s.bubblePinned,
                  item.deleted && s.bubbleDeleted,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {item.pinned && (
                  <View style={s.inlineRow}>
                    <Ionicons
                      name="pin"
                      size={12}
                      color={item.own ? c.white : c.teal}
                    />
                    <Text
                      style={[
                        s.pinnedText,
                        item.own && { color: "rgba(255,255,255,0.9)" },
                      ]}
                    >
                      Pinned announcement
                    </Text>
                  </View>
                )}
                {item.reply && (
                  <View style={[s.quote, item.own && s.quoteOwn]}>
                    <Text
                      style={[s.quoteName, item.own && { color: c.white }]}
                      numberOfLines={1}
                    >
                      {item.reply.name}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        s.quoteText,
                        item.own && { color: "rgba(255,255,255,0.85)" },
                      ]}
                    >
                      {item.reply.text}
                    </Text>
                  </View>
                )}
                <Text
                  selectable
                  style={[
                    text.body,
                    item.own && { color: c.white },
                    item.deleted && { color: c.muted, fontStyle: "italic" },
                  ]}
                >
                  {item.text}
                </Text>
              </Pressable>
              <View
                style={[
                  s.inlineRow,
                  { gap: 6, flexWrap: "wrap" },
                  item.own && { justifyContent: "flex-end" },
                ]}
              >
                {item.reactions.map((r) => (
                  <View
                    key={r.emoji}
                    style={[s.reaction, r.own && s.reactionOwn]}
                  >
                    <Text style={{ fontSize: 12 }}>{r.emoji}</Text>
                    <Text
                      style={[
                        s.reactionCount,
                        r.own && { color: c.teal, fontWeight: "700" },
                      ]}
                    >
                      {r.count}
                    </Text>
                  </View>
                ))}
                <Text style={s.time}>{formatChatTime(item.createdAt)}</Text>
              </View>
            </View>
          </View>
        )}
      />
      <View
        style={[
          s.composer,
          { paddingBottom: keyboard ? 10 : Math.max(insets.bottom, 10) },
        ]}
      >
        {!!error && !selected && <Notice>{error}</Notice>}
        {replyTo && (
          <View style={s.replyBar}>
            <Ionicons name="arrow-undo" size={16} color={c.teal} />
            <View style={{ flex: 1 }}>
              <Text style={[s.quoteName, { fontSize: 12 }]} numberOfLines={1}>
                Replying to {replyTo.own ? "yourself" : replyTo.sender.name}
              </Text>
              <Text numberOfLines={1} style={s.quoteText}>
                {replyTo.text}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              hitSlop={10}
              onPress={() => setReplyTo(null)}
            >
              <Ionicons name="close" size={18} color={c.muted} />
            </Pressable>
          </View>
        )}
        <View style={s.composerRow}>
          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            maxLength={2000}
            multiline
            placeholder="Say something kind…"
            placeholderTextColor="#95928D"
            style={s.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? "Sending" : "Send message"}
            disabled={!draft.trim() || busy}
            onPress={() => void send()}
            style={[
              s.sendButton,
              { backgroundColor: draft.trim() ? c.coralBright : "#DDCFC3" },
            ]}
          >
            {busy && !selected ? (
              <ActivityIndicator color={c.white} size="small" />
            ) : (
              <Ionicons name="send" size={19} color={c.white} />
            )}
          </Pressable>
        </View>
      </View>
      <Sheet visible={!!selected} onClose={closeSheet} label="Message actions">
        <ScrollView
          contentContainerStyle={{ gap: 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.previewCard}>
            <View style={s.inlineRow}>
              <MemberPhoto
                id={selected?.sender.photoId ?? undefined}
                style={{ width: 26, height: 26, borderRadius: 13 }}
              />
              <Text style={[text.label, { flex: 1 }]} numberOfLines={1}>
                {selected?.own ? "You" : selected?.sender.name}
              </Text>
              {selected && (
                <Text style={s.time}>{formatChatTime(selected.createdAt)}</Text>
              )}
            </View>
            <Text numberOfLines={4} style={text.body}>
              {selected?.text}
            </Text>
          </View>
          {!report ? (
            <>
              <View style={s.emojiRow}>
                {["❤️", "👍", "😂", "🎉", "🔥"].map((emoji) => {
                  const mine = !!selected?.reactions.some(
                    (r) => r.emoji === emoji && r.own,
                  );
                  return (
                    <Pressable
                      key={emoji}
                      accessibilityRole="button"
                      accessibilityLabel={`${mine ? "Remove reaction" : "React"} ${emoji}`}
                      accessibilityState={{ selected: mine }}
                      disabled={busy}
                      onPress={() =>
                        void action(() =>
                          communityWrite(
                            `/${id}/messages/${selected!.id}/react`,
                            { emoji: mine ? null : emoji },
                          ),
                        )
                      }
                      style={({ pressed }) => [
                        s.emoji,
                        mine && s.emojiActive,
                        pressed && { transform: [{ scale: 0.92 }] },
                      ]}
                    >
                      <Text style={{ fontSize: 24 }}>{emoji}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={[card, { paddingHorizontal: 14, shadowOpacity: 0 }]}>
                <ActionRow
                  icon="arrow-undo-outline"
                  label="Reply"
                  onPress={() => {
                    setReplyTo(selected);
                    setSelected(null);
                  }}
                />
                {community.moderator && (
                  <ActionRow
                    icon={selected?.pinned ? "pin" : "pin-outline"}
                    label={selected?.pinned ? "Unpin" : "Pin announcement"}
                    disabled={busy}
                    onPress={() =>
                      void action(() =>
                        communityWrite(`/${id}/messages/${selected!.id}/pin`, {
                          pinned: !selected!.pinned,
                        }),
                      )
                    }
                  />
                )}
                {(selected?.own || community.moderator) && (
                  <ActionRow
                    icon="trash-outline"
                    label="Remove message"
                    tone="danger"
                    disabled={busy}
                    last={!!selected?.own}
                    onPress={() =>
                      void action(() =>
                        communityWrite(
                          `/${id}/messages/${selected!.id}`,
                          undefined,
                          "DELETE",
                        ),
                      )
                    }
                  />
                )}
                {!selected?.own && (
                  <ActionRow
                    icon="flag-outline"
                    label="Report message"
                    tone="danger"
                    onPress={() => setReport(true)}
                    last
                  />
                )}
              </View>
            </>
          ) : (
            <View style={{ gap: 4 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReport(false)}
                style={[s.inlineRow, { paddingVertical: 6 }]}
              >
                <Ionicons name="chevron-back" size={16} color={c.teal} />
                <Text style={{ color: c.teal, fontWeight: "600" }}>
                  Back to actions
                </Text>
              </Pressable>
              <Field
                label="Why are you reporting this?"
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1500}
                placeholder="At least 10 characters"
              />
              <Button
                icon="flag-outline"
                loading={busy}
                disabled={reason.trim().length < 10}
                onPress={() =>
                  void action(() =>
                    communityWrite(`/${id}/report`, {
                      messageId: selected!.id,
                      reason,
                    }),
                  )
                }
              >
                Submit report
              </Button>
            </View>
          )}
          {!!error && <Notice>{error}</Notice>}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/* ------------------------------ Plans tab ------------------------------ */

function CommunityEvents({ id, joined }: { id: string; joined: boolean }) {
  const [section, setSection] = useState("upcoming"),
    [search, setSearch] = useState(""),
    [city, setCity] = useState(""),
    [available, setAvailable] = useState(false);
  const [filters, setFilters] = useState(false),
    [category, setCategory] = useState(""),
    [date, setDate] = useState(""),
    [policy, setPolicy] = useState("");
  const categories = usePlanCategories();
  const dateFilter = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `&from=${new Date(`${date}T00:00:00`).toISOString()}&to=${new Date(`${date}T23:59:59`).toISOString()}`
    : "";
  const q = useDebounced(search),
    area = useDebounced(city);
  const query = useInfiniteQuery({
    queryKey: [
      "community-plans",
      id,
      section,
      q,
      area,
      available,
      category,
      dateFilter,
      policy,
    ],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<CommunityPage<PlanRecord>>(
        `/communities/${id}/plans?section=${section}&q=${encodeURIComponent(q)}&city=${encodeURIComponent(area)}${available ? "&available=true" : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}${policy ? `&policy=${policy}` : ""}${dateFilter}${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    getNextPageParam: (p) => p.next ?? undefined,
    retry: false,
  });
  const activeFilters = (category ? 1 : 0) + (date ? 1 : 0) + (policy ? 1 : 0);
  const anyFilter =
    activeFilters > 0 || available || !!city.trim() || !!search.trim();
  return (
    <FlatList
      data={query.data?.pages.flatMap((p) => p.items) ?? []}
      keyExtractor={(item) => item._id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 16 }}>
          {joined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a community plan"
              onPress={() => router.push(`/create?communityId=${id}`)}
              style={({ pressed }) => [pressed && { opacity: 0.9 }]}
            >
              <LinearGradient
                colors={["#1A6065", "#08484F"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.createCard}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.createTitle}>Make a plan together</Text>
                  <Text style={s.createBody}>
                    Every plan has its own participant chat.
                  </Text>
                </View>
                <View style={s.createIcon}>
                  <Ionicons name="add" size={24} color={c.white} />
                </View>
              </LinearGradient>
            </Pressable>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {(
              [
                ["for-you", "For you", "sparkles-outline"],
                ["upcoming", "Upcoming", "time-outline"],
                ["popular", "Popular", "flame-outline"],
                ["mine", "My plans", "bookmark-outline"],
              ] as [string, string, IconName][]
            ).map(([v, label, icon]) => (
              <Chip
                key={v}
                icon={icon}
                selected={section === v}
                onPress={() => setSection(v)}
              >
                {label}
              </Chip>
            ))}
          </ScrollView>
          <SearchBar
            label="Search plans"
            value={search}
            onChangeText={setSearch}
            placeholder="Search plans"
          />
          <View style={s.inlineRow}>
            <SearchBar
              label="City or general area"
              icon="location-outline"
              value={city}
              onChangeText={setCity}
              placeholder="City or area"
              style={{ flex: 1 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={filters ? "Hide filters" : "More filters"}
              accessibilityState={{ expanded: filters }}
              onPress={() => setFilters(!filters)}
              style={[s.filterButton, filters && s.filterButtonActive]}
            >
              <Ionicons
                name="options-outline"
                size={19}
                color={filters ? c.white : c.teal}
              />
              {activeFilters > 0 && (
                <View style={s.filterCount}>
                  <Text style={s.badgeText}>{activeFilters}</Text>
                </View>
              )}
            </Pressable>
          </View>
          <View style={[s.inlineRow, { flexWrap: "wrap" }]}>
            <Chip
              icon="checkmark-circle-outline"
              selected={available}
              onPress={() => setAvailable(!available)}
            >
              Seats available
            </Chip>
            {anyFilter && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDate("");
                  setCategory("");
                  setPolicy("");
                  setAvailable(false);
                  setCity("");
                  setSearch("");
                }}
                style={{ padding: 8 }}
              >
                <Text style={s.linkText}>Clear all</Text>
              </Pressable>
            )}
          </View>
          {filters && (
            <View style={[card, s.filterPanel]}>
              <SectionLabel>Category</SectionLabel>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                <Chip selected={!category} onPress={() => setCategory("")}>
                  All
                </Chip>
                {categories.data?.map((cat) => (
                  <Chip
                    key={cat.slug}
                    selected={category === cat.slug}
                    onPress={() => setCategory(cat.slug)}
                  >
                    {cat.name}
                  </Chip>
                ))}
              </ScrollView>
              <SectionLabel>Date</SectionLabel>
              <DateTimeField
                mode="date"
                label="Event date"
                value={date}
                onChange={setDate}
              />
              <SectionLabel>Joining</SectionLabel>
              <View style={[s.inlineRow, { flexWrap: "wrap" }]}>
                {[
                  ["", "Any"],
                  ["open", "Open RSVP"],
                  ["approval", "Approval required"],
                ].map(([v, label]) => (
                  <Chip
                    key={v}
                    selected={policy === v}
                    onPress={() => setPolicy(v)}
                  >
                    {label}
                  </Chip>
                ))}
              </View>
            </View>
          )}
          {query.error && <Notice>{query.error.message}</Notice>}
          {query.isPending && <Loading />}
        </View>
      }
      renderItem={({ item }) => <PeoplePlanCard plan={item} />}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage)
          void query.fetchNextPage();
      }}
      ListFooterComponent={query.isFetchingNextPage ? <Loading /> : undefined}
      ListEmptyComponent={
        !query.isPending && !query.error ? (
          <Empty
            icon="calendar-outline"
            title="No plans here yet"
            description={
              joined
                ? "Try another filter, or bring your community together with a plan."
                : "Try another filter, or check back soon."
            }
          />
        ) : undefined
      }
    />
  );
}

/* ----------------------------- Members tab ----------------------------- */

const roleTone = (role: string): Tone =>
  role === "owner" || role === "admin"
    ? "coral"
    : role === "moderator"
      ? "teal"
      : "muted";

function CommunityMembers({
  id,
  moderator,
}: {
  id: string;
  moderator: boolean;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [selected, setSelected] = useState<{
      id: string;
      name: string;
      role: string;
      photoId?: string;
    } | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["community-members", id, q],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<
        CommunityPage<{
          id: string;
          name: string;
          photoId?: string;
          role: string;
        }>
      >(
        `/communities/${id}/members?q=${encodeURIComponent(q)}${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    getNextPageParam: (p) => p.next ?? undefined,
    retry: false,
  });
  async function action(kind: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "block")
        await api("/blocks", {
          method: "POST",
          body: JSON.stringify({ userId: selected.id }),
        });
      else if (kind === "report")
        await communityWrite(`/${id}/report`, { target: selected.id, reason });
      else
        await communityWrite(`/${id}/members/${selected.id}/moderate`, {
          action: kind,
          reason,
        });
      setSelected(null);
      setReason("");
      await client.invalidateQueries({ queryKey: ["community-members", id] });
      await client.invalidateQueries({ queryKey: ["community", id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const reasonReady = reason.trim().length >= 10;
  const close = () => {
    setSelected(null);
    setError("");
  };
  return (
    <>
      <FlatList
        data={query.data?.pages.flatMap((p) => p.items) ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 16 }}>
            <SearchBar
              label="Search members"
              value={search}
              onChangeText={setSearch}
              placeholder="Search members"
            />
            <View style={s.privacyNote}>
              <Ionicons
                name="shield-checkmark-outline"
                size={15}
                color={c.teal}
              />
              <Text style={s.privacyText}>
                Profile previews and Like / Vibe Check follow your usual privacy
                rules. Membership never unlocks private chats.
              </Text>
            </View>
            {query.error && <Notice>{query.error.message}</Notice>}
            {query.isPending && <Loading />}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Member ${item.name}, ${item.role}`}
            onPress={() => {
              setSelected(item);
              setReason("");
              setError("");
            }}
            style={({ pressed }) => [
              card,
              s.memberRow,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MemberPhoto
              id={item.photoId}
              style={{ width: 46, height: 46, borderRadius: 23 }}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={text.label} numberOfLines={1}>
                {item.name}
              </Text>
              {item.role !== "member" ? (
                <View style={{ alignSelf: "flex-start" }}>
                  <Pill tone={roleTone(item.role)}>
                    {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
                  </Pill>
                </View>
              ) : (
                <Text style={[text.muted, { fontSize: 12 }]}>Member</Text>
              )}
            </View>
            <Ionicons name="ellipsis-horizontal" size={20} color={c.muted} />
          </Pressable>
        )}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage)
            void query.fetchNextPage();
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Loading /> : undefined}
        ListEmptyComponent={
          !query.isPending && !query.error ? (
            <Empty
              icon="people-outline"
              title="No members found"
              description="Try a different name."
            />
          ) : undefined
        }
      />
      <Sheet visible={!!selected} onClose={close} label="Member actions">
        <ScrollView
          contentContainerStyle={{ gap: 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.sheetHeader}>
            <MemberPhoto
              id={selected?.photoId}
              style={{ width: 54, height: 54, borderRadius: 27 }}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[text.title, { fontSize: 20 }]} numberOfLines={1}>
                {selected?.name}
              </Text>
              {selected && (
                <View style={{ alignSelf: "flex-start" }}>
                  <Pill tone={roleTone(selected.role)}>
                    {selected.role.charAt(0).toUpperCase() +
                      selected.role.slice(1)}
                  </Pill>
                </View>
              )}
            </View>
            <IconButton
              icon="close"
              label="Close"
              onPress={close}
              style={s.closeButton}
            />
          </View>
          <Button
            icon="person-circle-outline"
            onPress={() => {
              if (selected) router.push(`/person?id=${selected.id}`);
              setSelected(null);
            }}
          >
            View profile
          </Button>
          <SectionLabel>Safety</SectionLabel>
          <View style={[card, { paddingHorizontal: 14, shadowOpacity: 0 }]}>
            <ActionRow
              icon="hand-left-outline"
              label="Block member"
              hint="They won't be able to see or contact you."
              tone="danger"
              disabled={busy}
              onPress={() => void action("block")}
              last
            />
          </View>
          <View style={[card, { padding: 16, gap: 4, shadowOpacity: 0 }]}>
            <Field
              label={
                moderator && selected?.role === "member"
                  ? "Reason for report or moderation"
                  : "Reason for report"
              }
              value={reason}
              onChangeText={setReason}
              maxLength={1500}
              multiline
              placeholder="At least 10 characters"
            />
            <Button
              variant="outline"
              icon="flag-outline"
              disabled={!reasonReady || busy}
              onPress={() => void action("report")}
            >
              Report member
            </Button>
          </View>
          {moderator && selected?.role === "member" && (
            <>
              <SectionLabel>Moderation</SectionLabel>
              <View style={[card, { paddingHorizontal: 14, shadowOpacity: 0 }]}>
                {(
                  [
                    [
                      "mute",
                      "volume-mute-outline",
                      "Pause messages for 24 hours",
                    ],
                    ["unmute", "volume-high-outline", "Restore messaging"],
                    [
                      "suspend",
                      "pause-circle-outline",
                      "Suspend from community",
                    ],
                    ["ban", "ban-outline", "Ban from community"],
                  ] as [string, IconName, string][]
                ).map(([kind, icon, label], i) => (
                  <ActionRow
                    key={kind}
                    icon={icon}
                    label={label}
                    tone={
                      kind === "ban" || kind === "suspend" ? "danger" : "teal"
                    }
                    disabled={!reasonReady || busy}
                    onPress={() => void action(kind)}
                    last={i === 3}
                  />
                ))}
              </View>
              {!reasonReady && (
                <Text style={[text.muted, { fontSize: 12 }]}>
                  Add a reason above to enable moderation actions.
                </Text>
              )}
            </>
          )}
          {!!error && <Notice>{error}</Notice>}
        </ScrollView>
      </Sheet>
    </>
  );
}

/* ------------------------- Event participants ------------------------- */

const statusTone = (status: string): Tone =>
  status === "accepted"
    ? "green"
    : status === "pending"
      ? "coral"
      : status === "waitlisted"
        ? "teal"
        : "muted";

export function CommunityParticipants() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId: string }>();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["community-participants", planId],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<
        CommunityPage<{
          id: string;
          userId: string;
          name: string;
          status: string;
        }>
      >(
        `/communities/${id}/plans/${planId}/participants${pageParam ? `?cursor=${pageParam}` : ""}`,
      ),
    getNextPageParam: (p) => p.next ?? undefined,
  });
  async function change(interestId: string, userId: string, approve: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (approve)
        await communityWrite(
          `/${id}/plans/${planId}/participants/${userId}/approve`,
        );
      else
        await communityWrite(
          `/${id}/plans/${planId}/participants/${userId}`,
          undefined,
          "DELETE",
        );
      await query.refetch();
      await client.invalidateQueries({ queryKey: ["activity", planId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const people = query.data?.pages.flatMap((p) => p.items) ?? [];
  const waiting = people.filter((p) =>
    ["pending", "waitlisted"].includes(p.status),
  ).length;
  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Header
        back
        title="Participants"
        subtitle={
          people.length
            ? `${plural(people.length, "person")}${waiting ? ` · ${waiting} waiting` : ""}`
            : undefined
        }
      />
      {!!error && <Notice>{error}</Notice>}
      {query.error && <Notice>{query.error.message}</Notice>}
      {query.isPending && <Loading />}
      <View style={{ gap: 12 }}>
        {people.map((p) => {
          const canApprove = ["pending", "waitlisted"].includes(p.status);
          const canRemove = ["pending", "accepted", "waitlisted"].includes(
            p.status,
          );
          return (
            <View key={p.id} style={[card, { padding: 16, gap: 14 }]}>
              <View style={s.inlineRow}>
                <View style={s.initials}>
                  <Text style={s.initialsText}>
                    {p.name.trim().charAt(0).toUpperCase() || "?"}
                  </Text>
                </View>
                <Text style={[text.label, { flex: 1 }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Pill tone={statusTone(p.status)}>
                  {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                </Pill>
              </View>
              {(canApprove || canRemove) && (
                <View style={s.buttonRow}>
                  {canRemove && (
                    <View style={{ flex: 1 }}>
                      <Button
                        disabled={busy}
                        variant="outline"
                        onPress={() => void change(p.id, p.userId, false)}
                      >
                        {p.status === "accepted" ? "Remove" : "Decline"}
                      </Button>
                    </View>
                  )}
                  {canApprove && (
                    <View style={{ flex: 1 }}>
                      <Button
                        icon="checkmark"
                        disabled={busy}
                        onPress={() => void change(p.id, p.userId, true)}
                      >
                        Approve
                      </Button>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
      {!query.isPending && !query.error && !people.length && (
        <Empty
          icon="people-outline"
          title="No participants yet"
          description="Requests to join this plan will show up here."
        />
      )}
      {query.hasNextPage && (
        <View style={{ marginTop: 16 }}>
          <Button
            variant="outline"
            loading={query.isFetchingNextPage}
            onPress={() => void query.fetchNextPage()}
          >
            More participants
          </Button>
        </View>
      )}
    </Screen>
  );
}

/* ---------------------------- Updates inbox ---------------------------- */

export function CommunityUpdates() {
  const query = useQuery({
    queryKey: ["community-notices"],
    queryFn: () =>
      api<{ id: string; communityId: string; text: string; read: boolean }[]>(
        "/communities/notices",
      ),
  });
  const unread = query.data?.filter((n) => !n.read).length ?? 0;
  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Header
        back
        title="Updates"
        subtitle={unread ? `${unread} unread` : "You're all caught up"}
        right={
          unread ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark all read"
              onPress={() => {
                void communityWrite("/notices/read").then(() =>
                  query.refetch(),
                );
              }}
              style={{ padding: 8 }}
            >
              <Text style={s.linkText}>Mark all read</Text>
            </Pressable>
          ) : undefined
        }
      />
      {query.error && <Notice>{query.error.message}</Notice>}
      {query.isPending && <Loading />}
      <View style={{ gap: 10 }}>
        {query.data?.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.read ? "" : "Unread. "}${n.text}`}
            onPress={() => router.push(`/community?id=${n.communityId}`)}
            style={({ pressed }) => [
              card,
              s.noticeRow,
              !n.read && s.noticeUnread,
              pressed && { opacity: 0.85 },
            ]}
          >
            <View
              style={[s.actionIcon, !n.read && { backgroundColor: "#FDE6E1" }]}
            >
              <Ionicons
                name="people-outline"
                size={18}
                color={n.read ? c.teal : c.coralBright}
              />
            </View>
            <Text
              style={[
                text.body,
                { flex: 1 },
                !n.read && { fontWeight: "600" },
                n.read && { color: "#4D5A60" },
              ]}
            >
              {n.text}
            </Text>
            {!n.read && <View style={s.unreadDot} />}
          </Pressable>
        ))}
      </View>
      {!query.isPending && !query.error && !query.data?.length && (
        <Empty
          icon="notifications-outline"
          title="No updates yet"
          description="News from your communities will appear here."
        />
      )}
    </Screen>
  );
}

/* --------------------------- Moderator reports --------------------------- */

const severityTone = (severity: string): Tone =>
  severity === "high" || severity === "critical"
    ? "danger"
    : severity === "medium"
      ? "coral"
      : "muted";

export function CommunityReports() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["community-reports", id],
    queryFn: () =>
      api<
        {
          id: string;
          reason: string;
          evidenceText?: string;
          messageId?: string;
          severity: string;
        }[]
      >(`/communities/${id}/reports`),
  });
  async function act(path: string, body?: unknown, method = "POST") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await communityWrite(path, body, method);
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const count = query.data?.length ?? 0;
  return (
    <Screen
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Header
        back
        title="Reports"
        subtitle={count ? `${plural(count, "open report")}` : undefined}
      />
      {query.error && <Notice>{query.error.message}</Notice>}
      {!!error && <Notice>{error}</Notice>}
      {query.isPending && <Loading />}
      {!!count && (
        <View style={[card, { padding: 16, marginBottom: 16, gap: 2 }]}>
          <Field
            label="Resolution note"
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder="Explain your decision (at least 10 characters). Used when resolving."
          />
        </View>
      )}
      <View style={{ gap: 14 }}>
        {query.data?.map((r) => (
          <View key={r.id} style={[card, { padding: 16, gap: 12 }]}>
            <View style={s.inlineRow}>
              <Ionicons
                name="flag"
                size={16}
                color={tones[severityTone(r.severity)].fg}
              />
              <Pill tone={severityTone(r.severity)}>
                {r.severity.charAt(0).toUpperCase() + r.severity.slice(1)}{" "}
                severity
              </Pill>
              {r.messageId && <Pill tone="muted">Message</Pill>}
            </View>
            <Text style={text.body}>{r.reason}</Text>
            {r.evidenceText && (
              <View style={s.evidence}>
                <Text style={[s.sectionLabel, { marginTop: 0 }]}>
                  Reported content
                </Text>
                <Text style={[text.body, { color: "#4D5A60" }]}>
                  {r.evidenceText}
                </Text>
              </View>
            )}
            <View style={s.buttonRow}>
              {r.messageId && (
                <View style={{ flex: 1 }}>
                  <Button
                    disabled={busy}
                    variant="outline"
                    icon="trash-outline"
                    onPress={() =>
                      void act(
                        `/${id}/messages/${r.messageId}`,
                        undefined,
                        "DELETE",
                      )
                    }
                  >
                    Remove
                  </Button>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button
                  icon="checkmark-done"
                  disabled={busy || reason.trim().length < 10}
                  onPress={() =>
                    void act(`/${id}/reports/${r.id}/resolve`, { reason })
                  }
                >
                  Resolve
                </Button>
              </View>
            </View>
          </View>
        ))}
      </View>
      {!query.isPending && !query.error && !count && (
        <Empty
          icon="shield-checkmark-outline"
          title="All clear"
          description="There are no open reports for this community."
        />
      )}
    </Screen>
  );
}

/* -------------------------------- Styles -------------------------------- */

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonRow: { flexDirection: "row", gap: 10 },
  listContent: { paddingHorizontal: 20, paddingBottom: 36 },

  // Search + segmented control
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: "#FFFBF7",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: c.charcoal,
    paddingVertical: 12,
  },
  segmented: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
    borderRadius: 16,
    backgroundColor: "#F6E9DE",
  },
  segment: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  segmentActive: {
    backgroundColor: c.white,
    shadowColor: "#6B4836",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  segmentText: { fontSize: 13, fontWeight: "600", color: c.muted },
  segmentTextActive: { color: c.teal },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: c.white, fontSize: 10, fontWeight: "700" },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontWeight: "700" },

  // Floating community button
  fabRipple: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: c.coralBright,
  },
  fabPressable: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    shadowColor: c.tealDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  fab: {
    flex: 1,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: c.ivory,
  },
  fabSpark: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.coralBright,
    borderWidth: 2,
    borderColor: c.ivory,
  },

  // Community card
  communityCard: { overflow: "hidden", borderRadius: 22 },
  coverTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 14,
  },
  coverIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  coverTitle: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    color: c.white,
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  joined: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: c.ivory,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  joinedText: { color: c.teal, fontSize: 12, fontWeight: "700" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontWeight: "600", color: c.teal },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#C5B8AD",
  },

  // Header bits
  headerAction: { backgroundColor: "#F6E9DE" },
  headerActionActive: { backgroundColor: "#E3EEEC" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  topBarIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  joinStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#E9F0EB",
  },
  smallButton: {
    minWidth: 76,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: c.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButtonText: { color: c.white, fontWeight: "700", fontSize: 14 },
  feature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
  },

  // Sheets
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,35,35,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "85%",
    alignSelf: "center",
    backgroundColor: c.ivory,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#E2D3C7",
    marginBottom: 2,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  closeButton: { width: 36, height: 36, backgroundColor: "#F6E9DE" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: c.muted,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    minHeight: 56,
  },
  actionRowDivider: { borderBottomWidth: 1, borderBottomColor: "#F1E5DB" },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E3EEEC",
  },
  confirmBox: {
    padding: 16,
    gap: 10,
    borderRadius: 18,
    backgroundColor: "#FCEDEA",
    borderWidth: 1,
    borderColor: "#F4D2CC",
  },

  // Chat
  chatIntro: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    maxWidth: 320,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#F6E9DE",
    marginBottom: 4,
  },
  chatIntroText: { flex: 1, fontSize: 11, lineHeight: 16, color: c.muted },
  earlier: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: "#E3EEEC",
  },
  earlierText: { color: c.teal, fontSize: 12, fontWeight: "700" },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  messageAvatar: { width: 30, height: 30, borderRadius: 15, marginBottom: 22 },
  senderName: {
    color: c.teal,
    fontWeight: "700",
    fontSize: 12,
    marginLeft: 4,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    gap: 6,
  },
  bubbleOwn: { backgroundColor: c.coralBright, borderBottomRightRadius: 5 },
  bubbleOther: { backgroundColor: "#F1E7DE", borderBottomLeftRadius: 5 },
  bubblePinned: { borderWidth: 1.5, borderColor: "#9FC4BF" },
  bubbleDeleted: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: c.line,
    borderStyle: "dashed",
  },
  pinnedText: { fontSize: 11, fontWeight: "700", color: c.teal },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: c.teal,
    backgroundColor: "rgba(255,255,255,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 2,
  },
  quoteOwn: {
    borderLeftColor: c.white,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  quoteName: { fontSize: 12, fontWeight: "700", color: c.teal },
  quoteText: { fontSize: 12, lineHeight: 17, color: c.muted },
  reaction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
  },
  reactionOwn: { backgroundColor: "#E3EEEC", borderColor: "#B9D3CF" },
  reactionCount: { fontSize: 11, color: c.muted },
  time: { fontSize: 10, color: c.muted, marginHorizontal: 4 },
  composer: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: c.line,
    backgroundColor: c.ivory,
  },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  composerInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 13,
    borderRadius: 23,
    backgroundColor: "#F2E9E1",
    color: c.charcoal,
    fontSize: 14,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: c.teal,
    backgroundColor: "#F6EEE7",
  },
  previewCard: {
    padding: 14,
    gap: 8,
    borderRadius: 18,
    backgroundColor: "#F1E7DE",
  },
  emojiRow: { flexDirection: "row", justifyContent: "space-between" },
  emoji: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.white,
    borderWidth: 1,
    borderColor: c.line,
  },
  emojiActive: { backgroundColor: "#E3EEEC", borderColor: c.teal },

  // Plans tab
  createCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 20,
  },
  createTitle: { color: c.white, fontSize: 17, fontWeight: "700" },
  createBody: { color: "rgba(255,255,255,0.78)", fontSize: 12 },
  createIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.coralBright,
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: "#FFFBF7",
  },
  filterButtonActive: { backgroundColor: c.teal, borderColor: c.teal },
  filterCount: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  filterPanel: { padding: 16, gap: 10, shadowOpacity: 0 },
  linkText: { color: c.teal, fontWeight: "700", fontSize: 13 },

  // Members
  privacyNote: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#E9F0EB",
  },
  privacyText: { flex: 1, color: c.teal, fontSize: 12, lineHeight: 18 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
  },

  // Participants / updates / reports
  initials: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F9E8DB",
  },
  initialsText: { color: c.teal, fontWeight: "700", fontSize: 16 },
  noticeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
  },
  noticeUnread: { backgroundColor: c.white, borderColor: "#F7CFC7" },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: c.coralBright,
  },
  evidence: {
    padding: 12,
    gap: 4,
    borderRadius: 12,
    backgroundColor: "#F6EEE7",
    borderLeftWidth: 3,
    borderLeftColor: "#E2D3C7",
  },
});
