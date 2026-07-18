import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
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
 * Browser client for the reset-password page.
 * - detectSessionInUrl: false — we parse hash/?code=/token_hash ourselves (avoids
 *   racing a one-time PKCE code with exchangeCodeForSession).
 * Note: @supabase/ssr createBrowserClient always forces flowType "pkce".
 */
export function createResetPasswordClient() {
  const { url, key } = publicEnv();
  return createBrowserClient(url, key, {
    auth: {
      detectSessionInUrl: false,
      autoRefreshToken: true,
      persistSession: true,
    },
  });
}

/**
 * Implicit-flow client used only to *request* recovery emails.
 * Must use supabase-js directly — @supabase/ssr's createBrowserClient overwrites
 * flowType to "pkce", which embeds a code_verifier and breaks cross-browser resets.
 */
export function createRecoveryClient(): SupabaseClient {
  const { url, key } = publicEnv();
  return createSupabaseJsClient(url, key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: false,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
