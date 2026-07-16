import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Parent repo has its own pnpm-lock.yaml; pin Turbopack to this app.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
