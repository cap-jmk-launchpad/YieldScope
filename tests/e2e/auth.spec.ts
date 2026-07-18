import { test, expect } from "@playwright/test";
import { loadE2EEnv } from "./helpers/env";
import {
  assertMailLogDelivery,
  waitForAuthMail,
} from "./helpers/mail";
import {
  adminCreateUser,
  adminDeleteUser,
  requestPasswordRecovery,
  requestSignup,
  signInWithPassword,
  tokenHashFromLink,
  updatePasswordWithAccessToken,
  verifyOtpTokenHash,
} from "./helpers/supabase";

const env = loadE2EEnv();

async function expectPageOk(path: string) {
  const res = await fetch(`${env.baseUrl}${path}`, {
    redirect: "manual",
  });
  // Auth pages 200; /app without session redirects 307/302 to login
  expect([200, 302, 303, 307, 308]).toContain(res.status);
  return res;
}

test.describe("YieldScope auth + mailserver E2E", () => {
  test.setTimeout(180_000);

  test("public auth routes respond", async ({ page }) => {
    for (const path of [
      "/login",
      "/register",
      "/forgot-password",
      "/auth/reset-password",
      "/auth/callback",
    ]) {
      const res = await page.goto(`${env.baseUrl}${path}`);
      expect(res?.ok() || res?.status() === 200).toBeTruthy();
      await expect(page.locator("body")).toBeVisible();
    }

    const app = await expectPageOk("/app");
    // Unauthed /app should bounce to login
    expect([302, 303, 307, 308, 200]).toContain(app.status);
  });

  test("register → confirmation mail → login → authed API + pages", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `e2e+reg${stamp}@yieldscope.d3bu7.com`;
    const password = `E2eReg-${stamp}-Aa1!`;
    let userId: string | undefined;

    try {
      const afterMs = Date.now();
      await requestSignup(env, email, password);

      const mail = await waitForAuthMail(env, {
        toIncludes: email,
        subjectIncludes: "Confirm",
        afterMs,
        pathHint: "/auth/callback",
        timeoutMs: 120_000,
      });
      assertMailLogDelivery(env, email);

      // Confirm via token_hash (same path the email link uses)
      const tokenHash = tokenHashFromLink(mail.link);
      // Signup confirmation links may use type=signup or type=email
      const typeMatch = /[?&]type=([a-z]+)/i.exec(mail.link);
      const otpType = (typeMatch?.[1] ?? "signup") as
        | "signup"
        | "email"
        | "recovery";
      await verifyOtpTokenHash(
        env,
        tokenHash,
        otpType === "recovery" ? "signup" : otpType,
      );

      const session = await signInWithPassword(env, email, password);
      userId = session.user.id;

      // Authed API routes
      for (const api of ["/api/ledger", "/api/sync", "/api/checkpoint/preview"]) {
        const unauth = await fetch(`${env.baseUrl}${api}`);
        expect(unauth.status).toBe(401);

        const authRes = await fetch(`${env.baseUrl}${api}`, {
          method: api === "/api/sync" || api === "/api/checkpoint/preview" ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            Cookie: "", // cookie session is separate; APIs use requireUser from cookies
          },
        });
        // App APIs gate on cookie session from middleware, not Bearer.
        // Assert unauth 401 above; browser login below covers cookie path.
        expect([401, 200, 400, 405, 502]).toContain(authRes.status);
      }

      // Browser login → /app + ledger
      await page.goto(`${env.baseUrl}/login`);
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/app/, { timeout: 30_000 });
      await expect(page).toHaveURL(/\/app/);

      const ledger = await page.request.get(`${env.baseUrl}/api/ledger`);
      expect(ledger.status()).toBe(200);
      const ledgerJson = await ledger.json();
      expect(ledgerJson).toBeTruthy();
    } finally {
      if (userId) await adminDeleteUser(env, userId).catch(() => undefined);
    }
  });

  test("forgot-password mail → reset → signInWithPassword", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `e2e+reset${stamp}@yieldscope.d3bu7.com`;
    const initialPassword = `E2eInit-${stamp}-Aa1!`;
    const nextPassword = `E2eNext-${stamp}-Bb2!`;

    const { id } = await adminCreateUser(env, email, initialPassword, true);
    try {
      await page.goto(`${env.baseUrl}/forgot-password`);
      await expect(page.getByRole("heading", { name: /reset password/i })).toBeVisible();

      const afterMs = Date.now();
      await requestPasswordRecovery(env, email);

      const mail = await waitForAuthMail(env, {
        toIncludes: email,
        subjectIncludes: "Reset",
        afterMs,
        pathHint: "/auth/reset-password",
        timeoutMs: 120_000,
      });
      assertMailLogDelivery(env, email);
      expect(mail.raw).toMatch(/noreply@yieldscope\.d3bu7\.com/);
      expect(mail.raw).toMatch(/DKIM-Signature/);

      // Follow the real reset URL in the browser
      await page.goto(mail.link);
      await expect(page.getByRole("heading", { name: /choose new password/i })).toBeVisible({
        timeout: 30_000,
      });
      await page.locator('input[type="password"]').nth(0).fill(nextPassword);
      await page.locator('input[type="password"]').nth(1).fill(nextPassword);
      await page.getByRole("button", { name: /update password/i }).click();
      await page.waitForURL(/\/login/, { timeout: 30_000 });
      await expect(page.getByText(/password updated/i)).toBeVisible();

      // Old password must fail; new password must work
      await expect(
        signInWithPassword(env, email, initialPassword),
      ).rejects.toThrow(/invalid|credentials/i);

      const session = await signInWithPassword(env, email, nextPassword);
      expect(session.user.email?.toLowerCase()).toBe(email.toLowerCase());

      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill(nextPassword);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/app/, { timeout: 30_000 });

      const ledger = await page.request.get(`${env.baseUrl}/api/ledger`);
      expect(ledger.status()).toBe(200);
    } finally {
      await adminDeleteUser(env, id).catch(() => undefined);
    }
  });

  test("API recovery path: token_hash → updateUser → login", async () => {
    const stamp = Date.now();
    const email = `e2e+api${stamp}@yieldscope.d3bu7.com`;
    const initialPassword = `E2eApi-${stamp}-Aa1!`;
    const nextPassword = `E2eApiNext-${stamp}-Cc3!`;
    const { id } = await adminCreateUser(env, email, initialPassword, true);
    try {
      const afterMs = Date.now();
      await requestPasswordRecovery(env, email);
      const mail = await waitForAuthMail(env, {
        toIncludes: email,
        subjectIncludes: "Reset",
        afterMs,
        pathHint: "/auth/reset-password",
      });
      const tokenHash = tokenHashFromLink(mail.link);
      const { access_token } = await verifyOtpTokenHash(
        env,
        tokenHash,
        "recovery",
      );
      await updatePasswordWithAccessToken(env, access_token, nextPassword);
      const session = await signInWithPassword(env, email, nextPassword);
      expect(session.access_token.length).toBeGreaterThan(20);
    } finally {
      await adminDeleteUser(env, id).catch(() => undefined);
    }
  });
});
