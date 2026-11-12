import { compressPhoto } from "../services/compressPhoto";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
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
} from "../components/ui";
import DateTimeField from "../components/DateTimeField";
import { localDate, localTime } from "../components/dateTime";
import { MemberPhoto, ProfileAccess } from "./LiveDiscover";
import { api, demoMode } from "../services/api";
import { useCompletion } from "../services/onboarding";
import {
  type Moment,
  type SocialFeedItem,
  type SocialSettings,
  type Connection,
  type Invitation,
  useSocialQuery,
  useMomentTray,
  useSocialNotifications,
  socialWrite,
} from "../services/social";
import { colors as c } from "../theme";
import { useAppLayout } from "../components/layout";
import { timeAgo } from "./Likes";
import { PeoplePlanCard } from "./PlanComponents";
import { PlayTogetherCard } from "./AlongPlay";

const themes = {
  teal: ["#174F54", "#326B69"],
  coral: ["#BD5048", "#F47768"],
  peach: ["#8E523C", "#C27D57"],
  night: ["#27343B", "#55586A"],
} as const;
const sparks = [
  "Mountains or beaches?",
  "Coffee or chai?",
  "Morning person or night owl?",
  "What's your perfect Sunday?",
  "Movie night or spontaneous road trip?",
];
const nowPrompts = [
  "Free this evening",
  "Anyone for coffee?",
  "Up for a movie",
  "Looking for a walking buddy",
  "Need a concert companion",
];
const emoji = ["❤️", "😂", "🔥", "☕", "👀", "🙌"];
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
const active = (moment: Moment, now: number) =>
  moment.status === "active" && +new Date(moment.expiresAt) > now;
