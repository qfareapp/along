import React, { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, Empty, Field, Header, Notice, Screen, card, text } from "../components/ui";
import type { IconName } from "./data";
import { api, demoMode } from "../services/api";
import { colors as c } from "../theme";
import { useMatchCelebration } from "../store/useMatchCelebration";
import {
  useVibeInbox, vibeWrite, type OwnVibeCheck, type OwnVibeQuestion,
  type PublicVibeCheck, type VibeInboxItem, type VibeResult, type VibeSettings,
} from "../services/vibeChecks";

const MAX_QUESTIONS = 20;
const errorMessage = (e: unknown) => e instanceof Error ? e.message : "Please try again.";
const box = { ...card, padding: 18, marginBottom: 16, gap: 12 };
const thresholdPresets = [["Easygoing", 50], ["Balanced", 70], ["Picky", 90]] as const;
function Choices({ options, value, onChange, disabled = false }: {
  options: string[]; value: number | undefined; onChange: (index: number) => void; disabled?: boolean;
}) {
  return <View style={{ gap: 8 }}>{options.map((option, index) => {
    const on = value === index;
    return <Pressable key={index} accessibilityRole="radio"
      accessibilityLabel={option} accessibilityState={{ checked: on, disabled }}
      disabled={disabled} onPress={() => onChange(index)}
      style={({ pressed }) => [st.choice, on && st.choiceOn, pressed && { opacity: 0.8 }]}>
      <View style={[st.radio, on && { borderColor: c.white }]}>{on && <View style={st.radioDot} />}</View>
      <Text style={{ flex: 1, fontSize: 14, color: on ? c.white : c.charcoal, fontWeight: on ? "600" : "400" }}>{option}</Text>
    </Pressable>;
  })}</View>;
}
function SettingRow({ icon, title, description, children }: { icon: IconName; title: string; description?: string; children?: ReactNode }) {
  return <View style={st.row}>
    <View style={st.rowIcon}><Ionicons name={icon} size={18} color={c.teal} /></View>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={text.label}>{title}</Text>
      {!!description && <Text style={text.muted}>{description}</Text>}
    </View>
    {children}
  </View>;
}
function Progress({ value, color = c.teal }: { value: number; color?: string }) {
  return <View style={st.track}><View style={[st.fill, { width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }]} /></View>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <View style={st.stat}>
    <Text style={{ color: c.white, fontSize: 18, fontWeight: "700" }}>{value}</Text>
    <Text style={{ color: "#CFE3E0", fontSize: 11 }}>{label}</Text>
  </View>;
}
function PrivateAnswer({ missing }: { missing: boolean }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <Ionicons name="lock-closed" size={13} color={missing ? c.coralBright : c.muted} />
    <Text style={[text.muted, missing && { color: c.coralBright, fontWeight: "600" }]}>
      {missing ? "Pick your private answer" : "Your private answer · only you can see this"}
    </Text>
  </View>;
}

