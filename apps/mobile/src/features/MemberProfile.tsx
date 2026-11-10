import React, { useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Button,
  card,
  Chip,
  IconButton,
  Notice,
  Screen,
  text,
} from "../components/ui";
import {
  DetailList,
  filledDetails,
  InfoTiles,
  labelOf,
  LookingFor,
  profileStyles,
  PromptCard,
  Section,
  VibeChips,
} from "../components/profile";
import { RELATIONSHIPS } from "../services/onboarding";
import { useCategories } from "../services/categories";
import { colors as c } from "../theme";
import type { IconName } from "./data";
import { useAppLayout } from "../components/layout";

export type MemberPlan = {
  id: string;
  title: string;
  category: string;
  zone: string;
  when: string;
};
export type MemberProfileData = {
  name: string;
  age?: number;
  verified?: boolean;
  occupation?: string;
  location?: string;
  distance?: string;
  bio?: string;
  vibes?: string[];
  tags?: string[];
  prompt?: { type?: string | null; answer?: string | null } | null;
  firstPlan?: string | null;
  relationship?: string | null;
  details?: Record<string, string>;
  memberSince?: string;
  plans?: MemberPlan[];
  /** Both people fit each other's age and gender preferences. */
  mutualMatch?: boolean;
};
export function MemberProfileView({
  profile: p,
  photos,
  liked,
  saved,
  mutual,
  busy,
  onLike,
  onSave,
  onChat,
  onReport,
  onBlock,
  blockLabel = "Block Profile",
  children,
}: {
  profile: MemberProfileData;
  photos: (style: { width: number; height: number }) => ReactNode[];
  liked?: boolean;
  saved?: boolean;
  mutual?: boolean;
  busy?: boolean;
  onLike: () => void;
  onSave?: () => void;
  onChat?: () => void;
  onReport: () => void;
  onBlock: () => void;
  blockLabel?: string;
  children?: ReactNode;
}) {
  const layout = useAppLayout();
  const [width, setWidth] = useState(Math.min(layout.width, 680));
  const photoHeight = layout.isTablet
    ? Math.min(620, Math.max(320, layout.height * 0.62))
    : PHOTO_HEIGHT;
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const [menu, setMenu] = useState(false);
  const { categories } = useCategories();
  const slides = photos({ width, height: photoHeight });
  function goTo(index: number) {
    const next = Math.min(slides.length - 1, Math.max(0, index));
    scroller.current?.scrollTo({ x: next * width, animated: true });
    setPage(next);
  }
  const intent = labelOf(RELATIONSHIPS, p.relationship);
  const details = p.details ?? {};
  const hasDetails = filledDetails(details).length > 0;
  const facts: { icon: IconName; label: string; value?: string }[] = [
    { icon: "briefcase-outline", label: "Work", value: p.occupation },
    { icon: "location-outline", label: "Lives in", value: p.location },
    { icon: "navigate-outline", label: "Distance", value: p.distance },
    { icon: "sparkles-outline", label: "Member since", value: p.memberSince },
  ];
  return (
    <Screen width="reading">
      <View
        style={[styles.hero, { height: photoHeight }]}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.width;
          if (next !== width) {
            setWidth(next);
            requestAnimationFrame(() =>
              scroller.current?.scrollTo({ x: page * next, animated: false }),
            );
          }
        }}
      >
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onScroll={(e) =>
            setPage(
              Math.min(
                slides.length - 1,
                Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)),
              ),
            )
          }
          scrollEventThrottle={16}
        >
          {slides.map((slide, i) => (
            <Pressable
              key={i}
              accessible={false}
              disabled={slides.length < 2}
              onPress={(e) =>
                goTo(e.nativeEvent.locationX < width / 2 ? i - 1 : i + 1)
              }
              style={{ width, height: photoHeight }}
            >
              {slide}
            </Pressable>
          ))}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={["#093E4300", "#093E4366", "#093E43E6"]}
          style={styles.shade}
        />
        <View style={styles.topBar}>
          <IconButton
            icon="arrow-back"
            color="white"
            label="Go back"
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/(tabs)")
            }
            style={styles.glass}
          />
          {slides.length > 1 && (
            <View style={styles.dots}>
              {slides.map((_, i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`Show photo ${i + 1} of ${slides.length}`}
                  accessibilityState={{ selected: i === page }}
                  hitSlop={6}
                  onPress={() => goTo(i)}
                  style={[
                    styles.dot,
                    i === page && { width: 18, backgroundColor: c.white },
                  ]}
                />
              ))}
            </View>
          )}
          <IconButton
            icon="ellipsis-horizontal"
            color="white"
            label="Profile options"
            onPress={() => setMenu(!menu)}
            style={styles.glass}
          />
        </View>
        <View pointerEvents="none" style={styles.heroText}>
          <View style={[profileStyles.row, { gap: 7 }]}>
            <Text style={styles.name}>
              {p.name}
              {p.age ? `, ${p.age}` : ""}
            </Text>
            {p.verified && (
              <Ionicons name="checkmark-circle" color="#5EC2FF" size={22} />
            )}
          </View>
          {!!p.occupation && <Text style={styles.sub}>{p.occupation}</Text>}
          {!!(p.location || p.distance) && (
            <View style={[profileStyles.row, { gap: 4, marginTop: 2 }]}>
              <Ionicons name="location-outline" size={14} color="#FFFFFFCC" />
              <Text style={styles.sub}>
                {[p.location, p.distance].filter(Boolean).join(" · ")}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.sheet}>
        {(!!intent || mutual || !!p.mutualMatch) && (
          <View style={styles.pills}>
            {mutual && (
              <View style={[styles.pill, { backgroundColor: c.coralBright }]}>
                <Ionicons name="heart" size={13} color={c.white} />
                <Text style={[styles.pillText, { color: c.white }]}>
                  You like each other
                </Text>
              </View>
            )}
            {!!p.mutualMatch && !mutual && (
              <View style={[styles.pill, { backgroundColor: c.teal }]}>
                <Ionicons name="heart-circle" size={13} color={c.coralBright} />
                <Text style={[styles.pillText, { color: c.white }]}>
                  Mutual match
                </Text>
              </View>
            )}
            {!!intent && (
              <View style={styles.pill}>
                <Ionicons name="sparkles" size={13} color={c.coralBright} />
                <Text style={styles.pillText}>{intent}</Text>
              </View>
            )}
          </View>
        )}

        {menu && (
          <View style={[card, styles.menu]}>
            <MenuRow
              icon="flag-outline"
              label="Report or get help"
              onPress={() => {
                setMenu(false);
                onReport();
              }}
            />
            <MenuRow
              icon="ban-outline"
              label={blockLabel}
              danger
              onPress={() => {
                setMenu(false);
                onBlock();
              }}
            />
          </View>
        )}

        <Section icon="chatbubble-ellipses-outline" title={`About ${p.name}`}>
          <Text style={text.body}>
            {p.bio?.trim() || "Here for shared experiences and good company."}
          </Text>
        </Section>

        {!!p.prompt?.answer?.trim() && (
          <PromptCard type={p.prompt.type} answer={p.prompt.answer} />
        )}

        {(!!p.vibes?.length || !!p.tags?.length) && (
          <Section icon="sparkles-outline" title="Vibes">
            {p.vibes?.length ? (
              <VibeChips ids={p.vibes} />
            ) : (
              <View style={styles.chips}>
                {p.tags?.map((tag) => (
                  <Chip key={tag}>{tag}</Chip>
                ))}
              </View>
            )}
          </Section>
        )}

        {(!!p.firstPlan || !!p.relationship) && (
          <Section icon="compass-outline" title="Looking for">
            <LookingFor firstPlan={p.firstPlan} relationship={p.relationship} />
          </Section>
        )}

        {facts.some((f) => f.value) && (
          <Section icon="id-card-outline" title="The basics">
            <InfoTiles items={facts} />
          </Section>
        )}

        {hasDetails && (
          <Section icon="list-outline" title={`More about ${p.name}`}>
            <DetailList details={details} />
          </Section>
        )}

        {!!p.plans?.length && (
          <Section icon="calendar-outline" title={`Plans by ${p.name}`}>
            <View style={{ gap: 10 }}>
              {p.plans.map((plan) => (
                <Pressable
                  key={plan.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/activity?id=${plan.id}`)}
                  style={({ pressed }) => [
                    styles.plan,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={styles.planIcon}>
                    <Ionicons
                      name={
                        categories.find((cat) => cat.id === plan.category)
                          ?.icon ?? "calendar-outline"
                      }
                      size={18}
                      color={c.white}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={text.label} numberOfLines={1}>
                      {plan.title}
                    </Text>
                    <Text
                      style={[text.muted, { fontSize: 12 }]}
                      numberOfLines={1}
                    >
                      {plan.zone} · {plan.when}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#C4B5A9" />
                </Pressable>
              ))}
            </View>
          </Section>
        )}

        <Notice>
          A shared plan is a starting point. Romantic interest is always a
          separate, mutual choice.
        </Notice>

        {children}

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            {mutual && onChat ? (
              <Button
                variant="coral"
                icon="chatbubble-ellipses"
                onPress={onChat}
              >
                {`Message ${p.name}`}
              </Button>
            ) : (
              <Button
                variant="coral"
                icon={liked ? "heart" : "heart-outline"}
                loading={busy}
                disabled={liked}
                onPress={onLike}
              >
                {liked ? "Liked" : `Like ${p.name}`}
              </Button>
            )}
          </View>
          {onSave && (
            <IconButton
              icon={saved ? "bookmark" : "bookmark-outline"}
              label={saved ? "Saved" : "Save profile"}
              color={c.teal}
              onPress={onSave}
              style={styles.square}
            />
          )}
          {onChat && !mutual && (
            <IconButton
              icon="chatbubble-ellipses-outline"
              label="Open chat"
              color={c.teal}
              onPress={onChat}
              style={styles.square}
            />
          )}
        </View>
      </View>
    </Screen>
  );
}
function MenuRow({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const color = danger ? "#A83229" : c.teal;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && { backgroundColor: c.soft },
      ]}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={{ color, fontWeight: "600", flex: 1 }}>{label}</Text>
    </Pressable>
  );
}
const PHOTO_HEIGHT = 460;
const styles = StyleSheet.create({
  hero: {
    height: PHOTO_HEIGHT,
    marginHorizontal: -22,
    backgroundColor: c.peach,
  },
  shade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
  },
  topBar: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  glass: { backgroundColor: "#153A3B66" },
  dots: { flexDirection: "row", gap: 5 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF80",
  },
  heroText: { position: "absolute", left: 22, right: 22, bottom: 44 },
  name: {
    flexShrink: 1,
    fontSize: 30,
    fontWeight: "800",
    color: c.white,
    letterSpacing: -0.8,
  },
  sub: { color: "#FFFFFFD9", fontSize: 14, marginTop: 2 },
  sheet: {
    marginHorizontal: -22,
    marginTop: -26,
    paddingHorizontal: 22,
    paddingTop: 20,
    backgroundColor: c.ivory,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#FBE7DA",
  },
  pillText: { fontSize: 12, fontWeight: "600", color: c.teal },
  menu: { marginTop: 14, paddingVertical: 4, overflow: "hidden" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 16,
    backgroundColor: "#FCF1E8",
  },
  planIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: c.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
    marginBottom: 6,
  },
  square: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: "#FFFDF9",
  },
});
