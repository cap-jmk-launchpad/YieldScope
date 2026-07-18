#!/usr/bin/env node
/**
 * Cursor `stop` hook: enforce ≥80% Vitest coverage before the agent can claim done.
 * Fail-closed: invalid JSON / crash / timeout blocks completion when failClosed is set.
 *
 * Input: JSON on stdin (stop event)
 * Output: JSON with optional followup_message when coverage fails
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "{}";
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// Consume stdin so the hook protocol is satisfied
void readStdin();

const checkScript = join(projectRoot, "scripts", "check-coverage.mjs");
if (!existsSync(checkScript)) {
  emit({
    followup_message:
      "Coverage gate script missing (scripts/check-coverage.mjs). Restore it and re-run coverage before finishing.",
  });
  process.exit(0);
}

// Isolate from any concurrent agent `pnpm test:coverage` so V8 merge does not
 // ENOENT on a shared coverage/.tmp/coverage-N.json (common on Windows).
const hookCoverageDir = join(
  "coverage",
  ".runs",
  `hook-${process.pid}-${Date.now().toString(36)}`,
).replace(/\\/g, "/");

const result = spawnSync(process.execPath, [checkScript], {
  cwd: projectRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    COVERAGE_DIR: hookCoverageDir,
  },
  timeout: 240_000,
});

const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

if (result.status === 0) {
  // Coverage OK — no follow-up required
  emit({});
  process.exit(0);
}

const snippet = combined
  .split("\n")
  .filter((l) => /Coverage|FAIL|OK|%|below|gate/i.test(l))
  .slice(-12)
  .join("\n");

emit({
  followup_message: [
    "Coverage gate failed (<80% lines/functions/branches/statements).",
    "Do not claim the task complete. Run `pnpm test:coverage` / `node scripts/check-coverage.mjs`, add tests for web/src/lib adapters, auth, ledger-db, sync, merkle, and supabase middleware until all thresholds pass, then finish.",
    snippet ? `Latest coverage output:\n${snippet}` : "",
  ]
    .filter(Boolean)
    .join("\n\n"),
});
process.exit(0);
