import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const outDir = join(pkgRoot, "..", "docs", "demo", "broll");

mkdirSync(outDir, { recursive: true });

const jobs = [
  { id: "ScatteredLedger", file: "scattered-ledger.mp4", port: 3460 },
  { id: "SourceWeave", file: "source-weave.mp4", port: 3461 },
];

for (const job of jobs) {
  const out = join(outDir, job.file);
  console.log(`\n→ Rendering ${job.id} → ${out}`);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "remotion",
      "render",
      "src/index.ts",
      job.id,
      out,
      "--codec=h264",
      "--image-format=jpeg",
      `--port=${job.port}`,
      "--concurrency=1",
    ],
    {
      cwd: pkgRoot,
      stdio: "inherit",
      shell: true,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\n✓ Both B-roll MP4s ready in docs/demo/broll/");
