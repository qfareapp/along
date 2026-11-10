"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Shapes, ShieldCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, json } from "@/lib/api";
import type { Category } from "@/lib/types";
import { Badge, Empty, ErrorState, Loading, PageHeading } from "./common";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
const blank = {
  name: "",
  slug: "",
  description: "",
  coverAssetKey: "coffee",
  coverImageUrl: "",
  icon: "sparkles-outline",
  active: true,
  displayOrder: 0,
  cities: "",
  riskLevel: "low",
  moderationRequired: false,
};
export function Categories() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Category | null>(null);
  const [form, setForm] = useState(blank);
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/categories"),
  });
  const mutation = useMutation({
    mutationFn: () =>
      api(selected ? `/categories/${selected._id}` : "/categories", {
        method: selected ? "PATCH" : "POST",
        body: json({
          ...form,
          ...(selected ? { slug: undefined } : {}),
          cities: form.cities
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          reason,
        }),
      }),
    onSuccess: async () => {
      toast.success(
        "Category saved. Mobile discovery will refresh from the same API.",
      );
      setOpen(false);
      await client.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => toast.error(e.message),
  });
  function edit(item?: Category) {
    setSelected(item ?? null);
    setForm(
      item
        ? {
            name: item.name,
            slug: item.slug,
            description: item.description ?? "",
            coverAssetKey: item.coverAssetKey ?? "coffee",
            coverImageUrl: item.coverImageUrl ?? "",
            icon: item.icon,
            active: item.active,
            displayOrder: item.displayOrder ?? 0,
            cities: (item.cities ?? []).join(", "),
            riskLevel: item.riskLevel ?? "low",
            moderationRequired: item.moderationRequired ?? false,
          }
        : blank,
    );
    setReason("");
    setOpen(true);
  }
  return (
    <>
      <PageHeading
        title="More ways to do life together."
        description="One dynamic category system, shared by the app and your team."
      >
        <Button onClick={() => edit()}>
          <Plus size={16} />
          Add category
        </Button>
      </PageHeading>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error.message} />
      ) : !query.data?.length ? (
        <div className="panel">
          <Empty>
            Create the first category, or run the existing category seed
            command.
          </Empty>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {query.data.map((item) => (
            <div className="panel p-6" key={item._id}>
              <div className="flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl bg-[#f4e6da] text-primary">
                  <Shapes size={22} />
                </div>
                <Badge value={item.active ? "active" : "disabled"} />
              </div>
              <h2 className="mt-5 text-base font-bold">{item.name}</h2>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.slug} · Order {item.displayOrder ?? 0}
              </p>
              <p className="mt-2 text-xs font-semibold text-primary">
                {item.liveCount ?? 0} live plans
              </p>
              <p className="mt-3 min-h-9 text-xs leading-5 text-muted-foreground">
                {item.description ||
                  "A little shared purpose. A new possibility."}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <ShieldCheck size={12} />
                  {item.riskLevel ?? "low"} risk
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${item.name}`}
                  onClick={() => edit(item)}
                >
                  <Pencil size={12} />
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={selected ? "Edit category" : "A new shared interest"}
        description="Disabling a category hides its existing activities and prevents new posts until reenabled."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          {(["name", "slug", "description", "icon", "cities"] as const).map(
            (key) => (
              <label
                key={key}
                className="block text-xs font-semibold capitalize"
              >
                {key === "cities"
                  ? "Cities (comma-separated; empty means all)"
                  : key}
                <input
                  className="field mt-2"
                  value={form[key]}
                  required={key === "name" || key === "slug"}
                  disabled={key === "slug" && !!selected}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, [key]: e.target.value }))
                  }
                />
              </label>
            ),
          )}
          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs font-semibold">
              Bundled category cover
              <select
                className="field mt-2"
                value={form.coverAssetKey}
                onChange={(e) =>
                  setForm((s) => ({ ...s, coverAssetKey: e.target.value }))
                }
              >
                {[
                  "coffee",
                  "commute",
                  "travel",
                  "food",
                  "shopping",
                  "fitness",
                  "movies",
                  "hobbies",
                  "sports",
                  "learning",
                  "events",
                  "culture",
                  "volunteering",
                ].map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Custom cover image (HTTPS)
              <input
                className="field mt-2"
                type="url"
                value={form.coverImageUrl}
                placeholder="https://…"
                onChange={(e) =>
                  setForm((s) => ({ ...s, coverImageUrl: e.target.value }))
                }
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Select an original bundled illustration or replace it with an image
            URL you manage. Clear the URL to use the illustration.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs font-semibold">
              Display order
              <input
                aria-label="Display order"
                type="number"
                min="0"
                max="1000"
                className="field mt-2"
                value={form.displayOrder}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    displayOrder: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold">
              Risk level
              <select
                className="field mt-2"
                value={form.riskLevel}
                onChange={(e) =>
                  setForm((s) => ({ ...s, riskLevel: e.target.value }))
                }
              >
                {["low", "medium", "high"].map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) =>
                setForm((s) => ({ ...s, active: e.target.checked }))
              }
            />
            Category enabled
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.moderationRequired}
              onChange={(e) =>
                setForm((s) => ({ ...s, moderationRequired: e.target.checked }))
              }
            />
            Require moderation
          </label>
          <label className="block text-xs font-semibold">
            Reason
            <textarea
              aria-label="Category change reason"
              required
              minLength={10}
              className="field mt-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button
            disabled={mutation.isPending || reason.trim().length < 10}
            type="submit"
          >
            {mutation.isPending ? "Saving…" : "Confirm category change"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
