import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // pdf-parse uses pdfjs-dist workers that fail when bundled by Turbopack;
  // @node-rs/argon2 uses native Node.js bindings. Both must run as externals.
  serverExternalPackages: ["pdf-parse", "@node-rs/argon2"],
};

export default nextConfig;
