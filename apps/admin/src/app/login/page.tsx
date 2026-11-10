"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ShieldCheck,
  ArrowRight,
  HeartHandshake,
  LoaderCircle,
} from "lucide-react";
import { api, json } from "@/lib/api";
import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  code: z.string().optional(),
});
type Values = z.infer<typeof schema>;
export default function Login() {
  const authConfig = useQuery({
    queryKey: ["admin-login-config"],
    queryFn: () =>
      api<{ mode: "mfa" | "env"; mfaRequired: boolean }>("/auth/config"),
    staleTime: 0,
  });
  const mfaRequired = authConfig.data?.mfaRequired ?? true;
  const router = useRouter();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  async function submit(values: Values) {
    try {
      setError("");
      if (mfaRequired && (!values.code || values.code.trim().length < 6)) {
        setError("Enter your authenticator or recovery code.");
        return;
      }
      await api("/auth/login", {
        method: "POST",
        body: json({
          email: values.email,
          password: values.password,
          ...(mfaRequired ? { code: values.code } : {}),
        }),
      });
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    }
  }
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-primary p-14 lg:flex">
        <Logo light />
        <div className="pointer-events-none absolute -right-20 top-40 size-96 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -left-40 bottom-0 size-[600px] rounded-full border border-white/10" />
        <div className="relative max-w-lg">
          <div className="mb-7 flex size-16 items-center justify-center rounded-2xl bg-white/10">
            <HeartHandshake className="text-[#f4c9a8]" size={32} />
          </div>
          <p className="mb-5 text-xs tracking-[3px] text-white/50">
            THE PEOPLE BEHIND THE POSSIBILITIES
          </p>
          <h1 className="text-5xl font-semibold leading-[1.15] tracking-[-2px] text-white">
            Good connections.
            <br />
            Thoughtful care.
          </h1>
          <p className="mt-7 max-w-sm text-sm leading-7 text-white/55">
            A shared workspace for the people making Along a warmer, safer place
            to do life together.
          </p>
        </div>
        <p className="text-xs text-white/40">Same plans. Better together.</p>
      </section>
      <section className="flex items-center justify-center p-7 sm:p-12">
        <div className="w-full max-w-[390px]">
          <div className="mb-12 lg:hidden">
            <Logo />
          </div>
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-[10px] text-primary">
            <ShieldCheck size={13} />
            SECURE ADMIN WORKSPACE
          </span>
          <h2 className="text-[32px] font-bold tracking-[-1px]">
            Welcome back.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in to take care of your community.
          </p>
          <form onSubmit={handleSubmit(submit)} className="mt-9 space-y-5">
            {(mfaRequired
              ? (["email", "password", "code"] as const)
              : (["email", "password"] as const)
            ).map((name) => (
              <div key={name}>
                <label
                  htmlFor={name}
                  className="mb-2 block text-xs font-semibold"
                >
                  {
                    {
                      email: "Work email",
                      password: "Password",
                      code: "Authenticator or recovery code",
                    }[name]
                  }
                </label>
                <input
                  id={name}
                  {...register(name)}
                  className="field"
                  type={
                    name === "password"
                      ? "password"
                      : name === "email"
                        ? "email"
                        : "text"
                  }
                  autoComplete={
                    name === "code"
                      ? "one-time-code"
                      : name === "password"
                        ? "current-password"
                        : "username"
                  }
                  placeholder={
                    name === "email"
                      ? "you@along.team"
                      : name === "code"
                        ? "6-digit code or one-time recovery code"
                        : "Enter your password"
                  }
                />
                {errors[name] && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {errors[name]?.message}
                  </p>
                )}
              </div>
            ))}
            {(error || authConfig.error) && (
              <div
                role="alert"
                className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-destructive"
              >
                {error || authConfig.error?.message}
              </div>
            )}
            <Button
              disabled={
                isSubmitting || authConfig.isPending || !!authConfig.error
              }
              className="mt-2 h-12 w-full"
              type="submit"
            >
              {isSubmitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <>
                  Sign in to Along
                  <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            {mfaRequired ? (
              <>
                Access is provisioned by your platform operator.
                <br />A recovery code can replace a lost authenticator.
              </>
            ) : (
              "Sign in with your administrator email and password."
            )}
          </p>
          {mfaRequired && (
            <Link
              href="/recover"
              className="mt-4 block text-center text-xs text-primary underline underline-offset-4"
            >
              Recover admin access
            </Link>
          )}
          <div className="mt-12 border-t border-border pt-6 text-center text-[10px] leading-5 text-muted-foreground">
            Administrative actions are recorded in the audit trail.
            <br />
            Never share credentials or verification codes.
          </div>
        </div>
      </section>
    </div>
  );
}
