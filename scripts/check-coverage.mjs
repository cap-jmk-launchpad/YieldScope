#!/usr/bin/env node
/**
 * Fail-closed coverage gate for YieldScope.
 * - Global gate: lines/functions/branches/statements ≥ 80%
 * - Backend-ops gate: 100% on the server/lib coverage include set
 *
 * Usage: node scripts/check-coverage.mjs
 *        (runs `pnpm exec vitest run --coverage` first unless --summary-only)
 *
 * Optional: COVERAGE_DIR=coverage-agent to isolate reports from concurrent Vitest runs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coverageDir = process.env.COVERAGE_DIR || "coverage";
const summaryPath = join(root, coverageDir, "coverage-summary.json");
const GLOBAL_THRESHOLD = 80;
const BACKEND_OPS_THRESHOLD = 100;
const summaryOnly = process.argv.includes("--summary-only");

function isBackendOpsFile(filePath) {
  const norm = filePath.replace(/\\/g, "/");
  return (
    /\/web\/src\/lib\/adapters\//.test(norm) ||
    /\/web\/src\/lib\/auth\//.test(norm) ||
    /\/web\/src\/lib\/supabase\/(admin|middleware)\.ts$/.test(norm) ||
    /\/web\/src\/lib\/(ledger-db|ledger-store|merkle|sync|sync-range|credentials-crypto|credentials-db|earnings-charts)\.ts$/.test(
      norm,
    ) ||
    /\/web\/src\/lib\/prices\//.test(norm)
  );
}

function runVitestCoverage() {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--coverage",
      `--coverage.reportsDirectory=${coverageDir}`,
    ],
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

function readSummary() {
  if (!existsSync(summaryPath)) {
    console.error(`Missing ${summaryPath}. Run vitest with --coverage first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(summaryPath, "utf8"));
}

function pctOf(metric) {
  if (!metric || typeof metric.total !== "number" || metric.total === 0) {
    return 100;
  }
  return (metric.covered / metric.total) * 100;
}

function checkThreshold(label, pct, threshold) {
  const metrics = ["lines", "functions", "branches", "statements"];
  let failed = false;
  console.log(`\n${label} (≥${threshold}%):`);
  for (const m of metrics) {
    const v = pct[m];
    const ok = typeof v === "number" && v >= threshold;
    console.log(`  ${m}: ${v.toFixed(2)}% ${ok ? "OK" : "FAIL"}`);
    if (!ok) failed = true;
  }
  return failed;
}

if (!summaryOnly) {
  runVitestCoverage();
}

const summary = readSummary();
const total = summary.total;
if (!total) {
  console.error("coverage-summary.json missing total section");
  process.exit(1);
}

const globalPct = {
  lines: total.lines.pct,
  functions: total.functions.pct,
  branches: total.branches.pct,
  statements: total.statements.pct,
};

let failed = checkThreshold(
  `Coverage gate [${coverageDir}]`,
  globalPct,
  GLOBAL_THRESHOLD,
);

const agg = {
  lines: { covered: 0, total: 0 },
  statements: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
};
const perFileFails = [];

for (const [file, data] of Object.entries(summary)) {
  if (file === "total") continue;
  if (!isBackendOpsFile(file)) continue;
  for (const m of Object.keys(agg)) {
    agg[m].covered += data[m].covered;
    agg[m].total += data[m].total;
  }
  for (const m of ["lines", "functions", "branches", "statements"]) {
    if (data[m].pct < BACKEND_OPS_THRESHOLD) {
      perFileFails.push(
        `${file.replace(/\\/g, "/").split("/web/src/lib/").pop()}: ${m} ${data[m].pct}% (${data[m].covered}/${data[m].total})`,
      );
    }
  }
}

const backendPct = {
  lines: pctOf(agg.lines),
  functions: pctOf(agg.functions),
  branches: pctOf(agg.branches),
  statements: pctOf(agg.statements),
};

failed =
  checkThreshold("Backend-ops coverage", backendPct, BACKEND_OPS_THRESHOLD) ||
  failed;

if (perFileFails.length) {
  console.error("\nBackend-ops files below 100%:");
  for (const line of perFileFails) console.error(`  ${line}`);
  failed = true;
}

if (failed) {
  console.error("\nCoverage gate failed — refuse to claim done.");
  process.exit(1);
}

console.log("\nCoverage gate passed (global ≥80%, backend-ops 100%).");
process.exit(0);
