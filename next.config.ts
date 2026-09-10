import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // pdf-parse and pdfjs-dist use workers/relative paths that fail when bundled
  // by Turbopack; @node-rs/argon2 uses native Node.js bindings. All must run as
  // externals so Node.js resolves them from node_modules at Lambda runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@node-rs/argon2"],
};

export default nextConfig;
