import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Button } from "./ui";
import { MemberPhoto } from "../features/LiveDiscover";
import { useCurrentAccount } from "../services/account";
import { demoMode } from "../services/api";
import { useAlong } from "../store/useAlong";
import {
  useMatchCelebration,
  type CelebratedMatch,
} from "../store/useMatchCelebration";
import { colors as c } from "../theme";

const native = Platform.OS !== "web";
const BURST = 14;
const AVATAR = 112;

/** Full-screen "It's a match" moment. Mounted once in the root layout. */
export function MatchCelebration() {
  const match = useMatchCelebration((s) => s.match);
  return match ? <Celebration key={match.name} match={match} /> : null;
}
function Celebration({ match }: { match: CelebratedMatch }) {
  const hide = useMatchCelebration((s) => s.hide);
  const [reduced, setReduced] = useState(false);
  const [backdrop] = useState(() => new Animated.Value(0));
  const [card] = useState(() => new Animated.Value(0));
  const [avatars] = useState(() => new Animated.Value(0));
  const [heart] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(1));
  const [burst] = useState(() => new Animated.Value(0));
  const [copy] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      setReduced(reduce);
      if (reduce) {
        for (const v of [backdrop, card, avatars, heart, copy]) v.setValue(1);
        return;
      }
      Animated.sequence([
        Animated.parallel([
          Animated.timing(backdrop, {
            toValue: 1,
            duration: 220,
            useNativeDriver: native,
          }),
          Animated.spring(card, {
            toValue: 1,
            friction: 6,
            tension: 70,
            useNativeDriver: native,
          }),
        ]),
        Animated.parallel([
          Animated.spring(avatars, {
            toValue: 1,
            friction: 5,
            tension: 60,
            useNativeDriver: native,
          }),
          Animated.sequence([
            Animated.delay(140),
            Animated.spring(heart, {
              toValue: 1,
              friction: 3,
              tension: 90,
              useNativeDriver: native,
            }),
          ]),
          Animated.sequence([
            Animated.delay(160),
            Animated.timing(burst, {
              toValue: 1,
              duration: 1100,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: native,
            }),
          ]),
          Animated.timing(copy, {
            toValue: 1,
            duration: 420,
            delay: 220,
            useNativeDriver: native,
          }),
        ]),
      ]).start(() => {
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, {
              toValue: 1.14,
              duration: 520,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: native,
            }),
            Animated.timing(pulse, {
              toValue: 1,
              duration: 520,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: native,
            }),
          ]),
        );
        loop.start();
      });
      AccessibilityInfo.announceForAccessibility(
        `It's a match! You and ${match.name} liked each other.`,
      );
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      hide();
      return true;
    });
    return () => {
      loop?.stop();
      back.remove();
    };
  }, [backdrop, card, avatars, heart, pulse, burst, copy, hide, match.name]);

  function chat() {
    hide();
    router.push(
      match.conversationId
        ? `/conversation?id=${match.conversationId}`
        : "/conversation",
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[s.backdrop, { opacity: backdrop }]}>
        <Pressable
          accessibilityLabel="Close"
          onPress={hide}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View style={s.center} pointerEvents="box-none">
        <Animated.View
          style={[
            s.cardWrap,
            {
              opacity: card,
              transform: [
                {
                  scale: card.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.7, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={[c.ivory, "#FFE7D6", "#FFD9C2"]}
            style={s.card}
          >
            <View style={s.stage}>
              {!reduced &&
                Array.from({ length: BURST }, (_, i) => {
                  const angle = (i / BURST) * Math.PI * 2;
                  const distance = 120 + (i % 3) * 22;
                  return (
                    <Animated.View
                      key={i}
                      pointerEvents="none"
                      style={[
                        s.spark,
                        {
                          opacity: burst.interpolate({
                            inputRange: [0, 0.15, 1],
                            outputRange: [0, 1, 0],
                          }),
                          transform: [
                            {
                              translateX: burst.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, Math.cos(angle) * distance],
                              }),
                            },
                            {
                              translateY: burst.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, Math.sin(angle) * distance],
                              }),
                            },
                            {
                              scale: burst.interpolate({
                                inputRange: [0, 0.4, 1],
                                outputRange: [0.3, 1, 0.6],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <Ionicons
                        name="heart"
                        size={10 + (i % 3) * 5}
                        color={i % 2 ? c.coralBright : c.peach}
                      />
                    </Animated.View>
                  );
                })}
              <Animated.View
                style={[
                  s.avatarRing,
                  {
                    marginRight: -18,
                    zIndex: 1,
                    transform: [
                      {
                        translateX: avatars.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-70, 0],
                        }),
                      },
                      { rotate: "-7deg" },
                    ],
                  },
                ]}
              >
                <MyAvatar />
              </Animated.View>
              <Animated.View
                style={[
                  s.avatarRing,
                  {
                    transform: [
                      {
                        translateX: avatars.interpolate({
                          inputRange: [0, 1],
                          outputRange: [70, 0],
                        }),
                      },
                      { rotate: "7deg" },
                    ],
                  },
                ]}
              >
                {match.image ? (
                  <Image
                    source={match.image}
                    accessibilityLabel={`${match.name}'s photo`}
                    style={s.avatar}
                  />
                ) : (
                  <MemberPhoto
                    id={match.photoId ?? undefined}
                    style={s.avatar}
                  />
                )}
              </Animated.View>
              <Animated.View
                style={[
                  s.heart,
                  {
                    transform: [{ scale: Animated.multiply(heart, pulse) }],
                  },
                ]}
              >
                <Ionicons name="heart" size={26} color={c.white} />
              </Animated.View>
            </View>
            <Animated.View
              style={{
                alignItems: "center",
                opacity: copy,
                transform: [
                  {
                    translateY: copy.interpolate({
                      inputRange: [0, 1],
                      outputRange: [14, 0],
                    }),
                  },
                ],
              }}
            >
              <Text style={s.kicker}>NEW CONNECTION</Text>
              <Text style={s.title}>It’s a match!</Text>
              <Text style={s.body}>
                You and {match.name} liked each other. Say hello while the vibe
                is fresh.
              </Text>
            </Animated.View>
            <View style={{ gap: 10, alignSelf: "stretch", marginTop: 22 }}>
              <Button variant="coral" icon="chatbubble-ellipses" onPress={chat}>
                {`Message ${match.name}`}
              </Button>
              <Button variant="outline" onPress={hide}>
                Keep Exploring
              </Button>
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </View>
  );
}
function MyAvatar() {
  const account = useCurrentAccount();
  const state = useAlong();
  const photoId = account.data?.profile?.photos?.[0];
  const name = account.data?.user.name ?? state.name;
  if (!demoMode && photoId)
    return <MemberPhoto id={photoId} style={s.avatar} />;
  if (state.photo)
    return (
      <Image
        source={{ uri: state.photo }}
        accessibilityLabel="Your photo"
        style={s.avatar}
      />
    );
  return (
    <View style={[s.avatar, s.initial]}>
      <Text style={{ fontSize: 40, fontWeight: "800", color: c.teal }}>
        {name.trim().charAt(0).toUpperCase() || "?"}
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "#093E43E0" },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  cardWrap: { width: "100%", maxWidth: 400 },
  card: {
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 24,
    alignItems: "center",
    overflow: "hidden",
  },
  stage: {
    height: AVATAR + 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  spark: { position: "absolute" },
  avatarRing: {
    borderRadius: AVATAR,
    borderWidth: 3,
    borderColor: c.coralBright,
    padding: 3,
    backgroundColor: c.ivory,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
  },
  initial: {
    backgroundColor: "#F8DFCC",
    alignItems: "center",
    justifyContent: "center",
  },
  heart: {
    position: "absolute",
    bottom: 4,
    zIndex: 2,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.coralBright,
    borderWidth: 4,
    borderColor: c.ivory,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    color: c.coralBright,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: c.teal,
    letterSpacing: -1,
    marginTop: 4,
  },
  body: {
    color: c.charcoal,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 290,
  },
});
