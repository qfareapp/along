"use client";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Search, ShieldCheck, ArrowUpRight, Download } from "lucide-react";
import { toast } from "sonner";
import { api, json } from "@/lib/api";
import type { Page, User, UserDetail } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useSession } from "@/components/shell";
import { Badge, ErrorState, Loading, PageHeading } from "@/components/common";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

function UsersContent({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const [verified, setVerified] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const session = useSession();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["users", q, status, city, verified, page],
    queryFn: () =>
      api<Page<User>>(
        `/users?${new URLSearchParams({ page: String(page), q, ...(status ? { status } : {}), ...(city ? { city } : {}), ...(verified ? { verified } : {}) })}`,
      ),
    refetchInterval: 15000,
  });
  const detail = useQuery({
    queryKey: ["user", selected],
    enabled: !!selected,
    queryFn: () => api<UserDetail>(`/users/${selected}`),
  });
  const mutation = useMutation({
    mutationFn: () =>
      api(`/users/${selected}/action`, {
        method: "POST",
        body: json({ action, reason }),
      }),
    onSuccess: async () => {
      setAction("");
      setReason("");
      toast.success("Account updated. Existing sessions were revoked.");
      await client.invalidateQueries({ queryKey: ["users"] });
      await client.invalidateQueries({ queryKey: ["user", selected] });
      await client.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Community member",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f5dfce] text-xs font-bold text-primary">
              {row.original.name.slice(0, 1)}
            </span>
            <div>
              <p className="font-semibold">{row.original.name}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {row.original.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "city",
        header: "Location",
        accessorFn: (row) => row.profile?.city ?? "Not provided",
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {String(getValue())}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Account",
        cell: ({ getValue }) => <Badge value={String(getValue())} />,
      },
      {
        accessorKey: "identityVerified",
        header: "Identity",
        cell: ({ row }) =>
          row.original.identityVerified ? (
            <span className="flex items-center gap-1 text-xs text-primary">
              <ShieldCheck size={14} />
              Verified
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not verified</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: "Joined",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatDate(String(getValue()))}
          </span>
        ),
      },
      {
        id: "view",
        header: "",
        cell: ({ row }) => (
          <Button
            aria-label={`View ${row.original.name}`}
            size="sm"
            variant="ghost"
            onClick={() => setSelected(row.original._id)}
          >
            View
            <ArrowUpRight size={13} />
          </Button>
        ),
      },
    ],
    [],
  );
  async function exportUsers() {
    try {
      const data = await api<{
        headers: string[];
        rows: (string | boolean)[][];
      }>("/users-export");
      const csv = [data.headers, ...data.rows]
        .map((row) =>
          row
            .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
            .join(","),
        )
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "along-user-report.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    }
  }
  return (
    <>
      <PageHeading
        title="People make Along."
        description="Get to know your community. Keep it safe, kind and welcoming."
      >
        {session.data?.permissions.includes("users.export") && (
          <Button
            variant="outline"
            onClick={() => {
              void exportUsers();
            }}
          >
            <Download size={14} />
            Export report
          </Button>
        )}
      </PageHeading>
      <div className="panel mb-5 flex flex-wrap gap-3 p-4">
        <div className="relative min-w-52 flex-1">
          <Search
            className="absolute top-3.5 left-3 text-muted-foreground"
            size={15}
          />
          <input
            aria-label="Search members"
            className="field pl-10!"
            placeholder="Search by name, email or user ID…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Account status"
          className="field w-auto!"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All account statuses</option>
          {["active", "suspended", "banned", "deleted"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Verification filter"
          className="field w-auto!"
          value={verified}
          onChange={(e) => {
            setVerified(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All identities</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>
        <input
          aria-label="City filter"
          className="field max-w-44"
          placeholder="City"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState
          message={query.error.message}
          retry={() => {
            void query.refetch();
          }}
        />
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
          if (!open) {
            setSelected(null);
            setAction("");
            setReason("");
          }
        }}
        title={detail.data?.user.name ?? "Member details"}
        description="Limited profile information and the account’s moderation history."
      >
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState message={detail.error.message} />
        ) : (
          detail.data && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {detail.data.user.email}
                </p>
                <Badge value={detail.data.user.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                User ID · {detail.data.user._id}
              </p>
              <div className="grid grid-cols-2 gap-4 rounded-2xl bg-muted p-4 text-xs">
                <p>
                  City
                  <strong className="mt-1 block">
                    {detail.data.profile?.city ?? "Not provided"}
                  </strong>
                </p>
                <p>
                  Profile
                  <strong className="mt-1 block">
                    {detail.data.profile?.onboardingComplete
                      ? "Complete"
                      : "In progress"}
                  </strong>
                </p>
                <p>
                  Mutual matches
                  <strong className="mt-1 block">
                    {detail.data.matchCount}
                  </strong>
                </p>
                <p>
                  Email
                  <strong className="mt-1 block">
                    {detail.data.user.emailVerified ? "Verified" : "Unverified"}
                  </strong>
                </p>
              </div>
              <p className="text-sm leading-6">
                {detail.data.profile?.bio ?? "No biography provided."}
              </p>
              {detail.data.onboarding && (
                <div className="rounded-2xl bg-muted p-4 text-sm space-y-3">
                  <p className="font-semibold">
                    Onboarding ·{" "}
                    {detail.data.onboarding.state.replaceAll("_", " ")}
                  </p>
                  <p>
                    Step {Math.min(detail.data.onboarding.currentStep, 5)} of 5
                    · Quick start{" "}
                    {detail.data.onboarding.quickStartCompleted
                      ? "complete"
                      : "in progress"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(detail.data.onboarding.checks).map(
                      ([key, ok]) => (
                        <span
                          key={key}
                          className="rounded-full bg-background px-3 py-1 text-xs"
                        >
                          {key}: {ok ? "Complete" : "Pending"}
                        </span>
                      ),
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Age, consent and romantic preferences cannot be overridden
                    here.
                  </p>
                </div>
              )}
              <div>
                <p className="mb-3 text-xs font-semibold">Active plans</p>
                {detail.data.activities.length ? (
                  detail.data.activities.map((a) => (
                    <p
                      key={a._id}
                      className="border-t border-border py-2 text-xs"
                    >
                      {a.title} · {a.category}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No active plans.
                  </p>
                )}
              </div>
              <div>
                <p className="mb-3 text-xs font-semibold">Recent moderation</p>
                {detail.data.history.length ? (
                  detail.data.history.map((a) => (
                    <div
                      key={a._id}
                      className="border-t border-border py-2 text-xs"
                    >
                      <p>
                        {a.action} · {formatDate(a.createdAt)}
                      </p>
                      <p className="mt-1 text-muted-foreground">{a.reason}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No moderation history.
                  </p>
                )}
              </div>
              {session.data?.permissions.includes("users.suspend") && (
                <div className="border-t border-border pt-5">
                  <label
                    htmlFor="enforcement"
                    className="mb-2 block text-xs font-semibold"
                  >
                    Account action
                  </label>
                  <select
                    id="enforcement"
                    className="field"
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="">Select an action</option>
                    <option value="suspend">Suspend account</option>
                    <option value="reactivate">Reactivate account</option>
                    {session.data.permissions.includes("users.ban") && (
                      <option value="ban">Permanently ban account</option>
                    )}
                    <option value="restrict_posting">Restrict posting</option>
                    <option value="restore_posting">Restore posting</option>
                    <option value="restrict_messaging">
                      Restrict messaging
                    </option>
                    <option value="restore_messaging">Restore messaging</option>
                  </select>
                  {action && (
                    <>
                      <label
                        htmlFor="action-reason"
                        className="mt-4 mb-2 block text-xs font-semibold"
                      >
                        Reason for this action
                      </label>
                      <textarea
                        id="action-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="field min-h-24"
                        placeholder="Include the policy basis and relevant context (10+ characters)."
                      />
                      <p className="my-3 text-xs leading-5 text-muted-foreground">
                        Confirming updates the shared account immediately and
                        revokes its sessions. The reason is permanently audited.
                        Users may contact support to appeal.
                      </p>
                      <Button
                        variant={
                          action === "reactivate" ||
                          action.startsWith("restore")
                            ? "default"
                            : "destructive"
                        }
                        disabled={
                          reason.trim().length < 10 || mutation.isPending
                        }
                        onClick={() => mutation.mutate()}
                      >
                        {mutation.isPending
                          ? "Applying…"
                          : "Confirm account action"}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </Dialog>
    </>
  );
}
export default function UsersPage() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  return <UsersContent key={q} initialQuery={q} />;
}
