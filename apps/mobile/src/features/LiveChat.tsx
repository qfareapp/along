import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  Button,
  card,
  Empty,
  Header,
  IconButton,
  Notice,
  Screen,
  text,
  useKeyboardVisible,
} from "../components/ui";
import { MemberPhoto } from "./LiveDiscover";
import {
  attachmentLabel,
  attachmentUrl,
  formatChatTime,
  formatFileSize,
  sendChatAttachment,
  sendChatMessage,
  type ChatMessage,
  type OutgoingAttachment,
  unmatch,
  useConversations,
  useThread,
  type ConversationSummary,
  type ConversationThread,
} from "../services/chat";
import { formatMonthYear } from "../components/profile";
import { colors as c } from "../theme";
import { useAppLayout } from "../components/layout";
import { ChatPlay, ChatPlayButton } from "./ChatPlay";
import { useMomentTray } from "../services/social";
import { PlanGroupList } from "./PlanGroupChat";
import { usePlanGroups } from "../services/planGroups";

export function LiveChatList() {
  const query = useConversations();
  const groups = usePlanGroups();
  const moments = useMomentTray();
  const rows = query.data ?? [];
  const fresh = rows.filter((r) => !r.lastMessage);
  const threads = rows.filter((r) => r.lastMessage);
  return (
    <Screen>
      <Header
        title="Your conversations"
        subtitle="A little hello goes a long way."
      />
      <PlanGroupList />
      {query.isPending && query.fetchStatus !== "idle" ? (
        <ActivityIndicator color={c.teal} />
      ) : query.error ? (
        <Empty
          icon="chatbubbles-outline"
          title="Couldn't load conversations"
          description={query.error.message}
        >
          <Button onPress={() => void query.refetch()}>Try Again</Button>
        </Empty>
      ) : !rows.length && !groups.data?.length ? (
        <Empty
          icon="chatbubbles-outline"
          title="Your next hello starts here"
          description="Conversations open after a mutual match or an accepted plan request. Explore people and shared plans to make a connection."
        >
          <Button onPress={() => router.push("/(tabs)")}>Explore People</Button>
        </Empty>
      ) : (
        <>
          {!!fresh.length && (
            <>
              <View style={[s.row, { gap: 8, marginTop: 8, marginBottom: 14 }]}>
                <Ionicons name="sparkles" size={15} color={c.coralBright} />
                <Text style={text.label}>New connections</Text>
                <View style={s.countPill}>
                  <Text style={s.countText}>{fresh.length}</Text>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 14, paddingRight: 8 }}
                style={{ marginHorizontal: -22, paddingHorizontal: 22 }}
              >
                {fresh.map((r) => (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Start chatting with ${r.member.name}`}
                    onPress={() => router.push(`/conversation?id=${r.id}`)}
                    style={({ pressed }) => [
                      { alignItems: "center", width: 78 },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <LinearGradient
                      colors={
                        moments.data?.some(
                          (m) => m.author.id === r.member.id && !m.viewed,
                        )
                          ? [c.coralBright, "#FFB08F"]
                          : ["#D6C8BC", "#E9DCD1"]
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.freshRing}
                    >
                      <MemberPhoto
                        id={r.member.photoId ?? undefined}
                        style={s.fresh}
                      />
                    </LinearGradient>
                    <Text
                      numberOfLines={1}
                      style={[text.label, { fontSize: 12, marginTop: 7 }]}
                    >
                      {r.member.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
          {!!threads.length && (
            <Text style={[text.label, { marginTop: 24, marginBottom: 6 }]}>
              Messages
            </Text>
          )}
          {threads.map((r) => (
            <ThreadRow key={r.id} row={r} />
          ))}
        </>
      )}
    </Screen>
  );
}
function ThreadRow({ row }: { row: ConversationSummary }) {
  const moments = useMomentTray();
  const hasMoment = moments.data?.some(
    (m) => m.author.id === row.member.id && new Date(m.expiresAt) > new Date(),
  );
  const unread = row.unread > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${row.member.name}${unread ? `, ${row.unread} unread` : ""}`}
      onPress={() => router.push(`/conversation?id=${row.id}`)}
      style={({ pressed }) => [
        card,
        s.thread,
        unread && { borderColor: "#F7B9A8" },
        pressed && { opacity: 0.75 },
      ]}
    >
      <MemberPhoto
        id={row.member.photoId ?? undefined}
        style={[
          s.threadAvatar,
          hasMoment ? { borderWidth: 3, borderColor: c.coralBright } : {},
        ]}
      />
      <View style={{ flex: 1 }}>
        <View style={[s.row, { gap: 5 }]}>
          <Text style={[text.label, { flexShrink: 1 }]} numberOfLines={1}>
            {row.member.name}
          </Text>
          {row.member.identityVerified && (
            <Ionicons name="checkmark-circle" color="#1597F5" size={14} />
          )}
          <View style={{ flex: 1 }} />
          {row.lastMessage && (
            <Text style={[s.time, unread && { color: c.coralBright }]}>
              {formatChatTime(row.lastMessage.createdAt)}
            </Text>
          )}
        </View>
        <View style={[s.row, { gap: 8, marginTop: 4 }]}>
          <Text
            numberOfLines={1}
            style={[
              text.muted,
              { flex: 1 },
              unread && { color: c.charcoal, fontWeight: "600" },
            ]}
          >
            {row.lastMessage?.own ? "You: " : ""}
            {row.lastMessage ? attachmentLabel(row.lastMessage) : ""}
          </Text>
          {unread && (
            <View style={s.unread}>
              <Text style={s.unreadText}>
                {row.unread > 9 ? "9+" : row.unread}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const STARTERS = [
  "Hey! 👋",
  "Coffee this week?",
  "What does your perfect Sunday look like?",
];
export function LiveConversation({ id }: { id?: string }) {
  const layout = useAppLayout();
  const thread = useThread(id);
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  const [confirmUnmatch, setConfirmUnmatch] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [pending, setPending] = useState<OutgoingAttachment | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const keyboard = useKeyboardVisible();
  // Home-indicator space is only needed while the keyboard is closed.
  const insets = useSafeAreaInsets();
  const bottom = keyboard ? 0 : insets.bottom;
  const data = thread.data;

  if (!data)
    return (
      <Screen>
        <Header back />
        {thread.isPending && !!id ? (
          <ActivityIndicator color={c.teal} />
        ) : (
          <Empty
            title="Conversation unavailable"
            description={
              thread.error?.message ?? "This conversation may have closed."
            }
          >
            <Button onPress={() => router.replace("/(tabs)/chat")}>
              Back to Chats
            </Button>
          </Empty>
        )}
      </Screen>
    );

  async function pickPhoto(camera: boolean) {
    setAttachMenu(false);
    setError("");
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error("Allow camera access in Settings to take a photo.");
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.85,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const photo = result.assets[0];
      if (photo.fileSize && photo.fileSize > 30 * 1024 * 1024)
        throw new Error(
          "Choose a source photo up to 30 MB. It will be compressed automatically.",
        );
      setPending({
        kind: "image",
        uri: photo.uri,
        name: photo.fileName ?? "photo.jpg",
        mimeType: photo.mimeType ?? "image/jpeg",
        size: photo.fileSize,
        file: photo.file,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open your photos.");
    }
  }
  async function pickFile() {
    setAttachMenu(false);
    setError("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "text/plain",
          "text/csv",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const doc = result.assets[0];
      if (doc.size && doc.size > 20 * 1024 * 1024)
        throw new Error("Choose a file up to 20 MB.");
      setPending({
        kind: "file",
        uri: doc.uri,
        name: doc.name,
        mimeType: doc.mimeType ?? "application/octet-stream",
        size: doc.size,
        file: doc.file,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open your files.");
    }
  }
  async function openFile(msg: ChatMessage) {
    if (!data) return;
    setError("");
    try {
      const url = await attachmentUrl(data.id, msg.id);
      if (Platform.OS === "web") window.open(url, "_blank", "noopener");
      else await Linking.openURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open this file.");
    }
  }
  async function send(textToSend = message) {
    const body = textToSend.trim();
    if ((!body && !pending) || sending || !data) return;
    setSending(true);
    setError("");
    try {
      const sent = pending
        ? await sendChatAttachment(data.id, pending, body)
        : await sendChatMessage(data.id, body);
      client.setQueryData<ConversationThread>(["conversation", data.id], (t) =>
        t && !t.messages.some((m) => m.id === sent.id)
          ? { ...t, messages: [...t.messages, sent] }
          : t,
      );
      setMessage("");
      setPending(null);
      void client.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message not sent. Try again.");
    } finally {
      setSending(false);
    }
  }
  const lastOwn = [...data.messages].reverse().find((m) => m.own);
  const member = data.member;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{
        flex: 1,
        width: "100%",
        maxWidth: 1000,
        alignSelf: "center",
        backgroundColor: c.ivory,
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "web" ? undefined : "padding"}
        style={{ flex: 1 }}
      >
        <View style={s.topBar}>
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
            accessibilityRole="button"
            accessibilityLabel={`View ${member.name}'s profile`}
            onPress={() => router.push(`/person?id=${member.id}`)}
            style={[s.row, { flex: 1, gap: 10 }]}
          >
            <MemberPhoto
              id={member.photoId ?? undefined}
              style={s.headAvatar}
            />
            <View style={{ flex: 1 }}>
              <View style={[s.row, { gap: 4 }]}>
                <Text style={text.label} numberOfLines={1}>
                  {member.name}
                </Text>
                {member.identityVerified && (
                  <Ionicons name="checkmark-circle" color="#1597F5" size={14} />
                )}
              </View>
              <Text
                style={{ fontSize: 11, color: c.coralBright, marginTop: 2 }}
              >
                {data.activityConnection
                  ? "Connected over a plan"
                  : `Matched ${formatMonthYear(data.matchedAt) ?? ""}`}
              </Text>
            </View>
          </Pressable>
          <ChatPlayButton
            conversationId={data.id}
            open={playOpen}
            onToggle={() => setPlayOpen(!playOpen)}
          />
          <IconButton
            icon="ellipsis-horizontal"
            label="Conversation options"
            onPress={() => {
              setOptions(!options);
              setConfirmUnmatch(false);
            }}
          />
        </View>
        {options && (
          <View style={[card, s.menu]}>
            <MenuRow
              icon="person-circle-outline"
              label="View profile"
              onPress={() => router.push(`/person?id=${member.id}`)}
            />
            <MenuRow
              icon="shield-checkmark-outline"
              label="Safety & reporting"
              onPress={() => router.push(`/safety?target=${member.id}`)}
            />
            {confirmUnmatch ? (
              <View style={{ padding: 14, gap: 10 }}>
                <Text style={text.body}>
                  Unmatch {member.name}? This conversation closes for both of
                  you and can’t be reopened.
                </Text>
                <View style={[s.row, { gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="outline"
                      onPress={() => setConfirmUnmatch(false)}
                    >
                      Cancel
                    </Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      onPress={() =>
                        void unmatch(data.id)
                          .then(() =>
                            client.invalidateQueries({
                              queryKey: ["conversations"],
                            }),
                          )
                          .then(() => router.replace("/(tabs)/chat"))
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      Unmatch
                    </Button>
                  </View>
                </View>
              </View>
            ) : (
              <MenuRow
                icon="heart-dislike-outline"
                label="Unmatch"
                danger
                onPress={() => setConfirmUnmatch(true)}
              />
            )}
          </View>
        )}
        <ScrollView
          ref={scroll}
          onContentSizeChange={() =>
            scroll.current?.scrollToEnd({ animated: true })
          }
          contentContainerStyle={{ padding: 19, paddingTop: 24, flexGrow: 1 }}
        >
          {!data.messages.length ? (
            <View style={s.intro}>
              <View style={s.introHeart}>
                <Ionicons name="heart" size={26} color={c.white} />
              </View>
              <Text style={[text.title, { fontSize: 22, textAlign: "center" }]}>
                {data.activityConnection
                  ? `A shared plan with ${member.name}`
                  : `You matched with ${member.name}!`}
              </Text>
              <Text style={[text.muted, { textAlign: "center" }]}>
                Break the ice. Plans are more fun with a little hello first.
              </Text>
              {data.canSend && (
                <View style={s.starters}>
                  {STARTERS.map((v) => (
                    <Pressable
                      key={v}
                      accessibilityRole="button"
                      disabled={sending}
                      onPress={() => void send(v)}
                      style={({ pressed }) => [
                        s.starter,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={{ color: c.teal, fontSize: 13 }}>{v}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <>
              <Text style={s.dayNote}>
                {data.activityConnection ? "SHARED PLAN" : "YOU MATCHED"} ·{" "}
                {formatChatTime(data.matchedAt).toUpperCase()}
              </Text>
              {data.messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    s.bubbleRow,
                    {
                      alignSelf: msg.own ? "flex-end" : "flex-start",
                      maxWidth: Math.min(560, layout.width * 0.86),
                    },
                  ]}
                >
                  {!msg.own && (
                    <MemberPhoto
                      id={member.photoId ?? undefined}
                      style={s.bubbleAvatar}
                    />
                  )}
                  <View style={{ flexShrink: 1 }}>
                    <View
                      style={[
                        s.bubble,
                        msg.own
                          ? {
                              backgroundColor: c.coralBright,
                              borderBottomRightRadius: 5,
                            }
                          : {
                              backgroundColor: "#F5E9DF",
                              borderTopLeftRadius: 5,
                            },
                        msg.attachment?.kind === "image" && s.imageBubble,
                      ]}
                    >
                      {msg.attachment?.kind === "image" && (
                        <Pressable
                          accessibilityRole="imagebutton"
                          accessibilityLabel="Open photo"
                          onPress={() => setViewing(msg.attachment!.path)}
                        >
                          <MemberPhoto
                            path={msg.attachment.path}
                            style={s.photo}
                          />
                        </Pressable>
                      )}
                      {msg.attachment?.kind === "file" && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${msg.attachment.name}`}
                          onPress={() => void openFile(msg)}
                          style={({ pressed }) => [
                            s.fileCard,
                            msg.own && {
                              backgroundColor: "rgba(255,255,255,0.18)",
                            },
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <View
                            style={[
                              s.fileIcon,
                              msg.own && { backgroundColor: c.white },
                            ]}
                          >
                            <Ionicons
                              name="document-text"
                              size={20}
                              color={c.coralBright}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              numberOfLines={1}
                              style={[
                                s.fileName,
                                { color: msg.own ? c.white : c.charcoal },
                              ]}
                            >
                              {msg.attachment.name}
                            </Text>
                            <Text
                              style={{
                                fontSize: 11,
                                color: msg.own
                                  ? "rgba(255,255,255,0.8)"
                                  : c.muted,
                              }}
                            >
                              {formatFileSize(msg.attachment.size)} · Tap to
                              open
                            </Text>
                          </View>
                          <Ionicons
                            name="download-outline"
                            size={18}
                            color={msg.own ? c.white : c.teal}
                          />
                        </Pressable>
                      )}
                      {!!msg.text && (
                        <Text
                          style={[
                            {
                              color: msg.own ? c.white : c.charcoal,
                              fontSize: 14,
                              lineHeight: 21,
                            },
                            msg.attachment?.kind === "image" && {
                              paddingHorizontal: 10,
                              paddingTop: 8,
                              paddingBottom: 4,
                            },
                            msg.attachment?.kind === "file" && { marginTop: 8 },
                          ]}
                        >
                          {msg.text}
                        </Text>
                      )}
                      {!!msg.socialMomentId && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Open shared Moment"
                          onPress={() =>
                            router.push(`/moment?id=${msg.socialMomentId}`)
                          }
                          style={{ paddingVertical: 10 }}
                        >
                          <Text
                            style={{
                              color: msg.own ? c.white : c.teal,
                              textDecorationLine: "underline",
                            }}
                          >
                            Open Moment · available for 24 hours
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    <Text
                      style={[
                        s.meta,
                        { alignSelf: msg.own ? "flex-end" : "flex-start" },
                      ]}
                    >
                      {formatChatTime(msg.createdAt)}
                      {msg.id === lastOwn?.id && msg.readAt ? " · Seen" : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </>
          )}
          <ChatPlay
            conversationId={data.id}
            canSend={data.canSend}
            name={member.name}
            open={playOpen}
            onOpen={() => setPlayOpen(true)}
            onClose={() => setPlayOpen(false)}
          />
        </ScrollView>
        {!!error && (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        )}
        {data.canSend && (attachMenu || pending) && (
          <View style={s.tray}>
            {pending ? (
              <View style={s.pending}>
                {pending.kind === "image" ? (
                  <Image source={{ uri: pending.uri }} style={s.pendingThumb} />
                ) : (
                  <View style={[s.fileIcon, { width: 46, height: 46 }]}>
                    <Ionicons
                      name="document-text"
                      size={22}
                      color={c.coralBright}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={text.label}>
                    {pending.kind === "image" ? "Photo" : pending.name}
                  </Text>
                  <Text style={[text.muted, { fontSize: 12 }]}>
                    {pending.size ? `${formatFileSize(pending.size)} · ` : ""}
                    Add a message or tap send
                  </Text>
                </View>
                <IconButton
                  icon="close-circle"
                  label="Remove attachment"
                  color={c.muted}
                  onPress={() => setPending(null)}
                />
              </View>
            ) : (
              <View style={[s.row, { gap: 10 }]}>
                {(
                  [
                    {
                      label: "Photos",
                      icon: "images",
                      color: c.coralBright,
                      onPress: () => void pickPhoto(false),
                    },
                    ...(Platform.OS === "web"
                      ? []
                      : [
                          {
                            label: "Camera",
                            icon: "camera",
                            color: c.teal,
                            onPress: () => void pickPhoto(true),
                          } as const,
                        ]),
                    {
                      label: "File",
                      icon: "document-text",
                      color: c.green,
                      onPress: () => void pickFile(),
                    },
                  ] as const
                ).map((option) => (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityLabel={`Attach from ${option.label}`}
                    onPress={option.onPress}
                    style={({ pressed }) => [
                      s.attachOption,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View
                      style={[
                        s.attachIcon,
                        { backgroundColor: option.color + "1A" },
                      ]}
                    >
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={option.color}
                      />
                    </View>
                    <Text style={s.attachLabel}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
        {data.canSend ? (
          <View style={[s.composer, { paddingBottom: 12 + bottom }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                attachMenu
                  ? "Close attachment options"
                  : "Attach a photo or file"
              }
              accessibilityState={{ expanded: attachMenu }}
              disabled={sending}
              onPress={() => setAttachMenu(!attachMenu)}
              style={({ pressed }) => [
                s.attach,
                attachMenu && { backgroundColor: c.teal },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name={attachMenu ? "close" : "add"}
                size={22}
                color={attachMenu ? c.white : c.teal}
              />
            </Pressable>
            <View style={s.inputWrap}>
              <TextInput
                accessibilityLabel="Message"
                placeholder={
                  pending ? "Add a message…" : `Message ${member.name}…`
                }
                placeholderTextColor={c.muted}
                value={message}
                onChangeText={setMessage}
                maxLength={2000}
                multiline
                onSubmitEditing={() => void send()}
                submitBehavior="submit"
                style={s.input}
              />
              <Pressable
                accessibilityLabel="Add a smile"
                onPress={() => setMessage((v) => `${v}🙂`)}
              >
                <Ionicons name="happy-outline" color={c.muted} size={21} />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={(!message.trim() && !pending) || sending}
              onPress={() => void send()}
              style={({ pressed }) => [
                s.send,
                !message.trim() && !pending && { backgroundColor: "#E9DDD3" },
                pressed && { opacity: 0.7 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color={c.white} size="small" />
              ) : (
                <Ionicons name="paper-plane" size={19} color={c.white} />
              )}
            </Pressable>
          </View>
        ) : (
          <View style={{ padding: 15, paddingBottom: 15 + bottom }}>
            <Notice>
              {data.waitingForOwner
                ? "The activity owner will send the first message. You can reply once they say hello."
                : "Messaging is restricted on your account. Contact support to appeal."}
            </Notice>
          </View>
        )}
      </KeyboardAvoidingView>
      <Modal
        visible={!!viewing}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <View style={s.viewer}>
          {!!viewing && (
            <MemberPhoto
              path={viewing}
              resizeMode="contain"
              style={{
                width: "100%",
                height: "80%",
                backgroundColor: "transparent",
              }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            onPress={() => setViewing(null)}
            style={[s.viewerClose, { top: insets.top + 12 }]}
          >
            <Ionicons name="close" size={24} color={c.white} />
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
function MenuRow({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
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
        s.menuRow,
        pressed && { backgroundColor: c.soft },
      ]}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={{ color, fontWeight: "600", flex: 1 }}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  countPill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: c.coralBright,
  },
  countText: { color: c.white, fontSize: 11, fontWeight: "700" },
  freshRing: { padding: 3, borderRadius: 40 },
  fresh: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: c.ivory,
  },
  thread: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 13,
    marginTop: 10,
  },
  threadAvatar: { width: 54, height: 54, borderRadius: 27 },
  time: { fontSize: 11, color: c.muted },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: c.white, fontSize: 11, fontWeight: "700" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1E6DD",
  },
  headAvatar: { width: 42, height: 42, borderRadius: 21 },
  menu: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  intro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  introHeart: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  starters: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  starter: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#FCF1E8",
    borderWidth: 1,
    borderColor: "#F2C4B2",
  },
  dayNote: {
    textAlign: "center",
    color: c.muted,
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 22,
  },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    maxWidth: "86%",
    marginBottom: 14,
    gap: 8,
  },
  bubbleAvatar: { width: 28, height: 28, borderRadius: 14 },
  bubble: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  meta: { fontSize: 10, color: c.muted, marginTop: 4, paddingHorizontal: 6 },
  imageBubble: { padding: 4, overflow: "hidden" },
  photo: { width: 230, height: 230, borderRadius: 16 },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 220,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FFE1D5",
    alignItems: "center",
    justifyContent: "center",
  },
  fileName: { fontSize: 13, fontWeight: "700" },
  tray: {
    marginHorizontal: 12,
    marginBottom: 2,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "#FFFCF8",
    borderWidth: 1,
    borderColor: c.line,
  },
  pending: { flexDirection: "row", alignItems: "center", gap: 12 },
  pendingThumb: { width: 46, height: 46, borderRadius: 12 },
  attachOption: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 6 },
  attachIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  attachLabel: { fontSize: 12, fontWeight: "600", color: c.charcoal },
  attach: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  viewer: {
    flex: 1,
    backgroundColor: "rgba(9,20,23,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerClose: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: "#A83229", paddingHorizontal: 18, paddingBottom: 6 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1E6DD",
  },
  inputWrap: {
    flexDirection: "row",
    flex: 1,
    borderRadius: 22,
    backgroundColor: "#F3EAE3",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    color: c.charcoal,
    fontSize: 14,
    paddingTop: 13,
    paddingBottom: 13,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: c.coralBright,
    alignItems: "center",
    justifyContent: "center",
  },
});
