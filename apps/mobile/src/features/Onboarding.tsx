import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Field, Header, Notice, Screen, text } from "../components/ui";
import { useCategories } from "../services/categories";
import { colors as c } from "../theme";
import { useAlong } from "../store/useAlong";
import { demoMode } from "../services/api";
import DateTimeField from "../components/DateTimeField";
import { adultBirthDateLimit } from "../components/dateTime";

export default function Onboarding() {
  const { categories } = useCategories();
  const store = useAlong();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(store.preferences);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  function finish() {
    const d = new Date(`${date}T00:00:00Z`);
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(now.getFullYear() - 18, now.getMonth(), now.getDate()),
    );
    if (name.trim().length < 2) {
      setError("Please enter your name.");
      return;
    }
    if (
      Number.isNaN(d.getTime()) ||
      d.toISOString().slice(0, 10) !== date ||
      d > cutoff ||
      d.getFullYear() < 1906
    ) {
      setError(
        "Enter a valid date of birth (YYYY-MM-DD). Along is for adults 18+.",
      );
      return;
    }
    if (!demoMode) {
      router.replace("/auth?mode=register");
      return;
    }
    store.update({ preferences: selected, name: name.trim(), welcomed: true });
    router.replace("/(tabs)");
  }
  return (
    <Screen>
      <Header back />
      <View
        style={{
          height: 5,
          backgroundColor: "#F2E6DD",
          borderRadius: 3,
          marginHorizontal: 70,
          marginTop: -45,
          marginBottom: 46,
        }}
      >
        <View
          style={{
            width: step === 0 ? "50%" : "100%",
            height: 5,
            backgroundColor: c.coralBright,
            borderRadius: 3,
          }}
        />
      </View>
      <Text style={[text.title, { textAlign: "center", fontSize: 24 }]}>
        {step === 0 ? "What brings you to Along?" : "A little about you"}
      </Text>
      <Text
        style={[
          text.muted,
          { textAlign: "center", marginTop: 8, marginBottom: 24 },
        ]}
      >
        {step === 0
          ? "You can choose multiple options."
          : "Good connections start with being yourself."}
      </Text>
      {step === 0 ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {categories.map((category, i) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected: selected.includes(category.id),
                }}
                key={category.id}
                onPress={() =>
                  setSelected((prev) =>
                    prev.includes(category.id)
                      ? prev.filter((v) => v !== category.id)
                      : [...prev, category.id],
                  )
                }
                style={{
                  width: "48%",
                  flexGrow: 1,
                  height: 116,
                  backgroundColor: selected.includes(category.id)
                    ? "#F6DFD0"
                    : "#FBEDE2",
                  borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: selected.includes(category.id)
                    ? c.coral
                    : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <Ionicons
                  name={category.icon}
                  size={34}
                  color={i % 3 === 1 ? c.coralBright : c.teal}
                />
                <Text
                  style={{
                    color: c.charcoal,
                    textAlign: "center",
                    fontSize: 14,
                  }}
                >
                  {category.name}
                </Text>
                {selected.includes(category.id) && (
                  <Ionicons
                    name="checkmark-circle"
                    color={c.coralBright}
                    size={18}
                    style={{ position: "absolute", top: 8, right: 8 }}
                  />
                )}
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 25 }}>
            <Button disabled={!selected.length} onPress={() => setStep(1)}>
              Continue
            </Button>
          </View>
        </>
      ) : (
        <>
          <Field
            label="Your first name"
            value={name}
            onChangeText={setName}
            placeholder="What should we call you?"
            maxLength={60}
          />
          <DateTimeField
            label="Date of birth"
            mode="date"
            value={date}
            onChange={setDate}
            maximumDate={adultBirthDateLimit()}
          />
          <Notice>
            Your date of birth stays private. You must be at least 18 to use
            Along.
          </Notice>
          <Notice>
            Practical help and shared plans never imply romantic consent. Always
            ask, respect boundaries and meet in public.
          </Notice>
          {error ? (
            <Text
              accessibilityRole="alert"
              style={{ color: "#BA4034", marginVertical: 12 }}
            >
              {error}
            </Text>
          ) : null}
          <Button onPress={finish}>
            {demoMode ? "Start Exploring" : "Create Your Account"}
          </Button>
          <Pressable onPress={() => setStep(0)} style={{ padding: 20 }}>
            <Text style={{ textAlign: "center", color: c.teal }}>
              Back to interests
            </Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
