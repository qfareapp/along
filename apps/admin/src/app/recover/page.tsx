"use client";
import { useState } from "react";
import Link from "next/link";
import { api, json } from "@/lib/api";
import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
export default function Recover() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/recover", {
        method: "POST",
        body: json({ email, recoveryCode: code.trim(), password }),
      });
      setDone(true);
      setCode("");
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recovery failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-full max-w-md p-8">
        <Logo />
        <h1 className="mt-9 text-2xl font-bold">A safe way back.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Use one of the offline recovery codes saved during setup. This code is
          consumed once, your password is replaced, and all sessions are
          revoked.
        </p>
        {done ? (
          <p
            role="status"
            className="mt-6 rounded-xl bg-[#e9efe8] p-4 text-sm text-primary"
          >
            Password reset. Sign in with your new password and an authenticator
            code or another unused recovery code.
          </p>
        ) : (
          <form
            className="mt-7 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block text-xs font-semibold">
              Work email
              <input
                className="field mt-2"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold">
              One-time recovery code
              <input
                className="field mt-2"
                required
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold">
              New password
              <input
                className="field mt-2"
                required
                type="password"
                autoComplete="new-password"
                minLength={6}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              Use 6+ characters with uppercase, lowercase, a number and a
              symbol.
            </p>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Recovering…" : "Reset password & revoke sessions"}
            </Button>
          </form>
        )}
        <Link
          href="/login"
          className="mt-6 block text-center text-xs text-primary underline"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
