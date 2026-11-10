import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  Avatar,
  Button,
  DemoNotice,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  text,
  useKeyboardVisible,
} from "../components/ui";
import { assets } from "./data";
import { useAlong } from "../store/useAlong";
import { colors as c } from "../theme";
import { demoMode } from "../services/api";
import { LiveChatList, LiveConversation } from "./LiveChat";

export function ChatList() {
  return demoMode ? <PreviewChatList /> : <LiveChatList />;
}
function PreviewChatList() {
  const { matched, blocked, messages } = useAlong();
  return (
    <Screen>
      <Header
        title="Your conversations"
        subtitle="A little hello goes a long way."
      />
      {demoMode && matched && !blocked.includes("ananya") ? (
        <>
          <Text style={[text.label, { marginTop: 15, marginBottom: 17 }]}>
            Your new connection
          </Text>
          <Pressable
            onPress={() => router.push("/conversation")}
            style={{
              flexDirection: "row",
              gap: 14,
              alignItems: "center",
              backgroundColor: "#F9EBDF",
              borderRadius: 20,
              padding: 16,
            }}
          >
            <Avatar source={assets.ananya} size={64} />
            <View style={{ flex: 1 }}>
              <Text style={text.label}>
                Ananya{" "}
                <Ionicons name="checkmark-circle" color="#1597F5" size={14} />
              </Text>
              <Text numberOfLines={1} style={[text.muted, { marginTop: 7 }]}>
                {messages.at(-1)?.text ?? "Say hello over coffee."}
              </Text>
              <Text
                style={{ fontSize: 10, color: c.coralBright, marginTop: 5 }}
              >
                Coffee after work · Preview match
              </Text>
            </View>
            <Ionicons name="chevron-forward" color={c.teal} size={19} />
          </Pressable>
        </>
      ) : (
        <Empty
          icon="chatbubbles-outline"
          title="Your next hello starts here"
          description="Conversations open after a mutual match. Explore people and shared plans to make a connection."
        >
          <Button onPress={() => router.push("/(tabs)")}>Explore People</Button>
        </Empty>
      )}
      <DemoNotice />
    </Screen>
  );
}
export function Conversation() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return demoMode ? <PreviewConversation /> : <LiveConversation id={id} />;
}
function PreviewConversation() {
  const state = useAlong();
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const keyboard = useKeyboardVisible();
  const insets = useSafeAreaInsets();
  // Home-indicator space is only needed while the keyboard is closed.
  const bottom = keyboard ? 0 : insets.bottom;
  if (!state.matched || state.blocked.includes("ananya"))
    return (
      <Screen>
        <Header back />
        <Empty
          title="Conversation unavailable"
          description="Messaging requires an active mutual match."
        />
      </Screen>
    );
  function send() {
    if (!message.trim()) return;
    state.sendMessage(message.trim());
    setMessage("");
  }
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: c.ivory }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "web" ? undefined : "padding"}
        style={{ flex: 1 }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: "#F1E6DD",
          }}
        >
          <IconButton
            icon="chevron-back"
            label="Go back"
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/chat")
            }
          />
          <Pressable
            onPress={() => router.push("/person?id=ananya")}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
            }}
          >
            <Avatar source={assets.ananya} size={40} />
            <View>
              <Text style={text.label}>Ananya</Text>
              <Text style={{ fontSize: 10, color: c.muted, marginTop: 3 }}>
                Preview conversation
              </Text>
            </View>
          </Pressable>
          <IconButton
            icon="ellipsis-horizontal"
            label="Conversation options"
            onPress={() => setOptions(!options)}
          />
        </View>
        {options && (
          <View style={{ paddingHorizontal: 22 }}>
            <Notice>
              You’re viewing a local demo. Messages stay on this device; no
              reply is simulated.
            </Notice>
            <Button variant="outline" onPress={() => router.push("/safety")}>
              Safety & Reporting
            </Button>
            <View style={{ marginTop: 8 }}>
              <Button
                variant="outline"
                onPress={() => {
                  state.update({ matched: false });
                  router.replace("/(tabs)/chat");
                }}
              >
                Unmatch Preview
              </Button>
            </View>
          </View>
        )}
        <ScrollView
          ref={scroll}
          onContentSizeChange={() =>
            scroll.current?.scrollToEnd({ animated: true })
          }
          contentContainerStyle={{ padding: 19, paddingTop: 28 }}
        >
          <Text
            style={{
              textAlign: "center",
              color: c.muted,
              fontSize: 10,
              marginBottom: 25,
            }}
          >
            YOU CONNECTED OVER COFFEE ☕
          </Text>
          {state.messages.map((msg) => (
            <View
              key={msg.id}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                alignSelf: msg.own ? "flex-end" : "flex-start",
                maxWidth: "88%",
                marginBottom: 20,
                gap: 8,
              }}
            >
              {!msg.own && <Avatar source={assets.ananya} size={30} />}
              <View style={{ flexShrink: 1 }}>
                <View
                  style={{
                    borderRadius: 20,
                    borderBottomRightRadius: msg.own ? 5 : 20,
                    borderTopLeftRadius: msg.own ? 20 : 5,
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                    backgroundColor: msg.own ? c.coralBright : "#F5E9DF",
                  }}
                >
                  <Text
                    style={{
                      color: msg.own ? "white" : c.charcoal,
                      fontSize: 14,
                      lineHeight: 21,
                    }}
                  >
                    {msg.text}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 9,
                    color: c.muted,
                    alignSelf: msg.own ? "flex-end" : "flex-start",
                    marginTop: 6,
                    paddingHorizontal: 6,
                  }}
                >
                  {msg.time}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            padding: 15,
            paddingBottom: 15 + bottom,
            borderTopWidth: 1,
            borderTopColor: "#F1E6DD",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              flex: 1,
              borderRadius: 22,
              backgroundColor: "#F3EAE3",
              alignItems: "center",
              paddingHorizontal: 14,
            }}
          >
            <TextInput
              accessibilityLabel="Message"
              placeholder="Type a message..."
              placeholderTextColor={c.muted}
              value={message}
              onChangeText={setMessage}
              maxLength={2000}
              onSubmitEditing={send}
              style={{
                flex: 1,
                minHeight: 46,
                color: c.charcoal,
                fontSize: 13,
              }}
            />
            <Pressable
              accessibilityLabel="Add a smile"
              onPress={() => setMessage((v) => `${v} 🙂`)}
            >
              <Ionicons name="happy-outline" color={c.muted} size={21} />
            </Pressable>
          </View>
          <IconButton
            icon="paper-plane"
            label="Send message"
            color={message.trim() ? c.coralBright : c.muted}
            onPress={send}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
