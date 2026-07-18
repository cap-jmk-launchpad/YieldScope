import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for server-side persistence (bypasses RLS).
 * Prefer SUPABASE_INTERNAL_URL in-cluster to avoid edge/nginx 502s on cron.
 */
export function createAdminClient() {
  const url =
    process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin unavailable — set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_INTERNAL_URL) and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminConfigured(): boolean {
  return Boolean(
    (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