export default function SocialHomeScreen() {
  return demoMode ? (
    <Screen>
      <Header title="Social ✦" subtitle="A little more of their world." />
      <Empty
        title="Your world gets better together."
        description="Sign in to share private, 24-hour Moments with your matches."
      >
        <Button onPress={() => router.push("/auth")}>Sign In</Button>
      </Empty>
    </Screen>
  ) : (
    <ProfileAccess title="Social">
      <SocialHome />
    </ProfileAccess>
  );
}
function SocialHome() {
  const client = useQueryClient(),
    completion = useCompletion(),
    layout = useAppLayout();
  const now = useClock();
  const insets = useSafeAreaInsets();
  const [composerOpen, setComposerOpen] = useState(false);
  const [feedScope, setFeedScope] = useState<"matches" | "discover">("matches");
  const [pendingScope, setPendingScope] = useState<
    "matches" | "discover" | null
  >(null);
  const tray = useMomentTray(feedScope);
  const notifications = useSocialNotifications();
  const settings = useSocialQuery<SocialSettings>("settings");
  const invitations = useSocialQuery<Invitation[]>("invitations");
  const feed = useInfiniteQuery({
    queryKey: ["social", "feed", "mixed", feedScope],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{
        items: SocialFeedItem[];
        next: string | null;
        connectionCount: number;
      }>(
        `/social/feed?includePlans=true&scope=${feedScope}${pageParam ? `&before=${pageParam}` : ""}`,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 10000,
  });
  const items =
    (!feed.error
      ? feed.data?.pages
          .flatMap((p) => p.items)
          .filter((item) =>
            item.kind === "moment"
              ? active(item.moment, now)
              : !item.plan.expired &&
                (+new Date(item.plan.startsAt) >= now ||
                  (item.plan.endsAt && +new Date(item.plan.endsAt) > now) ||
                  (item.plan.recurring && !item.plan.endsAt)),
          )
      : undefined) ?? [];
  const own = tray.data?.find((m) => m.own && active(m, now));
  const others = tray.data?.filter((m) => !m.own && active(m, now)) ?? [];
  const fresh = others.filter((m) => !m.viewed).length;
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;
  const pendingInvites =
    invitations.data?.filter((i) => i.status === "pending" && i.incoming)
      .length ?? 0;
  const firstName = completion.data?.user.name?.split(" ")[0];
  const [spark] = useState(
    () => sparks[Math.floor(Math.random() * sparks.length)],
  );
  const pad = layout.isTablet ? 28 : 20;
  function openMoment(path: string) {
    setComposerOpen(false);
    router.push(path);
  }
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["social"] });
  };
  return (
    <Screen scroll={false}>
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        style={{ width: "100%", maxWidth: 720, alignSelf: "center" }}
        contentContainerStyle={{
          padding: pad,
          paddingTop: 4,
          paddingBottom: 112,
        }}
        refreshing={feed.isRefetching}
        onRefresh={refresh}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage)
            void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>
            <View style={s.scopeHeader}>
              <View
                style={s.scopeTrack}
                accessibilityRole="radiogroup"
                accessibilityLabel="Social updates audience"
              >
                {(
                  [
                    { scope: "matches", label: "Matches", icon: "heart" },
                    { scope: "discover", label: "Discover", icon: "compass" },
                  ] as const
                ).map((option) => {
                  const selected = feedScope === option.scope;
                  return (
                    <Pressable
                      key={option.scope}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      aria-checked={selected}
                      accessibilityLabel={
                        option.scope === "matches"
                          ? "Matched connections"
                          : "Discover preferences"
                      }
                      onPress={() => {
                        if (!selected) setPendingScope(option.scope);
                      }}
                      hitSlop={{ top: 6, bottom: 6 }}
                      style={({ pressed }) => [
                        s.scopeOption,
                        selected && s.scopeSelected,
                        pressed && { opacity: 0.75 },
                      ]}
                    >
                      <Ionicons
                        name={selected ? option.icon : `${option.icon}-outline`}
                        size={14}
                        color={selected ? c.peach : c.teal}
                      />
                      <Text
                        style={[
                          s.scopeText,
                          { color: selected ? c.white : c.teal },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={[s.row, { gap: 6 }]}>
                <View>
                  <IconButton
                    icon="notifications-outline"
                    label={`Social notifications${unread ? `, ${unread} unread` : ""}`}
                    onPress={() => router.push("/social-updates")}
                  />
                  {!!unread && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>
                        {unread > 9 ? "9+" : unread}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
            <Text style={[text.muted, { fontSize: 12, marginBottom: 4 }]}>
              A little more of their world.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -pad }}
              contentContainerStyle={{
                gap: 12,
                paddingHorizontal: pad,
                paddingTop: 14,
                paddingBottom: 16,
              }}
            >
              <MomentAvatar
                name={own ? "Your Moment" : "Add yours"}
                photoId={completion.data?.profile.photos?.[0]}
                own
                viewed={!!own?.viewed}
                hasMoment={!!own}
                onPress={() =>
                  router.push(
                    own
                      ? `/moment?id=${own.id}&author=${own.author.id}`
                      : "/moment-create",
                  )
                }
              />
              {others.map((m) => (
                <MomentAvatar
                  key={m.author.id}
                  name={m.author.name}
                  photoId={m.author.photoId ?? undefined}
                  viewed={m.viewed}
                  hasMoment
                  onPress={() =>
                    router.push(`/moment?id=${m.id}&author=${m.author.id}`)
                  }
                />
              ))}
            </ScrollView>

            {feedScope === "matches" && settings.data?.enabled !== false && (
              <PlayTogetherCard />
            )}
            {!!pendingInvites && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/social-invitations")}
                style={({ pressed }) => [
                  s.inviteBanner,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Ionicons name="mail-unread" size={18} color={c.coralBright} />
                <Text style={s.inviteText}>
                  {pendingInvites} plan{" "}
                  {pendingInvites === 1 ? "invitation" : "invitations"} waiting
                  for you
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={c.coralBright}
                />
              </Pressable>
            )}
            <View style={[s.trayHeader, { marginTop: 24, marginBottom: 12 }]}>
              <Text style={s.sectionTitle}>
                {feedScope === "matches" ? "From your people" : "From Discover"}
              </Text>
              {!!fresh && (
                <View style={s.freshPill}>
                  <View style={s.freshDot} />
                  <Text style={s.freshText}>{fresh} new</Text>
                </View>
              )}
            </View>
            {feed.error && (
              <Notice>
                {feed.error.message}
                <Button onPress={() => void feed.refetch()}>Try Again</Button>
              </Notice>
            )}
          </>
        }
        renderItem={({ item }) =>
          item.kind === "moment" ? (
            <MomentFeedCard moment={item.moment} now={now} />
          ) : (
            <View>
              <View style={[s.row, { gap: 6, marginBottom: 8 }]}>
                <Ionicons name="calendar-outline" size={14} color={c.teal} />
                <Text style={[text.label, { color: c.teal, fontSize: 12 }]}>
                  Plan
                </Text>
              </View>
              <PeoplePlanCard plan={item.plan} />
            </View>
          )
        }
        ListEmptyComponent={
          feed.isPending ? (
            <View style={{ gap: 18 }}>
              {[0, 1].map((key) => (
                <View key={key} style={[card, { padding: 14, gap: 14 }]}>
                  <View style={s.row}>
                    <View style={[s.skeleton, { width: 40, height: 40 }]} />
                    <View style={{ gap: 6, flex: 1 }}>
                      <View
                        style={[s.skeleton, { width: "40%", height: 12 }]}
                      />
                      <View
                        style={[s.skeleton, { width: "25%", height: 10 }]}
                      />
                    </View>
                  </View>
                  <View
                    style={[s.skeleton, { height: 240, borderRadius: 20 }]}
                  />
                </View>
              ))}
            </View>
          ) : feed.error ? (
            <View />
          ) : (
            <View style={[card, s.emptyCard]}>
              <LinearGradient
                colors={["#FFE1D5", "#FAEDE3"]}
                style={s.emptyIcon}
              >
                <Ionicons name="sparkles" size={30} color={c.coralBright} />
              </LinearGradient>
              <Text style={[text.title, { fontSize: 20, textAlign: "center" }]}>
                {feedScope === "discover"
                  ? "No Discover updates yet."
                  : feed.data?.pages[0]?.connectionCount
                    ? "Quiet around here... for now."
                    : "Your world gets better together."}
              </Text>
              <Text style={[text.muted, { textAlign: "center" }]}>
                {feedScope === "discover"
                  ? "Plans and updates from people who fit your Discover preferences will appear here."
                  : feed.data?.pages[0]?.connectionCount
                    ? "Share a plan or a little of your day. Status updates stay for 24 hours."
                    : "Start connecting with people through shared plans. Their plans and updates will appear here once you match."}
              </Text>
              <View style={{ gap: 10, alignSelf: "stretch", marginTop: 6 }}>
                <Button
                  variant="coral"
                  icon="add-circle-outline"
                  onPress={() => router.push("/moment-create")}
                >
                  Share your first Moment
                </Button>
                <View style={[s.row, { gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="outline"
                      onPress={() => router.push("/(tabs)")}
                    >
                      Discover
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="outline"
                      onPress={() => router.push("/(tabs)/plans")}
                    >
                      Plans
                    </Button>
                  </View>
                </View>
              </View>
            </View>
          )
        }
        ListFooterComponent={
          <View style={{ gap: 14, marginTop: 4 }}>
            {feed.isFetchingNextPage && <ActivityIndicator color={c.teal} />}
            {!!items.length && !feed.isFetchingNextPage && (
              <Text style={[text.muted, { textAlign: "center", fontSize: 12 }]}>
                You&apos;re all caught up ✦
              </Text>
            )}
            <View style={s.linkRow}>
              {(
                [
                  {
                    label: "Invitations",
                    icon: "mail-outline",
                    path: "/social-invitations",
                    count: pendingInvites,
                  },
                  {
                    label: "Archive",
                    icon: "albums-outline",
                    path: "/moment-archive",
                    count: 0,
                  },
                  {
                    label: "Privacy",
                    icon: "shield-checkmark-outline",
                    path: "/social-settings",
                    count: 0,
                  },
                ] as const
              ).map((link) => (
                <Pressable
                  key={link.label}
                  accessibilityRole="button"
                  accessibilityLabel={`${link.label}${link.count ? `, ${link.count} pending` : ""}`}
                  onPress={() => router.push(link.path)}
                  style={({ pressed }) => [
                    s.linkPill,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons name={link.icon} size={14} color={c.teal} />
                  <Text style={s.linkText}>{link.label}</Text>
                  {!!link.count && (
                    <View style={s.linkCount}>
                      <Text style={s.badgeText}>{link.count}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        }
      />
      <View
        pointerEvents="box-none"
        style={[
          s.floatingComposerPosition,
          {
            paddingHorizontal: pad,
            bottom: layout.isTablet ? Math.max(20, insets.bottom + 12) : 20,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open What's on your mind"
          accessibilityHint="Choose a photo, question or update to share"
          accessibilityState={{ expanded: composerOpen }}
          onPress={() => setComposerOpen(true)}
          style={({ pressed }) => [
            s.floatingComposer,
            pressed && { opacity: 0.8 },
          ]}
        >
          {completion.data?.profile.photos?.[0] ? (
            <MemberPhoto
              id={completion.data.profile.photos[0]}
              style={s.floatingAvatar}
            />
          ) : (
            <Ionicons name="person" size={30} color={c.ivory} />
          )}
          <View style={s.floatingPlus}>
            <Ionicons name="add" size={20} color={c.white} />
          </View>
        </Pressable>
      </View>
      {pendingScope && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setPendingScope(null)}
        >
          <View
            style={[
              s.scopeDialogBackdrop,
              {
                paddingTop: insets.top + 24,
                paddingBottom: insets.bottom + 24,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel feed switch"
              onPress={() => setPendingScope(null)}
              style={StyleSheet.absoluteFill}
            />
            <View
              role="dialog"
              accessibilityLabel={
                pendingScope === "matches"
                  ? "Switch to Matches?"
                  : "Switch to Discover?"
              }
              accessibilityViewIsModal
              style={[s.scopeDialog, { maxHeight: layout.height * 0.85 }]}
            >
              <ScrollView bounces={false}>
                <View style={s.scopeDialogIcon}>
                  <Ionicons
                    name={pendingScope === "matches" ? "heart" : "compass"}
                    size={26}
                    color={c.teal}
                  />
                </View>
                <Text
                  accessibilityRole="header"
                  style={[text.title, { fontSize: 22, marginBottom: 12 }]}
                >
                  {pendingScope === "matches"
                    ? "Switch to Matches?"
                    : "Switch to Discover?"}
                </Text>
                <Text style={[text.body, { color: c.muted, marginBottom: 24 }]}>
                  {pendingScope === "matches"
                    ? "Plans and status updates from people you've matched with."
                    : "Plans and status updates from people who fit your Discover preferences. Private updates stay private."}
                </Text>
                <View style={[s.row, { gap: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="outline"
                      onPress={() => setPendingScope(null)}
                    >
                      Cancel
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      onPress={() => {
                        if (pendingScope) setFeedScope(pendingScope);
                        setPendingScope(null);
                      }}
                    >
                      OK
                    </Button>
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
      {composerOpen && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setComposerOpen(false)}
        >
          <View style={s.composerBackdrop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss update options"
              onPress={() => setComposerOpen(false)}
              style={StyleSheet.absoluteFill}
            />
            <View
              role="dialog"
              accessibilityLabel="What's on your mind?"
              accessibilityViewIsModal
              style={[
                s.composerSheet,
                {
                  maxHeight: layout.height * 0.85,
                  paddingBottom: Math.max(20, insets.bottom),
                },
              ]}
            >
              <View
                style={[
                  s.row,
                  { justifyContent: "space-between", marginBottom: 12 },
                ]}
              >
                <Text
                  accessibilityRole="header"
                  style={[text.title, { fontSize: 20, flex: 1 }]}
                >
                  Share an update
                </Text>
                <IconButton
                  icon="close"
                  label="Close update options"
                  onPress={() => setComposerOpen(false)}
                />
              </View>
              <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
                <Button
                  icon="game-controller"
                  onPress={() => {
                    setComposerOpen(false);
                    router.push("/play");
                  }}
                >
                  Play Together
                </Button>
                <LinearGradient
                  colors={["#1A6065", c.tealDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.composeCard}
                >
                  <View style={[s.blob, { top: -50, right: -40 }]} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create Moment"
                    onPress={() => openMoment("/moment-create")}
                    style={[s.row, { gap: 10 }]}
                  >
                    <MemberPhoto
                      id={completion.data?.profile.photos?.[0]}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        borderWidth: 2,
                        borderColor: "rgba(255,248,242,0.6)",
                      }}
                    />
                    <View style={s.composeInput}>
                      <Text
                        numberOfLines={1}
                        style={{ color: "rgba(255,248,242,0.85)", flex: 1 }}
                      >
                        {firstName
                          ? `What's on your mind, ${firstName}?`
                          : "What's on your mind?"}
                      </Text>
                    </View>
                  </Pressable>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, marginTop: 12 }}
                  >
                    {(
                      [
                        {
                          key: "photo",
                          label: "Photo",
                          icon: "image-outline",
                          path: "/moment-create?type=photo",
                        },
                        {
                          key: "question",
                          label: "Ask",
                          icon: "chatbubbles-outline",
                          path: "/moment-create?type=question",
                        },
                        {
                          key: "along_now",
                          label: "Along now",
                          icon: "sunny-outline",
                          path: "/moment-create?type=along_now",
                        },
                        {
                          key: "spark",
                          label: spark,
                          icon: "sparkles",
                          path: `/moment-create?type=question&text=${encodeURIComponent(spark)}`,
                        },
                      ] as const
                    ).map((option) => (
                      <Pressable
                        key={option.key}
                        accessibilityRole="button"
                        accessibilityLabel={
                          option.key === "spark"
                            ? `Ask: ${spark}`
                            : `Create a ${option.label} Moment`
                        }
                        onPress={() => openMoment(option.path)}
                        style={({ pressed }) => [
                          s.composeChip,
                          option.key === "spark" && s.sparkChip,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons
                          name={option.icon}
                          size={14}
                          color={option.key === "spark" ? c.peach : "#FFF8F2"}
                        />
                        <Text style={s.composeChipText}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </LinearGradient>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </Screen>
  );
}
export function MomentAvatar({
  name,
  photoId,
  viewed,
  own = false,
  hasMoment = false,
  onPress,
}: {
  name: string;
  photoId?: string;
  viewed?: boolean;
  own?: boolean;
  hasMoment?: boolean;
  onPress: () => void;
}) {
  const photo = (
    <View style={{ padding: 3, borderRadius: 40, backgroundColor: c.ivory }}>
      <MemberPhoto
        id={photoId}
        style={{ width: 62, height: 62, borderRadius: 31 }}
      />
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${hasMoment && !viewed ? ", new Moments" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        width: 76,
        gap: 7,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View>
        {hasMoment && !viewed ? (
          <LinearGradient
            colors={[c.coralBright, "#FFB27A", c.coral]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 2.5, borderRadius: 42 }}
          >
            {photo}
          </LinearGradient>
        ) : (
          <View
            style={{
              padding: hasMoment ? 2.5 : 1,
              borderRadius: 42,
              borderWidth: hasMoment ? 0 : 1.5,
              borderStyle: hasMoment ? "solid" : "dashed",
              borderColor: c.peach,
              backgroundColor: hasMoment ? "#E3D6CB" : "transparent",
            }}
          >
            {photo}
          </View>
        )}
        {own && !hasMoment && (
          <View style={s.plus}>
            <Ionicons name="add" size={15} color="white" />
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[
          text.label,
          {
            fontSize: 11,
            color: hasMoment && !viewed ? c.charcoal : c.muted,
            fontWeight: hasMoment && !viewed ? "700" : "500",
          },
        ]}
      >
        {name}
      </Text>
    </Pressable>
  );
}
function MomentContent({
  moment,
  large = false,
}: {
  moment: Moment;
  large?: boolean;
}) {
  return moment.type === "photo" && moment.mediaPath ? (
    <MemberPhoto
      path={moment.mediaPath}
      resizeMode="contain"
      style={{ width: "100%", height: large ? 420 : 340, borderRadius: 20 }}
    />
  ) : (
    <LinearGradient
      colors={themes[moment.theme] ?? themes.teal}
      style={{
        minHeight: large ? 360 : 260,
        borderRadius: 20,
        padding: 28,
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
    >
      <Ionicons
        name={
          moment.type === "question"
            ? "chatbubbles-outline"
            : moment.type === "along_now"
              ? "sunny-outline"
              : "sparkles-outline"
        }
        size={26}
        color="#FFF8F2"
      />
      <Text
        style={{
          color: "#FFF8F2",
          textAlign: "center",
          fontWeight: "600",
          fontSize: large ? 30 : 26,
          lineHeight: large ? 40 : 35,
        }}
      >
        {moment.text}
      </Text>
      <Text
        style={{
          color: "#FFF8F2",
          opacity: 0.7,
          fontSize: 11,
          letterSpacing: 2,
        }}
      >
        A LITTLE MORE OF MY WORLD
      </Text>
    </LinearGradient>
  );
}
function MomentFeedCard({ moment, now }: { moment: Moment; now: number }) {
  const [menu, setMenu] = useState(false);
  const hoursLeft = Math.max(
    1,
    Math.ceil((+new Date(moment.expiresAt) - now) / 3600000),
  );
  const open = () =>
    router.push(`/moment?id=${moment.id}&author=${moment.author.id}`);
  return (
    <View
      style={[
        card,
        { padding: 14, marginBottom: 18, gap: 13, borderRadius: 24 },
      ]}
    >
      <View style={s.row}>
        <View
          style={{
            padding: 2,
            borderRadius: 24,
            borderWidth: 1.5,
            borderColor: moment.viewed || moment.own ? c.line : c.coralBright,
          }}
        >
          <MemberPhoto
            id={moment.author.photoId ?? undefined}
            style={{ width: 38, height: 38, borderRadius: 19 }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[text.label, { fontSize: 15 }]}>
            {moment.own ? "You" : moment.author.name}
          </Text>
          <Text style={[text.muted, { fontSize: 12, lineHeight: 17 }]}>
            {timeAgo(moment.publishedAt)}
          </Text>
        </View>
        <View style={s.timePill}>
          <Ionicons name="hourglass-outline" size={12} color={c.teal} />
          <Text style={s.timePillText}>{hoursLeft}h left</Text>
        </View>
        <IconButton
          icon="ellipsis-horizontal"
          label={`Options for ${moment.author.name}'s Moment`}
          onPress={() => setMenu(!menu)}
          color={c.muted}
          style={{ width: 36, height: 36 }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${moment.author.name}'s Moment`}
        onPress={open}
        style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
      >
        <MomentContent moment={moment} />
      </Pressable>
      {!!moment.caption && (
        <Text style={[text.body, { fontSize: 15, lineHeight: 22 }]}>
          {!moment.own && (
            <Text style={{ fontWeight: "700" }}>{moment.author.name} </Text>
          )}
          {moment.caption}
        </Text>
      )}
      {!moment.own && <MomentActions moment={moment} />}
      {moment.own && (
        <Pressable
          accessibilityRole="button"
          onPress={open}
          style={({ pressed }) => [s.ownRow, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="eye-outline" size={17} color={c.teal} />
          <Text style={[text.label, { color: c.teal, flex: 1 }]}>
            View your Moment
          </Text>
          <Ionicons name="chevron-forward" size={17} color={c.teal} />
        </Pressable>
      )}
      {menu && <MomentMenu moment={moment} />}
    </View>
  );
}
function MomentActions({ moment }: { moment: Moment }) {
  const client = useQueryClient();
  const [override, setOverride] = useState<{
      source: string | null;
      value: string | null;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reaction =
    override?.source === moment.reaction ? override.value : moment.reaction;
  async function react(value: string) {
    if (busy) return;
    const previous = reaction,
      next = previous === value ? null : value;
    setOverride({ source: moment.reaction, value: next });
    setBusy(true);
    setError("");
    try {
      await socialWrite(
        `moments/${moment.id}/reaction`,
        next ? { emoji: next } : undefined,
        next ? "PUT" : "DELETE",
      );
      void client.invalidateQueries({ queryKey: ["social"] });
    } catch (e) {
      setOverride(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={s.reactionBar}>
        {emoji.map((e) => {
          const selected = reaction === e;
          return (
            <Pressable
              key={e}
              accessibilityRole="button"
              accessibilityLabel={`React ${e}`}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              onPress={() => void react(e)}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? c.white : "transparent",
                borderWidth: selected ? 1.5 : 0,
                borderColor: c.coralBright,
                transform: [{ scale: pressed ? 0.88 : selected ? 1.1 : 1 }],
              })}
            >
              <Text style={{ fontSize: 21 }}>{e}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[s.row, { gap: 8 }]}>
        {(
          [
            {
              label: "Reply",
              icon: "chatbubble-ellipses-outline",
              path: `/moment?id=${moment.id}&reply=true`,
              accent: false,
            },
            {
              label: "Share",
              icon: "paper-plane-outline",
              path: `/moment-share?id=${moment.id}`,
              accent: false,
            },
            {
              label: "Make a plan",
              icon: "calendar-outline",
              path: `/social-plan?moment=${moment.id}`,
              accent: true,
            },
          ] as const
        )
          .filter(
            (action) => moment.canReply !== false || action.label === "Share",
          )
          .map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              onPress={() => router.push(action.path)}
              style={({ pressed }) => [
                s.actionButton,
                action.accent && {
                  backgroundColor: "#FFE1D5",
                  borderColor: "#FFD0C2",
                  flex: 1.3,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name={action.icon}
                size={16}
                color={action.accent ? c.coralBright : c.teal}
              />
              <Text
                numberOfLines={1}
                style={[
                  s.actionText,
                  action.accent && { color: c.coralBright },
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
function MomentMenu({
  moment,
  archived = false,
}: {
  moment: Moment;
  archived?: boolean;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState(""),
    [report, setReport] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const settings = useSocialQuery<SocialSettings>("settings");
  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      setError("");
      await fn();
      setDone(message);
      void client.invalidateQueries({ queryKey: ["social"] });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View
      style={{
        gap: 10,
        borderTopWidth: 1,
        borderColor: c.line,
        paddingTop: 12,
      }}
    >
      {moment.own ? (
        <>
          <Button
            variant="outline"
            onPress={() =>
              void act(
                () => socialWrite(`moments/${moment.id}`, undefined, "DELETE"),
                "Moment deleted.",
              )
            }
          >
            Delete Moment
          </Button>
          {!archived && (
            <Button
              variant="outline"
              onPress={() =>
                void act(
                  () =>
                    socialWrite(
                      `moments/${moment.id}/audience`,
                      {
                        audience: "only_me",
                        allowed: [],
                        excluded: [],
                        allowReshare: false,
                      },
                      "PATCH",
                    ),
                  "Audience changed to Only Me.",
                )
              }
            >
              Make Only Me
            </Button>
          )}
        </>
      ) : (
        <>
          <Button variant="outline" onPress={() => setReport(!report)}>
            Report Moment
          </Button>
          {report && (
            <>
              <Field
                label="Report reason"
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1500}
              />
              <Button
                disabled={reason.trim().length < 5}
                onPress={() =>
                  void act(
                    () =>
                      socialWrite(`moments/${moment.id}/report`, { reason }),
                    "Report sent privately to our safety team.",
                  )
                }
              >
                Submit Report
              </Button>
            </>
          )}
          <Button
            variant="outline"
            disabled={!settings.data || moment.canReply === false}
            onPress={() =>
              void act(
                () =>
                  socialWrite(
                    "settings",
                    {
                      ...settings.data!,
                      muted: [
                        ...new Set([
                          ...(settings.data?.muted ?? []),
                          moment.author.id,
                        ]),
                      ],
                    },
                    "PATCH",
                  ),
                "Moments muted. Manage this in Social privacy settings.",
              )
            }
          >
            Mute {moment.author.name}
          </Button>
        </>
      )}
      {!!done && <Text style={text.muted}>{done}</Text>}
      {!!error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}
export function CreateMomentScreen() {
  return (
    <ProfileAccess title="Create Moment">
      <MomentComposer />
    </ProfileAccess>
  );
}
function MomentComposer() {
  const params = useLocalSearchParams<{
    type?: Moment["type"];
    text?: string;
  }>();
  const settings = useSocialQuery<SocialSettings>("settings"),
    connections = useSocialQuery<Connection[]>("connections"),
    client = useQueryClient();
  const [type, setType] = useState<Moment["type"]>(() =>
      params.type &&
      ["text", "photo", "question", "along_now"].includes(params.type)
        ? params.type
        : "text",
    ),
    [content, setContent] = useState(params.text ?? ""),
    [caption, setCaption] = useState(""),
    [theme, setTheme] = useState<Moment["theme"]>("teal"),
    [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null),
    [selectedAudience, setAudience] = useState<
      SocialSettings["audience"] | null
    >(null),
    [allowed, setAllowed] = useState<string[] | null>(null),
    [reshare, setReshare] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const audienceValue =
      selectedAudience ?? settings.data?.audience ?? "matches",
    circle = allowed ?? settings.data?.closeCircle ?? [];
  async function pickPhoto() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (!result.canceled) {
        const p = result.assets[0];
        if (p.fileSize && p.fileSize > 30 * 1024 * 1024)
          throw new Error(
            "Choose a source photo up to 30 MB. It will be compressed automatically.",
          );
        setPhoto(p);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function publish() {
    if (busy) return;
    setBusy(true);
    setError("");
    const payload = {
      type,
      text: content,
      caption,
      theme,
      audience: audienceValue,
      allowed: audienceValue === "close_circle" ? circle : [],
      allowReshare: reshare ?? settings.data?.allowReshare ?? false,
      ...(type === "along_now" && content.includes("coffee")
        ? { category: "food" }
        : {}),
    };
    try {
      let result: Moment;
      if (type === "photo" && photo) {
        const compressed = await compressPhoto(photo.uri);
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        if (Platform.OS === "web") {
          const bytes = await (await fetch(compressed.uri)).blob();
          form.append("photo", bytes, "moment.jpg");
        } else
          form.append("photo", {
            uri: compressed.uri,
            name: "moment.jpg",
            type: "image/jpeg",
          } as unknown as Blob);
        result = await api<Moment>("/social/moments", {
          method: "POST",
          body: form,
        });
      } else result = await socialWrite<Moment>("moments", payload);
      await client.invalidateQueries({ queryKey: ["social"] });
      router.replace(`/moment?id=${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen width="reading">
      <Header
        back
        title="Create Moment"
        subtitle="A little of your day. Choose who sees it."
      />
      <View style={[s.row, { flexWrap: "wrap", marginVertical: 22 }]}>
        {(["text", "photo", "question", "along_now"] as const).map((t) => (
          <Chip
            key={t}
            selected={type === t}
            onPress={() => {
              setType(t);
              setContent("");
            }}
          >
            {
              {
                text: "Text",
                photo: "Photo",
                question: "Spark Question",
                along_now: "Along Now",
              }[t]
            }
          </Chip>
        ))}
      </View>
      {type === "photo" ? (
        <View style={{ gap: 12 }}>
          {photo && (
            <Image
              source={{ uri: photo.uri }}
              style={{ width: "100%", height: 320, borderRadius: 22 }}
              resizeMode="contain"
            />
          )}
          <Button variant="outline" onPress={() => void pickPhoto()}>
            {photo ? "Choose Another Photo" : "Choose Photo"}
          </Button>
          <Text style={text.muted}>
            Photos are automatically compressed under 100 KB.
          </Text>
        </View>
      ) : (
        <>
          <LinearGradient colors={themes[theme]} style={s.composerPreview}>
            <Text
              style={{
                color: c.white,
                fontSize: 28,
                textAlign: "center",
                lineHeight: 38,
              }}
            >
              {content || "A little more of my world ✦"}
            </Text>
          </LinearGradient>
          <View style={[s.row, { marginVertical: 14 }]}>
            {Object.keys(themes).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityLabel={`${t} theme`}
                accessibilityState={{ selected: theme === t }}
                onPress={() => setTheme(t as Moment["theme"])}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 22,
                  backgroundColor: themes[t as Moment["theme"]][0],
                  borderWidth: theme === t ? 3 : 0,
                  borderColor: c.coralBright,
                }}
              />
            ))}
          </View>
          {(type === "question" || type === "along_now") && (
            <View style={{ gap: 8, marginBottom: 16 }}>
              {(type === "question" ? sparks : nowPrompts).map((p) => (
                <Chip
                  key={p}
                  selected={content === p}
                  onPress={() => setContent(p)}
                >
                  {p}
                </Chip>
              ))}
            </View>
          )}
          <Field
            label={type === "question" ? "Your Spark Question" : "Your Moment"}
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={600}
          />
          <Text style={text.muted}>
            {content.length}/600 · Add emoji with your keyboard
          </Text>
        </>
      )}
      <Field
        label="Caption (optional)"
        value={caption}
        onChangeText={setCaption}
        multiline
        maxLength={500}
      />
      <Text style={[text.label, { marginVertical: 12 }]}>
        Who can see this?
      </Text>
      <View style={{ gap: 10 }}>
        {(["matches", "discover", "close_circle", "only_me"] as const).map(
          (a) => (
            <Chip
              key={a}
              selected={audienceValue === a}
              onPress={() => setAudience(a)}
            >
              {
                {
                  matches: "All My Matches",
                  discover: "Discover matches",
                  close_circle: "Close Circle",
                  only_me: "Only Me",
                }[a]
              }
            </Chip>
          ),
        )}
      </View>
      {audienceValue === "discover" && (
        <Notice>
          People who match your Discover preferences can view this Moment
          without being a connection. Private replies and invitations require a
          match.
        </Notice>
      )}
      {audienceValue === "close_circle" && (
        <ConnectionSelector
          connections={connections.data ?? []}
          selected={circle}
          onChange={setAllowed}
        />
      )}
      <Toggle
        label="Allow sharing with authorized matches"
        value={reshare ?? settings.data?.allowReshare ?? false}
        onChange={setReshare}
      />
      <Notice>
        Disappears after 24 hours. Exact location is never attached. Hidden
        matches in your privacy settings stay excluded.
      </Notice>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Button
        loading={busy}
        disabled={
          settings.isPending ||
          !settings.data?.enabled ||
          (type === "photo" ? !photo : !content.trim()) ||
          (audienceValue === "close_circle" && !circle.length)
        }
        onPress={() => void publish()}
      >
        Publish Moment
      </Button>
      {settings.data?.enabled === false && (
        <Button
          variant="outline"
          onPress={() => router.push("/social-settings")}
        >
          Enable Social
        </Button>
      )}
    </Screen>
  );
}
export function MomentViewer() {
  const { id: initialId, author } = useLocalSearchParams<{
    id: string;
    author?: string;
  }>();
  const client = useQueryClient(),
    now = useClock();
  const [selected, setSelected] = useState(initialId),
    [reply, setReply] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState<string | null>(null),
    [progress, setProgress] = useState(0),
    [paused, setPaused] = useState(false);
  const detail = useSocialQuery<Moment>(`moments/${selected}`);
  const moment = detail.data;
  const authorId = author ?? moment?.author.id;
  const feed = useSocialQuery<{ items: Moment[] }>(
    `feed?scope=${moment?.canReply === false ? "discover" : "matches"}&limit=30&author=${authorId}`,
    !!authorId,
  );
  const sequence = useMemo(
    () =>
      feed.data?.items
        .filter((m) => m.author.id === authorId && active(m, now))
        .reverse() ?? [],
    [feed.data?.items, authorId, now],
  );
  const elapsed = useRef(0);
  const position = sequence.findIndex((m) => m.id === selected);
  const views = useSocialQuery<
    { id: string; name: string; viewedAt: string }[]
  >(`moments/${selected}/views`, !!moment?.own);
  const reactions = useSocialQuery<
    { id: string; name: string; emoji: string }[]
  >(`moments/${selected}/reactions`, !!moment?.own);
  function advance(direction: number) {
    const next = sequence[position + direction];
    if (next) {
      elapsed.current = 0;
      setProgress(0);
      setError("");
      setSent(null);
      setReply("");
      setSelected(next.id);
    } else if (direction > 0) router.back();
  }
  useEffect(() => {
    if (!selected) return;
    void socialWrite(`moments/${selected}/views`)
      .then(() => client.invalidateQueries({ queryKey: ["social", "tray"] }))
      .catch(() => {});
  }, [selected, client]);
  useEffect(() => {
    if (!moment || paused || reply || !active(moment, Date.now())) return;
    const t = setInterval(() => {
      elapsed.current = Math.min(1, elapsed.current + 0.02);
      setProgress(elapsed.current);
      if (elapsed.current >= 1) {
        const next = sequence[position + 1];
        if (next) {
          elapsed.current = 0;
          setProgress(0);
          setError("");
          setSent(null);
          setSelected(next.id);
        } else clearInterval(t);
      }
    }, 200);
    return () => clearInterval(t);
  }, [moment, paused, reply, selected, sequence, position]);
  async function send() {
    if (!moment || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await socialWrite<{ conversationId: string }>(
        `moments/${moment.id}/replies`,
        { text: reply },
      );
      setReply("");
      setSent(result.conversationId);
      void client.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (detail.isPending)
    return (
      <Screen>
        <Header back title="Moment" />
        <ActivityIndicator color={c.teal} />
      </Screen>
    );
  if (!moment || detail.error || !active(moment, now))
    return (
      <Screen>
        <Header back title="Moment" />
        <Empty
          title="This Moment has passed."
          description={
            detail.error?.message ??
            "Moments are available for 24 hours, while your connection and audience access remain active."
          }
        />
      </Screen>
    );
  return (
    <Screen width="reading">
      <Header
        back
        title={moment.own ? "Your Moment" : moment.author.name}
        subtitle={timeAgo(moment.publishedAt)}
        right={
          <IconButton
            icon={paused ? "play-outline" : "pause-outline"}
            label={paused ? "Resume Moment" : "Pause Moment"}
            onPress={() => setPaused(!paused)}
          />
        }
      />
      <View style={[s.row, { marginTop: 16 }]}>
        <MemberPhoto
          id={moment.author.photoId ?? undefined}
          style={{ width: 36, height: 36, borderRadius: 18 }}
        />
        <Text style={text.label}>{moment.author.name}</Text>
      </View>
      <View style={[s.row, { marginVertical: 18, gap: 4 }]}>
        {(sequence.length ? sequence : [moment]).map((m, i) => (
          <View
            key={m.id}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 3,
              backgroundColor: "#E8DAD0",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${i < Math.max(position, 0) ? 100 : m.id === selected ? progress * 100 : 0}%`,
                height: 4,
                backgroundColor: c.coralBright,
              }}
            />
          </View>
        ))}
      </View>
      <MomentContent moment={moment} large />
      {!!moment.caption && (
        <Text style={[text.body, { marginVertical: 16 }]}>
          {moment.caption}
        </Text>
      )}
      <View
        style={[s.row, { justifyContent: "space-between", marginVertical: 14 }]}
      >
        <IconButton
          icon="chevron-back"
          label="Previous Moment"
          onPress={() => advance(-1)}
        />
        <Text style={text.muted}>
          Available until{" "}
          {new Date(moment.expiresAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
        <IconButton
          icon="chevron-forward"
          label="Next Moment"
          onPress={() => advance(1)}
        />
      </View>
      {moment.own ? (
        <>
          <Text style={text.label}>{views.data?.length ?? 0} views</Text>
          {reactions.data?.map((r) => (
            <Text key={r.id} style={text.body}>
              {r.emoji} {r.name}
            </Text>
          ))}
          {views.data?.map((v) => (
            <Text key={v.id} style={text.muted}>
              {v.name}
            </Text>
          ))}
          <Button
            variant="outline"
            onPress={() => router.push("/moment-create")}
          >
            Add Another Moment
          </Button>
          <MomentMenu moment={moment} />
        </>
      ) : (
        <>
          <MomentActions moment={moment} />
          {moment.canReply === false ? (
            <Notice>
              Match with this person through Discover to reply privately or make
              a plan.
            </Notice>
          ) : (
            <>
              <Field
                label="Reply privately"
                value={reply}
                onChangeText={setReply}
                multiline
                maxLength={1500}
              />
              <Button
                loading={busy}
                disabled={!reply.trim()}
                onPress={() => void send()}
              >
                Send Private Reply
              </Button>
            </>
          )}
          {sent && (
            <>
              <Text style={text.muted}>Reply sent privately.</Text>
              <Button
                variant="outline"
                onPress={() => router.push(`/conversation?id=${sent}`)}
              >
                Continue in Chat
              </Button>
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
        </>
      )}
    </Screen>
  );
}
export function MomentShareSheet() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    client = useQueryClient();
  const recipients = useSocialQuery<Connection[]>(
    `moments/${id}/share-recipients`,
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function share(recipient: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await socialWrite<{ conversationId: string }>(
        `moments/${id}/share`,
        { recipient },
      );
      void client.invalidateQueries({ queryKey: ["conversations"] });
      router.replace(`/conversation?id=${r.conversationId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen width="reading">
      <Header
        back
        title="Share a Moment"
        subtitle="Only with someone who already has permission to see it."
      />
      {recipients.isPending && <ActivityIndicator color={c.teal} />}
      {recipients.data?.map((r) => (
        <Button key={r.id} disabled={busy} onPress={() => void share(r.id)}>
          Send to {r.name}
        </Button>
      ))}
      {!recipients.isPending && !recipients.data?.length && (
        <Notice>
          No authorized recipient is available. The creator must allow sharing,
          and the recipient must independently belong to the original audience.
        </Notice>
      )}
      {!!(error || recipients.error) && (
        <Text style={s.error}>{error || recipients.error?.message}</Text>
      )}
    </Screen>
  );
}
export function SocialPrivacySettings() {
  const result = useSocialQuery<SocialSettings>("settings"),
    connections = useSocialQuery<Connection[]>("connections");
  const [draft, setDraft] = useState<SocialSettings | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    client = useQueryClient();
  const value = draft ?? result.data;
  const change = (patch: Partial<SocialSettings>) => {
    if (value) setDraft({ ...value, ...patch });
    setSaved(false);
  };
  return (
    <Screen width="reading">
      <Header
        back
        title="Social privacy"
        subtitle="Your world, shared on your terms."
      />
      {value ? (
        <>
          <Toggle
            label="Enable Social visibility"
            value={value.enabled}
            onChange={(enabled) => change({ enabled })}
          />
          <Text style={text.label}>Default Moment audience</Text>
          <View style={{ gap: 10, marginVertical: 16 }}>
            {(["matches", "discover", "close_circle", "only_me"] as const).map(
              (a) => (
                <Chip
                  key={a}
                  selected={value.audience === a}
                  onPress={() => change({ audience: a })}
                >
                  {
                    {
                      matches: "All My Matches",
                      discover: "Discover matches",
                      close_circle: "Close Circle",
                      only_me: "Only Me",
                    }[a]
                  }
                </Chip>
              ),
            )}
          </View>
          <Toggle
            label="Allow sharing with authorized matches"
            value={value.allowReshare}
            onChange={(allowReshare) => change({ allowReshare })}
          />
          <Toggle
            label="View receipts"
            value={value.viewReceipts}
            onChange={(viewReceipts) => change({ viewReceipts })}
          />
          <Toggle
            label="Archive own Moments"
            value={value.archive}
            onChange={(archive) => change({ archive })}
          />
          <Toggle
            label="Social notifications"
            value={value.notifications}
            onChange={(notifications) => change({ notifications })}
          />
          {(["closeCircle", "hidden", "muted"] as const).map((key) => (
            <View key={key}>
              <Text style={[text.label, { marginTop: 22 }]}>
                {
                  {
                    closeCircle: "Your Close Circle",
                    hidden: "Hide your Moments from",
                    muted: "Mute Moments from",
                  }[key]
                }
              </Text>
              <ConnectionSelector
                connections={connections.data ?? []}
                selected={value[key]}
                onChange={(v) => change({ [key]: v })}
              />
            </View>
          ))}
          <Notice>
            Disabling visibility revokes Social access in both directions.
            Muting only changes your feed. View receipts already sent stay
            recorded. Audience and resharing defaults apply to new Moments.
          </Notice>
          <Button
            loading={busy}
            onPress={() => {
              setBusy(true);
              void socialWrite("settings", value, "PATCH")
                .then(() => {
                  setSaved(true);
                  return client.invalidateQueries({ queryKey: ["social"] });
                })
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Save Social Settings
          </Button>
          {saved && <Text style={text.muted}>Privacy settings saved.</Text>}
        </>
      ) : result.error ? (
        <Notice>{result.error.message}</Notice>
      ) : (
        <ActivityIndicator color={c.teal} />
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
}
function ConnectionSelector({
  connections,
  selected,
  onChange,
}: {
  connections: Connection[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <View style={{ gap: 10, marginVertical: 16 }}>
      {connections.length ? (
        connections.map((p) => (
          <Chip
            key={p.id}
            selected={selected.includes(p.id)}
            onPress={() =>
              onChange(
                selected.includes(p.id)
                  ? selected.filter((id) => id !== p.id)
                  : [...selected, p.id],
              )
            }
          >
            {p.name}
          </Chip>
        ))
      ) : (
        <Text style={text.muted}>Eligible matches will appear here.</Text>
      )}
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={[s.row, { paddingVertical: 16 }]}>
      <Text style={[text.body, { flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.teal }}
      />
    </View>
  );
}
export function MomentArchive() {
  const result = useSocialQuery<Moment[]>("my-archive");
  return (
    <Screen width="reading">
      <Header
        title="Your Moment archive"
        subtitle="Only you can see these past Moments."
        back
      />
      {result.isPending && <ActivityIndicator color={c.teal} />}
      {result.error && <Notice>{result.error.message}</Notice>}
      {!result.isPending && !result.data?.length && (
        <Empty
          title="Your memories live here."
          description="When archiving is enabled, your expired Moments stay private here."
        />
      )}
      {result.data?.map((m) => (
        <View
          key={m.id}
          style={[card, { padding: 14, gap: 12, marginTop: 20 }]}
        >
          <Text style={text.muted}>
            {new Date(m.publishedAt).toLocaleDateString()}
          </Text>
          <MomentContent moment={m} />
          {!!m.caption && <Text style={text.body}>{m.caption}</Text>}
          <MomentMenu moment={m} archived />
        </View>
      ))}
    </Screen>
  );
}
export function SocialUpdates() {
  const result = useSocialNotifications(),
    client = useQueryClient();
  const labels: Record<string, string> = {
    moment: "A match shared a new Moment.",
    reaction: "A match reacted to your Moment.",
    reply: "You have a private Moment reply.",
    shared: "A match shared a Moment with you.",
    invitation: "You have a private plan invitation.",
    accepted: "Your private plan was accepted.",
    changes: "Your match suggested changes to a plan.",
    game_invitation: "Invited you to play This or That.",
    game_request: "Wants to play This or That with you.",
    game_accepted: "Your play request was accepted. Get ready!",
    game_declined:
      "Your play request was declined. You can try another invitation.",
    game_ready: "Your match is ready to play.",
    game_waiting: "Your match is waiting in your game.",
    game_completed: "Your Vibe Match is ready to reveal.",
    game_rematch: "Invited you for another round of This or That.",
  };
  return (
    <Screen
      width="reading"
      refreshing={result.isRefetching}
      onRefresh={() => void result.refetch()}
    >
      <Header back title="Social updates" />
      <Button
        variant="outline"
        onPress={() => router.push("/social-invitations")}
      >
        Private Plan Invitations
      </Button>
      {result.error && <Notice>{result.error.message}</Notice>}
      {!result.isPending && !result.data?.length && (
        <Empty
          title="You're all caught up."
          description="New Moments and private connections will appear here."
        />
      )}
      {result.data?.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          onPress={() => {
            void socialWrite(`notifications/${n.id}/read`).then(() =>
              client.invalidateQueries({
                queryKey: ["social", "notifications"],
              }),
            );
            router.push(
              n.gameSessionId
                ? `/play/this-or-that/${n.gameSessionId}`
                : n.gameInvitationId
                  ? "/play"
                  : n.invitationId
                    ? "/social-invitations"
                    : `/moment?id=${n.momentId}`,
            );
          }}
          style={[
            card,
            {
              padding: 18,
              marginTop: 12,
              backgroundColor: n.readAt ? c.white : "#FCE7DB",
            },
          ]}
        >
          <Text style={text.label}>{n.actor.name}</Text>
          <Text style={text.body}>{labels[n.kind]}</Text>
          <Text style={text.muted}>{timeAgo(n.createdAt)}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}
export function MakePlanFromMomentSheet() {
  const { moment: momentId, invitation: invitationId } = useLocalSearchParams<{
    moment?: string;
    invitation?: string;
  }>();
  const moment = useSocialQuery<Moment>(`moments/${momentId}`, !!momentId),
    invites = useSocialQuery<Invitation[]>("invitations", !!invitationId);
  const categories =
    useSocialQuery<{ slug: string; name: string }[]>("categories");
  const source = invites.data?.find((i) => i.id === invitationId);
  return (
    <Screen width="reading">
      <Header
        back
        title={invitationId ? "Suggest changes" : "Make a Plan"}
        subtitle="An invitation for two. Nothing is posted publicly."
      />
      {(invitationId ? source : moment.data) ? (
        <PlanProposal
          key={invitationId ?? momentId}
          moment={moment.data}
          invitation={source}
          categories={categories.data ?? []}
        />
      ) : (
        <Notice>
          {moment.error?.message ??
            invites.error?.message ??
            "Loading your invitation…"}
        </Notice>
      )}
    </Screen>
  );
}
function PlanProposal({
  moment,
  invitation,
  categories,
}: {
  moment?: Moment;
  invitation?: Invitation;
  categories: { slug: string; name: string }[];
}) {
  const [tomorrow] = useState(() => new Date(Date.now() + 86400000));
  const client = useQueryClient();
  const [title, setTitle] = useState(
      invitation?.title ??
        moment?.text.slice(0, 100) ??
        "A little time together",
    ),
    [category, setCategory] = useState(
      invitation?.category ?? moment?.category ?? "food",
    ),
    [zone, setZone] = useState(invitation?.zone ?? ""),
    [date, setDate] = useState(
      invitation
        ? localDate(new Date(invitation.startsAt))
        : localDate(tomorrow),
    ),
    [time, setTime] = useState(
      invitation ? localTime(new Date(invitation.startsAt)) : "18:00",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const proposal = {
        title,
        category,
        zone,
        startsAt: new Date(`${date}T${time}:00`).toISOString(),
      };
      if (invitation)
        await socialWrite(`invitations/${invitation.id}/respond`, {
          action: "changes",
          version: invitation.version,
          proposal,
        });
      else await socialWrite(`moments/${moment!.id}/make-plan`, proposal);
      await client.invalidateQueries({ queryKey: ["social"] });
      router.replace("/social-invitations");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 14, marginTop: 20 }}>
      <Field
        label="Plan title"
        value={title}
        onChangeText={setTitle}
        maxLength={100}
      />
      <Text style={text.label}>Category</Text>
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {categories.map((c) => (
          <Chip
            key={c.slug}
            selected={category === c.slug}
            onPress={() => setCategory(c.slug)}
          >
            {c.name}
          </Chip>
        ))}
      </View>
      <DateTimeField
        label="Proposed date"
        mode="date"
        value={date}
        onChange={setDate}
        minimumDate={localDate(new Date())}
      />
      <DateTimeField
        label="Proposed time"
        mode="time"
        value={time}
        onChange={setTime}
      />
      <Field
        label="Approximate area"
        value={zone}
        onChangeText={setZone}
        maxLength={100}
      />
      <Notice>
        Your match can accept, decline or suggest changes. Use a public meeting
        area and keep exact addresses private.
      </Notice>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <Button
        loading={busy}
        disabled={
          title.trim().length < 3 || zone.trim().length < 2 || !date || !time
        }
        onPress={() => void send()}
      >
        {invitation ? "Send Suggested Changes" : "Send Private Invitation"}
      </Button>
    </View>
  );
}
export function SocialInvitations() {
  const result = useSocialQuery<Invitation[]>("invitations"),
    client = useQueryClient();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  async function respond(i: Invitation, action: "accept" | "decline") {
    if (busy) return;
    setBusy(i.id);
    try {
      await socialWrite(`invitations/${i.id}/respond`, {
        action,
        version: i.version,
      });
      await client.invalidateQueries({ queryKey: ["social"] });
      void client.invalidateQueries({ queryKey: ["plans"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Screen
      width="reading"
      refreshing={result.isRefetching}
      onRefresh={() => void result.refetch()}
    >
      <Header
        back
        title="Private plans"
        subtitle="Make time for each other, by mutual agreement."
      />
      {!!(error || result.error) && (
        <Notice>{error || result.error?.message}</Notice>
      )}
      {!result.isPending && !result.data?.length && (
        <Empty
          title="Something to look forward to."
          description="Tap Make a Plan on a match's Moment to send a private invitation."
        />
      )}
      {result.data?.map((i) => (
        <View
          key={i.id}
          style={[card, { padding: 20, marginTop: 16, gap: 12 }]}
        >
          <Text style={text.title}>{i.title}</Text>
          <Text style={text.body}>
            {i.member} · {i.status}
          </Text>
          <Text style={text.muted}>
            {new Date(i.startsAt).toLocaleString()} · {i.zone}
          </Text>
          {i.status === "pending" && i.incoming && (
            <>
              <Button
                loading={busy === i.id}
                disabled={!!busy}
                onPress={() => void respond(i, "accept")}
              >
                Accept Plan
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onPress={() => router.push(`/social-plan?invitation=${i.id}`)}
              >
                Suggest Changes
              </Button>
              <Button
                variant="outline"
                disabled={!!busy}
                onPress={() => void respond(i, "decline")}
              >
                Decline
              </Button>
            </>
          )}
          {i.status === "pending" && !i.incoming && (
            <Text style={text.muted}>Waiting for your match to respond.</Text>
          )}
          {i.activityId && (
            <Button onPress={() => router.push(`/activity?id=${i.activityId}`)}>
              View Confirmed Plan
            </Button>
          )}
        </View>
      ))}
    </Screen>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: {
    position: "absolute",
    right: 4,
    top: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: c.ivory,
  },
  badgeText: { color: "white", fontSize: 9, fontWeight: "800" },
  plus: {
    position: "absolute",
    right: 0,
    bottom: 0,
    backgroundColor: c.coralBright,
    borderRadius: 12,
    padding: 2,
    borderWidth: 2,
    borderColor: c.ivory,
  },
  trayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: c.charcoal,
    letterSpacing: -0.3,
  },
  freshPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#FFE1D5",
  },
  freshDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.coralBright,
  },
  freshText: { color: c.coralBright, fontSize: 11, fontWeight: "700" },
  floatingComposerPosition: {
    position: "absolute",
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    alignItems: "flex-end",
  },
  floatingComposer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.teal,
    borderWidth: 3,
    borderColor: c.ivory,
    shadowColor: c.tealDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 7,
  },
  floatingAvatar: { width: 58, height: 58, borderRadius: 29 },
  floatingPlus: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: c.coralBright,
    borderWidth: 2,
    borderColor: c.ivory,
    alignItems: "center",
    justifyContent: "center",
  },
  composerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(9,62,67,0.35)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  composerSheet: {
    width: "100%",
    maxWidth: 720,
    backgroundColor: c.ivory,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
  },
  scopeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 48,
    marginBottom: 2,
  },
  scopeTrack: {
    width: 244,
    flexShrink: 1,
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: 999,
    backgroundColor: c.soft,
    borderWidth: 1,
    borderColor: c.line,
  },
  scopeOption: {
    flex: 1,
    minHeight: 30,
    paddingHorizontal: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  scopeSelected: {
    backgroundColor: c.teal,
    shadowColor: "#093E43",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },
  scopeText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.1 },
  scopeDialogBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(9,62,67,0.4)",
  },
  scopeDialog: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 26,
    padding: 24,
    backgroundColor: c.ivory,
  },
  scopeDialogIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: c.soft,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  composeCard: { borderRadius: 22, padding: 14, overflow: "hidden" },
  blob: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(244,119,104,0.22)",
  },
  composeInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,248,242,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,248,242,0.18)",
  },
  composeChip: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,248,242,0.12)",
  },
  sparkChip: {
    backgroundColor: "rgba(244,201,168,0.16)",
    borderWidth: 1,
    borderColor: "rgba(244,201,168,0.35)",
  },
  composeChipText: { color: "#FFF8F2", fontSize: 12, fontWeight: "700" },
  inviteBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: "#FFE9E0",
    borderWidth: 1,
    borderColor: "#FFD0C2",
  },
  inviteText: { flex: 1, color: c.charcoal, fontSize: 13, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: c.line,
  },
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: c.soft,
  },
  linkText: { color: c.teal, fontSize: 12, fontWeight: "600" },
  linkCount: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: c.soft,
  },
  timePillText: { color: c.teal, fontSize: 11, fontWeight: "700" },
  reactionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 4,
    borderRadius: 999,
    backgroundColor: c.soft,
  },
  actionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: "#FFFCF8",
  },
  actionText: { color: c.teal, fontSize: 12, fontWeight: "700" },
  ownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: c.soft,
  },
  skeleton: { backgroundColor: "#F3E6DB", borderRadius: 20 },
  emptyCard: {
    padding: 24,
    borderRadius: 26,
    alignItems: "center",
    gap: 10,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  error: { color: "#A6382E", marginVertical: 8 },
  composerPreview: {
    padding: 28,
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    marginTop: 4,
  },
});
