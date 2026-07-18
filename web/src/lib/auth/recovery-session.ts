/**
 * Establish a password-recovery session from the email redirect URL.
 *
 * Supports:
 * - Implicit hash: `#access_token=…&refresh_token=…&type=recovery`
 * - PKCE query: `?code=…`
 * - OTP hash in query: `?token_hash=…&type=recovery` (scanner-safe; no GoTrue GET verify)
 */

export type RecoveryEstablishResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "session_failed"; detail?: string };

export type RecoveryAuthClient = {
  auth: {
    exchangeCodeForSession: (
      code: string,
    ) => Promise<{ error: { message: string } | null }>;
    verifyOtp: (args: {
      token_hash: string;
      type: "recovery" | "email";
    }) => Promise<{ error: { message: string } | null }>;
    setSession: (args: {
      access_token: string;
      refresh_token: string;
    }) => Promise<{ error: { message: string } | null }>;
    getSession: () => Promise<{
      data: { session: unknown };
      error: { message: string } | null;
    }>;
  };
};

/** Snapshot redirect params before any navigation / history clear. */
export function parseRecoveryUrl(href: string): {
  code: string | null;
  tokenHash: string | null;
  otpType: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
} {
  const url = new URL(href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const error =
    hashParams.get("error") || url.searchParams.get("error") || null;
  const errorCode =
    hashParams.get("error_code") || url.searchParams.get("error_code") || null;
  const errorDescription =
    hashParams.get("error_description") ||
    url.searchParams.get("error_description") ||
    null;

  return {
    code: url.searchParams.get("code"),
    tokenHash: url.searchParams.get("token_hash"),
    otpType: url.searchParams.get("type") || hashParams.get("type"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    error,
    errorCode,
    errorDescription,
  };
}

export async function establishRecoverySession(
  supabase: RecoveryAuthClient,
  href: string,
): Promise<RecoveryEstablishResult> {
  const params = parseRecoveryUrl(href);

  if (params.error || params.errorCode) {
    const expired =
      params.errorCode === "otp_expired" ||
      /expired|invalid/i.test(params.errorDescription ?? "") ||
      /expired|invalid/i.test(params.error ?? "");
    return {
      ok: false,
      reason: expired ? "expired" : "session_failed",
      detail: params.errorDescription?.replace(/\+/g, " ") ?? params.error ?? undefined,
    };
  }

  const hasRedirectCredential = Boolean(
    params.code ||
      params.tokenHash ||
      (params.accessToken && params.refreshToken),
  );

  try {
    if (params.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) {
        // detectSessionInUrl may have already consumed the one-time code
        const { data } = await supabase.auth.getSession();
        if (data.session) return { ok: true };
        return { ok: false, reason: "session_failed", detail: error.message };
      }
    } else if (
      params.tokenHash &&
      (params.otpType === "recovery" || params.otpType === "email")
    ) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: params.tokenHash,
        type: params.otpType,
      });
      if (error) {
        return { ok: false, reason: "session_failed", detail: error.message };
      }
    } else if (params.accessToken && params.refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
      });
      if (error) {
        return { ok: false, reason: "session_failed", detail: error.message };
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Session setup failed";
    const { data } = await supabase.auth.getSession();
    if (data.session) return { ok: true };
    return { ok: false, reason: "session_failed", detail };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return { ok: false, reason: "session_failed", detail: error.message };
  }
  if (data.session) return { ok: true };

  return {
    ok: false,
    reason: hasRedirectCredential ? "session_failed" : "missing",
  };
}

export function recoveryErrorMessage(result: RecoveryEstablishResult): string {
  if (result.ok) return "";
  switch (result.reason) {
    case "expired":
      return "This reset link was already used or has expired. Email apps sometimes open links early — request a new password reset email.";
    case "session_failed":
      return result.detail
        ? `Could not open reset session: ${result.detail}`
        : "Could not open reset session from this link. Request a new password reset email.";
    case "missing":
    default:
      return "No reset token found. Open the link from your latest password reset email.";
  }
}
