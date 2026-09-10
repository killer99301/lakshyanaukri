import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // pdf-parse and pdfjs-dist use workers/relative paths that fail when bundled
  // by Turbopack; @node-rs/argon2 uses native Node.js bindings. All must run as
  // externals so Node.js resolves them from node_modules at Lambda runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@node-rs/argon2"],
  // Vercel's file tracer follows static imports only; pdfjs-dist references its
  // worker at runtime via import.meta.url so the tracer never includes it.
  // Explicitly include the worker file so the Lambda can find it on disk.
  outputFileTracingIncludes: {
    "/api/admin/intake": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    ],
  },
};

export default nextConfig;
