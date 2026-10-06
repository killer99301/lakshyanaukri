// ═══════════════════════════════════════════════════════════
// Local test database — a stand-in for Neon's HTTP SQL endpoint
// ═══════════════════════════════════════════════════════════
//
// In-memory Postgres (PGlite) loaded with the project's own schema files.
// Nothing here can reach the real database: it has no connection string.
//
// Used two ways:
//   • in-process, via neonConfig.fetchFunction   (boot.ts → API workflow tests)
//   • as https://localhost/sql                   (serve.ts → run the whole app)
// ═══════════════════════════════════════════════════════════

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Queryable = Pick<PGlite, "query">;

interface NeonQuery {
  query: string;
  params?: unknown[];
}

// Neon returns every value as raw Postgres text and the driver parses it by
// type OID, so PGlite's own parsing and serialising are switched off.
const RAW_OIDS = [
  16, 17, 18, 19, 20, 21, 23, 25, 26, 114, 700, 701, 1042, 1043, 1082, 1083, 1114, 1184, 1186, 1700, 2950, 3802,
  199, 1000, 1001, 1005, 1007, 1009, 1014, 1015, 1016, 1021, 1022, 1115, 1182, 1185, 1231, 2951, 3807,
];
const parsers = Object.fromEntries(RAW_OIDS.map((oid) => [oid, (x: string) => x]));
const serializers = Object.fromEntries(
  RAW_OIDS.map((oid) => [oid, (x: unknown) => (x === null || x === undefined ? null : String(x))]),
);

const SCHEMA_FILES = ["src/lib/auth/schema.sql", "src/lib/cms/schema.sql", "src/lib/intelligence/schema.sql"];

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createDb(): Promise<PGlite> {
  const pg = new PGlite();
  for (const file of SCHEMA_FILES) {
    for (const statement of splitStatements(readFileSync(join(process.cwd(), file), "utf8"))) {
      await pg.query(statement);
    }
  }
  // Columns added to production after schema.sql was written.
  await pg.query("ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS classification JSONB");
  await pg.query("ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS exam_stages JSONB");
  await pg.query("ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS exam_pattern JSONB");
  await pg.query("ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS syllabus JSONB");
  return pg;
}

const TX_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i;

async function runOne(db: Queryable, q: NeonQuery) {
  // Over Neon HTTP every request is its own connection, so a lone BEGIN/COMMIT
  // does not span later requests. Reproduce that rather than open a transaction.
  if (TX_CONTROL.test(q.query)) {
    return { command: q.query.trim().toUpperCase().replace(";", ""), rowCount: 0, rows: [], fields: [], rowAsArray: true };
  }
  const res = await db.query(q.query, q.params ?? [], { rowMode: "array", parsers, serializers });
  return {
    command: q.query.trim().split(/\s+/)[0].toUpperCase(),
    rowCount: res.affectedRows ?? res.rows.length,
    rows: res.rows,
    fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowAsArray: true,
  };
}

/** One query is one implicit transaction; a batch is one transaction — as on Neon. */
export async function handle(pg: PGlite, body: NeonQuery | { queries: NeonQuery[] }) {
  if ("queries" in body) {
    const results = await pg.transaction(async (tx) => {
      const out = [];
      for (const q of body.queries) out.push(await runOne(tx as unknown as Queryable, q));
      return out;
    });
    return { results };
  }
  return runOne(pg, body);
}

export function errorBody(e: unknown) {
  const err = e as { message?: string; code?: string };
  return { message: String(err?.message ?? e), code: err?.code ?? "XX000" };
}

/** fetch()-compatible function for neonConfig.fetchFunction. */
export function makeFetch(pg: PGlite, onQuery?: () => void): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    try {
      const out = await handle(pg, JSON.parse(String(init?.body)));
      onQuery?.();
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify(errorBody(e)), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }) as typeof fetch;
}
