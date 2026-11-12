"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, Plus } from "lucide-react";
import { api, json } from "@/lib/api";
import { ErrorState, Loading, PageHeading } from "./common";
import { Button } from "./ui/button";
import { useSession } from "./shell";

const labels: Record<string, string> = {
  lifestyle: "Lifestyle & Personality",
  food: "Food & Drinks",
  travel: "Travel & Adventure",
  entertainment: "Entertainment & Hobbies",
  connection: "Relationships & Connection",
};
type Question = {
  _id: string;
  category: string;
  text: string;
  optionA: string;
  optionB: string;
  active: boolean;
  tone: string;
};
type Definition = {
  active: boolean;
  questionsPerCategory: number;
  invitationMinutes: number;
  inactivityMinutes: number;
};
type Bank = {
  questions: Question[];
  categories: string[];
  activeCount: number;
  definition: Definition;
};
const blank = {
  category: "lifestyle",
  text: "",
  optionA: "",
  optionB: "",
  active: true,
  tone: "playful",
};
export function AlongPlayAdmin() {
  const session = useSession();
  const allowed = !!session.data?.permissions.includes("settings.manage");
  const client = useQueryClient();
  const [category, setCategory] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState(false);
  const [form, setForm] = useState(blank),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Definition | null>(null),
    [settingsReason, setSettingsReason] = useState("");
  const bank = useQuery({
    queryKey: ["play-bank", category],
    queryFn: () =>
      api<Bank>(`/games/questions${category ? `?category=${category}` : ""}`),
    enabled: allowed,
  });
  async function saveQuestion() {
    setBusy(true);
    setError("");
    try {
      await api(
        selected ? `/games/questions/${selected}` : "/games/questions",
        {
          method: selected ? "PATCH" : "POST",
          body: json({ ...form, reason }),
        },
      );
      setEditing(false);
      setReason("");
      await client.invalidateQueries({ queryKey: ["play-bank"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save question.");
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings() {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      await api("/games/settings", {
        method: "PATCH",
        body: json({ ...settings, reason: settingsReason }),
      });
      setSettings(null);
      setSettingsReason("");
      await client.invalidateQueries({ queryKey: ["play-bank"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }
  if (session.isPending) return <Loading />;
  if (!allowed)
    return (
      <ErrorState message="You need settings management permission to manage Along Play." />
    );
  const definition = settings ?? bank.data?.definition;
  return (
    <div className="space-y-6">
      <PageHeading
        title="Along Play · Question Bank"
        description="Manage This or That questions. Completed games keep their original question snapshots."
      />
      {bank.isPending && <Loading />}
      {bank.error && (
        <ErrorState
          message={bank.error.message}
          retry={() => void bank.refetch()}
        />
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Gamepad2 className="text-primary" />
        <p className="text-sm">
          {bank.data?.activeCount ?? 0} active questions
        </p>
        <select
          aria-label="Filter questions by category"
          className="field max-w-xs"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {bank.data?.categories.map((key) => (
            <option key={key} value={key}>
              {labels[key]}
            </option>
          ))}
        </select>
        <Button
          onClick={() => {
            setForm(blank);
            setSelected(null);
            setEditing(true);
            setReason("");
            setError("");
          }}
        >
          <Plus size={16} /> Add question
        </Button>
      </div>
      {definition && (
        <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
          <h2 className="font-semibold">This or That settings</h2>
          <p className="text-sm text-muted-foreground">
            {definition.questionsPerCategory * 5} questions per new game.
            Existing games keep their saved configuration.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={definition.active}
              onChange={(e) =>
                setSettings({ ...definition, active: e.target.checked })
              }
            />
            Game available
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ["questionsPerCategory", "Questions per category", 1, 5],
                ["invitationMinutes", "Invitation expires (minutes)", 5, 120],
                ["inactivityMinutes", "Resume window (minutes)", 5, 120],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  className="field mt-2"
                  type="number"
                  min={min}
                  max={max}
                  value={definition[key]}
                  onChange={(e) =>
                    setSettings({
                      ...definition,
                      [key]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <input
            className="field"
            aria-label="Reason for game settings change"
            placeholder="Reason for changing settings (at least 10 characters)"
            value={settingsReason}
            onChange={(e) => setSettingsReason(e.target.value)}
          />
          <Button
            disabled={busy || !settings || settingsReason.trim().length < 10}
            onClick={() => void saveSettings()}
          >
            Save game settings
          </Button>
        </section>
      )}
      {editing && (
        <form
          className="space-y-4 rounded-2xl border border-border bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void saveQuestion();
          }}
        >
          <h2 className="font-semibold">
            {selected ? "Edit question" : "New question"}
          </h2>
          <label className="block text-sm">
            Category
            <select
              className="field mt-2"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["text", "Question", 200],
              ["optionA", "Option A", 80],
              ["optionB", "Option B", 80],
              ["tone", "Tone", 40],
            ] as const
          ).map(([key, label, maxLength]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                required
                className="field mt-2"
                maxLength={maxLength}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active question
          </label>
          <label className="block text-sm">
            Reason
            <input
              required
              minLength={10}
              maxLength={1500}
              className="field mt-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="rounded-xl bg-[#FFF8F2] p-5">
            <p className="text-xs text-muted-foreground">Player preview</p>
            <p className="my-3 font-semibold">{form.text || "Your question"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-primary p-4">
                {form.optionA || "Option A"}
              </div>
              <div className="rounded-xl border border-primary p-4">
                {form.optionB || "Option B"}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <Button disabled={busy || reason.trim().length < 10} type="submit">
              Save question
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <div className="space-y-3">
        {bank.data?.questions.map((question) => (
          <article
            key={question._id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5"
          >
            <div>
              <p className="text-xs text-muted-foreground">
                {labels[question.category]} ·{" "}
                {question.active ? "Active" : "Inactive"}
              </p>
              <h3 className="mt-2 font-semibold">{question.text}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {question.optionA} / {question.optionB}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSelected(question._id);
                setForm({
                  category: question.category,
                  text: question.text,
                  optionA: question.optionA,
                  optionB: question.optionB,
                  active: question.active,
                  tone: question.tone,
                });
                setEditing(true);
                setReason("");
              }}
            >
              Edit / deactivate
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
