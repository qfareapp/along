import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Button, DemoNotice, Logo, Screen, text } from "../components/ui";
import { demoMode } from "../services/api";
import { assets } from "./data";
import { colors as c } from "../theme";
import { useAppLayout } from "../components/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Welcome() {
  const layout = useAppLayout();
  const insets = useSafeAreaInsets();
  return (
    <Screen
      width="reading"
      contentStyle={{ paddingHorizontal: 0, paddingBottom: 0 }}
    >
      <LinearGradient
        colors={["#FFF9F3", "#FDEBDD", "#FFF8F2"]}
        style={{
          minHeight: Math.max(680, layout.height - insets.top),
          paddingBottom: insets.bottom,
        }}
      >
        <View style={{ flex: 1, paddingHorizontal: 24 }}>
          <View style={{ marginTop: 16, marginBottom: 15 }}>
            <Logo large />
          </View>
          <Image
            accessibilityLabel="A couple walking through the city together"
            source={assets.welcome}
            resizeMode="contain"
            style={{ flex: 1, width: "100%", minHeight: 180, maxHeight: 350 }}
          />
          <View style={{ paddingVertical: 24 }}>
            <Text
              style={[
                text.title,
                {
                  color: c.teal,
                  textAlign: "center",
                  fontSize: 29,
                  lineHeight: 34,
                },
              ]}
            >
              Life&apos;s better with someone along.
            </Text>
            <Text
              style={[
                text.muted,
                {
                  textAlign: "center",
                  marginTop: 14,
                  fontSize: 15,
                  lineHeight: 23,
                },
              ]}
            >
              Good coffee. Random plans. Everyday adventures. Maybe even love.
            </Text>
          </View>
          <Button onPress={() => router.push("/auth?mode=register")}>
            Create account
          </Button>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/auth")}
            style={{ padding: 17 }}
          >
            <Text style={{ textAlign: "center", fontSize: 13, color: c.muted }}>
              Sign in
            </Text>
          </Pressable>
          {demoMode && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/onboarding")}
              style={{ padding: 14 }}
            >
              <Text style={{ textAlign: "center", color: c.teal }}>
                Explore the preview
              </Text>
            </Pressable>
          )}
          <Text style={[text.muted, { textAlign: "center", fontSize: 11 }]}>
            For adults 18 and over.
          </Text>
          <DemoNotice />
        </View>
      </LinearGradient>
    </Screen>
  );
}
