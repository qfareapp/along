import React, { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  card,
  DemoNotice,
  Empty,
  Header,
  Screen,
  text,
} from "../components/ui";
import { colors as c } from "../theme";

export type LikeRow = {
  id: string;
  name: string;
  age?: number;
  verified?: boolean;
  /** Renders the member photo at the given size. */
  photo: (style: {
    width: "100%" | number;
    height: "100%" | number;
  }) => ReactNode;
  when?: string | null;
  saved?: boolean;
};
type Tab = "sent" | "received";

export const timeAgo = (value?: string | null) => {
  if (!value) return undefined;
  const minutes = Math.max(0, (Date.now() - +new Date(value)) / 60000);
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d ago`;
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
};

export function LikesScreen({
  youLiked,
  likedYou,
  loading,
  error,
  onRetry,
  refreshing,
  onRefresh,
  onOpen,
  onLikeBack,
  onPass,
  busyId,
}: {
  youLiked: LikeRow[];
  likedYou: LikeRow[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  onOpen: (row: LikeRow) => void;
  onLikeBack: (row: LikeRow) => void;
  onPass: (row: LikeRow) => void;
  busyId?: string | null;
}) {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(
    params.tab === "received" ? "received" : "sent",
  );
  const [gridWidth, setGridWidth] = useState(0);
  const columns = Math.max(1, Math.min(3, Math.floor((gridWidth + 12) / 172)));
  const tileWidth = Math.max(0, (gridWidth - 12 * (columns - 1)) / columns);
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Header
        title="Likes"
        subtitle="Like each other to start a conversation."
        back
      />
      <View style={s.segment} accessibilityRole="tablist">
        <Segment
          label="Liked by you"
          count={youLiked.length}
          active={tab === "sent"}
          onPress={() => setTab("sent")}
        />
        <Segment
          label="Liked you"
          count={likedYou.length}
          highlight
          active={tab === "received"}
          onPress={() => setTab("received")}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={c.teal} style={{ marginTop: 30 }} />
      ) : error ? (
        <Empty title="Couldn't load likes" description={error}>
          {onRetry && <Button onPress={onRetry}>Try Again</Button>}
        </Empty>
      ) : tab === "sent" ? (
        youLiked.length ? (
          <View style={{ gap: 10, marginTop: 16 }}>
            {youLiked.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`View ${row.name}'s profile`}
                onPress={() => onOpen(row)}
                style={({ pressed }) => [
                  card,
                  s.sentRow,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <View style={s.sentAvatar}>
                  {row.photo({ width: "100%", height: "100%" })}
                </View>
                <View style={{ flex: 1 }}>
                  <NameLine row={row} />
                  <View style={[s.row, { gap: 5, marginTop: 4 }]}>
                    <Ionicons
                      name={row.saved ? "bookmark" : "heart"}
                      size={12}
                      color={c.coralBright}
                    />
                    <Text style={[text.muted, { fontSize: 12 }]}>
                      {row.saved ? "Saved" : "You liked them"}
                      {row.when ? ` · ${row.when}` : ""}
                    </Text>
                  </View>
                  <Text style={s.waiting}>
                    Waiting for them to like you back
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C4B5A9" />
              </Pressable>
            ))}
          </View>
        ) : (
          <Empty
            icon="heart-outline"
            title="No likes sent yet"
            description="Like someone in Discover. When they like you back, you’ll find them in Chat."
          >
            <Button onPress={() => router.back()}>Explore People</Button>
          </Empty>
        )
      ) : likedYou.length ? (
        <>
          <LinearGradient
            colors={["#1A6065", c.tealDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.banner}
          >
            <View style={s.bannerIcon}>
              <Ionicons name="heart" size={18} color={c.white} />
            </View>
            <Text style={s.bannerText}>
              {likedYou.length === 1
                ? "1 person likes you."
                : `${likedYou.length} people like you.`}{" "}
              Like them back to match and start chatting.
            </Text>
          </LinearGradient>
          <View
            style={s.grid}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {likedYou.map((row) => (
              <View
                key={row.id}
                testID="received-like-card"
                style={[s.tile, { width: tileWidth }]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${row.name}'s profile`}
                  onPress={() => onOpen(row)}
                  style={{ height: Math.round(tileWidth * 1.15) }}
                >
                  {row.photo({ width: "100%", height: "100%" })}
                </Pressable>
                {!!row.when && (
                  <View pointerEvents="none" style={s.when}>
                    <Text style={s.whenText}>{row.when}</Text>
                  </View>
                )}
                <View style={s.tileFooter}>
                  <Text style={s.tileName}>
                    {row.name}
                    {row.age ? `, ${row.age}` : ""}
                    {row.verified ? " ✓" : ""}
                  </Text>
                  <View style={[s.row, { gap: 10, marginTop: 8 }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Pass on ${row.name}`}
                      disabled={!!busyId}
                      onPress={() => onPass(row)}
                      style={({ pressed }) => [
                        s.action,
                        s.pass,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Ionicons name="close" size={20} color={c.white} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Like ${row.name} back`}
                      disabled={!!busyId}
                      onPress={() => onLikeBack(row)}
                      style={({ pressed }) => [
                        s.action,
                        s.like,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      {busyId === row.id ? (
                        <ActivityIndicator color={c.white} size="small" />
                      ) : (
                        <Ionicons name="heart" size={20} color={c.white} />
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Empty
          icon="sparkles-outline"
          title="No new likes yet"
          description="When someone likes your profile, they’ll appear here. A great photo and a few vibes help."
        >
          <Button
            variant="outline"
            onPress={() => router.push("/(tabs)/profile")}
          >
            Polish My Profile
          </Button>
        </Empty>
      )}
      <DemoNotice />
    </Screen>
  );
}
function Segment({
  label,
  count,
  active,
  highlight,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  highlight?: boolean;
  onPress: () => void;
}) {
  const content = (
    <>
      <Text style={[s.segmentText, active && { color: c.white }]}>{label}</Text>
      {count > 0 && (
        <View
          style={[
            s.count,
            active
              ? { backgroundColor: "#FFFFFF33" }
              : highlight && { backgroundColor: c.coralBright },
          ]}
        >
          <Text
            style={[s.countText, (active || highlight) && { color: c.white }]}
          >
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      )}
    </>
  );
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {active ? (
        <LinearGradient
          colors={["#FF8B70", c.coralBright]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.segmentItem}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={s.segmentItem}>{content}</View>
      )}
    </Pressable>
  );
}
function NameLine({ row }: { row: LikeRow }) {
  return (
    <View style={[s.row, { gap: 5 }]}>
      <Text style={text.label} numberOfLines={1}>
        {row.name}
        {row.age ? `, ${row.age}` : ""}
      </Text>
      {row.verified && (
        <Ionicons name="checkmark-circle" color="#1597F5" size={14} />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  segment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 18,
    backgroundColor: "#F6E6D9",
    gap: 4,
  },
  segmentItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 42,
    borderRadius: 14,
  },
  segmentText: { fontSize: 13, fontWeight: "700", color: c.teal },
  count: {
    minWidth: 20,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFFAA",
  },
  countText: { fontSize: 11, fontWeight: "800", color: c.teal },
  sentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 13,
  },
  sentAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: c.peach,
  },
  waiting: { fontSize: 11, color: c.teal, marginTop: 3 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    marginTop: 16,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerText: { flex: 1, color: c.white, fontSize: 13, lineHeight: 19 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 14,
  },
  tile: {
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: c.tealDark,
  },
  when: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "#093E4399",
  },
  whenText: { color: c.white, fontSize: 10, fontWeight: "700" },
  tileFooter: { padding: 12 },
  tileName: { color: c.white, fontSize: 16, fontWeight: "800" },
  action: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pass: {
    backgroundColor: "#FFFFFF2E",
    borderWidth: 1,
    borderColor: "#FFFFFF55",
  },
  like: { backgroundColor: c.coralBright },
});
