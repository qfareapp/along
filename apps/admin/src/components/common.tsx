"use client";
import {
  LoaderCircle,
  ShieldCheck,
  AlertCircle,
  Inbox,
  Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import type { ReactNode } from "react";
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center text-[37px] leading-none font-black tracking-[-2px]",
        light ? "text-[#fff8f2]" : "text-primary",
      )}
      aria-label="Along"
    >
      <span>al</span>
      <Heart size={29} className="mt-1 fill-coral text-coral" strokeWidth={3} />
      <span>ng</span>
      <span className="ml-1 mt-5 size-2 rounded-full bg-coral" />
    </div>
  );
}
export function Loading() {
  return (
    <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground">
      <LoaderCircle className="animate-spin text-primary" size={20} />
      Loading shared platform data…
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="panel flex flex-col items-center gap-4 p-12 text-center"
    >
      <AlertCircle className="text-coral" size={30} />
      <h2 className="text-lg font-semibold">We couldn’t load this view</h2>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Empty({
  children = "No records match these filters.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      <Inbox size={30} strokeWidth={1.3} />
      <p>{children}</p>
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  const tone = [
    "active",
    "approved",
    "resolved",
    "success",
    "published",
  ].includes(value)
    ? "bg-[#e8f2e9] text-[#3f7658]"
    : ["banned", "deleted", "rejected", "critical", "denied"].includes(value)
      ? "bg-[#fde9e4] text-[#b45f50]"
      : "bg-[#fcf0dd] text-[#aa8544]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-semibold capitalize whitespace-nowrap",
        tone,
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
export function SecureNote() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <ShieldCheck size={14} className="text-primary" />
      One platform. One source of truth.
    </div>
  );
}
