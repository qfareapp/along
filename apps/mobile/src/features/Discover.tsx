import React, { useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Button,
  Chip,
  DemoNotice,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { assets, people } from "./data";
import { useAlong } from "../store/useAlong";
import { useMatchCelebration } from "../store/useMatchCelebration";
import { colors as c, shadow } from "../theme";
import { demoMode } from "../services/api";
import LiveDiscover, { LikesButton, LiveLikes } from "./LiveDiscover";
import { LikesScreen, type LikeRow } from "./Likes";
import { useAppLayout } from "../components/layout";

export default function Discover() {
  const layout = useAppLayout();
  const state = useAlong();
  const [filter, setFilter] = useState(false);
  const [nearby, setNearby] = useState(true);
  const candidates = people.filter(
    (p) =>
      !state.passed.includes(p.id) &&
      !state.likes.includes(p.id) &&
      !state.blocked.includes(p.id) &&
      (!nearby || parseInt(p.distance) <= 5),
  );
  const person = candidates[0];
  if (!demoMode) return <LiveDiscover />;
  function like() {
    if (!person) return;
    state.update({ likes: [...state.likes, person.id] });
    if (person.id === "ananya") {
      state.update({ matched: true });
      useMatchCelebration
        .getState()
        .show({ name: "Ananya", image: assets.ananya });
    }
  }
  return (
    <Screen width="reading">
      <Header
        right={
          <View style={{ flexDirection: "row" }}>
            <LikesButton count={previewLikedYou(state).length} />
            <IconButton
              icon="notifications-outline"
              label="Notifications"
              onPress={() => router.push("/notifications")}
            />
            <IconButton
              icon="options-outline"
              label="Discovery filters"
              onPress={() => setFilter(true)}
            />
          </View>
        }
      />
      {!demoMode ? (
        <Empty
          title="Discovery is being prepared"
          description="Live recommendations need completed profiles and mutual eligibility checks. You can browse plans connected to your API."
        >
          <Button onPress={() => router.push("/(tabs)/plans")}>
            Explore Plans
          </Button>
        </Empty>
      ) : person ? (
        <>
          <View style={{ marginBottom: 42 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${person.name}'s profile`}
              onPress={() => router.push(`/person?id=${person.id}`)}
            >
              <View
                style={{
                  height: layout.isTablet
                    ? Math.max(340, Math.min(640, layout.height - 280))
                    : 505,
                  borderRadius: 23,
                  overflow: "hidden",
                  backgroundColor: c.peach,
                }}
              >
                <Image
                  source={person.image}
                  resizeMode="cover"
                  style={{
                    position: "absolute",
                    width: "100%",
                    height: "100%",
                  }}
                />
                <LinearGradient
                  colors={["transparent", "#09262500", "#16251AEF"]}
                  locations={[0, 0.42, 1]}
                  style={{
                    flex: 1,
                    justifyContent: "space-between",
                    padding: 19,
                  }}
                >
                  <View
                    style={{
                      alignSelf: "flex-start",
                      borderRadius: 11,
                      backgroundColor: c.coralBright,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                    }}
                  >
                    <Ionicons name="cafe-outline" size={14} color="white" />
                    <Text style={{ color: "white", fontSize: 12 }}>
                      {person.category}
                    </Text>
                  </View>
                  <View style={{ paddingBottom: 33 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 7,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 28,
                          fontWeight: "700",
                          color: "white",
                        }}
                      >
                        {person.name}, {person.age}
                      </Text>
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color="#26A4F7"
                      />
                    </View>
                    <Text
                      style={{ color: "white", fontSize: 13, marginTop: 7 }}
                    >
                      {person.occupation} · {person.distance}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 6,
                        marginVertical: 13,
                      }}
                    >
                      {person.tags.map((tag) => (
                        <View
                          key={tag}
                          style={{
                            borderRadius: 10,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            backgroundColor: c.ivory,
                          }}
                        >
                          <Text style={{ color: c.charcoal, fontSize: 11 }}>
                            {tag}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Text
                      style={{ color: "white", fontSize: 13, lineHeight: 20 }}
                    >
                      “Looking for a coffee partner, gym buddy{"\n"}and maybe
                      more ☕”
                    </Text>
                  </View>
                </LinearGradient>
              </View>
            </Pressable>
            <View
              style={{
                position: "absolute",
                bottom: -31,
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 31,
              }}
            >
              <IconButton
                icon="close-outline"
                label={`Pass on ${person.name}`}
                color="#A2513E"
                onPress={() =>
                  state.update({ passed: [...state.passed, person.id] })
                }
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: 34,
                  backgroundColor: c.ivory,
                  ...shadow,
                }}
              />
              <IconButton
                icon="star"
                label="Save a plan"
                color={c.teal}
                onPress={() => {
                  state.toggleSaved(
                    person.id === "ananya" ? "coffee" : "carpool",
                  );
                  router.push("/(tabs)/plans?saved=true");
                }}
                style={{
                  backgroundColor: c.ivory,
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  ...shadow,
                }}
              />
              <IconButton
                icon="heart"
                label={`Like ${person.name}`}
                color={c.coralBright}
                onPress={like}
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: 34,
                  backgroundColor: c.ivory,
                  ...shadow,
                }}
              />
            </View>
          </View>
          <Text style={[text.muted, { textAlign: "center", fontSize: 12 }]}>
            A shared plan could be the start of something.
          </Text>
        </>
      ) : (
        <Empty
          icon="heart-outline"
          title="A little pause, a fresh start"
          description="You’ve explored everyone in this preview. Revisit your likes or explore plans nearby."
        >
          <Button onPress={() => state.update({ passed: [], likes: [] })}>
            Explore Again
          </Button>
        </Empty>
      )}
      <DemoNotice />
      <Modal
        visible={filter}
        transparent
        animationType="slide"
        onRequestClose={() => setFilter(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "#17333450",
          }}
        >
          <View
            style={{
              padding: 27,
              backgroundColor: c.ivory,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              gap: 18,
            }}
          >
            <Header
              title="Your kind of company"
              right={
                <IconButton
                  icon="close"
                  label="Close filters"
                  onPress={() => setFilter(false)}
                />
              }
            />
            <Text style={text.label}>Distance</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Chip selected={nearby} onPress={() => setNearby(true)}>
                Within 5 km
              </Chip>
              <Chip selected={!nearby} onPress={() => setNearby(false)}>
                Anywhere nearby
              </Chip>
            </View>
            <Notice>
              Preview profiles are fictional adults aged 26–27 in Kolkata. Live
              filters will use mutual dating preferences.
            </Notice>
            <Button onPress={() => setFilter(false)}>Show People</Button>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
/** Preview: Ananya has "liked" you, so liking her back shows the match flow. */
function previewLikedYou(state: ReturnType<typeof useAlong.getState>) {
  return people.filter(
    (p) =>
      p.id === "ananya" &&
      !state.likes.includes(p.id) &&
      !state.passed.includes(p.id) &&
      !state.blocked.includes(p.id),
  );
}
export function Likes() {
  const state = useAlong();
  if (!demoMode) return <LiveLikes />;
  const toRow = (p: (typeof people)[number]): LikeRow => ({
    id: p.id,
    name: p.name,
    age: p.age,
    verified: true,
    photo: (style) => (
      <Image
        source={p.id === "rohan" ? assets.rohan : p.image}
        resizeMode="cover"
        accessibilityLabel={`${p.name}'s photo`}
        style={style}
      />
    ),
  });
  const youLiked = people.filter(
    (p) =>
      state.likes.includes(p.id) &&
      !state.blocked.includes(p.id) &&
      !(p.id === "ananya" && state.matched),
  );
  return (
    <LikesScreen
      youLiked={youLiked.map(toRow)}
      likedYou={previewLikedYou(state).map(toRow)}
      onOpen={(row) => router.push(`/person?id=${row.id}`)}
      onPass={(row) => state.update({ passed: [...state.passed, row.id] })}
      onLikeBack={(row) => {
        state.update({
          likes: [...new Set([...state.likes, row.id])],
          matched: true,
        });
        useMatchCelebration
          .getState()
          .show({ name: row.name, image: assets.ananya });
        router.dismissTo("/(tabs)/chat");
      }}
    />
  );
}
