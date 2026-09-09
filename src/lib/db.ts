// ═══════════════════════════════════════════════════════════
// Neon HTTP client — shared DB connection
// ═══════════════════════════════════════════════════════════
//
// Uses the @neondatabase/serverless HTTP driver which works in
// both Edge (middleware) and Node.js (API route) runtimes.
//
// Required env var: DATABASE_URL (Neon Postgres connection string)
// ═══════════════════════════════════════════════════════════

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. " +
    "Add it to .env.local: DATABASE_URL=postgresql://user:pass@host/db"
  );
}

export const sql = neon(process.env.DATABASE_URL);
