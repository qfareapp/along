import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DemoNotice,
  Field,
  Header,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { assets } from "./data";
import { useCategories } from "../services/categories";
import { useAlong } from "../store/useAlong";
import { api, demoMode } from "../services/api";
import { colors as c } from "../theme";
import { useRefreshPlans } from "../services/plans";
import { useCompletion } from "../services/onboarding";
import {
  DistancePreference,
  distanceKm,
  validDistance,
  type DistanceChoice,
} from "../components/DistancePreference";
import { CategoryPlanFields } from "./CategoryPlanFields";
import DateTimeField from "../components/DateTimeField";
import { localDate } from "../components/dateTime";
import {
  ScheduleModeToggle,
  scheduleRange,
  type ScheduleMode,
} from "./PlanSchedule";
import {
  validatePlanDetails,
  type PlanDetails,
} from "../../../../packages/plan-details/index.js";

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Give your plan a title of at least 5 characters.")
    .max(100),
  description: z
    .string()
    .trim()
    .min(15, "Add a little more detail (at least 15 characters).")
    .max(1500),
  zone: z.string().trim().min(2, "Choose an approximate area."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 18:00."),
  endDate: z.string(),
  endTime: z.string(),
  budget: z.string().max(200),
});
type Values = z.infer<typeof schema>;
export default function CreatePlan() {
  const completion = useCompletion();
  const params = useLocalSearchParams<{ category?: string }>();
  const refreshPlans = useRefreshPlans();
  const [activityType, setActivityType] = useState<"one_on_one" | "group">(
    "one_on_one",
  );
  const [capacity, setCapacity] = useState("4");
  const [minAge, setMinAge] = useState("18"),
    [maxAge, setMaxAge] = useState("120");
  const [gender, setGender] = useState<"male" | "female" | "both">("both");
  const [distance, setDistance] = useState<DistanceChoice>({
    range: "",
    unit: "km",
  });
  const coordinates = completion.data?.profile.approximateLocation?.coordinates;
  const planDistance = {
    ...distance,
    location:
      distance.location ??
      (coordinates?.length === 2
        ? { longitude: coordinates[0], latitude: coordinates[1] }
        : undefined),
  };
  function resetAudience() {
    setMinAge("18");
    setMaxAge("120");
    setGender("both");
    setDistance({ range: "", unit: "km" });
  }
  const categoryQuery = useCategories();
  const state = useAlong();
  const client = useQueryClient();
  const [type, setType] = useState<"need" | "offer" | "together">("need");
  const categories = categoryQuery.categories.filter(
    (cat) => !cat.allowedTypes || cat.allowedTypes.includes(type),
  );
  const [category, setCategory] = useState(params.category ?? "");
  const [categoryDrafts, setCategoryDrafts] = useState<
    Record<string, PlanDetails>
  >({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const details = categoryDrafts[category] ?? {};
  const selectedCategory = categories.find((cat) => cat.id === category);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [tomorrow] = useState(() => localDate(new Date(Date.now() + 86400000)));
  const [dateMode, setDateMode] = useState<ScheduleMode>("exact");
  const [timeMode, setTimeMode] = useState<ScheduleMode>("exact");
  // Commute and travel already carry their own schedule fields.
  const flexibleSchedule = category !== "commute" && category !== "travel";
  const schedule = flexibleSchedule
    ? { dateMode, timeMode }
    : ({ dateMode: "exact", timeMode: "exact" } as const);
  const {
    control,
    handleSubmit,
    trigger,
    reset,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      zone: "",
      date: tomorrow,
      time: "18:00",
      endDate: "",
      endTime: "20:00",
      budget: "Decide together",
    },
  });
  const planDate = useWatch({ control, name: "date" });
  async function publish(value: Values) {
    setError("");
    const lower = Number(minAge),
      upper = Number(maxAge);
    if (
      !/^\d{2,3}$/.test(minAge) ||
      !/^\d{2,3}$/.test(maxAge) ||
      lower < 18 ||
      upper > 120 ||
      lower > upper
    ) {
      setError(
        "Choose an age range from 18 to 120, with minimum age no higher than maximum age.",
      );
      return;
    }
    if (!validDistance(planDistance)) {
      setError(
        "Choose a valid distance and set an approximate location for this plan.",
      );
      return;
    }
    const audience = {
      minAge: lower,
      maxAge: upper,
      gender,
      maxDistanceKm: distanceKm(planDistance),
      distanceUnit: distance.unit,
    };
    const categoryDetails = Object.fromEntries(
      Object.entries(details).map(([key, entry]) => [
        key,
        typeof entry === "string" ? entry.trim() : entry,
      ]),
    );
    const problems = validatePlanDetails(category, categoryDetails);
    setDetailErrors(problems);
    if (Object.keys(problems).length) {
      setError("Complete the category details below before publishing.");
      return;
    }
    if (
      activityType === "group" &&
      (!Number.isInteger(Number(capacity)) ||
        Number(capacity) < 1 ||
        Number(capacity) > 100)
    ) {
      setError("Choose between 1 and 100 available places.");
      return;
    }
    if (!selectedCategory) {
      setError("Choose an available category before publishing.");
      setStep(0);
      return;
    }
    const range = scheduleRange({
      schedule,
      date: value.date,
      endDate: value.endDate,
      time:
        category === "commute"
          ? String(categoryDetails.departureTime)
          : value.time,
      endTime: value.endTime,
    });
    if ("error" in range) {
      setError(range.error);
      return;
    }
    const startsAt = range.startsAt;
    const endsAt =
      category === "travel"
        ? new Date(`${categoryDetails.returnDate}T23:59:59`)
        : range.endsAt;
    if (endsAt && endsAt <= startsAt) {
      setDetailErrors({
        returnDate: "Return date must be on or after your departure date.",
      });
      return;
    }
    try {
      let id = `local-${new Date().getTime()}`;
      if (demoMode)
        state.addPlan({
          id,
          type,
          title: value.title,
          description: value.description,
          category,
          zone: value.zone,
          time: startsAt.toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
          startsAt: startsAt.toISOString(),
          categoryDetails,
          audience,
          creator: state.name,
          people: 0,
          need: type === "offer" ? "Open to company" : "Looking for company",
          image:
            category === "commute"
              ? assets.carpool
              : category === "travel"
                ? assets.travel
                : assets.coffee,
        });
      else {
        const result = await api<{ _id: string; status: string }>(
          "/activities",
          {
            method: "POST",
            body: JSON.stringify({
              type,
              title: value.title,
              description: value.description,
              category,
              zone: value.zone,
              startsAt: startsAt.toISOString(),
              budget: value.budget,
              recurring: category === "commute",
              categoryDetails,
              audience: {
                ...audience,
                ...(audience.maxDistanceKm != null
                  ? { location: planDistance.location }
                  : {}),
              },
              ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
              ...(flexibleSchedule ? { schedule } : {}),
              activityType,
              ...(activityType === "group"
                ? { capacity: Number(capacity) }
                : {}),
            }),
          },
        );
        id = result._id;
        await client.invalidateQueries({ queryKey: ["activities"] });
        await refreshPlans();
        if (result.status === "paused") {
          reset();
          resetAudience();
          setCategoryDrafts({});
          setDetailErrors({});
          setStep(0);
          setReviewPending(true);
          return;
        }
      }
      reset();
      resetAudience();
      setCategoryDrafts({});
      setDetailErrors({});
      setStep(0);
      router.replace(`/activity?id=${id}&created=true`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish your plan.");
    }
  }
  const field = (
    name: keyof Values,
    label: string,
    placeholder: string,
    multiline = false,
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur } }) =>
        name === "date" ||
        name === "time" ||
        name === "endDate" ||
        name === "endTime" ? (
          <DateTimeField
            label={label}
            mode={name === "date" || name === "endDate" ? "date" : "time"}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            error={errors[name]?.message}
            minimumDate={
              name === "date"
                ? localDate()
                : name === "endDate"
                  ? planDate || localDate()
                  : undefined
            }
          />
        ) : (
          <Field
            label={label}
            placeholder={placeholder}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            multiline={multiline}
            error={errors[name]?.message}
          />
        )
      }
    />
  );
  return (
    <Screen key={step} width="reading">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Header
          title="Create a Plan"
          subtitle="Post what you need or want to do."
          back
        />
        {reviewPending && (
          <Notice>
            Your plan has been submitted for moderation. It will appear in
            discovery after approval.
          </Notice>
        )}
        <Text style={[text.muted, { marginTop: 10 }]}>
          Step {step + 1} of 2 · {step === 0 ? "Your plan" : "Category details"}
        </Text>
        {step === 0 && (
          <View
            style={{
              flexDirection: "row",
              gap: 7,
              marginTop: 10,
              marginBottom: 19,
            }}
          >
            {(
              [
                { id: "need", label: "I Need" },
                { id: "offer", label: "I Can Offer" },
                { id: "together", label: "Let’s Do Together" },
              ] as const
            ).map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: type === item.id }}
                onPress={() => setType(item.id)}
                key={item.id}
                style={{
                  flex: 1,
                  backgroundColor: type === item.id ? c.coralBright : "#F5EBE2",
                  minHeight: 42,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 14,
                }}
              >
                <Text
                  style={{
                    color: type === item.id ? "white" : c.teal,
                    fontSize: 11,
                    fontWeight: "600",
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {step === 0 ? (
          <>
            {field(
              "title",
              "What’s the plan?",
              "e.g. Coffee and a conversation",
            )}
            {field(
              "description",
              "What are you looking for?",
              "e.g. Need a carpool partner to office, someone to explore new cafés, or a travel buddy.",
              true,
            )}
            <Text style={[text.label, { marginBottom: 13 }]}>Category</Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 22,
              }}
            >
              {categories.map((cat) => (
                <Pressable
                  key={cat.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === cat.id }}
                  accessibilityLabel={`Category: ${cat.label}`}
                  aria-pressed={category === cat.id}
                  onPress={() => {
                    setCategory(cat.id);
                    setDetailErrors({});
                    setError("");
                  }}
                  style={{
                    width: "23%",
                    flexGrow: 1,
                    height: 85,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: category === cat.id ? c.coralBright : c.line,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 9,
                    backgroundColor:
                      category === cat.id ? "#FFE1D5" : "#FCF0E6",
                  }}
                >
                  <Ionicons
                    name={cat.icon}
                    size={25}
                    color={category === cat.id ? c.coralBright : c.teal}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      textAlign: "center",
                      color: category === cat.id ? c.coralBright : c.charcoal,
                    }}
                  >
                    {cat.label}
                  </Text>
                  {category === cat.id && (
                    <Ionicons
                      name="checkmark-circle"
                      color={c.coralBright}
                      size={14}
                      style={{ position: "absolute", top: 5, right: 5 }}
                    />
                  )}
                </Pressable>
              ))}
            </View>
            {!demoMode && categoryQuery.isPending && (
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 18 }}>
                <ActivityIndicator color={c.teal} />
                <Text style={text.muted}>Loading categories…</Text>
              </View>
            )}
            {!demoMode && categoryQuery.error ? (
              <>
                <Text
                  accessibilityRole="alert"
                  style={{ color: "#BA4034", marginBottom: 12 }}
                >
                  Couldn&apos;t load categories. {categoryQuery.error.message}
                </Text>
                <Button
                  variant="outline"
                  onPress={() => void categoryQuery.refetch()}
                >
                  Retry Categories
                </Button>
              </>
            ) : (
              !categoryQuery.isPending &&
              !categories.length && (
                <Notice>
                  No categories are currently enabled for this type of plan. Try
                  another plan type or ask the admin to enable categories.
                </Notice>
              )
            )}
            {!!selectedCategory && (
              <Text style={[text.muted, { marginBottom: 14 }]}>
                Selected: {selectedCategory.label}
              </Text>
            )}
            <Button
              disabled={!selectedCategory}
              onPress={() => {
                void trigger(["title", "description"]).then((ok) => {
                  if (ok && selectedCategory) setStep(1);
                });
              }}
            >
              Next
            </Button>
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={{ color: "#BA4034", marginTop: 12 }}
              >
                {error}
              </Text>
            )}
          </>
        ) : (
          <>
            {!!selectedCategory && (
              <Text style={[text.label, { marginBottom: 18 }]}>
                Category: {selectedCategory.label}
              </Text>
            )}
            <CategoryPlanFields
              category={category}
              minimumDate={planDate}
              details={details}
              errors={detailErrors}
              onChange={(next) => {
                setCategoryDrafts((previous) => ({
                  ...previous,
                  [category]: next,
                }));
                setDetailErrors({});
              }}
            />
            {field("zone", "Approximate area", "e.g. Park Street, Kolkata")}
            <Text style={[text.label, { marginBottom: 10 }]}>When</Text>
            {flexibleSchedule && (
              <ScheduleModeToggle
                value={dateMode}
                onChange={(mode) => {
                  setDateMode(mode);
                  const start = getValues("date");
                  if (mode === "range" && getValues("endDate") <= start)
                    setValue(
                      "endDate",
                      localDate(
                        new Date(
                          new Date(`${start}T12:00:00`).getTime() + 86400000,
                        ),
                      ),
                    );
                }}
                labels={["Exact date", "Date range"]}
              />
            )}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                {field(
                  "date",
                  category === "commute"
                    ? "First working day"
                    : category === "travel"
                      ? "Departure date"
                      : schedule.dateMode === "range"
                        ? "From date"
                        : "Date",
                  "YYYY-MM-DD",
                )}
              </View>
              {schedule.dateMode === "range" ? (
                <View style={{ flex: 1 }}>
                  {field("endDate", "To date", "YYYY-MM-DD")}
                </View>
              ) : (
                !flexibleSchedule &&
                category !== "commute" && (
                  <View style={{ flex: 1 }}>
                    {field("time", "Time", "18:00")}
                  </View>
                )
              )}
            </View>
            {flexibleSchedule && (
              <>
                <ScheduleModeToggle
                  value={timeMode}
                  onChange={setTimeMode}
                  labels={["Exact time", "Time range"]}
                />
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    {field(
                      "time",
                      timeMode === "range" ? "From" : "Time",
                      "18:00",
                    )}
                  </View>
                  {timeMode === "range" && (
                    <View style={{ flex: 1 }}>
                      {field("endTime", "Until", "20:00")}
                    </View>
                  )}
                </View>
              </>
            )}
            {field("budget", "Cost expectations", "e.g. Split the bill")}
            <Text style={[text.label, { marginBottom: 10 }]}>
              Who&apos;s the plan for?
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              {(["one_on_one", "group"] as const).map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activityType === kind }}
                  onPress={() => setActivityType(kind)}
                  style={{
                    flex: 1,
                    padding: 15,
                    borderRadius: 14,
                    backgroundColor: activityType === kind ? c.teal : c.soft,
                  }}
                >
                  <Text
                    style={{ color: activityType === kind ? c.white : c.teal }}
                  >
                    {kind === "group" ? "Small group" : "One-on-one"}
                  </Text>
                </Pressable>
              ))}
            </View>
            {activityType === "group" && (
              <Field
                label="Available places (excluding you)"
                value={capacity}
                onChangeText={setCapacity}
                keyboardType="number-pad"
              />
            )}
            <Text style={[text.label, { marginTop: 12, marginBottom: 14 }]}>
              Who would you like to join?
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Plan minimum age"
                  value={minAge}
                  onChangeText={setMinAge}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Plan maximum age"
                  value={maxAge}
                  onChangeText={setMaxAge}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
            </View>
            <Text style={text.label}>Gender preference</Text>
            <View style={{ flexDirection: "row", gap: 10, marginVertical: 14 }}>
              {(["male", "female", "both"] as const).map((choice) => (
                <Pressable
                  key={choice}
                  accessibilityRole="radio"
                  accessibilityLabel={
                    choice === "male"
                      ? "Male"
                      : choice === "female"
                        ? "Female"
                        : "Both"
                  }
                  accessibilityState={{ checked: gender === choice }}
                  aria-checked={gender === choice}
                  onPress={() => setGender(choice)}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 14,
                    alignItems: "center",
                    backgroundColor: gender === choice ? c.teal : c.soft,
                  }}
                >
                  <Text style={{ color: gender === choice ? c.white : c.teal }}>
                    {choice === "male"
                      ? "Male"
                      : choice === "female"
                        ? "Female"
                        : "Both"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[text.muted, { marginBottom: 16 }]}>
              Both means no gender restriction. Existing discovery privacy and
              eligibility settings still apply.
            </Text>
            <DistancePreference
              context="plan"
              value={planDistance}
              onChange={setDistance}
            />
            <Notice>
              Use an approximate area. Agree on the details together and choose
              a public place for your first meeting.
            </Notice>
            {error && (
              <Text
                accessibilityRole="alert"
                style={{ color: "#BA4034", marginBottom: 15 }}
              >
                {error}
              </Text>
            )}
            <Button
              loading={isSubmitting}
              variant="coral"
              onPress={handleSubmit(publish)}
            >
              {demoMode ? "Publish Preview Plan" : "Publish Plan"}
            </Button>
            <Pressable onPress={() => setStep(0)} style={{ padding: 20 }}>
              <Text style={{ textAlign: "center", color: c.teal }}>
                Back to plan details
              </Text>
            </Pressable>
          </>
        )}
        <DemoNotice />
      </KeyboardAvoidingView>
    </Screen>
  );
}
