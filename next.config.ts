import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // pdf-parse and @node-rs/argon2 use native bindings that cannot be bundled.
  serverExternalPackages: ["pdf-parse", "@node-rs/argon2"],
};

export default nextConfig;
