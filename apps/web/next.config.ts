import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  devIndicators: false,
  // Workspace packages ship raw .ts; let Next compile them.
  transpilePackages: ["@quod/contracts", "@quod/intel"],
  // pg and the OpenAI SDK are server-only; keep them out of the bundle.
  serverExternalPackages: ["pg", "openai"],
};

export default nextConfig;
