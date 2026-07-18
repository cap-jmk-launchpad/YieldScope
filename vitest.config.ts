import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/** Meaningful app surface under coverage gate (≥80%). */
const coverageInclude = [
  "web/src/lib/adapters/**/*.ts",
  "web/src/lib/auth/**/*.ts",
  "web/src/lib/supabase/admin.ts",
  "web/src/lib/supabase/middleware.ts",
  "web/src/lib/ledger-db.ts",
  "web/src/lib/ledger-store.ts",
  "web/src/lib/merkle.ts",
  "web/src/lib/sync.ts",
  "web/src/lib/credentials-crypto.ts",
  "web/src/lib/credentials-db.ts",
  "web/src/lib/prices/**/*.ts",
  "web/src/lib/sync-range.ts",
  "web/src/lib/earnings-charts.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Windows + AV: parallel V8 coverage merges can ENOENT on coverage/.tmp/*.json
    // when multiple workers flush concurrently. Keep merge reads serial.
    fileParallelism: true,
    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: process.env.COVERAGE_DIR || "coverage",
      // Serialize coverage file reads/writes — avoids ENOENT races on Windows.
      processingConcurrency: 1,
      include: coverageInclude,
      exclude: [
        "**/*.d.ts",
        "**/types.ts",
        "web/src/lib/contracts.ts",
        "web/src/lib/supabase/client.ts",
        "web/src/lib/supabase/server.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "web/src"),
      next: resolve(__dirname, "web/node_modules/next"),
      "@supabase/ssr": resolve(__dirname, "web/node_modules/@supabase/ssr"),
    },
  },
});
