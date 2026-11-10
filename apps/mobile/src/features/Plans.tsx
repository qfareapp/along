import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  DemoNotice,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  card,
  text,
} from "../components/ui";
import { demoMode } from "../services/api";
import { useCompletion } from "../services/onboarding";
import {
  type PlanCategory,
  type PlanRecord,
  useDebounced,
  usePlanCategories,
  usePlanFeed,
  useLegacyPlanSaves,
} from "../services/plans";
import { NotificationBell } from "./ActivityNotifications";
import {
  CategoryCard,
  PeoplePlanCard,
  PlanChip,
  PlanSearch,
  PlanSkeleton,
  SectionHeader,
} from "./PlanComponents";
import { categories as previewCategories, assets, type Plan } from "./data";
import { useAlong } from "../store/useAlong";
import { colors as c } from "../theme";
import { useAppLayout } from "../components/layout";
export type RemotePlan = PlanRecord;
export function mapPlan(p: RemotePlan): Plan {
  return {
    id: p._id,
    title: p.title,
    category: p.category,
    zone: p.zone,
    time: new Date(p.startsAt).toLocaleString(),
    description: p.description ?? p.highlight,
    creator: p.creator.name,
    creatorId: p.creator._id,
    creatorPhotoId: p.creator.photoId,
    creatorVerified: p.creator.identityVerified,
    creatorOccupation: p.creator.occupation,
    type: p.type,
    audience: p.audience ?? undefined,
    need: "Open to company",
    people: 0,
    image: assets.coffee,
  };
}
export default function Plans() {
  const layout = useAppLayout();
  useLegacyPlanSaves();
  const completion = useCompletion();
  const params = useLocalSearchParams<{ saved?: string; category?: string }>();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const categories = usePlanCategories(q);
  const feed = usePlanFeed({ q, sort: "recommended", limit: q ? "20" : "4" });
  const preview = useAlong();
  const [refreshing, setRefreshing] = useState(false);
  if (params.saved === "true") return <PlanListing saved />;
  if (params.category) return <PlanListing category={params.category} />;
  if (!demoMode && !completion.data?.activated)
    return (
      <Screen>
        <Header title="Explore Plans" />
        <Notice>
          {completion.error?.message ??
            "Complete your profile to connect with people."}
        </Notice>
        {completion.isPending ? (
          <ActivityIndicator color={c.teal} />
        ) : (
          <Button
            onPress={() =>
              completion.error
                ? void completion.refetch()
                : router.push(
                    completion.data?.checks.quickStart
                      ? "/profile-unlock"
                      : "/onboarding",
                  )
            }
          >
            {completion.error ? "Retry" : "Complete Profile"}
          </Button>
        )}
      </Screen>
    );
  const values: PlanCategory[] = demoMode
    ? previewCategories
        .filter(
          (cat) =>
            !q ||
            `${cat.label} ${cat.name}`.toLowerCase().includes(q.toLowerCase()),
        )
        .map((cat) => ({
          _id: cat.id,
          slug: cat.id,
          name: cat.name.replace(/\n/g, " "),
          liveCount: preview.plans.filter(
            (p) => p.category === cat.id && (p.ownerState ?? "live") === "live",
          ).length,
          ownManagedCount: preview.plans.filter(
            (p) =>
              p.category === cat.id &&
              p.id.startsWith("local-") &&
              p.ownerState &&
              p.ownerState !== "live",
          ).length,
        }))
    : (categories.data ?? []);
  const plans = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Screen scroll={false} width="wide">
      <FlatList
        key={`categories-${layout.categoryColumns}`}
        data={values}
        numColumns={layout.categoryColumns}
        keyExtractor={(cat) => cat.slug}
        contentContainerStyle={{ padding: layout.padding, paddingBottom: 32 }}
        columnWrapperStyle={
          layout.categoryColumns > 1 ? { gap: 16, marginBottom: 16 } : undefined
        }
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void Promise.all([categories.refetch(), feed.refetch()]).finally(() =>
            setRefreshing(false),
          );
        }}
        renderItem={({ item }) => (
          <View
            style={{
              flex: 1,
              maxWidth: `${100 / layout.categoryColumns}%`,
              marginBottom: layout.categoryColumns === 1 ? 16 : 0,
            }}
          >
            <CategoryCard category={item} />
          </View>
        )}
        ListHeaderComponent={
          <>
            <Header
              title="Explore Plans"
              subtitle={completion.data?.profile.city ?? "Your neighbourhood"}
              right={
                <View style={{ flexDirection: "row" }}>
                  <NotificationBell />
                  <IconButton
                    icon="bookmark-outline"
                    label="Saved Plans"
                    onPress={() => router.push("/plans/saved")}
                  />
                </View>
              }
            />
            <LinearGradient
              colors={["#1A6065", c.tealDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.hero}
            >
              <View style={[s.heroBlob, { top: -40, right: -30 }]} />
              <View
                style={[
                  s.heroBlob,
                  {
                    bottom: -55,
                    right: 60,
                    width: 110,
                    height: 110,
                    backgroundColor: "rgba(244,119,104,0.35)",
                  },
                ]}
              />
              <Text style={s.heroEyebrow}>EXPLORE PLANS</Text>
              <Text style={s.heroTitle}>
                A little plan.{"\n"}A lovely possibility.
              </Text>
              <Text style={s.heroBody}>
                Find your kind of thing. Meet your kind of people.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start a plan"
                onPress={() => router.push("/create")}
                style={({ pressed }) => [
                  s.heroCta,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Ionicons name="add" size={16} color={c.white} />
                <Text
                  style={{ color: c.white, fontWeight: "700", fontSize: 13 }}
                >
                  Start a plan
                </Text>
              </Pressable>
            </LinearGradient>
            <PlanSearch value={search} onChangeText={setSearch} />
            <SectionHeader
              title={q ? "Matching categories" : "What sounds like you?"}
              subtitle={
                values.length
                  ? `${values.length} ${values.length === 1 ? "category" : "categories"}`
                  : undefined
              }
            />
            {!demoMode && categories.isLoading && <PlanSkeleton categories />}
            {categories.error && (
              <Empty
                title="Couldn't load plans. Please try again."
                description={categories.error.message}
              >
                <Button onPress={() => void categories.refetch()}>Retry</Button>
              </Empty>
            )}
          </>
        }
        ListEmptyComponent={
          !categories.isLoading && !categories.error ? (
            <Empty
              title={
                q
                  ? "No matching categories"
                  : "No activities available right now."
              }
              description={
                q
                  ? "Try another activity or explore the plans below."
                  : "Check back soon for something to share."
              }
            />
          ) : undefined
        }
        ListFooterComponent={
          <View style={{ marginTop: 24 }}>
            <SectionHeader
              title={q ? "Matching plans" : "For You"}
              subtitle={
                q
                  ? `${feed.data?.pages[0]?.total ?? 0} plans found`
                  : "Shared interests. New beginnings."
              }
              action="See all"
              onAction={() => router.push("/plans/all")}
            />
            {!demoMode && feed.isLoading ? (
              <PlanSkeleton />
            ) : feed.error ? (
              <Empty
                title="Couldn't load plans. Please try again."
                description={feed.error.message}
              >
                <Button onPress={() => void feed.refetch()}>Retry</Button>
              </Empty>
            ) : plans.length ? (
              <View>
                {Array.from(
                  { length: Math.ceil(plans.length / layout.planColumns) },
                  (_, row) =>
                    plans.slice(
                      row * layout.planColumns,
                      (row + 1) * layout.planColumns,
                    ),
                ).map((row) => (
                  <View
                    key={row[0]._id}
                    style={{ flexDirection: "row", gap: 16 }}
                  >
                    {row.map((plan) => (
                      <PeoplePlanCard key={plan._id} plan={plan} />
                    ))}
                    {row.length < layout.planColumns && (
                      <View style={{ flex: 1 }} />
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <Empty
                description="Start with something you'd love to do."
                title={
                  q
                    ? "No plans match your search. Try another activity."
                    : "Your next shared plan starts here."
                }
              >
                <Button onPress={() => router.push("/create")}>
                  Create a Plan
                </Button>
              </Empty>
            )}
            {!!q && feed.hasNextPage && (
              <Button
                variant="outline"
                loading={feed.isFetchingNextPage}
                onPress={() => void feed.fetchNextPage()}
              >
                More results
              </Button>
            )}
            <DemoNotice />
          </View>
        }
      />
    </Screen>
  );
}

export function PlanListing({
  category,
  saved = false,
}: {
  category?: string;
  saved?: boolean;
}) {
  const layout = useAppLayout();
  const categories = usePlanCategories();
  const completion = useCompletion();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [sort, setSort] = useState("soon"),
    [when, setWhen] = useState("any"),
    [kind, setKind] = useState("any"),
    [nearby, setNearby] = useState(false),
    [filters, setFilters] = useState(false),
    [mine, setMine] = useState(false);
  const feed = usePlanFeed({
    ...(category ? { category } : {}),
    q,
    sort,
    when,
    kind,
    nearby: String(nearby),
    saved: String(saved),
    owner: String(mine),
  });
  const data = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const cat = categories.data?.find((cat) => cat.slug === category);
  const [refreshing, setRefreshing] = useState(false);
  const chips = [
    {
      label: "Your plans",
      selected: mine,
      press: () => {
        setMine(!mine);
        setWhen("any");
        setKind("any");
        setNearby(false);
      },
    },
    {
      label: "For You",
      selected: sort === "recommended",
      press: () => setSort("recommended"),
    },
    { label: "Soon", selected: sort === "soon", press: () => setSort("soon") },
    { label: "Nearby", selected: nearby, press: () => setNearby(!nearby) },
    {
      label: "Today",
      selected: when === "today",
      press: () => setWhen(when === "today" ? "any" : "today"),
    },
    {
      label: "This Weekend",
      selected: when === "weekend",
      press: () => setWhen(when === "weekend" ? "any" : "weekend"),
    },
    {
      label: "One-on-One",
      selected: kind === "one_on_one",
      press: () => setKind(kind === "one_on_one" ? "any" : "one_on_one"),
    },
    {
      label: "Group",
      selected: kind === "group",
      press: () => setKind(kind === "group" ? "any" : "group"),
    },
  ];
  return (
    <Screen scroll={false} width="wide">
      <FlatList
        key={`plans-${layout.planColumns}`}
        numColumns={layout.planColumns}
        columnWrapperStyle={layout.planColumns > 1 ? { gap: 16 } : undefined}
        data={data}
        keyExtractor={(plan) => plan._id}
        contentContainerStyle={{ padding: layout.padding, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <View style={{ flex: 1, maxWidth: `${100 / layout.planColumns}%` }}>
            <PeoplePlanCard plan={item} />
          </View>
        )}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void feed.refetch().finally(() => setRefreshing(false));
        }}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage)
            void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <>
            <Header
              back
              title={saved ? "Saved Plans" : (cat?.name ?? "People & Plans")}
              subtitle={
                mine
                  ? "Your live, paused, successful and earlier plans"
                  : `${feed.data?.pages[0]?.total ?? 0} plans around ${completion.data?.profile.city ?? "you"}`
              }
              right={
                <IconButton
                  icon="options-outline"
                  label="Plan filters"
                  onPress={() => setFilters(!filters)}
                />
              }
            />
            <PlanSearch
              value={search}
              onChangeText={setSearch}
              placeholder="Search this collection..."
            />
            {!mine && !!cat?.ownManagedCount ? (
              <Notice>
                Some of your plans are paused, successful or have earlier dates.
                Choose Your plans to manage them.
              </Notice>
            ) : (
              !mine &&
              !!cat?.ownPastCount && (
                <Notice>
                  {cat.ownPastCount} of your plans in this category have an
                  earlier date. Choose Your plans to view or reschedule them.
                </Notice>
              )
            )}
            {filters && (
              <View style={[card, s.filters]}>
                <Text style={text.label}>Sort plans</Text>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {[
                    ["recommended", "Recommended"],
                    ["soon", "Soonest"],
                    ["nearest", "Nearest area"],
                    ["newest", "Newest"],
                  ].map(([key, label]) => (
                    <PlanChip
                      key={key}
                      label={label}
                      selected={sort === key}
                      onPress={() => setSort(key)}
                    />
                  ))}
                </View>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -layout.padding, marginBottom: 18 }}
              contentContainerStyle={{
                gap: 8,
                paddingHorizontal: layout.padding,
              }}
            >
              {chips.map((chip) => (
                <PlanChip
                  key={chip.label}
                  label={chip.label}
                  selected={chip.selected}
                  onPress={chip.press}
                />
              ))}
            </ScrollView>
            {feed.isLoading && <PlanSkeleton />}
            {feed.error && (
              <Empty
                title="Couldn't load plans. Please try again."
                description={feed.error.message}
              >
                <Button onPress={() => void feed.refetch()}>Retry</Button>
              </Empty>
            )}
          </>
        }
        ListEmptyComponent={
          !feed.isLoading && !feed.error ? (
            <Empty
              title={
                q
                  ? "No plans match your search. Try another activity."
                  : saved
                    ? "Keep a little possibility for later."
                    : "No plans here yet. Why not start one?"
              }
              description={
                saved
                  ? "Tap the bookmark on a plan to save it here."
                  : "Start with something you'd love to do."
              }
            >
              <Button
                onPress={() =>
                  router.push(
                    category
                      ? `/create?category=${encodeURIComponent(category)}`
                      : "/create",
                  )
                }
              >
                Create a Plan
              </Button>
            </Empty>
          ) : undefined
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <ActivityIndicator color={c.teal} />
          ) : feed.hasNextPage ? (
            <Button variant="outline" onPress={() => void feed.fetchNextPage()}>
              Load more plans
            </Button>
          ) : undefined
        }
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: {
    marginTop: 8,
    padding: 22,
    borderRadius: 26,
    overflow: "hidden",
  },
  heroBlob: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  heroEyebrow: {
    color: c.peach,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  heroTitle: {
    color: c.white,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "700",
    letterSpacing: -0.7,
    marginTop: 8,
  },
  heroBody: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    maxWidth: 300,
  },
  heroCta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 16,
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: c.coral,
  },
  filters: { gap: 12, padding: 16, marginBottom: 14 },
});
