import React from "react";
import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Avatar, Button, DemoNotice, Screen, text } from "../components/ui";
import { assets } from "./data";
import { colors as c } from "../theme";

export default function Match() {
  return (
    <Screen scroll={false}>
      <LinearGradient
        colors={["#FFF8F2", "#FFE7D6", "#FFF8F2"]}
        style={{ flex: 1, paddingHorizontal: 26, justifyContent: "center" }}
      >
        <View style={{ alignItems: "center", marginBottom: 20 }}>
          <Ionicons name="heart" color={c.coralBright} size={83} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 30,
            }}
          >
            <View
              style={{
                borderColor: c.coralBright,
                borderWidth: 2,
                borderRadius: 90,
                overflow: "hidden",
                transform: [{ rotate: "-5deg" }],
              }}
            >
              <Avatar source={assets.rohan} size={135} />
            </View>
            <View
              style={{
                borderColor: c.coralBright,
                borderWidth: 2,
                borderRadius: 90,
                overflow: "hidden",
                marginLeft: -12,
                transform: [{ rotate: "5deg" }],
              }}
            >
              <Avatar source={assets.ananya} size={135} />
            </View>
            <View
              style={{
                position: "absolute",
                left: 113,
                bottom: -10,
                backgroundColor: c.coral,
                borderRadius: 30,
                borderWidth: 3,
                borderColor: c.ivory,
                padding: 9,
              }}
            >
              <Ionicons name="heart" size={24} color="white" />
            </View>
          </View>
          <Text
            style={[text.title, { fontSize: 33, color: c.teal, marginTop: 42 }]}
          >
            It’s a Match!
          </Text>
          <Text style={[text.muted, { marginTop: 12, textAlign: "center" }]}>
            You and Ananya liked each other’s plan.
          </Text>
          <Text
            style={[
              text.muted,
              { marginTop: 8, textAlign: "center", fontSize: 11 },
            ]}
          >
            A simulated match for the design preview.
          </Text>
        </View>
        <View style={{ gap: 12, marginTop: 14 }}>
          <Button onPress={() => router.replace("/conversation")}>
            Send a Message
          </Button>
          <Button variant="outline" onPress={() => router.replace("/(tabs)")}>
            Keep Exploring
          </Button>
        </View>
        <DemoNotice />
      </LinearGradient>
    </Screen>
  );
}
