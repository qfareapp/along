"use client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { api, json } from "@/lib/api";
import type { Page } from "@/lib/types";
import { Badge, ErrorState, Loading, PageHeading } from "./common";
import { DataTable } from "./data-table";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
type Row = { _id: string; [key: string]: unknown };
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return typeof obj.name === "string" ? obj.name : JSON.stringify(value);
  }
  return String(value);
}
const definitions: Record<
  string,
  {
    title: string;
    description: string;
    endpoint: string;
    columns: string[];
    actions?: { label: string; value: string }[];
  }
> = {
  verification: {
    title: "Trust starts here.",
    description:
      "Review provider outcomes and verification requests. Identity approval does not verify email ownership.",
    endpoint: "verifications",
    columns: ["user", "type", "status", "providerReference"],
    actions: [
      { label: "Approve verification", value: "approved" },
      { label: "Reject verification", value: "rejected" },
      { label: "Request more information", value: "more_info" },
    ],
  },
  activities: {
    title: "Every plan is a possibility.",
    description:
      "Review needs, offers and shared plans from the same activity collection as the mobile app.",
    endpoint: "activities",
    columns: ["title", "creator", "category", "type", "zone", "status"],
    actions: [
      { label: "Approve / restore", value: "active" },
      { label: "Pause activity", value: "paused" },
      { label: "Remove activity", value: "deleted" },
    ],
  },
  reports: {
    title: "A community worth caring for.",
    description:
      "Investigate concerns, capture a reason and keep a clear resolution history.",
    endpoint: "reports",
    columns: ["reporter", "target", "reason", "severity", "status"],
    actions: [
      { label: "Begin review", value: "under_review" },
      { label: "Escalate concern", value: "escalated" },
      { label: "Record action taken", value: "action_taken" },
      { label: "Resolve report", value: "resolved" },
      { label: "Dismiss report", value: "dismissed" },
    ],
  },
  "audit-logs": {
    title: "A clear record of care.",
    description:
      "An append-only history of sensitive administrative actions. Audit entries cannot be edited here.",
    endpoint: "audit-logs",
    columns: [
      "admin",
      "action",
      "targetType",
      "reason",
      "outcome",
      "createdAt",
    ],
  },
};
export function Resource({ module }: { module: string }) {
  const config = definitions[module];
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState("medium");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["resource", module, page, search],
    queryFn: () =>
      api<Page<Row>>(
        `/${config.endpoint}?page=${page}&q=${encodeURIComponent(search)}`,
      ),
    enabled: !!config,
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: () =>
      api(
        `/${config.endpoint}/${selected!._id}/${module === "activities" ? "action" : "review"}`,
        {
          method: "POST",
          body: json({
            status: action,
            reason,
            ...(module === "reports" ? { severity } : {}),
          }),
        },
      ),
    onSuccess: async () => {
      toast.success("Review saved and recorded in the audit trail.");
      setSelected(null);
      setAction("");
      setReason("");
      await client.invalidateQueries({ queryKey: ["resource"] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      ...(config?.columns ?? []).map((key) => ({
        accessorKey: key,
        header: key.replace(/([A-Z])/g, " $1"),
        cell: ({ row }: { row: { original: Row } }) =>
          ["status", "outcome", "severity"].includes(key) ? (
            <Badge value={display(row.original[key])} />
          ) : (
            <span
              className="block max-w-[240px] truncate text-xs"
              title={display(row.original[key])}
            >
              {key === "createdAt"
                ? new Date(display(row.original[key])).toLocaleString()
                : display(row.original[key])}
            </span>
          ),
      })),
      {
        id: "review",
        header: "",
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected(row.original);
              setAction("");
              setReason("");
              setSeverity(
                display(row.original.severity) === "—"
                  ? "medium"
                  : display(row.original.severity),
              );
            }}
          >
            {config?.actions ? "Review" : "Details"}
          </Button>
        ),
      },
    ],
    [config],
  );
  if (!config)
    return (
      <ErrorState message="This administrative module is not available." />
    );
  return (
    <>
      <PageHeading title={config.title} description={config.description} />
      {["activities", "audit-logs"].includes(module) && (
        <div className="mb-5">
          <input
            aria-label="Search records"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="field max-w-md"
            placeholder={
              module === "activities"
                ? "Search plans by title…"
                : "Search by action…"
            }
          />
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error.message} />
      ) : (
        query.data && (
          <DataTable
            columns={columns}
            data={query.data.items}
            total={query.data.total}
            page={page}
            onPage={setPage}
          />
        )
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={config.actions ? "Review & decide" : "Audit record"}
        description="The database record and any decisions are retained for accountability."
      >
        {selected && (
          <>
            <dl className="space-y-3">
              {Object.entries(selected)
                .filter(([key]) => !["__v", "updatedAt"].includes(key))
                .map(([key, value]) => (
                  <div key={key} className="border-b border-border pb-3">
                    <dt className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {key.replace(/([A-Z])/g, " $1")}
                    </dt>
                    <dd className="text-xs leading-5 break-words whitespace-pre-wrap">
                      {display(value)}
                    </dd>
                  </div>
                ))}
            </dl>
            {config.actions && (
              <div className="mt-6 space-y-4">
                <label className="block text-xs font-semibold">
                  Decision
                  <select
                    aria-label="Review decision"
                    className="field mt-2"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="">Choose an action</option>
                    {config.actions.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                {module === "reports" && (
                  <label className="block text-xs font-semibold">
                    Severity
                    <select
                      aria-label="Report severity"
                      className="field mt-2"
                      value={severity}
                      onChange={(e) => setSeverity(e.target.value)}
                    >
                      {["low", "medium", "high", "critical"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-xs font-semibold">
                  Reason
                  <textarea
                    aria-label="Review reason"
                    className="field mt-2 min-h-24"
                    placeholder="Document the basis for your decision (10+ characters)."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Confirming changes the live shared record. This decision is
                  recorded in the audit trail.
                </p>
                <Button
                  disabled={
                    !action || reason.trim().length < 10 || mutation.isPending
                  }
                  onClick={() => mutation.mutate()}
                >
                  {mutation.isPending ? "Saving…" : "Confirm decision"}
                </Button>
              </div>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
