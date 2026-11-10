"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState, Loading } from "@/components/common";
type Group = { _id: string | number; count: number };
type Analytics = {
  started: number;
  completed: number;
  quickStartCompletionRate: number;
  averageCompletionMs: number | null;
  eligibilityCompletionRate: number;
  readyForDiscovery: number;
  pendingVerification: number;
  dropOff: Group[];
  vibes: Group[];
  firstPlans: Group[];
  relationshipIntent: Group[];
  suppressedRelationshipCount: number;
  events: {
    _id: { name: string; step?: number; skipped?: boolean };
    count: number;
    averageDurationMs?: number;
  }[];
};
export function OnboardingAnalytics() {
  const query = useQuery({
    queryKey: ["onboarding-analytics"],
    queryFn: () => api<Analytics>("/onboarding/analytics"),
    refetchInterval: 30000,
  });
  const data = query.data;
  return (
    <section className="mt-8 rounded-3xl border border-border bg-card p-6">
      <h2 className="text-xl font-semibold text-primary">
        From a first vibe to a connection
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        All-time onboarding funnel · existing members are included when they
        start the new flow. Relationship groups smaller than five are hidden.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : (
        data && (
          <>
            <div className="my-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
              {[
                ["Started onboarding", data.started],
                ["Quick starts completed", data.completed],
                [
                  "Quick-start completion",
                  `${(data.quickStartCompletionRate * 100).toFixed(1)}%`,
                ],
                [
                  "Average completion time",
                  data.averageCompletionMs === null
                    ? "Not available"
                    : `${Math.round(data.averageCompletionMs / 1000)} seconds`,
                ],
                [
                  "Eligibility conversion",
                  `${(data.eligibilityCompletionRate * 100).toFixed(1)}%`,
                ],
                ["Pending email verification", data.pendingVerification],
                ["Ready for discovery", data.readyForDiscovery],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {[
                ["Drop-off by step", data.dropOff],
                ["Popular vibes", data.vibes],
                ["First plans", data.firstPlans],
                [
                  "Relationship intentions (aggregate)",
                  data.relationshipIntent,
                ],
              ].map(([label, values]) => (
                <div key={label as string} className="rounded-2xl bg-muted p-4">
                  <h3 className="mb-3 text-sm font-semibold">
                    {label as string}
                  </h3>
                  {(values as Group[]).length ? (
                    (values as Group[]).map((v) => (
                      <div key={String(v._id)} className="mb-3">
                        <div className="flex justify-between text-xs">
                          <span className="capitalize">
                            {String(v._id).replaceAll("_", " ")}
                          </span>
                          <span>{v.count}</span>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-background">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{
                              width: `${Math.min(100, (v.count / Math.max(data.started, 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No reportable data yet.
                    </p>
                  )}
                </div>
              ))}
            </div>
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-semibold">
                Step timing, skips and upload outcomes
              </summary>
              <div className="mt-3 space-y-2 text-xs">
                {data.events.map((v) => (
                  <p key={JSON.stringify(v._id)}>
                    {v._id.name.replaceAll("_", " ")}
                    {v._id.step ? ` · step ${v._id.step}` : ""}
                    {v._id.skipped ? " · skipped" : ""}: {v.count}
                    {v.averageDurationMs !== null &&
                    v.averageDurationMs !== undefined
                      ? ` · ${Math.round(v.averageDurationMs / 1000)}s average`
                      : ""}
                  </p>
                ))}
              </div>
            </details>
          </>
        )
      )}
    </section>
  );
}
