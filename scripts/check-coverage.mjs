#!/usr/bin/env node
/**
 * Fail-closed coverage gate for YieldScope.
 * Exits non-zero if lines/functions/branches/statements < 80%.
 *
 * Usage: node scripts/check-coverage.mjs
 *        (runs `pnpm exec vitest run --coverage` first unless --summary-only)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const summaryPath = join(root, "coverage", "coverage-summary.json");
const THRESHOLD = 80;
const summaryOnly = process.argv.includes("--summary-only");

function runVitestCoverage() {
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", "--coverage"],
    {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: process.env,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readPercents() {
  if (!existsSync(summaryPath)) {
    console.error(`Missing ${summaryPath}. Run vitest with --coverage first.`);
    process.exit(1);
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const total = summary.total;
  if (!total) {
    console.error("coverage-summary.json missing total section");
    process.exit(1);
  }
  return {
    lines: total.lines.pct,
    functions: total.functions.pct,
    branches: total.branches.pct,
    statements: total.statements.pct,
  };
}

if (!summaryOnly) {
  runVitestCoverage();
}

const pct = readPercents();
const metrics = ["lines", "functions", "branches", "statements"];
let failed = false;

console.log("\nCoverage gate (≥80%):");
for (const m of metrics) {
  const v = pct[m];
  const ok = typeof v === "number" && v >= THRESHOLD;
  console.log(`  ${m}: ${v}% ${ok ? "OK" : "FAIL"}`);
  if (!ok) failed = true;
}

if (failed) {
  console.error("\nCoverage below 80% — refuse to claim done.");
  process.exit(1);
}

console.log("\nCoverage gate passed.");
process.exit(0);
