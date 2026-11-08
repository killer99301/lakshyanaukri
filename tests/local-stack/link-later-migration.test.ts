// ═══════════════════════════════════════════════════════════
// "Link not released yet": the migration, on a disposable local database
// ═══════════════════════════════════════════════════════════
//
// docs/apply-link-not-yet-open-design.md, revision 3, §6. The database is
// first put back to how the importer left it at fcb8bdc (the kind and
// public-note checks as they were, the decision trigger function from
// fcb8bdc's schema.sql), with real imports and decisions in it. Then:
//   M1 before: the check reports what is missing; the new kind is refused;
//   M2 the migration (scripts/cms-add-link-later.ts) applied: nothing missing;
//      every existing claim row byte-for-byte the same;
//   M3 run a second time: still nothing missing, still the same rows;
//   M4 the existing decisions still work (verify, not applicable, not stated,
//      withdraw), and the new kind is accepted;
//   M5 old code (fcb8bdc's classify.ts) reading the new rows: the decision
//      is ignored, the Apply Online link stays a blocker (rolling the code
//      back never lets a job through on it);
//   M6 rolling the database function back (fcb8bdc's schema.sql run again)
//      leaves every row valid; running the migration again restores it.
// Local PGlite only: never Neon, never production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/link-later-migration.test.ts
// ═══════════════════════════════════════════════════════════

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import { splitSqlStatements } from "@/lib/cms/importer/sql-split";

