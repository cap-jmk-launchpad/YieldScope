"use client";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Handles Supabase email / recovery redirects.
 * - PKCE: `?code=` → exchangeCodeForSession
 * - Implicit: `#access_token=...` → createBrowserClient detects session in URL
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
        } else if (hashParams.get("access_token")) {
          // detectSessionInUrl parses the hash during client init
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) throw new Error("No session from recovery link");
        } else {
          router.replace("/login?error=auth_callback");
          return;
        }

        if (!cancelled) {
          router.replace(next);
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
