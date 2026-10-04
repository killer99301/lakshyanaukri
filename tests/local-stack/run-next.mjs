// Starts Next.js against the LOCAL in-memory test database only.
//
//   node tests/local-stack/run-next.mjs dev | build | start | cache-test | auth-test   [--no-gemini]
//
// Requires `npm run test:stack:db` to be running. Process environment wins over
// .env.local, so the real DATABASE_URL, Redis and email settings are never used.
// The Gemini key from .env.local is kept (for live AI Assist tests) unless
// --no-gemini is passed.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cert = join(root, "tests", "local-stack", ".tmp", "cert.pem");
if (!existsSync(cert)) {
  console.error("No local test certificate found. Start the test database first: npm run test:stack:db");
  process.exit(1);
}

const mode = process.argv[2] ?? "dev";
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://test:test@localhost/test",
  NODE_EXTRA_CA_CERTS: cert,
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  RESEND_API_KEY: "",
  GITHUB_TOKEN: "",
  ADMIN_ALLOWED_ORIGINS: "http://localhost:3000",
  ADMIN_OTP_HMAC_KEY: "local-test-hmac-key-not-a-secret",
};
if (process.argv.includes("--no-gemini")) env.GEMINI_API_KEY = "";

// Test modes: run a test file with the same isolated environment. The local
// certificate has to be trusted from process start, which is why tests that
// talk to the HTTPS test database go through this launcher.
const TESTS = {
  "cache-test": "tests/local-stack/production-cache.test.ts",
  "auth-test": "tests/auth/auth-real.test.ts",
};

let child;
if (TESTS[mode]) {
  child = spawn("npx", ["tsx", "--tsconfig", "tsconfig.json", TESTS[mode]], { cwd: root, env, stdio: "inherit", shell: true });
} else {
  const args = [join(root, "node_modules", "next", "dist", "bin", "next"), mode];
  if (mode !== "build") args.push("-p", "3000");
  child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
}
child.on("exit", (code) => process.exit(code ?? 0));
