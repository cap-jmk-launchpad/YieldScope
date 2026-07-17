export function isEmailNotConfirmed(message: string): boolean {
  return /email not confirmed/i.test(message);
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
