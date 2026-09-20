// Quick table existence probe — run after migration
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) { console.error("No DATABASE_URL"); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);

const TABLES = [
  "recruitments",
  "recruitment_evidence",
  "field_revisions",
  "recruitment_lifecycle_events",
  "published_recruitments",
  "recruitment_audit_events",
];

async function main() {
  let allOk = true;
  for (const t of TABLES) {
    try {
      await sql.query(`SELECT 1 FROM ${t} LIMIT 0`);
      console.log(`✅  ${t}`);
    } catch (e: unknown) {
      const msg = String(e);
      console.log(`❌  ${t} — ${msg.slice(0, 100)}`);
      allOk = false;
    }
  }
  if (allOk) console.log("\nAll 6 CMS tables exist.");
  else console.log("\nSome tables missing.");
  process.exit(allOk ? 0 : 1);
}

main().catch(console.error);
