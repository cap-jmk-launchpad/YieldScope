import type { E2EEnv } from "./env";

type Json = Record<string, unknown>;

async function authFetch(
  env: E2EEnv,
  path: string,
  init: RequestInit & { service?: boolean } = {},
): Promise<Response> {
  const key = init.service ? env.serviceRoleKey : env.anonKey;
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const { service: _s, ...rest } = init;
  return fetch(`${env.supabaseUrl}/auth/v1${path}`, { ...rest, headers });
}

export async function adminCreateUser(
  env: E2EEnv,
  email: string,
  password: string,
  confirm = true,
): Promise<{ id: string }> {
  const res = await authFetch(env, "/admin/users", {
    method: "POST",
    service: true,
    body: JSON.stringify({
      email,
      password,
      email_confirm: confirm,
    }),
  });
  const json = (await res.json()) as Json & { id?: string; msg?: string };
  if (!res.ok || !json.id) {
    throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return { id: json.id };
}

export async function adminDeleteUser(env: E2EEnv, id: string): Promise<void> {
  const res = await authFetch(env, `/admin/users/${id}`, {
    method: "DELETE",
    service: true,
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`admin delete user failed: ${res.status} ${text}`);
  }
}

export async function signInWithPassword(
  env: E2EEnv,
  email: string,
  password: string,
): Promise<{ access_token: string; user: { id: string; email?: string } }> {
  const res = await authFetch(env, "/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json()) as Json & {
    access_token?: string;
    user?: { id: string; email?: string };
    msg?: string;
    error_code?: string;
  };
  if (!res.ok || !json.access_token || !json.user) {
    throw new Error(
      `signInWithPassword failed: ${res.status} ${json.error_code ?? ""} ${json.msg ?? JSON.stringify(json)}`,
    );
  }
  return { access_token: json.access_token, user: json.user };
}

export async function requestPasswordRecovery(
  env: E2EEnv,
  email: string,
): Promise<void> {
  const res = await authFetch(env, "/recover", {
    method: "POST",
    body: JSON.stringify({
      email,
      redirect_to: `${env.baseUrl}/auth/reset-password`,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`recover failed: ${res.status} ${text}`);
  }
}

export async function requestSignup(
  env: E2EEnv,
  email: string,
  password: string,
): Promise<void> {
  const res = await authFetch(env, "/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_redirect_to: `${env.baseUrl}/auth/callback?next=/app`,
      data: {},
    }),
  });
  // GoTrue may return 200 with user even when confirmation required
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`signup failed: ${res.status} ${text}`);
  }
}

export async function verifyOtpTokenHash(
  env: E2EEnv,
  tokenHash: string,
  type: "recovery" | "signup" | "email",
): Promise<{ access_token: string }> {
  const res = await authFetch(env, "/verify", {
    method: "POST",
    body: JSON.stringify({ type, token_hash: tokenHash }),
  });
  const json = (await res.json()) as Json & {
    access_token?: string;
    msg?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`verify failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return { access_token: json.access_token };
}

export async function updatePasswordWithAccessToken(
  env: E2EEnv,
  accessToken: string,
  password: string,
): Promise<void> {
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    throw new Error(`updateUser password failed: ${res.status} ${await res.text()}`);
  }
}

export function tokenHashFromLink(link: string): string {
  const u = new URL(link);
  const hash = u.searchParams.get("token_hash");
  if (!hash) throw new Error(`No token_hash in link: ${link}`);
  return hash;
}