export default function VibeCheck({ target, initialTab, fromOnboarding = false }: { target?: string; initialTab?: string; fromOnboarding?: boolean }) {
  return target ? <TakeVibeCheck target={target} /> : <ManageVibeCheck initialTab={initialTab} fromOnboarding={fromOnboarding} />;
}
function ManageVibeCheck({ initialTab, fromOnboarding }: { initialTab?: string; fromOnboarding: boolean }) {
  const [tab, setTab] = useState(initialTab === "requests" ? "requests" : "setup");
  const [message, setMessage] = useState("");
  const mine = useQuery({
    queryKey: ["vibe-checks", "mine"],
    queryFn: () => api<OwnVibeCheck>("/vibe-checks/mine"), enabled: !demoMode, retry: false,
  });
  const unread = useVibeInbox().data?.filter(item => !item.readAt).length ?? 0;
  const tabs = [["setup", "My questions", "list"], ["requests", "Results & requests", "heart"]] as const;
  return <Screen><Header title="Your Vibe Check" back subtitle="Shared choices. A new way to say hello." />
    {fromOnboarding && <View style={{ marginBottom: 16, gap: 10 }}>
      <Notice>Vibe Check is optional. Save your questions to continue, or come back from Profile anytime.</Notice>
      <Button variant="outline" onPress={() => router.replace("/(tabs)")}>Later</Button>
    </View>}
    <View style={st.segment}>{tabs.map(([key, label, icon]) => {
      const on = tab === key;
      return <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
        onPress={() => { setTab(key); setMessage(""); }} style={[st.segmentItem, on && st.segmentOn]}>
        <Ionicons name={on ? icon : `${icon}-outline`} size={16} color={on ? c.white : c.teal} />
        <Text numberOfLines={1} style={{ color: on ? c.white : c.teal, fontWeight: "600", fontSize: 13 }}>{label}</Text>
        {key === "requests" && unread > 0 && <View style={st.badge}><Text style={st.badgeText}>{unread}</Text></View>}
      </Pressable>;
    })}</View>
    {!!message && <Notice>{message}</Notice>}
    {demoMode ? <Notice>Sign in to set up your own Vibe Check.</Notice> : tab === "requests" ? <VibeInbox onSetup={() => setTab("setup")} /> :
      mine.data ? <VibeEditor key={mine.data.settings.revision} data={mine.data} onSaved={() => {
        if (fromOnboarding) router.replace("/(tabs)");
        else setMessage("Your Vibe Check is saved.");
      }} /> :
      mine.isPending ? <ActivityIndicator color={c.teal} /> : <Empty title="Couldn't load your Vibe Check" description={mine.error?.message ?? ""}>
        <Button onPress={() => void mine.refetch()}>Try again</Button>
      </Empty>}
  </Screen>;
}
function VibeEditor({ data, onSaved }: { data: OwnVibeCheck; onSaved: () => void }) {
  const client = useQueryClient();
  const [settings, setSettings] = useState<VibeSettings>(data.settings);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "selected">("all");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [answer, setAnswer] = useState(-1);
  const selected = settings.questions;
  const required = Math.ceil(selected.length * settings.threshold / 100);
  const unanswered = selected.filter(q => q.answer < 0).length;
  const presets = filter === "all" ? data.presets : data.presets.filter(p => selected.some(q => q.id === p.id));
  function updateQuestion(id: string, change: Partial<OwnVibeQuestion>) {
    setSettings(old => ({ ...old, questions: old.questions.map(q => q.id === id ? { ...q, ...change } : q) }));
  }
  function toggle(q: OwnVibeQuestion) {
    if (!selected.some(s => s.id === q.id) && selected.length >= MAX_QUESTIONS) {
      setError(`Choose up to ${MAX_QUESTIONS} questions in total.`); return;
    }
    setError("");
    setSettings(old => ({ ...old, questions: old.questions.some(s => s.id === q.id)
      ? old.questions.filter(s => s.id !== q.id) : [...old.questions, q] }));
  }
  const setThreshold = (threshold: number) => setSettings(old => ({ ...old, threshold: Math.min(100, Math.max(0, Math.round(threshold))) }));
  async function save() {
    if (busy) return;
    if (settings.enabled && !selected.length) { setError("Choose at least one question."); return; }
    if (unanswered) { setError("Choose your private answer for every selected question."); return; }
    setBusy(true); setError("");
    try {
      await vibeWrite("/mine", settings, "PUT");
      await Promise.all(["vibe-checks", "discovery", "member-profile"].map(key => client.invalidateQueries({ queryKey: [key] })));
      onSaved();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <LinearGradient colors={["#1A6065", "#08484F"]} style={st.hero}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={st.heroIcon}><Ionicons name="sparkles" size={20} color={c.peach} /></View>
        <Text style={{ flex: 1, color: c.white, fontSize: 22, fontWeight: "700", letterSpacing: -0.5 }}>Make it yours</Text>
        <View style={[st.pill, { backgroundColor: settings.enabled ? "#2E8A7C" : "rgba(255,255,255,0.14)" }]}>
          <View style={[st.dot, { backgroundColor: settings.enabled ? "#9BF0C8" : "#C9D6D4" }]} />
          <Text style={{ color: c.white, fontSize: 11, fontWeight: "600" }}>{settings.enabled ? "Live" : "Hidden"}</Text>
        </View>
      </View>
      <Text style={{ color: "#DCEBE8", fontSize: 14, lineHeight: 21 }}>Pick up to {MAX_QUESTIONS} questions and choose your private answers. Visitors answer without seeing your choices. Likes still work as usual.</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat label="Questions" value={`${selected.length}/${MAX_QUESTIONS}`} />
        <Stat label="To pass" value={`${settings.threshold}%`} />
        <Stat label="On pass" value={settings.autoMatch ? "Match" : "Request"} />
      </View>
    </LinearGradient>

    <View style={box}>
      <SettingRow icon="eye-outline" title="Show Vibe Check on my profile" description="Visitors see a Vibe Check button on Discover and your profile.">
        <Switch accessibilityLabel="Enable my Vibe Check" value={settings.enabled} disabled={busy}
          trackColor={{ true: c.teal, false: c.line }} thumbColor={c.white}
          onValueChange={enabled => setSettings(old => ({ ...old, enabled }))} />
      </SettingRow>
      <View style={st.divider} />
      <SettingRow icon="speedometer-outline" title={`Match threshold: ${settings.threshold}%`}
        description={selected.length ? `${required} of ${selected.length} matching answers needed.` : "Select questions to preview your cutoff."}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Lower threshold by 1%" disabled={busy || settings.threshold === 0}
            onPress={() => setThreshold(settings.threshold - 1)} style={[st.step, settings.threshold === 0 && { opacity: 0.4 }]}>
            <Ionicons name="remove" size={18} color={c.teal} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Raise threshold by 1%" disabled={busy || settings.threshold === 100}
            onPress={() => setThreshold(settings.threshold + 1)} style={[st.step, settings.threshold === 100 && { opacity: 0.4 }]}>
            <Ionicons name="add" size={18} color={c.teal} />
          </Pressable>
        </View>
      </SettingRow>
      <Slider accessibilityLabel="Vibe match threshold" minimumValue={0} maximumValue={100} step={1}
        style={{ height: 44 }} value={settings.threshold} disabled={busy}
        minimumTrackTintColor={c.teal} maximumTrackTintColor={c.line} thumbTintColor={c.coralBright}
        onValueChange={setThreshold} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {thresholdPresets.map(([label, value]) => <Chip key={label} selected={settings.threshold === value}
          onPress={busy ? undefined : () => setThreshold(value)}>{label} · {value}%</Chip>)}
      </View>
      {selected.length > 0 && <View style={st.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {selected.map((q, index) => <View key={q.id} style={[st.cutDot, index < required && { backgroundColor: c.coralBright, borderColor: c.coralBright }]} />)}
      </View>}
      {settings.threshold === 0 && <Text style={text.muted}>Everyone who completes your check passes.</Text>}
      <View style={st.divider} />
      <SettingRow icon="flash-outline" title="Automatically match with people who pass" description={settings.autoMatch
        ? "By enabling this, you agree to match and unlock chat with eligible members who pass."
        : "People who pass send a request. You choose whether to accept and unlock chat."}>
        <Switch accessibilityLabel="Automatically match with people who pass" value={settings.autoMatch} disabled={busy}
          trackColor={{ true: c.teal, false: c.line }} thumbColor={c.white}
          onValueChange={autoMatch => setSettings(old => ({ ...old, autoMatch }))} />
      </SettingRow>
      <View style={st.fineprint}>
        <Ionicons name="time-outline" size={15} color={c.muted} />
        <Text style={[text.muted, { flex: 1, fontSize: 12, lineHeight: 18 }]}>Saving starts a new version. Previous scores remain in results, and undecided requests from an older version expire. Existing chats stay open.</Text>
      </View>
    </View>

    <View style={{ gap: 8, marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[text.title, { fontSize: 21 }]}>Choose your questions</Text>
        <Text style={[text.label, { color: selected.length >= MAX_QUESTIONS ? c.coralBright : c.teal }]}>{selected.length}/{MAX_QUESTIONS}</Text>
      </View>
      <Progress value={selected.length / MAX_QUESTIONS * 100} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6, marginBottom: 6 }}>
        <Chip selected={filter === "all"} onPress={() => setFilter("all")}>All questions</Chip>
        <Chip selected={filter === "selected"} onPress={() => setFilter("selected")}>Selected · {selected.length}</Chip>
      </View>
    </View>
    {presets.map(preset => {
      const picked = selected.find(q => q.id === preset.id);
      return <View key={preset.id} style={[box, picked && st.picked]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${picked ? "Selected" : "Add"} · ${preset.prompt}`}
          accessibilityState={{ selected: !!picked, disabled: busy }} disabled={busy}
          onPress={() => toggle({ ...preset, answer: -1 })} style={({ pressed }) => [st.questionHead, pressed && { opacity: 0.7 }]}>
          <Text style={[text.label, { flex: 1, fontSize: 15 }]}>{preset.prompt}</Text>
          <Ionicons name={picked ? "checkmark-circle" : "add-circle-outline"} size={26} color={picked ? c.teal : c.coralBright} />
        </Pressable>
        {picked ? <><PrivateAnswer missing={picked.answer < 0} /><Choices options={picked.options} value={picked.answer} disabled={busy}
          onChange={value => updateQuestion(picked.id, { answer: value })} /></> :
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {preset.options.map(option => <Text key={option} style={st.optionPreview}>{option}</Text>)}
          </View>}
      </View>;
    })}
    {filter === "selected" && !selected.length && <Text style={[text.muted, { textAlign: "center", marginVertical: 12 }]}>Nothing selected yet. Tap + on a question to add it.</Text>}
    {selected.filter(q => q.id.startsWith("custom_")).map(q => <View key={q.id} style={[box, st.picked]}>
      <View style={st.questionHead}>
        <View style={st.tag}><Ionicons name="create-outline" size={12} color={c.coralBright} /><Text style={st.tagText}>Your custom question</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Remove question" disabled={busy} onPress={() => toggle(q)} style={st.step}>
          <Ionicons name="trash-outline" size={17} color="#BA4034" />
        </Pressable>
      </View>
      <Field label="Question" value={q.prompt} editable={!busy} maxLength={180} onChangeText={value => updateQuestion(q.id, { prompt: value })} />
      {q.options.map((option, index) => <Field key={index} label={`Option ${index + 1}`} value={option} editable={!busy} maxLength={80}
        onChangeText={value => updateQuestion(q.id, { options: q.options.map((o, i) => i === index ? value : o) })} />)}
      <PrivateAnswer missing={q.answer < 0} />
      <Choices options={q.options} value={q.answer} disabled={busy} onChange={value => updateQuestion(q.id, { answer: value })} />
    </View>)}

    <View style={[box, st.dashed]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={st.rowIcon}><Ionicons name="bulb-outline" size={18} color={c.coralBright} /></View>
        <Text style={[text.title, { fontSize: 19, flex: 1 }]}>Add your own</Text>
      </View>
      <Text style={text.muted}>Keep questions respectful. Avoid asking for private contact details or sensitive information.</Text>
      <Field label="Your question" placeholder="e.g. How shall we spend Sunday?" value={prompt} maxLength={180} editable={!busy} onChangeText={setPrompt} />
      {options.map((option, index) => <View key={index} style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label={`Custom option ${index + 1}`} value={option} maxLength={80} editable={!busy}
            onChangeText={value => setOptions(old => old.map((o, i) => i === index ? value : o))} />
        </View>
        {options.length > 2 && <Pressable accessibilityRole="button" accessibilityLabel={`Remove option ${index + 1}`} disabled={busy}
          onPress={() => { setOptions(old => old.filter((_, i) => i !== index)); setAnswer(-1); }} style={[st.step, { marginBottom: 20 }]}>
          <Ionicons name="close" size={17} color={c.muted} />
        </Pressable>}
      </View>)}
      {options.length < 4 && <Pressable accessibilityRole="button" accessibilityLabel="Add another answer option" disabled={busy}
        onPress={() => setOptions(old => [...old, ""])} style={st.link}>
        <Ionicons name="add" size={17} color={c.teal} />
        <Text style={{ color: c.teal, fontWeight: "600" }}>Add another answer option</Text>
      </Pressable>}
      <PrivateAnswer missing={false} />
      <Choices options={options.map((o, i) => o.trim() || `Option ${i + 1}`)} value={answer} disabled={busy} onChange={setAnswer} />
      <Button variant="outline" icon="add-circle-outline" disabled={busy || selected.length >= MAX_QUESTIONS || prompt.trim().length < 5 || options.some(o => !o.trim()) || answer < 0}
        onPress={() => {
          toggle({ id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, prompt: prompt.trim(), options: options.map(o => o.trim()), answer });
          setPrompt(""); setOptions(["", ""]); setAnswer(-1);
        }}>Add custom question</Button>
    </View>

    {!!error && <View style={st.error}>
      <Ionicons name="alert-circle" size={17} color="#BA4034" />
      <Text accessibilityRole="alert" style={{ color: "#BA4034", flex: 1 }}>{error}</Text>
    </View>}
    {!!error && <Button variant="outline" disabled={busy} onPress={() => void client.invalidateQueries({ queryKey: ["vibe-checks", "mine"] })}>Reload saved questions</Button>}
    {unanswered > 0 && !error && <Text style={[text.muted, { textAlign: "center" }]}>{unanswered} selected {unanswered === 1 ? "question needs" : "questions need"} your private answer.</Text>}
    <Button icon="checkmark" loading={busy} onPress={() => void save()}>Save Vibe Check</Button>
  </View>;
}

function TakeVibeCheck({ target }: { target: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["vibe-checks", "profile", target],
    queryFn: () => api<PublicVibeCheck>(`/vibe-checks/profiles/${target}`), retry: false,
    refetchInterval: query => query.state.data?.attempt?.status === "pending" ? 10000 : false });
  return <Screen><Header title="Vibe Check" back subtitle="A few choices. A little spark." />
    {query.data ? <AnswerCheck key={query.data.revision} check={query.data} reload={() => void query.refetch()} onResult={async result => {
      client.setQueryData<PublicVibeCheck>(["vibe-checks", "profile", target], old => old ? { ...old, attempt: result } : old);
      await Promise.all(["conversations", "vibe-checks", "member-profile", "discovery"].map(key => client.invalidateQueries({ queryKey: [key] })));
      if (result.status === "matched") useMatchCelebration.getState().show({ name: query.data.owner.name, conversationId: result.conversationId });
    }} /> : query.isPending ? <ActivityIndicator color={c.teal} /> : <Empty title="Vibe Check unavailable" description={query.error?.message ?? ""}>
      <Button onPress={() => void query.refetch()}>Try again</Button>
    </Empty>}
  </Screen>;
}
const vibeGradient = ["#FF8B70", "#F25F8C", "#8E5BD9"] as const;
function AnswerTiles({ options, value, onChange, disabled }: {
  options: string[]; value: number | undefined; onChange: (index: number) => void; disabled: boolean;
}) {
  // Two options read as "this or that"; longer lists stack.
  const pair = options.length === 2;
  return <View style={pair ? { flexDirection: "row", alignItems: "stretch", gap: 8 } : { gap: 8 }}>
    {options.map((option, index) => {
      const on = value === index;
      return <React.Fragment key={index}>
        {pair && index === 1 && <View style={st.or}><Text style={st.orText}>or</Text></View>}
        <Pressable accessibilityRole="radio" accessibilityLabel={option} accessibilityState={{ checked: on, disabled }}
          disabled={disabled} onPress={() => onChange(index)}
          style={({ pressed }) => [st.tile, pair && { flex: 1 }, on && st.tileOn, pressed && { transform: [{ scale: 0.97 }] }]}>
          {on ? <LinearGradient colors={vibeGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
          <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={20} color={on ? c.white : "#CDBFB3"} />
          <Text style={[st.tileText, pair && { textAlign: "center" }, on && { color: c.white, fontWeight: "700" }]}>{option}</Text>
        </Pressable>
      </React.Fragment>;
    })}
  </View>;
}
const outcomes: Record<VibeResult["status"], { icon: IconName; title: string; body: string }> = {
  matched: { icon: "heart", title: "Your vibes matched!", body: "Say hello while the spark is fresh." },
  pending: { icon: "hourglass", title: "You passed!", body: "Your match request is waiting for their response." },
  declined: { icon: "leaf", title: "Not this time", body: "They declined this request. Thanks for giving it a try." },
  superseded: { icon: "refresh", title: "Questions changed", body: "This version has changed. Open their profile for the current check." },
  failed: { icon: "compass", title: "Different wavelengths", body: "You didn't reach this cutoff. Shared choices are only one way to connect; you can still send a like." },
};
function AnswerCheck({ check, onResult, reload }: { check: PublicVibeCheck; onResult: (result: VibeResult) => Promise<void>; reload: () => void }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const result = check.attempt;
  const conversationId = check.conversationId ?? result?.conversationId;
  const total = check.questions.length;
  const answered = Object.keys(answers).length;
  const needed = Math.ceil(total * check.threshold / 100);
  async function submit() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const outcome = await vibeWrite<VibeResult>(`/profiles/${check.owner.id}/attempt`, {
        revision: check.revision, answers: check.questions.map(q => ({ id: q.id, choice: answers[q.id] })),
      });
      await onResult(outcome);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const outcome = result ? outcomes[result.status] : null;
  return <View style={{ gap: 14 }}>
    <LinearGradient colors={vibeGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.visitHero}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={st.visitAvatar}><Text style={{ color: "#F25F8C", fontSize: 20, fontWeight: "800" }}>{check.owner.name.charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.white, fontSize: 21, fontWeight: "800", letterSpacing: -0.4 }}>{check.owner.name}&apos;s Vibe Check</Text>
          <Text style={{ color: "#FFE9EF", fontSize: 13 }}>Pick what feels most like you.</Text>
        </View>
        <Ionicons name="sparkles" size={24} color={c.white} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[[`${total}`, "questions"], [`${needed}/${total}`, "to pass"], [check.autoMatch ? "Instant" : "Request", "on pass"]].map(([value, label]) =>
          <View key={label} style={st.visitStat}>
            <Text style={{ color: c.white, fontSize: 17, fontWeight: "800" }}>{value}</Text>
            <Text style={{ color: "#FFE9EF", fontSize: 11 }}>{label}</Text>
          </View>)}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="lock-closed" size={13} color="#FFE9EF" />
        <Text style={{ color: "#FFE9EF", fontSize: 12, lineHeight: 17, flex: 1 }}>
          {check.autoMatch ? "Pass to match and unlock chat automatically." : "Pass to send a match request. Chat opens after they accept."} One attempt per version. Their answers stay private.
        </Text>
      </View>
    </LinearGradient>

    {result && outcome ? <View style={[box, { alignItems: "center", paddingVertical: 26 }]}>
      <LinearGradient colors={result.passed ? vibeGradient : ["#C9C2BB", "#9C948D"]} style={st.resultIcon}>
        <Ionicons name={outcome.icon} size={30} color={c.white} />
      </LinearGradient>
      <Text style={[st.eyebrow, { color: result.passed ? "#F25F8C" : c.muted }]}>{outcome.title}</Text>
      <Text style={[text.title, { textAlign: "center" }]}>{result.score}% shared choices</Text>
      <View style={[st.dots, { justifyContent: "center" }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: result.total }, (_, i) => <View key={i} style={[st.resultDot, i < result.matches && { backgroundColor: "#F25F8C", borderColor: "#F25F8C" }]} />)}
      </View>
      <Text style={text.muted}>{result.matches} of {result.total} answers matched.</Text>
      <Text style={[text.body, { textAlign: "center" }]}>{outcome.body}</Text>
      <View style={{ alignSelf: "stretch", gap: 10, marginTop: 6 }}>
        {conversationId && <Button icon="chatbubble-ellipses-outline" onPress={() => router.push(`/conversation?id=${conversationId}`)}>Open chat</Button>}
        <Button variant="outline" icon="person-outline" onPress={() => router.push(`/person?id=${check.owner.id}`)}>Back to profile</Button>
      </View>
    </View> : conversationId ? <Button icon="chatbubble-ellipses-outline" onPress={() => router.push(`/conversation?id=${conversationId}`)}>You already matched · Open chat</Button> : <>
      <View style={[box, { gap: 8, paddingVertical: 14 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={text.label}>{answered === total ? "All answered. Nice!" : "Your progress"}</Text>
          <Text style={[text.label, { color: "#F25F8C" }]}>{answered}/{total}</Text>
        </View>
        <Progress value={total ? answered / total * 100 : 0} color="#F25F8C" />
      </View>
      {check.questions.map((q, index) => {
        const done = answers[q.id] !== undefined;
        return <View key={q.id} style={[box, done && { borderColor: "#F6B9CB" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {done ? <LinearGradient colors={vibeGradient} style={st.qNumber}><Ionicons name="checkmark" size={16} color={c.white} /></LinearGradient>
              : <View style={[st.qNumber, st.qNumberIdle]}><Text style={{ color: "#F25F8C", fontWeight: "800" }}>{index + 1}</Text></View>}
            <Text style={[st.eyebrow, { color: c.muted }]}>Question {index + 1} of {total}</Text>
          </View>
          <Text style={[text.title, { fontSize: 19 }]}>{q.prompt}</Text>
          <AnswerTiles options={q.options} value={answers[q.id]} disabled={busy} onChange={choice => setAnswers(old => ({ ...old, [q.id]: choice }))} />
        </View>;
      })}
      <Text style={[text.muted, { textAlign: "center" }]}>{answered === total ? "Check your choices, then send them off." : `${total - answered} to go. Check your choices before submitting.`}</Text>
      <Button variant="coral" icon="sparkles" disabled={answered !== total} loading={busy} onPress={() => void submit()}>Submit Vibe Check</Button>
      <Pressable accessibilityRole="button" accessibilityLabel="Report a question" onPress={() => router.push(`/safety?target=${check.owner.id}`)} style={[st.link, { alignSelf: "center" }]}>
        <Ionicons name="flag-outline" size={15} color={c.muted} />
        <Text style={{ color: c.muted, fontWeight: "600" }}>Report a question</Text>
      </Pressable>
    </>}
    {!!error && <View style={st.error}>
      <Ionicons name="alert-circle" size={17} color="#BA4034" />
      <Text accessibilityRole="alert" style={{ color: "#BA4034", flex: 1 }}>{error}</Text>
    </View>}
    {!!error && <Button variant="outline" onPress={reload}>Reload current check</Button>}
  </View>;
}
const statusStyle: Record<VibeResult["status"], { label: string; color: string; bg: string }> = {
  matched: { label: "Matched", color: c.green, bg: "#E3F1EC" },
  pending: { label: "Awaiting response", color: "#C4503E", bg: "#FDE8E2" },
  failed: { label: "Didn't pass", color: c.muted, bg: c.soft },
  declined: { label: "Declined", color: c.muted, bg: c.soft },
  superseded: { label: "Questions changed", color: c.muted, bg: c.soft },
};
function InboxCard({ item, busy, act }: { item: VibeInboxItem; busy: string | null; act: (id: string, accept?: boolean) => void }) {
  const status = item.status === "pending" && item.incoming ? { ...statusStyle.pending, label: "Needs your response" } : statusStyle[item.status];
  return <View style={[box, !item.readAt && { borderColor: c.coral }]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={st.initial}><Text style={{ color: c.white, fontWeight: "700", fontSize: 17 }}>{item.member.name.charAt(0).toUpperCase()}</Text></View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={text.label}>{item.member.name}</Text>
          {!item.readAt && <View style={[st.dot, { backgroundColor: c.coralBright }]} />}
        </View>
        <Text style={text.muted}>{item.incoming ? "Took your Vibe Check" : "You took their Vibe Check"}</Text>
      </View>
      <Text style={{ fontSize: 22, fontWeight: "800", color: item.passed ? c.teal : c.muted }}>{item.score}%</Text>
    </View>
    <Progress value={item.score} color={item.passed ? c.teal : "#C9C2BB"} />
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text style={text.muted}>{item.matches}/{item.total} shared choices</Text>
      <View style={[st.pill, { backgroundColor: status.bg }]}><Text style={{ color: status.color, fontSize: 11, fontWeight: "700" }}>{status.label}</Text></View>
    </View>
    {item.status === "pending" && item.incoming && <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 1 }}><Button variant="outline" disabled={!!busy} onPress={() => act(item.id, false)}>Decline</Button></View>
      <View style={{ flex: 2 }}><Button icon="chatbubbles-outline" disabled={!!busy} loading={busy === item.id} onPress={() => act(item.id, true)}>Accept & open chat</Button></View>
    </View>}
    {item.conversationId && <Button icon="chatbubble-ellipses-outline" disabled={!!busy} onPress={() => { act(item.id); router.push(`/conversation?id=${item.conversationId}`); }}>Open chat</Button>}
    {!item.readAt && <Pressable accessibilityRole="button" accessibilityLabel="Mark as read" disabled={!!busy} onPress={() => act(item.id)} style={[st.link, { alignSelf: "center" }]}>
      <Ionicons name="checkmark-done" size={16} color={c.teal} />
      <Text style={{ color: c.teal, fontWeight: "600" }}>Mark as read</Text>
    </Pressable>}
  </View>;
}
function VibeInbox({ onSetup }: { onSetup: () => void }) {
  const inbox = useVibeInbox(true), client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function act(id: string, accept?: boolean) {
    if (busy) return;
    setBusy(id); setError("");
    try {
      if (accept === undefined) await vibeWrite(`/attempts/${id}/read`);
      else {
        const result = await vibeWrite<VibeResult>(`/attempts/${id}/decision`, { accept });
        if (result.conversationId) router.push(`/conversation?id=${result.conversationId}`);
      }
      await Promise.all(["vibe-checks", "conversations", "member-profile"].map(key => client.invalidateQueries({ queryKey: [key] })));
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }
  const items = inbox.data ?? [];
  const waiting = items.filter(item => item.incoming && item.status === "pending");
  const rest = items.filter(item => !waiting.includes(item));
  return <View style={{ gap: 12 }}>
    <Text style={text.muted}>Passing requests and your results appear here. New matches also appear in Chat.</Text>
    {!!error && <View style={st.error}>
      <Ionicons name="alert-circle" size={17} color="#BA4034" />
      <Text accessibilityRole="alert" style={{ color: "#BA4034", flex: 1 }}>{error}</Text>
    </View>}
    {inbox.isPending ? <ActivityIndicator color={c.teal} /> : inbox.error ? <Notice>{inbox.error.message}</Notice> : !items.length ?
      <Empty icon="heart-circle-outline" title="No Vibe Checks yet" description="Add your questions or try one from Discover.">
        <Button variant="outline" icon="list-outline" onPress={onSetup}>Set up my questions</Button>
      </Empty> : <>
        {waiting.length > 0 && <Text style={st.section}>Waiting for you · {waiting.length}</Text>}
        {waiting.map(item => <InboxCard key={item.id} item={item} busy={busy} act={(id, accept) => void act(id, accept)} />)}
        {waiting.length > 0 && rest.length > 0 && <Text style={st.section}>Recent</Text>}
        {rest.map(item => <InboxCard key={item.id} item={item} busy={busy} act={(id, accept) => void act(id, accept)} />)}
      </>}
    <Button variant="outline" icon="refresh" loading={inbox.isRefetching} onPress={() => void inbox.refetch()}>Refresh results</Button>
  </View>;
}
const st = StyleSheet.create({
  choice: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.white },
  choiceOn: { borderColor: c.teal, backgroundColor: c.teal },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#CDBFB3", alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.white },
  segment: { flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: c.soft, marginBottom: 18, gap: 4 },
  segmentItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 4, borderRadius: 12 },
  segmentOn: { backgroundColor: c.teal },
  badge: { position: "absolute", top: -4, right: -2, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, borderWidth: 2, borderColor: c.soft, backgroundColor: c.coralBright, alignItems: "center", justifyContent: "center" },
  badgeText: { color: c.white, fontSize: 11, fontWeight: "700" },
  hero: { borderRadius: 22, padding: 18, gap: 12, marginBottom: 4 },
  heroIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  stat: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.1)", gap: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 2 },
  step: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.line, backgroundColor: c.white, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  cutDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: "#D9CBBF", backgroundColor: c.white },
  fineprint: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, backgroundColor: c.soft },
  track: { height: 6, borderRadius: 3, backgroundColor: c.line, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  picked: { borderColor: c.teal, borderWidth: 1.5 },
  questionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  optionPreview: { fontSize: 12, color: c.muted, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.soft, overflow: "hidden" },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#FDE8E2" },
  tagText: { color: c.coralBright, fontSize: 12, fontWeight: "600" },
  dashed: { borderStyle: "dashed", borderColor: c.peach, borderWidth: 1.5, shadowOpacity: 0, elevation: 0 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  error: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, backgroundColor: "#FBE9E6" },
  initial: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.coral, alignItems: "center", justifyContent: "center" },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, color: c.muted, textTransform: "uppercase", marginTop: 4 },
  visitHero: { borderRadius: 24, padding: 18, gap: 14 },
  visitAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: c.white, alignItems: "center", justifyContent: "center" },
  visitStat: { flex: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", gap: 1 },
  qNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  qNumberIdle: { backgroundColor: "#FDE8EF" },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  tile: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.white, overflow: "hidden" },
  tileOn: { borderColor: "#F25F8C" },
  tileText: { flexShrink: 1, fontSize: 14, color: c.charcoal, fontWeight: "500" },
  or: { alignSelf: "center", width: 28, height: 28, borderRadius: 14, backgroundColor: c.soft, alignItems: "center", justifyContent: "center", marginHorizontal: -4 },
  orText: { fontSize: 11, fontWeight: "700", color: c.muted },
  resultIcon: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  resultDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: "#D9CBBF", backgroundColor: c.white },
});
