"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, json } from "@/lib/api";
import { ErrorState, Loading, PageHeading } from "./common";
import { Button } from "./ui/button";
type Weights = {
  romantic: number;
  activity: number;
  location: number;
  lifestyle: number;
  radiusKm: number;
  minScore: number;
  frequencyHours: number;
  expiresDays: number;
};
type Config = {
  version: number;
  value: Weights;
  history: { version: number; value: Weights; reason: string; at: string }[];
};
function MatchingForm({ config }: { config: Config }) {
  const [value, setValue] = useState(config.value);
  const [reason, setReason] = useState("");
  const client = useQueryClient();
  const sum =
    value.romantic + value.activity + value.location + value.lifestyle;
  const mutation = useMutation({
    mutationFn: () =>
      api("/matching", {
        method: "PUT",
        body: json({ version: config.version, value, reason }),
      }),
    onSuccess: async () => {
      toast.success("Configuration version saved.");
      setReason("");
      await client.invalidateQueries({ queryKey: ["matching"] });
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1.5fr_1fr]">
      <form
        className="panel space-y-6 p-7"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="flex justify-between">
          <h2 className="font-semibold">Compatibility weights</h2>
          <span className="text-xs text-muted-foreground">
            Version {config.version}
          </span>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {Object.entries(value).map(([key, number]) => (
            <label key={key} className="text-xs font-semibold">
              {
                {
                  romantic: "Romantic compatibility (%)",
                  activity: "Activity compatibility (%)",
                  location: "Location & schedule (%)",
                  lifestyle: "Lifestyle compatibility (%)",
                  radiusKm: "Maximum radius (km)",
                  minScore: "Minimum score",
                  frequencyHours: "Recommendation interval (hours)",
                  expiresDays: "Recommendation expiry (days)",
                }[key]
              }
              <input
                className="field mt-2"
                type="number"
                aria-label={key}
                value={number}
                onChange={(e) =>
                  setValue((v) => ({ ...v, [key]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
        </div>
        <p
          className={`text-xs ${sum === 100 ? "text-primary" : "text-destructive"}`}
        >
          Weights total {sum}% · must equal 100%
        </p>
        <label className="block text-xs font-semibold">
          Reason for this version
          <textarea
            aria-label="Matching change reason"
            className="field mt-2 min-h-24"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button
          disabled={
            sum !== 100 || reason.trim().length < 10 || mutation.isPending
          }
          type="submit"
        >
          {mutation.isPending ? "Saving…" : "Confirm new version"}
        </Button>
      </form>
      <div className="space-y-5">
        <div className="rounded-2xl bg-[#e9efe8] p-6">
          <ShieldCheck className="text-primary" />
          <h2 className="mt-4 text-sm font-bold">
            Some things aren’t up for adjustment.
          </h2>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Mutual consent, age eligibility, blocked accounts and safety
            restrictions can never be disabled by these settings. Existing
            matches are not rewritten. The live recommendation service is not
            implemented yet; this configuration prepares its server-owned
            settings.
          </p>
        </div>
        <div className="panel p-6">
          <h2 className="mb-4 text-sm font-semibold">Version history</h2>
          {config.history.length ? (
            [...config.history].reverse().map((item) => (
              <div
                key={item.version}
                className="mb-4 border-t border-border pt-4"
              >
                <p className="text-xs font-semibold">Version {item.version}</p>
                <p className="my-2 text-xs text-muted-foreground">
                  {item.reason}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setValue(item.value);
                    setReason("");
                    toast.info(
                      "Previous settings loaded. Add a reason and confirm to create a rollback version.",
                    );
                  }}
                >
                  <RotateCcw size={12} />
                  Use this configuration
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              The first saved version starts the history.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
export function Matching() {
  const query = useQuery({
    queryKey: ["matching"],
    queryFn: () => api<Config>("/matching"),
  });
  return (
    <>
      <PageHeading
        title="A little more in common."
        description="Versioned, explainable matching configuration. Every change leaves a clear record."
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error.message} />
      ) : (
        query.data && (
          <MatchingForm key={query.data.version} config={query.data} />
        )
      )}
    </>
  );
}
