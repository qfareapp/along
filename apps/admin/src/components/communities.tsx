"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { ErrorState, Loading } from "./common";
type Community = {
  _id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  coverImage?: string;
  rules: string;
  status: string;
  visibility: string;
  maxActivePlans: number;
  messageRateLimit: number;
  memberCount: number;
};
type Membership = {
  _id: string;
  user: { _id: string; name: string } | null;
  status: string;
  role: string;
};
type Report = {
  _id: string;
  reason: string;
  severity: string;
  status: string;
  evidenceText?: string;
  communityMessage?: string;
};
type Plan = {
  _id: string;
  title: string;
  status: string;
  startsAt: string;
  ownerState: string;
};
const initial = {
  name: "",
  slug: "",
  description: "",
  category: "hangouts",
  icon: "people-outline",
  coverImage: "",
  rules:
    "Be respectful. No harassment, spam or sharing private information. Meet in public and report unsafe behaviour.",
  status: "active",
  visibility: "public",
  maxActivePlans: 3,
  messageRateLimit: 20,
};
export function CommunityManagement() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-communities"],
    queryFn: () => api<Community[]>("/communities"),
  });
  const [selected, setSelected] = useState<Community | null>(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(initial),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tab, setTab] = useState("members"),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState("");
  const members = useQuery({
    queryKey: ["admin-community-members", selected?._id, search, cursor],
    enabled: !!selected && tab === "members",
    queryFn: () =>
      api<{ items: Membership[]; next: string | null }>(
        `/communities/${selected!._id}/members?q=${encodeURIComponent(search)}${cursor ? `&cursor=${cursor}` : ""}`,
      ),
  });
  const reports = useQuery({
    queryKey: ["admin-community-reports", selected?._id],
    enabled: !!selected && tab === "reports",
    queryFn: () => api<Report[]>(`/communities/${selected!._id}/reports`),
  });
  const plans = useQuery({
    queryKey: ["admin-community-plans", selected?._id],
    enabled: !!selected && tab === "plans",
    queryFn: () => api<Plan[]>(`/communities/${selected!._id}/plans`),
  });
  async function act(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await client.invalidateQueries({ queryKey: ["admin-communities"] });
      await client.invalidateQueries({ queryKey: ["admin-community-members"] });
      await client.invalidateQueries({ queryKey: ["admin-community-plans"] });
      await client.invalidateQueries({ queryKey: ["admin-community-reports"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function edit(item: Community | null) {
    setSelected(item);
    setEditing(true);
    setReason("");
    setError("");
    setDraft(
      item
        ? {
            name: item.name,
            slug: item.slug,
            description: item.description,
            category: item.category,
            icon: item.icon,
            coverImage: item.coverImage ?? "",
            rules: item.rules,
            status: item.status,
            visibility: item.visibility,
            maxActivePlans: item.maxActivePlans,
            messageRateLimit: item.messageRateLimit ?? 20,
          }
        : initial,
    );
  }
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Along Communities</h1>
          <p className="text-sm text-muted-foreground">
            Manage interest groups, memberships, event limits and safety.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(() => api("/communities/seed", { method: "POST" }))
            }
          >
            Set up initial communities
          </Button>
          <Button onClick={() => edit(null)}>Add community</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Initial setup adds the six Along groups and preserves any existing
        edits. Face verification is deferred; community plans use existing
        adult-account eligibility.
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {query.isPending && <Loading />}
      {query.error && (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {query.data?.map((item) => (
          <section
            key={item._id}
            className="space-y-3 rounded-2xl border bg-white p-5"
          >
            <div className="flex justify-between gap-2">
              <h2 className="font-semibold">{item.name}</h2>
              <span className="text-xs text-muted-foreground">
                {item.status} · {item.visibility}
              </span>
            </div>
            <p className="text-sm">{item.description}</p>
            <p className="text-xs text-muted-foreground">
              {item.memberCount} members · {item.maxActivePlans} active plans
              per organiser
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => edit(item)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelected(item);
                  setEditing(false);
                  setCursor("");
                  setReason("");
                }}
              >
                Manage
              </Button>
            </div>
          </section>
        ))}
      </div>
      {query.data?.length === 0 && (
        <div className="rounded-xl border p-6">
          No communities configured. Select “Set up initial communities” to add
          TravelAlong, JamAlong, MusicAlong, FoodAlong, PlayAlong and FitAlong.
        </div>
      )}
      {editing && (
        <section className="space-y-3 rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold">
            {selected ? `Edit ${selected.name}` : "Add community"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure the fields below. Cover images must use an HTTPS URL.
            Archive a community to close access.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["name", "Community name"],
                ["slug", "Short link (lowercase letters and hyphens)"],
                ["category", "Interest category"],
                ["coverImage", "Cover image URL (optional)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm font-medium">
                {label}
                <input
                  className="mt-1 w-full rounded-xl border p-3"
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                  onBlur={() => {
                    if (key === "name" && !selected && !draft.slug)
                      setDraft({
                        ...draft,
                        slug: draft.name
                          .replace(/^#/, "")
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, ""),
                      });
                  }}
                />
              </label>
            ))}
            <label className="block text-sm font-medium">
              Icon
              <select
                className="mt-1 w-full rounded-xl border p-3"
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
              >
                {[
                  ["people-outline", "People"],
                  ["airplane-outline", "Travel"],
                  ["cafe-outline", "Cafe"],
                  ["musical-notes-outline", "Music"],
                  ["restaurant-outline", "Food"],
                  ["game-controller-outline", "Gaming"],
                  ["fitness-outline", "Fitness"],
                  ["book-outline", "Books"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Status
              <select
                className="mt-1 w-full rounded-xl border p-3"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Visibility
              <select
                className="mt-1 w-full rounded-xl border p-3"
                value={draft.visibility}
                onChange={(e) =>
                  setDraft({ ...draft, visibility: e.target.value })
                }
              >
                <option value="public">Listed in the app</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Active plans per organiser
              <input
                type="number"
                min={1}
                max={50}
                className="mt-1 w-full rounded-xl border p-3"
                value={draft.maxActivePlans}
                onChange={(e) =>
                  setDraft({ ...draft, maxActivePlans: Number(e.target.value) })
                }
              />
            </label>
            <label className="block text-sm font-medium">
              Messages per member per minute
              <input
                type="number"
                min={1}
                max={60}
                className="mt-1 w-full rounded-xl border p-3"
                value={draft.messageRateLimit}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    messageRateLimit: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Description
            <textarea
              className="mt-1 min-h-24 w-full rounded-xl border p-3"
              value={draft.description}
              maxLength={1000}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label className="block text-sm font-medium">
            Community rules
            <textarea
              className="mt-1 min-h-28 w-full rounded-xl border p-3"
              value={draft.rules}
              maxLength={4000}
              onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Reason for change
            <input
              className="mt-1 w-full rounded-xl border p-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={busy || reason.trim().length < 10}
              onClick={() =>
                void act(async () => {
                  await api(
                    selected ? `/communities/${selected._id}` : "/communities",
                    {
                      method: selected ? "PATCH" : "POST",
                      body: JSON.stringify({
                        ...draft,
                        reason,
                      }),
                    },
                  );
                  setEditing(false);
                })
              }
            >
              Save community
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      {selected && !editing && (
        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold">Manage {selected.name}</h2>
          <div className="flex gap-2">
            {["members", "reports", "plans"].map((value) => (
              <Button
                key={value}
                variant={tab === value ? "default" : "outline"}
                onClick={() => setTab(value)}
              >
                {value}
              </Button>
            ))}
          </div>
          <label className="block text-sm">
            Reason for moderation (required)
            <input
              className="mt-1 w-full rounded-xl border p-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {tab === "members" && (
            <>
              <input
                aria-label="Search members"
                placeholder="Search members"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCursor("");
                }}
                className="w-full rounded-xl border p-3"
              />
              {members.error && <ErrorState message={members.error.message} />}
              {members.data?.items.map((m) => (
                <div
                  key={m._id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
                >
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">
                      {m.user?.name ?? "Deleted member"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.status} · {m.role}
                    </p>
                  </div>
                  {m.user &&
                    [
                      m.role === "moderator" ? "member" : "moderator",
                      "mute",
                      "unmute",
                      "suspend",
                      "ban",
                      "restore",
                    ].map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant="outline"
                        disabled={busy || reason.trim().length < 10}
                        onClick={() =>
                          void act(() =>
                            api(
                              `/communities/${selected._id}/members/${m.user!._id}`,
                              {
                                method: "POST",
                                body: JSON.stringify({ action, reason }),
                              },
                            ),
                          )
                        }
                      >
                        {action}
                      </Button>
                    ))}
                </div>
              ))}
              <div className="flex gap-2">
                {cursor && (
                  <Button variant="outline" onClick={() => setCursor("")}>
                    First page
                  </Button>
                )}
                {members.data?.next && (
                  <Button onClick={() => setCursor(members.data!.next!)}>
                    Next members
                  </Button>
                )}
              </div>
            </>
          )}
          {tab === "reports" && (
            <>
              {reports.error && <ErrorState message={reports.error.message} />}
              {reports.data?.map((r) => (
                <div key={r._id} className="space-y-2 rounded-xl border p-3">
                  <p className="font-medium">
                    {r.severity} · {r.status}
                  </p>
                  <p>{r.reason}</p>
                  {r.evidenceText && (
                    <blockquote className="rounded-xl bg-muted p-3 text-sm">
                      {r.evidenceText}
                    </blockquote>
                  )}
                  {r.communityMessage && (
                    <Button
                      variant="outline"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        void act(() =>
                          api(
                            `/communities/${selected._id}/messages/${r.communityMessage}/remove`,
                            {
                              method: "POST",
                              body: JSON.stringify({ reason }),
                            },
                          ),
                        )
                      }
                    >
                      Remove reported message
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
          {tab === "plans" && (
            <>
              {plans.error && <ErrorState message={plans.error.message} />}
              {plans.data?.map((p) => (
                <div
                  key={p._id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
                >
                  <div className="flex-1">
                    <p className="font-medium">{p.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(p.startsAt).toLocaleString()} · {p.status} ·{" "}
                      {p.ownerState}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      p.status === "deleted" ||
                      reason.trim().length < 10
                    }
                    onClick={() =>
                      void act(() =>
                        api(
                          `/communities/${selected._id}/plans/${p._id}/remove`,
                          { method: "POST", body: JSON.stringify({ reason }) },
                        ),
                      )
                    }
                  >
                    Remove plan
                  </Button>
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
