"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  CalendarDays,
  Shapes,
  Flag,
  SlidersHorizontal,
  ScrollText,
  Settings,
  Menu,
  X,
  LogOut,
  Search,
  ChevronRight,
  ArrowUpRight,
  HeartHandshake,
  Gamepad2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Session } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorState, Loading, Logo } from "./common";
export const useSession = () =>
  useQuery({
    queryKey: ["admin-session"],
    queryFn: () => api<Session>("/auth/me"),
    refetchInterval: 30000,
  });
const navigation = [
  ["Overview", "/dashboard", LayoutDashboard, "dashboard.read"],
  ["People", "/users", Users, "users.read"],
  ["Verifications", "/verification", ShieldCheck, "verification.review"],
  ["Activities", "/activities", CalendarDays, "activities.moderate"],
  ["Reports & safety", "/reports", Flag, "reports.review"],
  ["Social Moderation", "/social", ShieldCheck, "reports.review"],
  ["Categories", "/categories", Shapes, "categories.manage"],
  ["Matching rules", "/matching", HeartHandshake, "matching.configure"],
  ["Along Play", "/along-play", Gamepad2, "settings.manage"],
  ["Admin roles", "/admin-roles", Users, "admins.manage"],
  ["Audit trail", "/audit-logs", ScrollText, "audit.read"],
  ["System health", "/system-health", SlidersHorizontal, "system.read"],
] as const;
export function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const path = usePathname();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401)
      router.replace("/login");
  }, [session.error, router]);
  if (session.isPending) return <Loading />;
  if (!session.data)
    return (
      <div className="p-10">
        <ErrorState
          message={session.error?.message ?? "Session unavailable."}
          retry={() => {
            void session.refetch();
          }}
        />
      </div>
    );
  const user = session.data;
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      client.clear();
      router.replace("/login");
    } catch (e) {
      setLogoutError(e instanceof Error ? e.message : "Could not sign out.");
    }
  }
  return (
    <div className="min-h-screen">
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-primary px-5 py-8 text-white transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-3 flex items-center justify-between px-3">
          <Logo light />
          <button
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="lg:hidden"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mb-10 pl-3 text-[9px] tracking-[3px] text-white/45">
          PLATFORM ADMINISTRATION
        </p>
        <p className="mb-3 pl-3 text-[9px] font-semibold tracking-[2px] text-white/35">
          YOUR WORKSPACE
        </p>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {navigation
            .filter((n) => user.permissions.includes(n[3]))
            .map(([name, href, Icon]) => (
              <Link
                onClick={() => setOpen(false)}
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-xs transition-colors",
                  path.startsWith(href)
                    ? "bg-white/12 text-white"
                    : "text-white/60 hover:bg-white/7 hover:text-white",
                )}
              >
                <Icon size={17} strokeWidth={1.7} />
                {name}
                {path.startsWith(href) && (
                  <span className="ml-auto size-1.5 rounded-full bg-coral" />
                )}
              </Link>
            ))}
        </nav>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <ShieldCheck size={23} className="mb-3 text-[#f4c9a8]" />
          <p className="text-xs font-semibold">
            Better together. Safer always.
          </p>
          <p className="mt-2 text-[10px] leading-4 text-white/45">
            Every action helps build a kinder community.
          </p>
        </div>
        <button
          onClick={() => {
            void logout();
          }}
          className="mt-6 flex items-center gap-3 px-3 text-xs text-white/60 hover:text-white"
        >
          <LogOut size={16} />
          Sign out
        </button>
        {logoutError && (
          <p role="alert" className="mt-2 text-xs text-coral">
            {logoutError}
          </p>
        )}
      </aside>
      <div className="lg:pl-[236px]">
        <header className="flex h-[83px] items-center justify-between gap-5 border-b border-border bg-[#fffaf6] px-6 lg:px-9">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden"
            >
              <Menu size={22} />
            </button>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Workspace
            </span>
            <ChevronRight
              size={13}
              className="hidden text-muted-foreground sm:block"
            />
            <span className="text-xs font-semibold">
              {navigation.find((n) => path.startsWith(n[1]))?.[0] ??
                "Administration"}
            </span>
          </div>
          {user.permissions.includes("users.read") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/users?q=${encodeURIComponent(search)}`);
              }}
              className="hidden max-w-xs flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 md:flex"
            >
              <Search size={16} className="text-muted-foreground" />
              <input
                aria-label="Search users globally"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a person…"
                className="h-9 w-full bg-transparent text-xs shadow-none!"
              />
            </form>
          )}
          <Link href="/settings" className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full border border-[#e6c3a9] bg-[#f4dfce] text-sm font-semibold text-primary">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold">{user.name}</p>
              <p className="mt-1 text-[10px] capitalize text-muted-foreground">
                {user.role.replaceAll("-", " ")}
              </p>
            </div>
            <Settings size={15} className="text-muted-foreground" />
          </Link>
        </header>
        <main className="mx-auto max-w-[1600px] p-5 md:p-8 lg:p-9">
          {children}
          <footer className="mt-10 flex items-center justify-between border-t border-border pt-5 text-[10px] text-muted-foreground">
            <span>© {new Date().getFullYear()} Along · Do life together.</span>
            <Link
              href="/settings"
              className="flex items-center gap-1 hover:text-primary"
            >
              Session & security
              <ArrowUpRight size={12} />
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
