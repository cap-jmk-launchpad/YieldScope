"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authRecoveryRedirect } from "@/lib/auth/redirect";
import {
  createRecoveryClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      const supabase = createRecoveryClient();
      const redirectTo =
        typeof window !== "undefined"
          ? authRecoveryRedirect(window.location.origin)
          : undefined;

      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      setInfo(
        `If an account exists for ${email}, we sent a password reset link. Open it to choose a new password.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Reset password</h1>
      <p className="lede">
        Enter your email and we&apos;ll send a link to set a new password.
      </p>

      {!configured ? (
        <p className="err">
          Auth backend missing — set Supabase env vars in <code>web/.env.local</code>.
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

      {error ? <p className="err">{error}</p> : null}
      {info ? <p className="ok">{info}</p> : null}

      <button type="submit" className="btn-primary" disabled={busy || !configured}>
        {busy ? "Please wait…" : "Send reset link"}
      </button>

      <p className="switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
