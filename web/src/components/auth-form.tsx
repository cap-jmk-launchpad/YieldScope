"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  authCallbackErrorMessage,
  emailNotConfirmedMessage,
  isEmailNotConfirmed,
  signupConfirmationSentMessage,
} from "@/lib/auth/messages";
import { authCallbackRedirect } from "@/lib/auth/redirect";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/app";
  const callbackError = authCallbackErrorMessage(searchParams.get("error"));
  const passwordUpdated = searchParams.get("password_updated") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    passwordUpdated && mode === "login"
      ? "Password updated. Sign in with your new password."
      : null,
  );
  const [busy, setBusy] = useState(false);
  const displayError = error ?? callbackError;
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

    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) {
          if (isEmailNotConfirmed(authError.message)) {
            setInfo(emailNotConfirmedMessage());
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
          ? authCallbackRedirect(next, window.location.origin)
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
      setInfo(signupConfirmationSentMessage(email));
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

      {mode === "login" ? (
        <p className="auth-forgot">
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
      ) : null}

      {displayError ? <p className="err">{displayError}</p> : null}
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
