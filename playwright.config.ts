import { defineConfig, devices } from "@playwright/test";

/**
 * Auth E2E against prod (or E2E_BASE_URL).
 *
 *   pnpm test:e2e:auth
 *
 * Requires kubectl + KUBECONFIG (default ~/.kube/config-homelab) for:
 *   - Supabase anon/service keys (if not in env)
 *   - yieldscope-mail maildir reads for e2e@ / e2e+*@ addresses
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://yieldscope.d3bu7.com",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
