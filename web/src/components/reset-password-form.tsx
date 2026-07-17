"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!configured);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      if (!data.session) {
        setError(
          "Reset link expired or missing. Request a new password reset email.",
        );
      }
      setReady(true);
    });
  }, [configured]);

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

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) {
        setError(authError.message);
        return;
      }
      setInfo("Password updated. Redirecting to your dashboard…");
      router.push("/app?password_updated=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="lede">Loading…</p>;
  }

  const sessionMissing = ready && configured && !hasSession;

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Choose new password</h1>
      <p className="lede">
        Set a new password for your account. You&apos;ll stay signed in afterward.
      </p>

      {!configured ? (
        <p className="err">
          Auth backend missing — set Supabase env vars in <code>web/.env.local</code>.
        </p>
      ) : null}

      {!sessionMissing ? (
        <>
          <label>
            New password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </>
      ) : null}

      {error ? <p className="err">{error}</p> : null}
      {info ? <p className="ok">{info}</p> : null}

      {!sessionMissing ? (
        <button type="submit" className="btn-primary" disabled={busy || !configured}>
          {busy ? "Please wait…" : "Update password"}
        </button>
      ) : (
        <Link href="/forgot-password" className="btn-primary auth-form-link-btn">
          Request new reset link
        </Link>
      )}

      <p className="switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
