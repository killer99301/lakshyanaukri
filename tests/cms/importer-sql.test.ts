// Splitting the importer schema into statements, and the migration's object check
//   npx tsx --tsconfig tsconfig.json tests/cms/importer-sql.test.ts
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { splitSqlStatements } from "@/lib/cms/importer/sql-split";
import { describeProblems, IMPORTER_OBJECTS, type Catalogue } from "@/lib/cms/importer/schema-manifest";

suite("SQL splitting");
test("SQ01 semicolons in strings, identifiers, comments and function bodies do not split", () => {
  const text = `-- a; comment\nSELECT 'a;b', "c;d";\n/* x; y */\nCREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN RETURN 1; END $fn$;\nSELECT 'it''s; fine'`;
  assert.deepEqual(splitSqlStatements(text), [
    `SELECT 'a;b', "c;d"`,
    "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN RETURN 1; END $fn$",
    "SELECT 'it''s; fine'",
  ]);
});
test("SQ02 the importer schema splits into whole statements", () => {
  const parts = splitSqlStatements(readFileSync("src/lib/cms/importer/schema.sql", "utf8"));
  assert.ok(parts.length > 30);
  for (const p of parts) assert.ok(/^(CREATE|DROP|REVOKE)\b/.test(p), p.slice(0, 60));
  assert.ok(parts.some((p) => p.startsWith("CREATE OR REPLACE FUNCTION public.cms_apply_import") && p.endsWith("$fn$")));
});

suite("Migration object check");
const full = (): Catalogue => ({
  columns: Object.entries(IMPORTER_OBJECTS.tables).flatMap(([table, cols]) =>
    Object.entries(cols).map(([column_name, [data_type, nullable]]) => ({ table_name: table, column_name, data_type, is_nullable: nullable ? "YES" : "NO" }))),
  triggers: IMPORTER_OBJECTS.triggers.map(([name, table_name]) => ({ name, table_name, enabled: "O" })),
  functions: IMPORTER_OBJECTS.functions.map((name) => ({ name, security_definer: false, config: "search_path=pg_catalog, pg_temp" })),
  indexes: [...IMPORTER_OBJECTS.indexes],
});
test("SQ03 complete catalogue → no problems", () => assert.deepEqual(describeProblems(full()), []));
test("SQ04 each kind of drift is reported", () => {
  const c = full();
  c.columns = c.columns.map((x) => x.table_name === "recruitment_source_retrievals" && x.column_name === "authenticity" ? { ...x, is_nullable: "YES" } : x);
  c.triggers = c.triggers.map((t) => t.name === "trg_imports_guard" ? { ...t, enabled: "D" } : t);
  c.functions = c.functions.map((f) => f.name === "cms_apply_import" ? { ...f, security_definer: true } : f);
  c.indexes = c.indexes.filter((i) => i !== "uq_field_claims_revoked_once");
  const p = describeProblems(c);
  assert.ok(p.includes("recruitment_source_retrievals.authenticity should be NOT NULL"));
  assert.ok(p.includes("trigger trg_imports_guard on recruitment_imports is disabled"));
  assert.ok(p.includes("function cms_apply_import must not be SECURITY DEFINER"));
  assert.ok(p.includes("index uq_field_claims_revoked_once is missing"));
});
