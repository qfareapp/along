"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { Empty, ErrorState, Loading } from "./common";
type Report = {
  id: string;
  reason: string;
  status: string;
  severity: string;
  target: { _id: string; name: string; status: string };
  createdAt: string;
};
type Review = {
  reportId: string;
  status: string;
  notes: { text: string; at: string }[];
  moment: {
    type: string;
    text: string;
    caption: string;
    status: string;
    hasPhoto: boolean;
    publishedAt: string;
    expiresAt: string;
  } | null;
};
export function SocialModeration() {
  const client = useQueryClient();
  const [page, setPage] = useState(1),
    [review, setReview] = useState<Review | null>(null),
    [reason, setReason] = useState(""),
    [accessReason, setAccessReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reports = useQuery({
    queryKey: ["social-reports", page],
    queryFn: () =>
      api<{ items: Report[]; total: number }>(`/social/reports?page=${page}`),
  });
  const metrics = useQuery({
    queryKey: ["social-metrics"],
    queryFn: () =>
      api<{
        views: number;
        reactions: number;
        replies: number;
        plans: number;
        reports: number;
        removed: number;
        dailyViewers: number;
        distribution: { _id: string; count: number }[];
      }>("/social/analytics"),
    retry: false,
  });
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      setReview(
        await api<Review>(
          `/social/reports/${id}?reason=${encodeURIComponent(reason)}`,
        ),
      );
      setAccessReason(reason);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function moderate(action: string) {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      await api(`/social/reports/${review.reportId}/moderate`, {
        method: "POST",
        body: JSON.stringify({ action, reason }),
      });
      setReview(null);
      await client.invalidateQueries({ queryKey: ["social-reports"] });
      void client.invalidateQueries({ queryKey: ["social-metrics"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">TRUST & SAFETY</p>
        <h1 className="text-3xl font-bold text-primary">Social Moderation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Reported Moments only. Sensitive content reviews and moderation
          decisions are audited.
        </p>
      </div>
      {metrics.data && (
        <div className="panel grid grid-cols-2 gap-4 p-6 md:grid-cols-4">
          {Object.entries({
            "Moments / 7 days": metrics.data.distribution.reduce(
              (a, v) => a + v.count,
              0,
            ),
            "Views / 7 days": metrics.data.views,
            "Reactions / 7 days": metrics.data.reactions,
            "Private replies / 7 days": metrics.data.replies,
            "Accepted plans / 7 days": metrics.data.plans,
            "Reports / 7 days": metrics.data.reports,
            "Removed / 7 days": metrics.data.removed,
            "Daily viewers": metrics.data.dailyViewers,
          }).map(([k, v]) => (
            <div key={k}>
              <p className="text-sm text-muted-foreground">{k}</p>
              <p className="text-2xl font-semibold">{v}</p>
            </div>
          ))}
        </div>
      )}
      <div className="panel space-y-3 p-6">
        <label className="block text-sm font-semibold" htmlFor="review-reason">
          Review / moderation reason (required)
        </label>
        <textarea
          id="review-reason"
          value={reason}
          maxLength={1500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain why this reported content needs review…"
          className="min-h-24 w-full rounded-lg border p-3"
        />
        <p className="text-xs text-muted-foreground">
          At least 10 characters. This explanation is saved in the audit trail.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {reports.isPending ? (
        <Loading />
      ) : reports.error ? (
        <ErrorState
          message={reports.error.message}
          retry={() => void reports.refetch()}
        />
      ) : (
        <div className="panel divide-y">
          {!reports.data?.items.length && <Empty>No reported Moments.</Empty>}
          {reports.data?.items.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-4 p-6"
            >
              <div className="max-w-xl">
                <Link
                  href={`/users?q=${r.target?._id}`}
                  className="font-semibold text-primary"
                >
                  {r.target?.name ?? "Member"}
                </Link>
                <p className="mt-1 text-sm">{r.reason}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {r.status} · {r.severity} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                disabled={busy || reason.trim().length < 10}
                onClick={() => void open(r.id)}
              >
                Review Reported Content
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          variant="outline"
          disabled={page * 20 >= (reports.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
      {review && (
        <section
          className="panel space-y-4 border-coral p-6"
          aria-label="Reported content review"
        >
          <h2 className="text-xl font-semibold">
            Reported Moment · {review.moment?.status}
          </h2>
          {review.moment ? (
            <>
              <p className="whitespace-pre-wrap">{review.moment.text}</p>
              <p className="whitespace-pre-wrap">{review.moment.caption}</p>
              {review.moment.hasPhoto && (
                <ReportedPhoto
                  reportId={review.reportId}
                  reason={accessReason}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Published {new Date(review.moment.publishedAt).toLocaleString()}{" "}
                · Expires {new Date(review.moment.expiresAt).toLocaleString()}
              </p>
            </>
          ) : (
            <p>Content no longer retained.</p>
          )}
          {review.notes.map((n, i) => (
            <p key={i} className="text-sm">
              {new Date(n.at).toLocaleString()} · {n.text}
            </p>
          ))}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || reason.trim().length < 10}
              onClick={() => void moderate("remove")}
            >
              Remove Moment
            </Button>
            <Button
              variant="outline"
              disabled={busy || reason.trim().length < 10}
              onClick={() => void moderate("dismiss")}
            >
              Dismiss Report
            </Button>
            <Button
              variant="outline"
              disabled={busy || reason.trim().length < 10}
              onClick={() => void moderate("escalate")}
            >
              Escalate
            </Button>
            <Button variant="outline" onClick={() => setReview(null)}>
              Close Review
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
function ReportedPhoto({
  reportId,
  reason,
}: {
  reportId: string;
  reason: string;
}) {
  // Same-origin admin proxy carries the HttpOnly session; no public media URL.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Authenticated evidence must bypass the public image optimizer.
    <img
      alt="Reported Moment evidence"
      className="max-h-96 max-w-full rounded-xl object-contain"
      src={`/api/admin/social/reports/${reportId}/media?reason=${encodeURIComponent(reason)}`}
    />
  );
}
