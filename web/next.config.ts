import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(webRoot, "..");

const nextConfig: NextConfig = {
  output: "standalone",
  // Turbopack must resolve from the monorepo root (not web/ or src/app/) so
  // pnpm-hoisted node_modules/next is visible. See vercel/next.js#92540.
  turbopack: {
    root: monorepoRoot,
  },
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
