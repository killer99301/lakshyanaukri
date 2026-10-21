// ═══════════════════════════════════════════════════════════
// Importer schema on real PostgreSQL, with two sessions at once.
//
// Starts a throwaway cluster on 127.0.0.1 (default port 55432) from the local
// PostgreSQL installation, loads the schema exactly as the migration does
// (split statements, one transaction, twice), checks every object, runs the
// concurrency scenarios with two psql sessions, then stops the cluster and
// deletes its folder. Never touches any other database.
//
//   PG_BIN="C:\Program Files\PostgreSQL\17\bin" npx tsx --tsconfig tsconfig.json tests/pg/importer-concurrency.test.ts
// ═══════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { splitSqlStatements } from "@/lib/cms/importer/sql-split";
import { describeProblems, IMPORTER_OBJECTS } from "@/lib/cms/importer/schema-manifest";

const BIN = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
const PORT = process.env.PG_TEST_PORT ?? "55432";
const exe = (name: string) => join(BIN, process.platform === "win32" ? `${name}.exe` : name);

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? " — " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) : ""}`); }
};
const section = (s: string) => console.log(`\n── ${s}`);

function run(cmd: string, args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    // pg_ctl hands its output handles to the server it starts, so its pipes
    // never close; it gets no pipes and is awaited by its exit.
    if (cmd.endsWith(process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl")) {
      const c = spawn(cmd, args, { stdio: "ignore" });
      c.on("exit", (code) => resolve({ code: code ?? 1, out: "", err: code === 0 ? "" : `pg_ctl exited with ${code}` }));
      return;
    }
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out, err }));
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}
const psqlArgs = ["-h", "127.0.0.1", "-p", PORT, "-U", "probe", "-d", "importer_test", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
const psql = (sqlText: string) => run(exe("psql"), psqlArgs, sqlText);
const one = async (sqlText: string) => {
  const r = await psql(sqlText);
  if (r.code !== 0) throw new Error(`psql failed: ${r.err}`);
  return r.out.trim();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const data = mkdtempSync(join(tmpdir(), "importer-pg-"));
  try {
    const init = await run(exe("initdb"), ["-D", data, "-U", "probe", "-A", "trust", "-E", "UTF8"]);
    if (init.code !== 0) throw new Error(`initdb: ${init.err}`);
    const start = await run(exe("pg_ctl"), ["-D", data, "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`, "-l", join(data, "log.txt"), "-w", "start"]);
    if (start.code !== 0) throw new Error(`pg_ctl start: ${start.err}`);
    await run(exe("createdb"), ["-h", "127.0.0.1", "-p", PORT, "-U", "probe", "importer_test"]);
    const version = await one("SHOW server_version");
    console.log(`PostgreSQL ${version} on 127.0.0.1:${PORT}, folder ${data}`);

    section("Schema: existing files, then the importer exactly as the migration runs it");
    for (const f of ["src/lib/auth/schema.sql", "src/lib/cms/schema.sql", "src/lib/intelligence/schema.sql"]) {
      const r = await run(exe("psql"), [...psqlArgs, "-f", f]);
      if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
    }
    await one(["classification", "exam_stages", "exam_pattern", "syllabus", "taken_down"].map((c) => `ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS ${c} JSONB;`).join("\n"));
    const statements = splitSqlStatements(readFileSync("src/lib/cms/importer/schema.sql", "utf8"));
    const asMigration = `BEGIN;\n${statements.map((s) => s + ";").join("\n")}\nCOMMIT;`;
    const first = await psql(asMigration);
    check(`migration statements (${statements.length}) run in one transaction`, first.code === 0, first.err);
    const second = await psql(asMigration);
    check("running it a second time changes nothing and succeeds", second.code === 0, second.err);
    const tables = Object.keys(IMPORTER_OBJECTS.tables).map((t) => `'${t}'`).join(",");
    const cat = JSON.parse(await one(`SELECT json_build_object(
      'columns', (SELECT json_agg(json_build_object('table_name', table_name, 'column_name', column_name, 'data_type', data_type, 'is_nullable', is_nullable)) FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${tables})),
      'triggers', (SELECT json_agg(json_build_object('name', t.tgname, 'table_name', c.relname, 'enabled', t.tgenabled)) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN (${tables})),
      'functions', (SELECT json_agg(json_build_object('name', p.proname, 'security_definer', p.prosecdef, 'config', coalesce(array_to_string(p.proconfig, ','), ''))) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'cms\\_%'),
      'indexes', (SELECT json_agg(indexname) FROM pg_indexes WHERE schemaname = 'public'))`));
    const problems = describeProblems(cat);
    check("every table, column, index, trigger and function as expected", problems.length === 0, problems);
    const broken = describeProblems({ ...cat, triggers: cat.triggers.filter((t: { name: string }) => t.name !== "trg_field_claims_check") });
    check("the check notices a missing trigger", broken.some((p) => p.includes("trg_field_claims_check")));

    // ── Fixtures ──
    const admin = await one("INSERT INTO admins (username, email, password_hash) VALUES ('a', 'a@example.test', 'x') RETURNING id");
    const field = (v: unknown) => ({ value: v, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false });
    const lit = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
    const recordJson = (slug: string, org: string, year: number, notif?: string) => ({
      slug, identity: { title: field(`Job ${slug}`), organizationId: org, organizationName: org, recruitmentYear: year, ...(notif ? { notificationNumber: field(notif) } : {}) },
      dates: { applicationCloseDate: field("2026-11-01") }, vacancies: {}, financial: {}, lifecycle: { status: "DRAFT", conflicts: [], events: [] },
      provenance: {}, links: [], documents: [], updates: [], record_revision: "rev-1", organization_name: org, title_text: `Job ${slug}`,
    });
    const item = { id: "i1", kind: "FIELD", fieldPath: "dates.applicationCloseDate", value: "2026-11-01" };
    const newImport = async (idKey: string | null, orgYear: string) => {
      const id = randomUUID();
      await one(`INSERT INTO recruitment_imports (import_id, mode, org_year_key, identity_key, proposal, created_by)
                 VALUES ('${id}', 'NEW', '${orgYear}', ${idKey ? `'${idKey}'` : "NULL"}, ${lit({ items: [item] })}, '${admin}')`);
      return id;
    };
    const applyCall = (imp: string, rec: unknown) => `SELECT public.cms_apply_import('${imp}', '${admin}', ARRAY['i1'], NULL, ${lit({ record: rec })})`;
    /** Session A holds its transaction open for `holdMs` after its statement; session B starts `delayMs` later. */
    const race = async (a: string, b: string, holdMs = 1500, delayMs = 300) => {
      const pa = psql(`BEGIN;\n${a};\nSELECT pg_sleep(${holdMs / 1000});\nCOMMIT;`);
      await sleep(delayMs);
      const startB = Date.now();
      const rb = await psql(b + ";");
      const waited = Date.now() - startB;
      return { a: await pa, b: rb, waited };
    };

    section("Same import applied by two sessions at once");
    const impSame = await newImport("ADVT 1/2026", "lic-hfl:2026");
    const r1 = await race(applyCall(impSame, recordJson("same-import", "lic-hfl", 2026, "ADVT 1/2026")), applyCall(impSame, recordJson("same-import", "lic-hfl", 2026, "ADVT 1/2026")));
    check("session A applied", r1.a.code === 0, r1.a.err);
    check("session B waited for A, then got A's result marked replayed", r1.b.code === 0 && r1.waited >= 900 && /"replayed": true/.test(r1.b.out), { waited: r1.waited, out: r1.b.out, err: r1.b.err });
    check("exactly one job and one IMPORT_APPLIED event", await one(`SELECT count(*) FROM recruitments WHERE slug = 'same-import'`) === "1"
      && await one(`SELECT count(*) FROM recruitment_audit_events WHERE event_type = 'IMPORT_APPLIED' AND metadata->>'importId' = '${impSame}'`) === "1");

    section("Two different imports of the same notification at once");
    const impA = await newImport("ADVT 2/2026", "ssc:2026");
    const impB = await newImport("ADVT 2/2026", "ssc:2026");
    const r2 = await race(applyCall(impA, recordJson("ssc-a", "ssc", 2026, "ADVT 2/2026")), applyCall(impB, recordJson("ssc-b", "ssc", 2026, "ADVT 2/2026")));
    check("first import created the job", r2.a.code === 0, r2.a.err);
    check("second waited on the lock and was refused as DUPLICATE", r2.b.code !== 0 && /DUPLICATE/.test(r2.b.err) && r2.waited >= 900, { waited: r2.waited, err: r2.b.err });
    check("exactly one job for that notification", await one(`SELECT count(*) FROM recruitments WHERE identity->'notificationNumber'->>'value' = 'ADVT 2/2026'`) === "1");
    check("the second import is still PREVIEWED (nothing half-applied)", await one(`SELECT status FROM recruitment_imports WHERE import_id = '${impB}'`) === "PREVIEWED");

    section("Two manual creates of the same organisation and year at once");
    const manual = (slug: string, force = false) => `SELECT public.cms_create_job_checked(${lit(recordJson(slug, "upsc", 2027))}, 'upsc', 2027, ${force}, '${admin}')`;
    const r3 = await race(manual("upsc-one"), manual("upsc-two"));
    check("first created", r3.a.code === 0 && /"id"/.test(r3.a.out), r3.a.err);
    check("second waited and got the duplicate warning, nothing inserted", r3.b.code === 0 && /"duplicates"/.test(r3.b.out) && r3.waited >= 900, { waited: r3.waited, out: r3.b.out });
    check("one job for upsc 2027", await one(`SELECT count(*) FROM recruitments WHERE organization_id = 'upsc'`) === "1");
    const forced = await one(manual("upsc-forced", true));
    check("create anyway → created and recorded as DUPLICATE_OVERRIDE", /"id"/.test(forced)
      && await one(`SELECT count(*) FROM recruitment_audit_events WHERE event_type = 'DUPLICATE_OVERRIDE' AND metadata->>'via' = 'manual'`) === "1");

    section("A manual create racing an import of the same organisation and year");
    const impC = await newImport(null, "bpsc:2026");
    const r4 = await race(manual("bpsc-manual").replace(/'upsc'/g, "'bpsc'").replace(/2027/g, "2026"), applyCall(impC, recordJson("bpsc-import", "bpsc", 2026)));
    check("manual create went first", r4.a.code === 0, r4.a.err);
    check("the import waited and was refused as DUPLICATE", r4.b.code !== 0 && /DUPLICATE/.test(r4.b.err), r4.b.err);
    check("one bpsc job", await one(`SELECT count(*) FROM recruitments WHERE organization_id = 'bpsc'`) === "1");

    section("Two sessions revoking the same decision at once");
    const job = await one(`SELECT id FROM recruitments WHERE slug = 'same-import'`);
    const src = await one(`INSERT INTO recruitment_sources (content_sha256, content_kind, byte_size, page_count, text) VALUES ('${"a".repeat(64)}', 'PDF', 10, 1, 't') RETURNING id`);
    const ret = await one(`INSERT INTO recruitment_source_retrievals (import_id, source_id, declared_kind, method, origin_host, origin_role, authenticity, authenticity_method, retrieved_by)
                           VALUES ('${impSame}', '${src}', 'OFFICIAL_NOTIFICATION', 'FETCHED', 'lichousing.com', 'AUTHORITY', 'CONFIRMED', 'FETCHED_BY_SERVER', '${admin}') RETURNING id`);
    const rev = await one(`SELECT id FROM field_revisions WHERE recruitment_id = '${job}' LIMIT 1`).then((x) => x || one(`INSERT INTO field_revisions (recruitment_id, field_path, revised_by) VALUES ('${job}', 'dates.applicationCloseDate', '${admin}') RETURNING id`));
    const revPath = await one(`SELECT field_path FROM field_revisions WHERE id = '${rev}'`);
    const decision = await one(`INSERT INTO recruitment_field_claims (recruitment_id, field_path, kind, value, retrieval_id, page, quote, field_revision_id, claimed_by)
                                VALUES ('${job}', '${revPath}', 'ADMIN_VERIFIED', '"2026-11-01"', '${ret}', 5, '01.11.2026', '${rev}', '${admin}') RETURNING id`);
    const revoke = `INSERT INTO recruitment_field_claims (recruitment_id, field_path, kind, revokes_claim_id, claimed_by) VALUES ('${job}', '${revPath}', 'ADMIN_REVOKED', '${decision}', '${admin}')`;
    const r5 = await race(revoke, revoke);
    check("first revocation stored", r5.a.code === 0, r5.a.err);
    check("second waited and was refused by the unique index", r5.b.code !== 0 && /uq_field_claims_revoked_once|duplicate key/.test(r5.b.err), r5.b.err);
    check("exactly one revocation", await one(`SELECT count(*) FROM recruitment_field_claims WHERE revokes_claim_id = '${decision}'`) === "1");

    console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed (PostgreSQL ${version})`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await run(exe("pg_ctl"), ["-D", data, "-w", "stop"]);
    rmSync(data, { recursive: true, force: true });
    writeFileSync(join(tmpdir(), "importer-pg-last.txt"), `removed ${data}\n`);
  }
})().catch((e) => { console.error("HARNESS ERROR:", e instanceof Error ? e.message : e); process.exit(1); });
