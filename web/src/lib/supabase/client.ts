import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return { url, key };
}

export function createClient() {
  const { url, key } = publicEnv();
  return createBrowserClient(url, key);
}

/**
 * Implicit flow for password-recovery emails so the link works in any browser
 * (no PKCE code_verifier required from the tab that requested the reset).
 */
export function createRecoveryClient(): SupabaseClient {
  const { url, key } = publicEnv();
  return createBrowserClient(url, key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
    },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
