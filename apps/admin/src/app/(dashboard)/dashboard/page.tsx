"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Users,
  UserCheck,
  CalendarDays,
  HeartHandshake,
  ShieldCheck,
  Flag,
  ArrowUpRight,
  RefreshCw,
  Sparkles,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { useSession } from "@/components/shell";
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  PageHeading,
  SecureNote,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { OnboardingAnalytics } from "@/components/onboarding-analytics";
const metricCards = [
  ["totalUsers", "Community members", Users, "All registered members"],
  [
    "newUsers",
    "New connections to Along",
    Sparkles,
    "Registrations in selected period",
  ],
  [
    "activePlans",
    "Active plans",
    CalendarDays,
    "Possibilities waiting to happen",
  ],
  [
    "matches",
    "Mutual matches",
    HeartHandshake,
    "Active, consent-based connections",
  ],
  ["verified", "Verified identities", UserCheck, "Reviewed and approved"],
  [
    "pendingVerifications",
    "Awaiting verification",
    ShieldCheck,
    "Ready for a thoughtful review",
  ],
  ["pendingReports", "Open safety reports", Flag, "Care and attention needed"],
  [
    "dailyActive",
    "Daily active members",
    Activity,
    "Recorded in the last 24 hours",
  ],
] as const;
const chartColors = [
  "#174F54",
  "#F47768",
  "#E4B28E",
  "#7D9F90",
  "#B5C6BE",
  "#DDBBA3",
];
export default function DashboardPage() {
  const session = useSession();
  const [days, setDays] = useState("30");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: ["dashboard", days, city, category, from, to],
    queryFn: () =>
      api<Dashboard>(
        `/dashboard?${new URLSearchParams({ days, ...(city ? { city } : {}), ...(category ? { category } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
      ),
    refetchInterval: 30000,
  });
  const firstName = session.data?.name.split(" ")[0] ?? "there";
  return (
    <>
      <PageHeading
        title={`A little overview, ${firstName}.`}
        description="Here’s what’s happening across the Along community."
      >
        <div className="flex items-center gap-2">
          <Button
            aria-label="Refresh dashboard"
            variant="outline"
            size="icon"
            onClick={() => {
              void query.refetch();
            }}
          >
            <RefreshCw size={15} />
          </Button>
          <select
            aria-label="Dashboard date range"
            className="field w-auto! text-xs!"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </PageHeading>
      <div className="mb-7 flex flex-wrap items-center gap-3">
        <input
          aria-label="Filter dashboard by city"
          className="field max-w-44 text-xs!"
          placeholder="All cities"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        />
        <input
          aria-label="Filter dashboard by category"
          className="field max-w-44 text-xs!"
          placeholder="All categories (slug)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <input
          aria-label="Start date"
          type="date"
          className="field w-auto! text-xs!"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          aria-label="End date"
          type="date"
          className="field w-auto! text-xs!"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="ml-auto">
          <SecureNote />
        </div>
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
          <>
            <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map(([key, label, Icon, description], i) => (
                <div key={key} className="panel p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                    <div
                      className={`flex size-8 items-center justify-center rounded-xl ${i % 3 === 1 ? "bg-[#FCEAE0] text-[#D98B71]" : "bg-[#EAF0E9] text-[#66867B]"}`}
                    >
                      <Icon size={16} strokeWidth={1.6} />
                    </div>
                  </div>
                  <p className="mt-4 text-[31px] font-semibold leading-none tracking-[-1px] text-primary">
                    {query.data!.metrics[key]?.toLocaleString("en-IN") ?? "—"}
                  </p>
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
            <div className="mb-7 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
              <section className="panel min-w-0 p-6">
                <div className="mb-7 flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-bold">A growing community</h2>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      People finding their way to Along
                    </p>
                  </div>
                  <span className="rounded-md bg-[#EAF0E9] px-2 py-1 text-[9px] font-semibold text-primary">
                    REGISTRATIONS
                  </span>
                </div>
                {query.data.growth.length ? (
                  <div className="h-[235px] w-full min-w-0">
                    <ResponsiveContainer>
                      <AreaChart
                        data={query.data.growth}
                        margin={{ left: -20, right: 5 }}
                      >
                        <defs>
                          <linearGradient
                            id="growth"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#174F54"
                              stopOpacity={0.17}
                            />
                            <stop
                              offset="100%"
                              stopColor="#174F54"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="#EEE7DF"
                          strokeDasharray="3 4"
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v) =>
                            new Date(v).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })
                          }
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 10, fill: "#959C99" }}
                          minTickGap={25}
                        />
                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 10, fill: "#959C99" }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            fontSize: 12,
                            borderColor: "#EADFD5",
                          }}
                        />
                        <Area
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="users"
                          name="New members"
                          stroke="#174F54"
                          strokeWidth={2.5}
                          fill="url(#growth)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty>No registrations in this date range.</Empty>
                )}
              </section>
              <section className="panel min-w-0 p-6">
                <h2 className="text-sm font-bold">
                  What brings people together
                </h2>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Plans created by activity category
                </p>
                {query.data.categories.length ? (
                  <div className="mt-6 h-[235px]">
                    <ResponsiveContainer>
                      <BarChart
                        data={query.data.categories}
                        layout="vertical"
                        margin={{ left: 5, right: 15 }}
                      >
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 10, fill: "#7B8383" }}
                          width={73}
                        />
                        <Tooltip
                          cursor={{ fill: "#F7F0E8" }}
                          contentStyle={{ borderRadius: 12, fontSize: 12 }}
                        />
                        <Bar
                          isAnimationActive={false}
                          dataKey="count"
                          name="Plans"
                          radius={[0, 5, 5, 0]}
                          barSize={15}
                        >
                          {query.data.categories.map((item, i) => (
                            <Cell
                              key={item.name}
                              fill={chartColors[i % chartColors.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty>No plans created in this period.</Empty>
                )}
              </section>
            </div>
            <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
              <section className="panel overflow-hidden">
                <div className="flex items-center justify-between p-6">
                  <div>
                    <h2 className="text-sm font-bold">
                      The latest around Along
                    </h2>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Recent administrative activity
                    </p>
                  </div>
                  {session.data?.permissions.includes("audit.read") && (
                    <Link
                      href="/audit-logs"
                      className="flex items-center gap-1 text-[10px] text-primary"
                    >
                      View audit trail
                      <ArrowUpRight size={12} />
                    </Link>
                  )}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Area</th>
                        <th>Date</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.recent.map((item) => (
                        <tr key={item._id}>
                          <td className="font-medium">
                            {item.action
                              .replaceAll(".", " · ")
                              .replaceAll("_", " ")}
                          </td>
                          <td className="text-xs text-muted-foreground">
                            {item.targetType}
                          </td>
                          <td className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDate(item.createdAt)}
                          </td>
                          <td>
                            <Badge value={item.outcome} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!query.data.recent.length && (
                  <Empty>
                    Your platform’s audit activity will appear here.
                  </Empty>
                )}
              </section>
              <div className="space-y-5">
                <section className="rounded-[20px] bg-[#F5E4D5] p-6">
                  <ShieldCheck size={25} className="mb-4 text-primary" />
                  <h2 className="text-base font-bold text-primary">
                    A community built on care.
                  </h2>
                  <p className="mt-3 text-xs leading-6 text-[#8D7969]">
                    {query.data.metrics.pendingReports ?? 0} reports and{" "}
                    {query.data.metrics.pendingVerifications ?? 0} verifications
                    are waiting for review.
                  </p>
                  {session.data?.permissions.includes("reports.review") && (
                    <Link
                      href="/reports"
                      className="mt-5 flex items-center gap-2 text-xs font-semibold text-primary"
                    >
                      Visit the safety queue
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                </section>
                <section className="panel p-6">
                  <h2 className="text-sm font-bold">
                    Across our neighbourhoods
                  </h2>
                  <div className="mt-5 space-y-4">
                    {query.data.geography.length ? (
                      query.data.geography.map((row) => (
                        <div
                          key={row._id}
                          className="flex justify-between text-xs"
                        >
                          <span className="text-muted-foreground">
                            {row._id}
                          </span>
                          <span className="font-semibold">
                            {row.count} members
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        City data will appear as profiles are completed.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </div>
            <details className="panel mt-6 p-5">
              <summary className="cursor-pointer text-xs font-semibold">
                Additional platform metrics & data coverage
              </summary>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {Object.entries(query.data.metrics)
                  .filter(([key]) => !metricCards.some((m) => m[0] === key))
                  .map(([key, value]) => (
                    <div key={key}>
                      <p className="text-xs text-muted-foreground">
                        {key.replace(/([A-Z])/g, " $1")}
                      </p>
                      <p className="mt-1 font-semibold">
                        {value === null
                          ? "Not tracked"
                          : value.toLocaleString("en-IN")}
                      </p>
                    </div>
                  ))}
              </div>
              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                {query.data.notes.activity} {query.data.notes.billing}
              </p>
            </details>
          </>
        )
      )}
      <OnboardingAnalytics />
    </>
  );
}
