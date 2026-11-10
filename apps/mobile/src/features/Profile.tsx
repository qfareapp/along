import React, { useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  card,
  DemoNotice,
  Empty,
  Field,
  Header,
  IconButton,
  Screen,
  text,
} from "../components/ui";
import {
  DetailList,
  filledDetails,
  formatMonthYear,
  InfoTiles,
  labelOf,
  LookingFor,
  Placeholder,
  PromptCard,
  Section,
  VibeChips,
} from "../components/profile";
import { assets, people, type IconName } from "./data";
import { useAlong } from "../store/useAlong";
import { useMatchCelebration } from "../store/useMatchCelebration";
import { api, demoMode } from "../services/api";
import { colors as c } from "../theme";
import { useCurrentAccount } from "../services/account";
import { LivePerson, MemberPhoto } from "./LiveDiscover";
import { MemberProfileView } from "./MemberProfile";
import { MAX_PHOTOS } from "../components/PhotoGrid";
import { useOnboarding } from "../store/useOnboarding";
import { GENDERS, RELATIONSHIPS } from "../services/onboarding";

export function PersonProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = people.find((p) => p.id === id);
  const state = useAlong();
  if (!demoMode) return <LivePerson id={id} />;
  if (!person || state.blocked.includes(person.id))
    return (
      <Screen>
        <Header back />
        <Empty
          title="Profile unavailable"
          description="This profile is not available to view."
        />
      </Screen>
    );
  const liked = state.likes.includes(person.id);
  function like() {
    if (!person) return;
    state.update({ likes: [...new Set([...state.likes, person.id])] });
    if (person.id === "ananya") {
      state.update({ matched: true });
      useMatchCelebration
        .getState()
        .show({ name: "Ananya", image: assets.ananya });
    }
  }
  const photos =
    person.id === "rohan" ? [assets.rohan, person.image] : [person.image];
  return (
    <MemberProfileView
      profile={{
        name: person.name,
        age: person.age,
        verified: true,
        occupation: person.occupation,
        location: "Kolkata",
        distance: person.distance,
        bio: person.bio,
        tags: person.tags,
        relationship: person.id === "ananya" ? "meaningful" : "exploring",
        firstPlan: person.id === "rohan" ? "everyday_person" : "do_something",
        plans: state.plans
          .filter((plan) => plan.creator === person.name)
          .map((plan) => ({
            id: plan.id,
            title: plan.title,
            category: plan.category,
            zone: plan.zone,
            when: plan.time,
          })),
      }}
      photos={(size) =>
        photos.map((source, i) => (
          <Image
            key={i}
            source={source}
            resizeMode="cover"
            accessibilityLabel={`${person.name}'s photo`}
            style={size}
          />
        ))
      }
      liked={liked}
      mutual={liked && state.matched && person.id === "ananya"}
      onLike={like}
      onChat={() =>
        state.matched && person.id === "ananya"
          ? router.push("/conversation")
          : router.push("/(tabs)/chat")
      }
      onReport={() => router.push(`/safety?target=${person.id}`)}
      blockLabel="Block Preview Profile"
      onBlock={() => {
        state.update({
          blocked: [...state.blocked, person.id],
          matched: person.id === "ananya" ? false : state.matched,
        });
        router.replace("/(tabs)");
      }}
    >
      <DemoNotice />
    </MemberProfileView>
  );
}
export function MyProfile() {
  const account = useCurrentAccount();
  const client = useQueryClient();
  const state = useAlong();
  const draft = useOnboarding((s) => s.draft);
  const live = !demoMode;
  const user = account.data?.user;
  const profile = account.data?.profile;
  const onboarding = profile?.onboarding;
  const currentBio = live ? (profile?.bio ?? "") : state.bio;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(state.name);
  const [bio, setBio] = useState(currentBio);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (name.trim().length < 2) {
      setError("Use at least two characters for your name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (live) {
        await api("/profiles/me", {
          method: "PATCH",
          body: JSON.stringify({ bio }),
        });
        await client.invalidateQueries({ queryKey: ["current-account"] });
      }
      state.update({ name: name.trim(), bio });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  function startEditing() {
    setName(state.name);
    setBio(currentBio);
    setError("");
    setEditing(true);
  }
  const editProfile = () =>
    live ? router.push("/profile-edit") : startEditing();

  const displayName = user?.name ?? state.name;
  const age = user?.age ?? undefined;
  const vibes = (live ? onboarding?.vibes : draft.vibes) ?? [];
  const firstPlan = live ? onboarding?.firstPlanIntent : draft.firstPlanIntent;
  const relationship = live
    ? onboarding?.relationshipIntent
    : draft.relationshipIntent;
  const prompt = live ? onboarding?.personalityPrompt : draft.personalityPrompt;
  const city = (live ? profile?.city : draft.city) || "";
  const area = (live ? profile?.area : draft.area) || "";
  const country = (live ? profile?.country : draft.country) || "";
  const occupation = live ? profile?.occupation : undefined;
  const photoIds = live ? (profile?.photos ?? []) : [];
  const localPhoto = state.photo ?? draft.photoUri;
  const details = filledDetails(profile?.optionalDetails);
  const prefs = profile?.preferences;
  const location = [area, city].filter(Boolean).join(", ") || "Kolkata";
  const memberSince = formatMonthYear(user?.createdAt);

  const strength = [
    { done: photoIds.length > 0 || !!localPhoto, tip: "a photo" },
    { done: !!currentBio.trim(), tip: "a bio" },
    { done: !!occupation || !live, tip: "your occupation" },
    { done: vibes.length > 0, tip: "your vibes" },
    { done: !!prompt?.answer?.trim(), tip: "a personality prompt" },
    { done: !!city, tip: "your city" },
    { done: !!relationship, tip: "what you're looking for" },
    { done: details.length >= 3 || !live, tip: "a few more details" },
  ];
  const score = Math.round(
    (strength.filter((s) => s.done).length / strength.length) * 100,
  );
  const nextTip = strength.find((s) => !s.done)?.tip;

  const basics: { icon: IconName; label: string; value?: string }[] = [
    { icon: "gift-outline", label: "Age", value: age ? `${age}` : undefined },
    {
      icon: "person-outline",
      label: "Gender",
      value: labelOf(GENDERS, profile?.gender),
    },
    { icon: "briefcase-outline", label: "Work", value: occupation },
    {
      icon: "location-outline",
      label: "Lives in",
      value: [city, country].filter(Boolean).join(", ") || undefined,
    },
    {
      icon: "heart-circle-outline",
      label: "Interested in",
      value:
        prefs?.genders?.map((g) => labelOf(GENDERS, g) ?? g).join(", ") ||
        undefined,
    },
    {
      icon: "options-outline",
      label: "Age range",
      value:
        prefs?.minAge && prefs?.maxAge
          ? `${prefs.minAge} – ${prefs.maxAge}`
          : undefined,
    },
    {
      icon: "navigate-outline",
      label: "Distance",
      value: prefs?.maxDistanceKm
        ? `Within ${prefs.maxDistanceKm} km`
        : undefined,
    },
    { icon: "sparkles-outline", label: "Member since", value: memberSince },
  ];

  const stats: {
    number: number;
    label: string;
    icon: IconName;
    path: string;
  }[] = [
    {
      number: state.plans.filter((p) => p.id.startsWith("local-")).length,
      label: "Your plans",
      icon: "calendar-outline",
      path: "/(tabs)/plans",
    },
    {
      number: state.saved.length,
      label: "Saved",
      icon: "bookmark-outline",
      path: "/(tabs)/plans?saved=true",
    },
    {
      number: state.likes.length,
      label: "Connections",
      icon: "heart-outline",
      path: "/likes",
    },
  ];
  const links: {
    icon: IconName;
    title: string;
    subtitle: string;
    path: string;
  }[] = [
    ...(live
      ? [
          {
            icon: "color-palette-outline" as const,
            title: "Edit profile & vibe",
            subtitle: "Photos, details and what you're into",
            path: "/profile-edit",
          },
          {
            icon: "eye-outline" as const,
            title: "Profile safety & discovery",
            subtitle: "Control who can find and see you",
            path: "/profile-unlock",
          },
        ]
      : []),
    {
      icon: "shield-checkmark-outline",
      title: "Safety Centre",
      subtitle: "Tips, reporting and getting help",
      path: "/safety",
    },
    {
      icon: "settings-outline",
      title: "Settings",
      subtitle: "Account, notifications and privacy",
      path: "/settings",
    },
  ];

  return (
    <Screen>
      {/* Hero */}
      <LinearGradient
        colors={["#1A6065", c.teal, c.tealDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={[styles.blob, styles.blobCoral]} />
        <View style={[styles.blob, styles.blobPeach]} />
        <View style={styles.heroTop}>
          <Text style={styles.heroTitle}>Your profile</Text>
          <IconButton
            icon="settings-outline"
            label="Settings"
            color={c.white}
            onPress={() => router.push("/settings")}
            style={{ backgroundColor: "#FFFFFF22" }}
          />
        </View>
        <View style={{ alignItems: "center" }}>
          <View>
            <LinearGradient
              colors={[c.coralBright, "#FFB08F", c.peach]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 3, borderRadius: 66 }}
            >
              <View style={styles.avatar}>
                {photoIds[0] ? (
                  <MemberPhoto
                    id={photoIds[0]}
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : localPhoto ? (
                  <Image
                    source={{ uri: localPhoto }}
                    accessibilityLabel="Your profile photo"
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : (
                  <Text style={styles.initial}>
                    {displayName.trim().charAt(0).toUpperCase() || "?"}
                  </Text>
                )}
              </View>
            </LinearGradient>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              onPress={editProfile}
              style={({ pressed }) => [
                styles.avatarBadge,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="pencil" size={15} color={c.white} />
            </Pressable>
          </View>
          <View style={[styles.row, { gap: 6, marginTop: 16 }]}>
            <Text style={styles.heroName}>
              {displayName}
              {age ? `, ${age}` : ""}
            </Text>
            {user?.identityVerified && (
              <Ionicons name="checkmark-circle" color="#5EC2FF" size={22} />
            )}
          </View>
          {!!occupation && <Text style={styles.heroSub}>{occupation}</Text>}
          <View style={[styles.row, { gap: 4, marginTop: 4 }]}>
            <Ionicons name="location-outline" size={14} color="#FFFFFFB3" />
            <Text style={styles.heroSub}>{location}</Text>
          </View>
          <View style={styles.heroPill}>
            <Ionicons name="sparkles" size={13} color={c.peach} />
            <Text style={styles.heroPillText}>
              {labelOf(RELATIONSHIPS, relationship) ??
                "Here for the possibilities"}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Stats */}
      <View style={[card, styles.stats]}>
        {stats.map((item, i) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={`${item.number} ${item.label}`}
            onPress={() => router.push(item.path as "/likes")}
            style={({ pressed }) => [
              styles.stat,
              { borderLeftWidth: i ? 1 : 0 },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name={item.icon} size={17} color={c.coralBright} />
            <Text style={styles.statNumber}>{item.number}</Text>
            <Text style={{ color: c.muted, fontSize: 11 }}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Profile strength */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Profile strength ${score} percent`}
        disabled={score === 100}
        onPress={editProfile}
        style={({ pressed }) => [pressed && { opacity: 0.8 }]}
      >
        <LinearGradient
          colors={["#FFE3D0", "#FFF1E6"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.strength}
        >
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <View style={[styles.row, { gap: 8 }]}>
              <Ionicons name="flame" size={18} color={c.coralBright} />
              <Text style={text.label}>Profile strength</Text>
            </View>
            <Text style={{ color: c.coralBright, fontWeight: "800" }}>
              {score}%
            </Text>
          </View>
          <View style={styles.track}>
            <LinearGradient
              colors={["#FF8B70", c.coralBright]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.fill, { width: `${score}%` }]}
            />
          </View>
          <Text style={[text.muted, { fontSize: 12 }]}>
            {nextTip
              ? `Add ${nextTip} to stand out to the right people.`
              : "Your profile is looking complete. Nice!"}
          </Text>
        </LinearGradient>
      </Pressable>

      {/* Photos */}
      {photoIds.length > 0 && (
        <Section
          icon="images-outline"
          title={`Photos · ${photoIds.length}/${MAX_PHOTOS}`}
          action={["Manage", editProfile]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10 }}
          >
            {photoIds.map((id) => (
              <MemberPhoto key={id} id={id} style={styles.thumb} />
            ))}
          </ScrollView>
        </Section>
      )}

      {/* About */}
      <Section
        icon="chatbubble-ellipses-outline"
        title="A little about you"
        action={editing ? undefined : ["Edit", startEditing]}
      >
        {editing ? (
          <>
            {demoMode && (
              <Field
                label="First name"
                value={name}
                onChangeText={setName}
                maxLength={60}
              />
            )}
            <Field
              label="About you"
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={600}
            />
            {!!error && (
              <Text style={{ color: "#BA4034", marginBottom: 12 }}>
                {error}
              </Text>
            )}
            <Button
              loading={saving}
              onPress={() => {
                void save();
              }}
            >
              Save Profile
            </Button>
            <Pressable
              onPress={() => setEditing(false)}
              style={{ paddingTop: 16, paddingBottom: 4 }}
            >
              <Text style={{ color: c.teal, textAlign: "center" }}>Cancel</Text>
            </Pressable>
          </>
        ) : currentBio.trim() ? (
          <Text style={text.body}>{currentBio}</Text>
        ) : (
          <Placeholder onPress={startEditing}>
            Write a few lines about yourself
          </Placeholder>
        )}
      </Section>

      {/* Personality prompt */}
      {!!prompt?.answer?.trim() && (
        <PromptCard
          type={prompt.type}
          answer={prompt.answer}
          fallback="In my words"
        />
      )}

      {/* Basics */}
      {basics.some((b) => b.value) && (
        <Section icon="id-card-outline" title="The basics">
          <InfoTiles items={basics} />
        </Section>
      )}

      {/* Vibes */}
      <Section
        icon="sparkles-outline"
        title="Your vibes"
        action={live ? ["Edit", () => router.push("/onboarding")] : undefined}
      >
        {vibes.length ? (
          <VibeChips ids={vibes} />
        ) : (
          <Placeholder
            onPress={live ? () => router.push("/onboarding") : undefined}
          >
            Pick the kinds of plans you love
          </Placeholder>
        )}
      </Section>

      {/* Looking for */}
      {(!!firstPlan || !!relationship) && (
        <Section icon="compass-outline" title="Looking for">
          <LookingFor firstPlan={firstPlan} relationship={relationship} />
        </Section>
      )}

      {/* Optional details */}
      {live && (
        <Section
          icon="list-outline"
          title="More about you"
          action={["Edit", () => router.push("/profile-edit")]}
        >
          {details.length ? (
            <DetailList details={profile?.optionalDetails ?? {}} />
          ) : (
            <Placeholder onPress={() => router.push("/profile-edit")}>
              Add hobbies, food, weekends and more
            </Placeholder>
          )}
        </Section>
      )}

      {/* Trust */}
      {live && user && (
        <Section icon="shield-checkmark-outline" title="Trust & account">
          <View style={{ gap: 12 }}>
            {!!user.email && (
              <TrustRow
                icon="mail-outline"
                label={user.email}
                ok={!!user.emailVerified}
                okText="Verified"
                noText="Not verified"
              />
            )}
            <TrustRow
              icon="finger-print-outline"
              label="Identity"
              ok={user.identityVerified}
              okText="Verified"
              noText="Not verified"
            />
            <TrustRow
              icon="people-outline"
              label="Discovery"
              ok={!!account.data?.completion?.activated}
              okText="Visible"
              noText="Not yet visible"
            />
          </View>
        </Section>
      )}

      {/* Links */}
      <Text style={[text.label, { marginTop: 26, marginBottom: 12 }]}>
        Manage your Along
      </Text>
      <View style={[card, { paddingVertical: 4, overflow: "hidden" }]}>
        {links.map((link, i) => (
          <Pressable
            key={link.title}
            accessibilityRole="button"
            onPress={() => router.push(link.path as "/settings")}
            style={({ pressed }) => [
              styles.linkRow,
              { borderTopWidth: i ? 1 : 0 },
              pressed && { backgroundColor: c.soft },
            ]}
          >
            <View style={styles.iconTile}>
              <Ionicons name={link.icon} size={18} color={c.teal} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={text.label}>{link.title}</Text>
              <Text style={[text.muted, { fontSize: 12, lineHeight: 17 }]}>
                {link.subtitle}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#C4B5A9" />
          </Pressable>
        ))}
      </View>
      <DemoNotice />
    </Screen>
  );
}
function TrustRow({
  icon,
  label,
  ok,
  okText,
  noText,
}: {
  icon: IconName;
  label: string;
  ok: boolean;
  okText: string;
  noText: string;
}) {
  return (
    <View style={[styles.row, { gap: 12 }]}>
      <Ionicons name={icon} size={18} color={c.teal} />
      <Text style={[text.body, { flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      <View
        style={[styles.badge, { backgroundColor: ok ? "#E3F1EC" : "#FBE7DA" }]}
      >
        <Ionicons
          name={ok ? "checkmark-circle" : "time-outline"}
          size={13}
          color={ok ? c.green : c.coralBright}
        />
        <Text
          style={{
            fontSize: 11,
            fontWeight: "600",
            color: ok ? c.green : c.coralBright,
          }}
        >
          {ok ? okText : noText}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  hero: {
    marginHorizontal: -22,
    paddingHorizontal: 22,
    paddingBottom: 58,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    overflow: "hidden",
  },
  blob: { position: "absolute", borderRadius: 999 },
  blobCoral: {
    width: 220,
    height: 220,
    right: -70,
    top: -60,
    backgroundColor: "#FF685233",
  },
  blobPeach: {
    width: 160,
    height: 160,
    left: -60,
    bottom: -40,
    backgroundColor: "#F4C9A822",
  },
  heroTop: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroTitle: {
    fontSize: 25,
    fontWeight: "700",
    color: c.white,
    letterSpacing: -0.7,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#F8DFCC",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: c.tealDark,
    overflow: "hidden",
  },
  initial: { fontSize: 46, fontWeight: "800", color: c.teal },
  avatarBadge: {
    position: "absolute",
    right: 2,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.coralBright,
    borderWidth: 3,
    borderColor: c.tealDark,
    alignItems: "center",
    justifyContent: "center",
  },
  heroName: {
    fontSize: 26,
    fontWeight: "800",
    color: c.white,
    letterSpacing: -0.7,
  },
  heroSub: { color: "#FFFFFFCC", fontSize: 13, marginTop: 2 },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#FFFFFF1F",
    borderWidth: 1,
    borderColor: "#FFFFFF33",
  },
  heroPillText: { fontSize: 12, color: c.white, fontWeight: "600" },
  stats: { flexDirection: "row", marginTop: -36, paddingVertical: 16 },
  stat: { flex: 1, alignItems: "center", gap: 3, borderColor: c.line },
  statNumber: { color: c.teal, fontSize: 24, fontWeight: "800" },
  strength: { marginTop: 16, borderRadius: 20, padding: 16, gap: 10 },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFFAA",
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 4 },
  thumb: { width: 96, height: 124, borderRadius: 16 },
  prompt: {
    marginTop: 16,
    borderRadius: 22,
    padding: 20,
    overflow: "hidden",
  },
  promptQuestion: {
    color: "#FFFFFFD9",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  promptAnswer: {
    color: c.white,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: "700",
    marginTop: 8,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "#FCF1E8",
    gap: 4,
  },
  tileLabel: { fontSize: 11, color: c.muted, fontWeight: "600" },
  tileValue: { fontSize: 14, color: c.charcoal, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#FBE7DA",
    alignItems: "center",
    justifyContent: "center",
  },
  iconTileCoral: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  editPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: c.soft,
  },
  placeholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#F2C4B2",
    backgroundColor: "#FFFBF7",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderColor: "#F4EAE1",
  },
});
