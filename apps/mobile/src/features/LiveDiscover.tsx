import React, { useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Platform,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Chip,
  Empty,
  Field,
  Header,
  IconButton,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { api, apiPhoto } from "../services/api";
import {
  actOnProfile,
  type MemberCard,
  type SwipeAction,
} from "../services/discovery";
import { useCompletion, VIBES } from "../services/onboarding";
import { colors as c, shadow } from "../theme";
import { MemberProfileView } from "./MemberProfile";
import { useMatchCelebration } from "../store/useMatchCelebration";
import { LikesScreen, timeAgo, type LikeRow } from "./Likes";
import { formatMonthYear } from "../components/profile";
import { NotificationBell } from "./ActivityNotifications";
import { useAppLayout } from "../components/layout";

type MemberPhotoProps = {
  id?: string;
  path?: string;
  resizeMode?: "cover" | "contain";
  style: StyleProp<ImageStyle>;
};
export function MemberPhoto(props: MemberPhotoProps) {
  return <PrivateMemberPhoto key={props.path ?? props.id} {...props} />;
}
function PrivateMemberPhoto({
  id,
  path,
  style,
  resizeMode = "cover",
}: MemberPhotoProps) {
  const [source, setSource] = useState<ImageSourcePropType | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const photo = useQuery({
    queryKey: ["member-photo", path ?? id, attempt],
    enabled: !!(id || path),
    queryFn: ({ signal }) => apiPhoto(id ?? "", signal, path),
    staleTime: 300000,
    gcTime: 300000,
    retry: false,
  });
  useEffect(() => {
    if (!photo.data) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    let reader: FileReader | undefined;
    const blob = photo.data;
    if (Platform.OS === "web") {
      objectUrl = URL.createObjectURL(blob);
      const uri = objectUrl;
      void Promise.resolve().then(() => {
        if (!cancelled) setSource({ uri });
      });
    } else {
      reader = new FileReader();
      reader.onload = () => {
        if (!cancelled && typeof reader?.result === "string")
          setSource({ uri: reader.result });
      };
      reader.onerror = () => {
        if (!cancelled) setFailed(true);
      };
      reader.readAsDataURL(blob);
    }
    return () => {
      cancelled = true;
      reader?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.data]);
  return (
    <View style={[style, { backgroundColor: c.peach, overflow: "hidden" }]}>
      {source && !failed ? (
        <Image
          accessibilityLabel="Member profile photo"
          source={source}
          resizeMode={resizeMode}
          testID="member-photo"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          {failed || photo.isError ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry profile photo"
              onPress={(event) => {
                event.stopPropagation();
                setSource(null);
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
              style={{ alignItems: "center", padding: 8, gap: 5 }}
            >
              <Ionicons name="refresh-outline" size={26} color={c.teal} />
              <Text style={{ color: c.teal, fontSize: 11 }}>Retry photo</Text>
            </Pressable>
          ) : !(id || path) ? (
            <Ionicons name="person-outline" size={48} color={c.teal} />
          ) : (
            <ActivityIndicator color={c.teal} />
          )}
        </View>
      )}
    </View>
  );
}
export function ProfileAccess({
  children,
  title = "Discover people",
}: {
  children: ReactNode;
  title?: string;
}) {
  const progress = useCompletion();
  if (!progress.data?.activated)
    return (
      <Screen>
        <Header title={title} />
        <Empty
          icon="people-outline"
          title={
            progress.isPending
              ? "Getting your profile ready"
              : "Complete Profile to Connect"
          }
          description={
            progress.error?.message ??
            "Finish your safety checks to view profiles and connect with people."
          }
        >
          {progress.error ? (
            <Button onPress={() => void progress.refetch()}>Try Again</Button>
          ) : (
            !progress.isPending && (
              <Button
                onPress={() =>
                  router.push(
                    progress.data?.checks.quickStart
                      ? "/profile-unlock"
                      : "/onboarding",
                  )
                }
              >
                Complete Profile to Connect
              </Button>
            )
          )}
        </Empty>
      </Screen>
    );
  return <>{children}</>;
}
function ProfileCard({
  member,
  busy,
  onAction,
}: {
  member: MemberCard;
  busy: boolean;
  onAction: (action: SwipeAction) => Promise<void>;
}) {
  const layout = useAppLayout();
  const [x] = useState(() => new Animated.Value(0)),
    [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => sub.remove();
  }, []);
  const reset = () => {
    if (reduced) x.setValue(0);
    else
      Animated.spring(x, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
  };
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) =>
      !busy && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
    onPanResponderMove: (_e, g) => {
      if (!busy) x.setValue(g.dx);
    },
    onPanResponderRelease: (_e, g) => {
      reset();
      if (!busy && Math.abs(g.dx) > 85)
        void onAction(g.dx > 0 ? "like" : "pass");
    },
    onPanResponderTerminate: reset,
  });
  return (
    <View style={{ marginBottom: 42 }}>
      <Animated.View
        testID="discovery-profile-card"
        {...pan.panHandlers}
        style={{
          transform: [
            { translateX: x },
            {
              rotate: reduced
                ? "0deg"
                : x.interpolate({
                    inputRange: [-240, 0, 240],
                    outputRange: ["-9deg", "0deg", "9deg"],
                  }),
            },
          ],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${member.name}'s profile`}
          disabled={busy}
          onPress={() => router.push(`/person?id=${member.id}`)}
          style={{
            height: layout.isTablet
              ? Math.max(340, Math.min(640, layout.height - 280))
              : 505,
            borderRadius: 23,
            overflow: "hidden",
            backgroundColor: c.peach,
          }}
        >
          <MemberPhoto
            key={member.photoIds[0]}
            id={member.photoIds[0]}
            style={{ position: "absolute", width: "100%", height: "100%" }}
          />
          <LinearGradient
            pointerEvents="box-none"
            colors={["transparent", "#09262500", "#16251AEF"]}
            locations={[0, 0.35, 1]}
            style={{ flex: 1, justifyContent: "space-between", padding: 20 }}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {member.likedYou && (
                <View style={[cardPill, { backgroundColor: c.coralBright }]}>
                  <Ionicons name="heart" size={12} color={c.white} />
                  <Text style={cardPillText}>Liked you</Text>
                </View>
              )}
              {member.mutualMatch ? (
                <View style={[cardPill, { backgroundColor: c.teal }]}>
                  <Ionicons name="heart" size={12} color={c.coralBright} />
                  <Text style={cardPillText}>Mutual match</Text>
                </View>
              ) : (
                <View
                  style={[
                    cardPill,
                    {
                      backgroundColor: "#093E4399",
                      borderWidth: 1,
                      borderColor: "#FFFFFF55",
                    },
                  ]}
                >
                  <Ionicons name="sparkles" size={12} color={c.peach} />
                  <Text style={cardPillText}>Open to meeting you</Text>
                </View>
              )}
              <View style={[cardPill, { backgroundColor: c.coralBright }]}>
                <Text style={cardPillText}>
                  {VIBES.find((v) => v.id === member.vibes[0])?.label ??
                    "Shared experiences"}
                </Text>
              </View>
            </View>
            <View style={{ paddingBottom: 30, gap: 11 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: "white",
                    fontWeight: "700",
                    fontSize: 28,
                    flexShrink: 1,
                  }}
                >
                  {member.name}, {member.age}
                </Text>
                {member.identityVerified && (
                  <Ionicons name="checkmark-circle" color="#26A4F7" size={21} />
                )}
              </View>
              <Text style={{ color: "white", fontSize: 13 }}>
                {[member.occupation, member.city].filter(Boolean).join(" · ")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {VIBES.filter((v) => member.vibes.includes(v.id))
                  .slice(0, 3)
                  .map((v) => (
                    <View
                      key={v.id}
                      style={{
                        borderRadius: 10,
                        backgroundColor: c.ivory,
                        padding: 8,
                      }}
                    >
                      <Text style={{ color: c.charcoal, fontSize: 11 }}>
                        {v.label}
                      </Text>
                    </View>
                  ))}
              </View>
              <Text
                numberOfLines={3}
                style={{ color: "white", fontSize: 14, lineHeight: 21 }}
              >
                {member.bio ||
                  member.personalityPrompt?.answer ||
                  "A shared experience could be the start of something."}
              </Text>
            </View>
          </LinearGradient>
        </Pressable>
      </Animated.View>
      <View
        style={{
          position: "absolute",
          bottom: -31,
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: 30,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Pass on ${member.name}`}
          disabled={busy}
          onPress={() => void onAction("pass")}
          style={[actionStyle, { width: 68, height: 68 }]}
        >
          <Ionicons name="close-outline" color="#A2513E" size={31} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Save ${member.name}'s profile`}
          disabled={busy}
          onPress={() => void onAction("save")}
          style={[actionStyle, { width: 54, height: 54 }]}
        >
          <Ionicons name="star" color={c.teal} size={25} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Like ${member.name}`}
          disabled={busy}
          onPress={() => void onAction("like")}
          style={[actionStyle, { width: 68, height: 68 }]}
        >
          {busy ? (
            <ActivityIndicator color={c.teal} />
          ) : (
            <Ionicons name="heart" color={c.coralBright} size={31} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
const cardPill = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 5,
  paddingHorizontal: 11,
  paddingVertical: 7,
  borderRadius: 12,
};
const cardPillText = {
  color: "white",
  fontSize: 12,
  fontWeight: "600" as const,
};
const actionStyle = {
  borderRadius: 40,
  backgroundColor: c.ivory,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  ...shadow,
};
export default function LiveDiscover() {
  return (
    <ProfileAccess>
      <DiscoveryFeed />
    </ProfileAccess>
  );
}
function DiscoveryFeed() {
  const preferences = useCompletion().data?.profile.preferences;
  const radius = preferences?.maxDistanceKm;
  const unit = preferences?.distanceUnit ?? "km";
  const radiusLabel =
    radius == null
      ? ""
      : `${Number((radius / (unit === "mi" ? 1.609344 : 1)).toFixed(1))} ${unit}`;
  const client = useQueryClient(),
    [cityOnly, setCityOnly] = useState(true),
    [filters, setFilters] = useState(false),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const key = ["discovery", cityOnly];
  const feed = useQuery({
    queryKey: key,
    queryFn: () => api<MemberCard[]>(`/discovery?cityOnly=${cityOnly}`),
    retry: false,
  });
  const member = feed.data?.[0];
  const likedMe = useLikedMe();
  async function refresh() {
    if (refreshing || busy) return;
    setRefreshing(true);
    setError("");
    try {
      await Promise.all([
        feed.refetch(),
        likedMe.refetch(),
        client.invalidateQueries({ queryKey: ["activity-notifications"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }
  async function act(action: SwipeAction) {
    if (!member || busy || refreshing) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await actOnProfile(member.id, action);
      if (result.mutual) {
        useMatchCelebration.getState().show({
          name: member.name,
          photoId: member.photoIds[0],
          conversationId: result.conversationId,
        });
        void client.invalidateQueries({ queryKey: ["conversations"] });
      }
      client.setQueriesData<MemberCard[]>(
        { queryKey: ["discovery"] },
        (previous) => previous?.filter((v) => v.id !== member.id) ?? [],
      );
      await client.invalidateQueries({ queryKey: ["profile-likes"] });
      await client.invalidateQueries({ queryKey: ["liked-me"] });
      await client.invalidateQueries({
        queryKey: ["profile-like-notifications"],
      });
      if (feed.data?.length === 1) void feed.refetch();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't save your choice. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      width="reading"
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <Header
        right={
          <View style={{ flexDirection: "row" }}>
            <LikesButton count={likedMe.data?.length ?? 0} />
            <NotificationBell />
            <IconButton
              icon="options-outline"
              label="Discovery filters"
              onPress={() => setFilters(!filters)}
            />
          </View>
        }
      />
      {filters && (
        <View style={{ marginBottom: 16, gap: 10 }}>
          <Text style={text.label}>Where to meet your kind of person</Text>
          {radius != null ? (
            <Text style={text.body}>
              Suggestions within {radiusLabel}. People who liked you may be
              farther away.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Chip selected={cityOnly} onPress={() => setCityOnly(true)}>
                My city
              </Chip>
              <Chip selected={!cityOnly} onPress={() => setCityOnly(false)}>
                All cities
              </Chip>
            </View>
          )}
          <Text style={text.muted}>
            Mutual matches come first. After those, you’ll see people outside
            your age or gender preferences who are open to someone like you.
            Exact locations stay private.
          </Text>
          <Button
            variant="outline"
            onPress={() => router.push("/profile-unlock?edit=true")}
          >
            Edit Dating Preferences
          </Button>
        </View>
      )}
      {!!notice && <Notice>{notice}</Notice>}
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{ color: "#A83229", marginBottom: 12 }}
        >
          {error}
        </Text>
      )}
      {feed.isPending ? (
        <ActivityIndicator color={c.teal} style={{ margin: 60 }} />
      ) : feed.error ? (
        <Empty title="Couldn't load profiles" description={feed.error.message}>
          <Button onPress={() => void refresh()}>Try Again</Button>
        </Empty>
      ) : member ? (
        <>
          <DeckStatus
            member={member}
            mutualLeft={feed.data?.filter((v) => v.mutualMatch).length ?? 0}
          />
          <ProfileCard
            key={member.id}
            member={member}
            busy={busy || refreshing}
            onAction={act}
          />
          <Text style={[text.muted, { textAlign: "center" }]}>
            Swipe left to pass, right to like. Tap a profile to learn more.
          </Text>
        </>
      ) : (
        <Empty
          icon="people-outline"
          title="Your next connection is on the way"
          description={
            radius != null
              ? `You've seen everyone within ${radiusLabel} for now. Update your dating distance to explore farther away.`
              : "You’ve seen everyone here for now, including people outside your preferences. Check back as more people join."
          }
        >
          <Button
            onPress={() => {
              if (radius != null) router.push("/profile-unlock?edit=true");
              else if (cityOnly) setCityOnly(false);
              else void refresh();
            }}
          >
            {radius != null
              ? "Edit Dating Distance"
              : cityOnly
                ? "Explore All Cities"
                : "Refresh Profiles"}
          </Button>
        </Empty>
      )}
    </Screen>
  );
}
export function LiveLikes() {
  return (
    <ProfileAccess title="Your likes & saved profiles">
      <LikesList />
    </ProfileAccess>
  );
}
function LikesList() {
  const client = useQueryClient();
  const sent = useQuery({
    queryKey: ["profile-likes"],
    queryFn: () => api<MemberCard[]>("/discovery/likes"),
    retry: false,
  });
  const received = useLikedMe();
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      await Promise.all([sent.refetch(), received.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const byId = new Map(
    [...(sent.data ?? []), ...(received.data ?? [])].map((p) => [p.id, p]),
  );
  const toRow = (p: MemberCard): LikeRow => ({
    id: p.id,
    name: p.name,
    age: p.age,
    verified: p.identityVerified,
    saved: p.action === "save",
    when: timeAgo(p.likedAt),
    photo: (style) => <MemberPhoto id={p.photoIds[0]} style={style} />,
  });
  async function act(row: LikeRow, action: SwipeAction) {
    if (busyId) return;
    setBusyId(row.id);
    setError("");
    try {
      const result = await actOnProfile(row.id, action);
      await Promise.all(
        [
          "liked-me",
          "profile-likes",
          "profile-like-notifications",
          "discovery",
          "conversations",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      if (result.mutual) {
        // Matches live in Chat now: show the moment, then land on the Chat tab.
        useMatchCelebration.getState().show({
          name: row.name,
          photoId: byId.get(row.id)?.photoIds[0],
          conversationId: result.conversationId,
        });
        router.dismissTo("/(tabs)/chat");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <LikesScreen
      youLiked={(sent.data ?? []).filter((p) => !p.mutual).map(toRow)}
      likedYou={(received.data ?? []).map(toRow)}
      loading={sent.isPending || received.isPending}
      error={error || sent.error?.message || received.error?.message}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      onRetry={() => void refresh()}
      busyId={busyId}
      onOpen={(row) => router.push(`/person?id=${row.id}`)}
      onLikeBack={(row) => void act(row, "like")}
      onPass={(row) => void act(row, "pass")}
    />
  );
}
export function useLikedMe(enabled = true) {
  return useQuery({
    queryKey: ["liked-me"],
    enabled,
    queryFn: () => api<MemberCard[]>("/discovery/liked-me"),
    retry: false,
    refetchInterval: 20000,
  });
}

export function LivePerson({ id }: { id: string }) {
  return (
    <ProfileAccess>
      <PersonDetail id={id} />
    </ProfileAccess>
  );
}
function PersonDetail({ id }: { id: string }) {
  const query = useQuery({
      queryKey: ["member-profile", id],
      queryFn: () => api<MemberCard>(`/discovery/${id}`),
      retry: false,
    }),
    client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [report, setReport] = useState(false),
    [confirmBlock, setConfirmBlock] = useState(false),
    [reason, setReason] = useState("");
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["profile-likes"] });
      await client.invalidateQueries({ queryKey: ["liked-me"] });
      await client.invalidateQueries({
        queryKey: ["profile-like-notifications"],
      });
      await client.invalidateQueries({ queryKey: ["discovery"] });
      await client.invalidateQueries({ queryKey: ["member-profile", id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const p = query.data;
  if (!p)
    return (
      <Screen>
        <Header title="Profile" back />
        {query.isPending ? (
          <ActivityIndicator color={c.teal} />
        ) : (
          <Empty
            title="Profile unavailable"
            description={query.error?.message ?? "Please try again."}
          >
            <Button onPress={() => void query.refetch()}>Try Again</Button>
          </Empty>
        )}
      </Screen>
    );
  return (
    <MemberProfileView
      profile={{
        name: p.name,
        age: p.age,
        verified: p.identityVerified,
        occupation: p.occupation,
        location: p.city,
        bio: p.bio,
        vibes: p.vibes,
        prompt: p.personalityPrompt,
        firstPlan: p.firstPlanIntent,
        relationship: p.relationshipIntent,
        mutualMatch: p.mutualMatch,
        details: p.details,
        memberSince: formatMonthYear(p.memberSince),
        plans: p.plans?.map((plan) => ({
          id: plan._id,
          title: plan.title,
          category: plan.category,
          zone: plan.zone,
          when: new Date(plan.startsAt).toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
        })),
      }}
      photos={(size) =>
        (p.photoIds.length ? p.photoIds : [undefined]).map((photo) => (
          <MemberPhoto key={photo ?? "none"} id={photo} style={size} />
        ))
      }
      liked={p.action === "like"}
      saved={p.action === "save" || p.action === "like"}
      mutual={p.mutual}
      busy={busy}
      onLike={() =>
        void action(async () => {
          const result = await actOnProfile(p.id, "like");
          if (result.mutual) {
            useMatchCelebration.getState().show({
              name: p.name,
              photoId: p.photoIds[0],
              conversationId: result.conversationId,
            });
            void client.invalidateQueries({ queryKey: ["conversations"] });
          } else setMessage("Like saved.");
        })
      }
      onSave={
        p.action
          ? undefined
          : () =>
              void action(async () => {
                await actOnProfile(p.id, "save");
                setMessage("Profile saved.");
              })
      }
      onChat={
        p.conversationId
          ? () => router.push(`/conversation?id=${p.conversationId}`)
          : undefined
      }
      onReport={() => {
        setConfirmBlock(false);
        setReport(true);
      }}
      onBlock={() => {
        setReport(false);
        setConfirmBlock(true);
      }}
    >
      {report && (
        <View style={{ marginTop: 6 }}>
          <Field
            label="Report reason"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={1500}
          />
          <Button
            disabled={reason.trim().length < 10}
            loading={busy}
            onPress={() =>
              void action(async () => {
                await api("/reports", {
                  method: "POST",
                  body: JSON.stringify({ userId: p.id, reason }),
                });
                setMessage("Your report was sent to the safety team.");
                setReport(false);
              })
            }
          >
            Send Report
          </Button>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/safety?target=${p.id}`)}
            style={{ padding: 12 }}
          >
            <Text style={{ color: c.teal, textAlign: "center" }}>
              Open Safety Centre
            </Text>
          </Pressable>
        </View>
      )}
      {confirmBlock && (
        <View style={{ marginTop: 6, gap: 10 }}>
          <Notice>
            {p.name} won’t be able to see you or message you, and you won’t see
            them.
          </Notice>
          <Button
            loading={busy}
            onPress={() =>
              void action(async () => {
                await api("/blocks", {
                  method: "POST",
                  body: JSON.stringify({ userId: p.id }),
                });
                router.replace("/(tabs)");
              })
            }
          >
            Block {p.name}
          </Button>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmBlock(false)}
            style={{ padding: 10 }}
          >
            <Text style={{ color: c.teal, textAlign: "center" }}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#A83229" }}>
          {error}
        </Text>
      )}
      {!!message && <Notice>{message}</Notice>}
    </MemberProfileView>
  );
}

export function LikesButton({ count }: { count: number }) {
  return (
    <View>
      <IconButton
        icon={count ? "heart" : "heart-outline"}
        color={count ? c.coralBright : c.charcoal}
        label={count ? `Likes, ${count} people liked you` : "Your likes"}
        onPress={() => router.push(count ? "/likes?tab=received" : "/likes")}
      />
      {count > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 4,
            right: 2,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: c.coralBright,
            borderWidth: 2,
            borderColor: c.ivory,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: c.white, fontSize: 9, fontWeight: "800" }}>
            {count > 9 ? "9+" : count}
          </Text>
        </View>
      )}
    </View>
  );
}

function DeckStatus({
  member,
  mutualLeft,
}: {
  member: MemberCard;
  mutualLeft: number;
}) {
  if (member.mutualMatch)
    return (
      <View style={deckStatus.row}>
        <Ionicons name="heart-circle" size={18} color={c.coralBright} />
        <Text style={deckStatus.label}>Mutual matches</Text>
        <Text style={text.muted}>
          {mutualLeft === 1 ? "Last one" : `${mutualLeft} to go`}
        </Text>
      </View>
    );
  return (
    <LinearGradient
      colors={["#1A6065", c.tealDark]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={deckStatus.banner}
    >
      <View style={deckStatus.icon}>
        <Ionicons name="checkmark-done" size={18} color={c.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.white, fontWeight: "700", fontSize: 13 }}>
          You’ve seen all your mutual matches
        </Text>
        <Text style={{ color: "#FFFFFFCC", fontSize: 12, lineHeight: 17 }}>
          Here are more people who are open to meeting you, outside your age or
          gender preferences.
        </Text>
      </View>
    </LinearGradient>
  );
}
const deckStatus = {
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    marginBottom: 12,
  },
  label: { ...text.label, flex: 1 },
  banner: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 14,
    borderRadius: 18,
    marginBottom: 14,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.coralBright,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
