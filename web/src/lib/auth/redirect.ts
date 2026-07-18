/** Build the Supabase email redirect URL (PKCE callback + post-auth destination). */
export function authCallbackRedirect(next: string, origin: string): string {
  const safeNext = safeRedirectPath(next);
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
}

/**
 * Password-recovery redirect — path only (no query string).
 * GoTrue appends `?code=` / `#access_token=`; nested `?next=` is fragile and unnecessary.
 */
export function authRecoveryRedirect(origin: string): string {
  return `${origin}/auth/reset-password`;
}

/** Reject open redirects — only same-origin relative paths. */
export function safeRedirectPath(next: string | null, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
