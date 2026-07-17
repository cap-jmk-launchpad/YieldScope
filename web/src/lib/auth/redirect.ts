/** Build the Supabase email redirect URL (PKCE callback + post-auth destination). */
export function authCallbackRedirect(next: string, origin: string): string {
  const safeNext = safeRedirectPath(next);
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
}

/** Reject open redirects — only same-origin relative paths. */
export function safeRedirectPath(next: string | null, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
