"use client";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Handles Supabase email / OAuth redirects.
 * - PKCE: `?code=` → exchangeCodeForSession
 * - Implicit: `#access_token=...` → setSession (do not rely on async detectSessionInUrl)
 * - token_hash: `?token_hash=&type=` → verifyOtp
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isSupabaseConfigured()) {
        router.replace("/login?error=auth_unconfigured");
        return;
      }

      const url = new URL(window.location.href);
      const next = safeRedirectPath(url.searchParams.get("next"));
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const otpType = url.searchParams.get("type");
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const hashError = hashParams.get("error") || url.searchParams.get("error");

      if (hashError) {
        router.replace("/login?error=auth_callback");
        return;
      }

      try {
        const supabase = createClient();

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && otpType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as "recovery" | "signup" | "invite" | "magiclink" | "email",
          });
          if (error) throw error;
        } else if (hashParams.get("access_token") && hashParams.get("refresh_token")) {
          const { error } = await supabase.auth.setSession({
            access_token: hashParams.get("access_token")!,
            refresh_token: hashParams.get("refresh_token")!,
          });
          if (error) throw error;
        } else {
          router.replace("/login?error=auth_callback");
          return;
        }

        const recoveryType =
          hashParams.get("type") === "recovery" || otpType === "recovery";
        const destination = recoveryType ? "/auth/reset-password" : next;

        if (!cancelled) {
          router.replace(destination);
        }
      } catch {
        if (!cancelled) {
          setMessage("Could not complete sign-in.");
          router.replace("/login?error=auth_callback");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="auth-shell">
      <p className="lede">{message}</p>
    </main>
  );
}
