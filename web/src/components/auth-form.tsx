"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "login" | "register";

function isEmailNotConfirmed(message: string): boolean {
  return /email not confirmed/i.test(message);
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const requireTurnstile = mode === "login" && Boolean(siteKey);
  const configured = isSupabaseConfigured();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!configured) {
      setError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
      return;
    }

    if (requireTurnstile && !turnstileToken) {
      setError("Complete the bot check and try again.");
      return;
    }

    setBusy(true);
    try {
      if (requireTurnstile) {
        const verifyRes = await fetch("/api/auth/turnstile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: turnstileToken }),
        });
        const verifyJson = (await verifyRes.json()) as { ok?: boolean; error?: string };
        if (!verifyRes.ok || !verifyJson.ok) {
          setError(verifyJson.error ?? "Bot check failed.");
          return;
        }
      }

      const supabase = createClient();
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) {
          if (isEmailNotConfirmed(authError.message)) {
            setInfo(
              "Confirm your email first — check your inbox for the signup link, then sign in again.",
            );
            return;
          }
          setError(authError.message);
          return;
        }
        router.push(next);
        router.refresh();
        return;
      }

      const emailRedirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : undefined;

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo },
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      if (data.session) {
        router.push(next);
        router.refresh();
        return;
      }
      setInfo(
        `We sent a confirmation link to ${email}. Open it to activate your account, then sign in.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
      <p className="lede">
        {mode === "login"
          ? "Sign in to sync earn sources and attest checkpoints."
          : "Register with email and password. We email a confirmation link before your account is active."}
      </p>

      {!configured ? (
        <p className="err">
          Auth backend missing — set Supabase env vars in{" "}
          <code>web/.env.local</code>.
        </p>
      ) : null}

      <label>
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {requireTurnstile ? (
        <div className="turnstile">
          <Turnstile
            siteKey={siteKey!}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            options={{ theme: "dark" }}
          />
        </div>
      ) : mode === "login" ? (
        <p className="hint">
          Bot protection idle — set{" "}
          <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> +{" "}
          <code>TURNSTILE_SECRET_KEY</code> for production.
        </p>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
      {info ? <p className="ok">{info}</p> : null}

      <button type="submit" className="btn-primary" disabled={busy || !configured}>
        {busy
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : "Create account"}
      </button>

      <p className="switch">
        {mode === "login" ? (
          <>
            No account? <Link href="/register">Register</Link>
          </>
        ) : (
          <>
            Already registered? <Link href="/login">Sign in</Link>
          </>
        )}
      </p>
    </form>
  );
}
