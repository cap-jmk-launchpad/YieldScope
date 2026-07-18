/** From-address for YieldScope auth mail (GoTrue / yieldscope-mail). */
export const AUTH_MAIL_FROM = "noreply@yieldscope.d3bu7.com";

export function isEmailNotConfirmed(message: string): boolean {
  return /email not confirmed/i.test(message);
}

export function signupConfirmationSentMessage(email: string): string {
  return `We sent a confirmation link to ${email}. Look for YieldScope mail from ${AUTH_MAIL_FROM} (check spam/junk if needed). Open it to activate your account, then sign in.`;
}

export function passwordResetSentMessage(email: string): string {
  return `If an account exists for ${email}, we sent a password reset link. Look for YieldScope mail from ${AUTH_MAIL_FROM} (check spam/junk if needed). Open it to choose a new password.`;
}

export function emailNotConfirmedMessage(): string {
  return `Confirm your email first — look for YieldScope mail from ${AUTH_MAIL_FROM} (check spam/junk if needed), then sign in again.`;
}

export function authCallbackErrorMessage(code: string | null): string | null {
  if (code === "auth_callback") {
    return "Sign-in link expired or invalid. Request a new confirmation or reset email and try again.";
  }
  if (code === "auth_unconfigured") {
    return "Auth backend is not configured on this deployment.";
  }
  return null;
}
