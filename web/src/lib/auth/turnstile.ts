/**
 * Verify a Cloudflare Turnstile token server-side.
 * When TURNSTILE_SECRET_KEY is unset (local/dev), verification is skipped
 * only if NEXT_PUBLIC_TURNSTILE_SITE_KEY is also unset — otherwise fail closed.
 */
export async function verifyTurnstile(
  token: string | undefined | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  if (!secret && !siteKey) {
    // Bot protection not configured — allow in local/dev
    return { ok: true };
  }

  if (!secret) {
    return { ok: false, error: "Turnstile secret not configured." };
  }

  if (!token) {
    return { ok: false, error: "Complete the bot check and try again." };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  if (!res.ok) {
    return { ok: false, error: "Bot check failed — try again." };
  }

  const data = (await res.json()) as { success?: boolean };
  if (!data.success) {
    return { ok: false, error: "Bot check failed — try again." };
  }

  return { ok: true };
}