const CHECKPOINT = "fcb8bdc";
const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-MIGRATION-2099.pdf";
const LINK_LINE = "The link for online registration will be activated on www.ibps.in from 01.12.2099";
const PDF = makePdf([
  "Institute of Banking Personnel Selection\nCommon Recruitment Process TEST MIGRATION 2099\nAge Limit: as per the detailed rules of the participating banks",
  `Important dates\n${LINK_LINE}\nOnline registration: 03.12.2099 to 23.12.2099`,
]);
const OLD_KIND = "ALTER TABLE recruitment_field_claims ADD CHECK (kind IN ('EXTRACTED', 'ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED', 'ADMIN_REVOKED'))";
const OLD_NOTE = "ALTER TABLE recruitment_field_claims ADD CHECK (public_note IS NULL OR (kind IN ('ADMIN_NOT_STATED', 'ADMIN_NOT_APPLICABLE') AND length(public_note) <= 160))";

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { fieldStates, firstImportAt } = await import("@/lib/cms/importer/repository");
  const { inspectLinkLater, migrateLinkLater } = await import("../../scripts/cms-add-link-later");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const oldSchema = execSync(`git show ${CHECKPOINT}:src/lib/cms/importer/schema.sql`, { encoding: "utf8" });
  const oldFunction = splitSqlStatements(oldSchema).find((s) => /FUNCTION public\.cms_importer_check_claim\(\)/.test(s))!;
  const runAll = async (statements: string[]) => { await pg.transaction(async (tx) => { for (const s of statements) await tx.query(s); }); };
  // The migration script's own function (one transaction through the database driver).
  const migrate = async () => { const n = await migrateLinkLater(); console.log(`  migration ran ${n} statements in one transaction`); };
  const claimsHash = async () => (await pg.query("SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(c)::text, '|' ORDER BY c.seq), '')) AS h FROM recruitment_field_claims c")).rows[0] as { n: number; h: string };
  const checkCount = async () => (await pg.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.recruitment_field_claims'::regclass AND contype = 'c'")).rows[0].n as number;

  // ── The database as fcb8bdc left it ──
  section("Before: the database as at fcb8bdc, with real decisions in it");
  await runAll([
    "ALTER TABLE recruitment_field_claims DROP CONSTRAINT recruitment_field_claims_kind_v2",
    "ALTER TABLE recruitment_field_claims DROP CONSTRAINT recruitment_field_claims_public_note_v2",
    "ALTER TABLE recruitment_field_claims DROP CONSTRAINT recruitment_field_claims_not_yet_open",
    OLD_KIND, OLD_NOTE, oldFunction,
  ]);
  const p = await service.previewImport({ adminId, mode: "NEW", apiKey: undefined,
    newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2099, title: "TEST RECORD IBPS MIGRATION 2099", govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} (migration test)` }] } as never);
  const ticked = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
  const id = (await service.applyImportFlow({ importId: p.importId, adminId, selected: ticked, confirmReplaceVerified: false, override: null })).recruitmentId;
  const doc = (await service.checksFor((await getRecruitmentById(id))!)).retrievals[0].id;
  const rowOf = async (path: string) => (await service.checksFor((await getRecruitmentById(id))!)).rows.find((r) => r.fieldPath === path)!;
  const decide = async (path: string, kind: "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED" | "ADMIN_NOT_YET_OPEN", o: { page?: number | null; quote?: string | null; justification?: string | null; reviewScope?: unknown; linkLater?: unknown }) => {
    const r = await rowOf(path);
    try {
      await service.decide({ recruitmentId: id, adminId, fieldPath: path, kind, retrievalId: doc, page: o.page ?? null, quote: o.quote ?? null, tableCell: null,
        reviewScope: (o.reviewScope ?? null) as never, justification: o.justification ?? null, publicNote: null, linkLater: (o.linkLater ?? null) as never,
        seen: { revisionId: r.latestRevisionId, decisionId: r.decisionId ?? null } });
      return "accepted";
    } catch (e) { return `refused: ${(e as Error).message}`; }
  };
  const rev = async () => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "dates.applicationCloseDate", field: { value: "2099-12-23", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(), reason: "migration test" }), { params: Promise.resolve({ id }) });
  const oldDecisions = [
    await decide("dates.applicationCloseDate", "ADMIN_VERIFIED", { page: 2, quote: "Online registration: 03.12.2099 to 23.12.2099" }),
    await decide("age", "ADMIN_NOT_APPLICABLE", { page: 1, quote: "Age Limit: as per the detailed rules of the participating banks", justification: "Set by each participating bank" }),
    await decide("financial.feeGeneral", "ADMIN_NOT_STATED", { reviewScope: { whole_document: true }, justification: "Not given in this synthetic test notice" }),
  ];
  const LATER = { linkReleaseOn: "2099-12-01", applicationsOpenOn: "2099-12-03", where: "www.ibps.in", reviewerConfirmed: true };
  const newKind = () => decide("links#APPLY_ONLINE", "ADMIN_NOT_YET_OPEN", { page: 2, quote: `${LINK_LINE}\nOnline registration: 03.12.2099 to 23.12.2099`, justification: "The notice says the registration link will be activated later", linkLater: LATER });
  const problemsBefore = await inspectLinkLater();
  const refusedBefore = await newKind();
  check("M1 before: the check names what is missing, existing decisions recorded, the new kind refused by the database",
    problemsBefore.length >= 3 && oldDecisions.every((d) => d === "accepted") && refusedBefore.startsWith("refused"), { problemsBefore, oldDecisions, refusedBefore });
  const h0 = await claimsHash();

  // ── Migrate ──
  section("The migration");
  await migrate();
  const after1 = await inspectLinkLater();
  const h1 = await claimsHash();
  const c1 = await checkCount();
  check("M2 applied: nothing missing; every existing claim row unchanged", after1.length === 0 && h1.n === h0.n && h1.h === h0.h, { after1, h0, h1 });
  await migrate();
  const h2 = await claimsHash();
  check("M3 run a second time: nothing missing, the same rows, the same number of checks", (await inspectLinkLater()).length === 0 && h2.h === h0.h && (await checkCount()) === c1, { c1, c2: await checkCount() });

  // ── After ──
  section("After: existing decisions and the new one");
  const newAccepted = await newKind();
  const notStated = await decide("financial.feeSCST", "ADMIN_NOT_STATED", { reviewScope: { whole_document: true }, justification: "Not given in this synthetic test notice" });
  const ageRow = await rowOf("age");
  await service.revoke({ recruitmentId: id, adminId, fieldPath: "age", decisionId: ageRow.decisionId! });
  const reAge = await decide("age", "ADMIN_NOT_APPLICABLE", { page: 1, quote: "Age Limit: as per the detailed rules of the participating banks", justification: "Set by each participating bank" });
  const applyRow = await rowOf("links#APPLY_ONLINE");
  await service.revoke({ recruitmentId: id, adminId, fieldPath: "links#APPLY_ONLINE", decisionId: applyRow.decisionId! });
  const reLater = await newKind();
  check("M4 existing kinds still work (not stated, withdraw, not applicable); the new kind is accepted and can be withdrawn",
    newAccepted === "accepted" && notStated === "accepted" && reAge === "accepted" && reLater === "accepted" && applyRow.cls === "NOT_YET_OPEN", { newAccepted, notStated, reAge, reLater, cls: applyRow.cls });

  // ── Old code ──
  section("Old code reading the new rows");
  const dir = join(process.cwd(), "tests", "local-stack", ".tmp");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "old-classify.ts"), execSync(`git show ${CHECKPOINT}:src/lib/cms/importer/classify.ts`, { encoding: "utf8" }));
  const old = await import("./.tmp/old-classify");
  const record = (await getRecruitmentById(id))!;
  const states = await fieldStates(record);
  const oldApply = old.classifyField(states.find((s) => s.fieldPath === "links#APPLY_ONLINE")!, await firstImportAt(id));
  const oldGate = old.publishGate(states as never, await firstImportAt(id));
  check("M5 fcb8bdc's classify ignores the new decision: the Apply Online link stays missing and blocks publishing",
    oldApply.cls === "MISSING" && oldGate.blockers.some((b: { fieldPath: string }) => b.fieldPath === "links#APPLY_ONLINE"), { cls: oldApply.cls });

  // ── Rollback of the database function, and forward again ──
  section("Rolling back and forward");
  const hBefore = await claimsHash();
  await runAll(splitSqlStatements(oldSchema));
  const rolledBack = await inspectLinkLater();
  const hRolled = await claimsHash();
  await migrate();
  check("M6 fcb8bdc's schema file run on the migrated database: it runs, every row stays valid and unchanged (only its trigger function goes back); the migration restores it",
    rolledBack.length === 1 && /does not know ADMIN_NOT_YET_OPEN/.test(rolledBack[0]) && hRolled.h === hBefore.h && (await inspectLinkLater()).length === 0, { rolledBack });

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
