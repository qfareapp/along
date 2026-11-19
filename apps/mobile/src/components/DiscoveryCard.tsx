import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
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
import { useQuery } from "@tanstack/react-query";
import { apiPhoto } from "../services/api";
import { type MemberCard, type SwipeAction } from "../services/discovery";
import { colors as c, shadow } from "../theme";
import { VIBES } from "../services/onboarding";
import { useAppLayout } from "./layout";

type MemberPhotoProps = {
  id?: string;
  path?: string;
  resizeMode?: "cover" | "contain";
  style: StyleProp<ImageStyle>;
  /** Reports the loaded photo's width / height so callers can size to it. */
  onAspectRatio?: (ratio: number) => void;
};
export function MemberPhoto(props: MemberPhotoProps) {
  return <PrivateMemberPhoto key={props.path ?? props.id} {...props} />;
}
function PrivateMemberPhoto({
  id,
  path,
  style,
  resizeMode = "cover",
  onAspectRatio,
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
          onLoad={(event) => {
            if (!onAspectRatio) return;
            const loaded = event.nativeEvent.source;
            if (loaded?.width && loaded?.height)
              onAspectRatio(loaded.width / loaded.height);
            else if (
              source &&
              typeof source === "object" &&
              "uri" in source &&
              source.uri
            )
              Image.getSize(source.uri, (width, height) => {
                if (width && height) onAspectRatio(width / height);
              });
          }}
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
export function ProfileCard({
  member,
  busy,
  onAction,
  depth = 0,
  onOpen,
}: {
  member: MemberCard;
  busy: boolean;
  onAction: (member: MemberCard, action: SwipeAction) => void;
  depth?: number;
  onOpen?: () => void;
}) {
  const layout = useAppLayout();
  const preview = depth > 0;
  const [x] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(0));
  const [stack] = useState(() => new Animated.Value(depth));
  const [reduced, setReduced] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (reduced) stack.setValue(depth);
    else
      Animated.spring(stack, {
        toValue: depth,
        stiffness: 280,
        damping: 25,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    return () => stack.stopAnimation();
  }, [depth, reduced, stack]);
  useEffect(
    () => () => {
      x.stopAnimation();
      y.stopAnimation();
    },
    [x, y],
  );
  const reset = useCallback(() => {
    if (leaving) return;
    if (reduced) {
      x.setValue(0);
      y.setValue(0);
    } else
      Animated.parallel(
        [x, y].map((value) =>
          Animated.spring(value, {
            toValue: 0,
            stiffness: 270,
            damping: 24,
            mass: 0.8,
            useNativeDriver: true,
          }),
        ),
      ).start();
  }, [leaving, reduced, x, y]);
  const choose = useCallback(
    (action: SwipeAction) => {
      if (busy || preview || leaving) return;
      setLeaving(true);
      const complete = () => onAction(member, action);
      if (reduced) {
        complete();
        return;
      }
      const liked = action === "like";
      const duration = liked ? 280 : 230;
      Animated.parallel([
        Animated.timing(x, {
          toValue: (liked ? 1 : -1) * (layout.width + 120),
          duration,
          easing: Easing.out(liked ? Easing.quad : Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(y, {
          toValue: liked ? -95 : 65,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) complete();
        else {
          setLeaving(false);
          reset();
        }
      });
    },
    [
      busy,
      preview,
      leaving,
      reduced,
      member,
      onAction,
      layout.width,
      x,
      y,
      reset,
    ],
  );
  const gesture = useRef({ busy, preview, leaving, choose, reset });
  useEffect(() => {
    gesture.current = { busy, preview, leaving, choose, reset };
  }, [busy, preview, leaving, choose, reset]);
  const pan = useMemo(
    () =>
      // PanResponder registers these callbacks; it does not call them in render.
      // Keep one responder while saves and animation state update around a drag.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          !gesture.current.busy &&
          !gesture.current.preview &&
          !gesture.current.leaving &&
          Math.abs(g.dx) > 10 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderGrant: () => {
          setDragging(true);
          x.stopAnimation();
          y.stopAnimation();
        },
        onPanResponderMove: (_e, g) => {
          if (!gesture.current.busy && !gesture.current.leaving)
            x.setValue(g.dx);
        },
        onPanResponderRelease: (_e, g) => {
          const flick =
            Math.abs(g.dx) > 28 && Math.abs(g.vx) > 0.65 && g.dx * g.vx > 0;
          if (Math.abs(g.dx) > 85 || flick)
            gesture.current.choose(g.dx > 0 ? "like" : "pass");
          else gesture.current.reset();
        },
        onPanResponderTerminate: () => gesture.current.reset(),
        onPanResponderTerminationRequest: () => !gesture.current.leaving,
      }),
    [x, y],
  );
  const likeOpacity = x.interpolate({
    inputRange: [0, 30, 110],
    outputRange: [0, 0, 1],
    extrapolate: "clamp",
  });
  const passOpacity = x.interpolate({
    inputRange: [-110, -30, 0],
    outputRange: [1, 0, 0],
    extrapolate: "clamp",
  });
  return (
    <Animated.View
      pointerEvents={preview ? "none" : "auto"}
      accessibilityElementsHidden={preview}
      importantForAccessibility={preview ? "no-hide-descendants" : "auto"}
      aria-hidden={preview}
      style={{
        marginBottom: 42,
        transform: [
          {
            translateY: stack.interpolate({
              inputRange: [0, 2],
              outputRange: [0, 18],
            }),
          },
          {
            scale: stack.interpolate({
              inputRange: [0, 2],
              outputRange: [1, 0.93],
            }),
          },
        ],
      }}
    >
      <View>
        <Animated.View
          testID={preview ? "discovery-preview-card" : "discovery-profile-card"}
          {...pan.panHandlers}
          style={{
            transform: [
              { translateX: x },
              { translateY: y },
              {
                rotate: reduced
                  ? "0deg"
                  : x.interpolate({
                      inputRange: [-240, 0, 240],
                      outputRange: ["-16deg", "0deg", "12deg"],
                      extrapolate: "clamp",
                    }),
              },
            ],
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${member.name}'s profile`}
            disabled={busy || preview || leaving}
            onPressIn={() => setDragging(false)}
            onPress={() => {
              if (!dragging) {
                if (onOpen) onOpen();
                else router.push(`/person?id=${member.id}`);
              }
            }}
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
                    <Ionicons
                      name="checkmark-circle"
                      color="#26A4F7"
                      size={21}
                    />
                  )}
                </View>
                <Text style={{ color: "white", fontSize: 13 }}>
                  {[member.occupation, member.city].filter(Boolean).join(" · ")}
                </Text>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                >
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
            {!reduced && !preview && (
              <View
                pointerEvents="none"
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ position: "absolute", inset: 0 }}
              >
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "#EE8199",
                    opacity: Animated.multiply(likeOpacity, 0.2),
                  }}
                />
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: c.teal,
                    opacity: Animated.multiply(passOpacity, 0.18),
                  }}
                />
                <Animated.View
                  testID="discovery-like-feedback"
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 90,
                    left: 22,
                    opacity: likeOpacity,
                    transform: [{ rotate: "-12deg" }],
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 18,
                      paddingVertical: 12,
                      borderWidth: 3,
                      borderColor: "#FFE4EC",
                      borderRadius: 16,
                      backgroundColor: "#B92D6088",
                    }}
                  >
                    <Ionicons name="heart" color="#FFE4EC" size={30} />
                    <Text
                      style={{
                        color: "#FFE4EC",
                        fontSize: 27,
                        fontWeight: "900",
                        letterSpacing: 3,
                      }}
                    >
                      LIKE
                    </Text>
                  </View>
                </Animated.View>
                <Animated.View
                  testID="discovery-pass-feedback"
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 90,
                    right: 22,
                    opacity: passOpacity,
                    transform: [{ rotate: "12deg" }],
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 18,
                      paddingVertical: 12,
                      borderWidth: 3,
                      borderColor: "#D4F1E9",
                      borderRadius: 16,
                      backgroundColor: "#064D4F99",
                    }}
                  >
                    <Ionicons name="arrow-back" color="#D4F1E9" size={28} />
                    <Text
                      style={{
                        color: "#D4F1E9",
                        fontSize: 27,
                        fontWeight: "900",
                        letterSpacing: 3,
                      }}
                    >
                      PASS
                    </Text>
                  </View>
                </Animated.View>
                {[0, 1, 2].map((index) => (
                  <Animated.View
                    key={index}
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: 180 + index * 48,
                      right: 30 + index * 35,
                      opacity: likeOpacity,
                      transform: [
                        {
                          translateY: x.interpolate({
                            inputRange: [0, 350],
                            outputRange: [0, -70 - index * 18],
                            extrapolate: "clamp",
                          }),
                        },
                        { rotate: `${index * 18 - 15}deg` },
                      ],
                    }}
                  >
                    <Ionicons
                      name="heart"
                      color="#FFE4EC"
                      size={24 + index * 8}
                    />
                  </Animated.View>
                ))}
              </View>
            )}
          </Pressable>
        </Animated.View>
        {!preview && (
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
              disabled={busy || leaving}
              onPress={() => choose("pass")}
              style={[actionStyle, { width: 68, height: 68 }]}
            >
              <Ionicons name="close-outline" color="#A2513E" size={31} />
            </Pressable>
            {member.vibeCheck && (
              <VibeMatchButton
                questions={member.vibeCheck.questionCount}
                reduced={reduced}
                disabled={busy || leaving}
                onPress={() => router.push(`/vibe-check?id=${member.id}`)}
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Like ${member.name}`}
              disabled={busy || leaving}
              onPress={() => choose("like")}
              style={[actionStyle, { width: 68, height: 68 }]}
            >
              <Ionicons name="heart" color={c.coralBright} size={31} />
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}
// Takes the middle action slot only for members with a Vibe Check.
function VibeMatchButton({
  questions,
  reduced,
  disabled,
  onPress,
}: {
  questions: number;
  reduced: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  const ring = (delay: number) => {
    const t = pulse.interpolate({
      inputRange: [0, delay, 1],
      outputRange: [0, 0, 1 - delay],
    });
    return {
      opacity: t.interpolate({
        inputRange: [0, 0.1, 1 - delay],
        outputRange: [0, 0.55, 0],
      }),
      transform: [
        {
          scale: t.interpolate({
            inputRange: [0, 1 - delay],
            outputRange: [1, 1.55],
          }),
        },
      ],
    };
  };
  const bob = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.08, 1],
  });
  const tilt = pulse.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: ["0deg", "-12deg", "0deg", "12deg", "0deg"],
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Vibe Check · ${questions} questions`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 62,
        height: 62,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {[0, 0.4].map((delay) => (
        <Animated.View
          key={delay}
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: 62,
              height: 62,
              borderRadius: 31,
              borderWidth: 2,
              borderColor: "#F25F8C",
            },
            ring(delay),
          ]}
        />
      ))}
      <Animated.View style={{ transform: [{ scale: bob }] }}>
        <LinearGradient
          colors={["#FF8B70", "#F25F8C", "#8E5BD9"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 62,
            height: 62,
            borderRadius: 31,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 3,
            borderColor: c.white,
            shadowColor: "#F25F8C",
            shadowOpacity: 0.45,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Animated.View style={{ transform: [{ rotate: tilt }] }}>
            <Ionicons name="sparkles" color={c.white} size={26} />
          </Animated.View>
        </LinearGradient>
      </Animated.View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -4,
          right: -6,
          minWidth: 22,
          height: 22,
          paddingHorizontal: 5,
          borderRadius: 11,
          backgroundColor: c.teal,
          borderWidth: 2,
          borderColor: c.white,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: c.white, fontSize: 10, fontWeight: "800" }}>
          {questions}Q
        </Text>
      </View>
    </Pressable>
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
