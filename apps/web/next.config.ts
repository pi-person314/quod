import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship raw .ts; let Next compile them.
  transpilePackages: ["@cairn/contracts", "@cairn/intel"],
  // pg and the OpenAI SDK are server-only; keep them out of the bundle.
  serverExternalPackages: ["pg", "openai"],
};

export default nextConfig;
