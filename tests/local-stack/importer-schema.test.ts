// ═══════════════════════════════════════════════════════════
// Importer schema: constraints, triggers and the apply function, against the
// in-memory test database (PGlite, real PostgreSQL). Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-schema.test.ts
// ═══════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { createDb } from "./emulator";
import { check, section, summary } from "./boot";

type Row = Record<string, unknown>;

(async () => {
  const pg = await createDb();
  const q = async (text: string, params: unknown[] = []) => (await pg.query<Row>(text, params)).rows;
  /** Runs a statement and returns the error message, or null when it succeeded. */
  const refused = async (text: string, params: unknown[] = []): Promise<string | null> => {
    try { await pg.query(text, params); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  const hex = (c: string) => c.repeat(64);

  // ── Fixtures ──
  const [admin] = await q("INSERT INTO admins (username, email, password_hash) VALUES ('a', 'a@example.test', 'x') RETURNING id");
  const adminId = admin.id as string;
  const field = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false });
  const newJob = async (slug: string, org = "lic-hfl", year = 2026, notif: string | null = null) => {
    const identity = { title: field(`Job ${slug}`), organizationId: org, organizationName: org.toUpperCase(), recruitmentYear: year,
      ...(notif ? { notificationNumber: field(notif) } : {}) };
    const [r] = await q(
      `INSERT INTO recruitments (slug, identity, organization_id, organization_name, title_text, record_revision)
       VALUES ($1, $2, $3, $4, $5, 'rev-1') RETURNING id`,
      [slug, JSON.stringify(identity), org, org.toUpperCase(), `Job ${slug}`],
    );
    return r.id as string;
  };
  const job1 = await newJob("job-one", "lic-hfl", 2026, "Advt 10/2026");
  const job2 = await newJob("job-two", "ssc", 2026);
  const proposal = (items: unknown[] = []) => JSON.stringify({ items });
  const newImport = async (opts: { mode?: "NEW" | "EXISTING"; job?: string | null; base?: string | null; org?: string | null; idKey?: string | null; items?: unknown[] } = {}) => {
    const id = randomUUID();
    const mode = opts.mode ?? "EXISTING";
    await q(
      `INSERT INTO recruitment_imports (import_id, mode, recruitment_id, base_revision, org_year_key, identity_key, proposal, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, mode, mode === "EXISTING" ? (opts.job ?? job1) : null, mode === "EXISTING" ? (opts.base ?? "rev-1") : null,
       mode === "NEW" ? (opts.org === undefined ? "lic-hfl:2026" : opts.org) : null, opts.idKey ?? null, proposal(opts.items), adminId],
    );
    return id;
  };
  const newSource = async (kind = "PDF", sha = randomUUID().replace(/-/g, "").padEnd(64, "0")) => {
    const [s] = await q("INSERT INTO recruitment_sources (content_sha256, content_kind, byte_size, page_count, text) VALUES ($1, $2, 1000, 3, 'text') RETURNING id", [sha, kind]);
    return s.id as string;
  };
  const retrieval = async (importId: string, sourceId: string, cols: Record<string, unknown>) => {
    const base: Record<string, unknown> = {
      import_id: importId, source_id: sourceId, declared_kind: "OFFICIAL_NOTIFICATION", method: "FETCHED",
      origin_host: "lichousing.com", origin_role: "AUTHORITY", authenticity: "CONFIRMED",
      authenticity_method: "FETCHED_BY_SERVER", retrieved_by: adminId, ...cols,
    };
    const keys = Object.keys(base);
    const sqlText = `INSERT INTO recruitment_source_retrievals (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`;
    return sqlText ? { sqlText, params: keys.map((k) => base[k]) } : null!;
  };
  const insertRetrieval = async (importId: string, sourceId: string, cols: Record<string, unknown> = {}) => {
    const r = await retrieval(importId, sourceId, cols);
    return (await q(r.sqlText, r.params))[0].id as string;
  };
  const tryRetrieval = async (importId: string, sourceId: string, cols: Record<string, unknown>) => {
    const r = await retrieval(importId, sourceId, cols);
    return refused(r.sqlText, r.params);
  };
  const newRevision = async (job: string, path: string) => {
    const [r] = await q("INSERT INTO field_revisions (recruitment_id, field_path, revised_by, new_value) VALUES ($1, $2, $3, 'null') RETURNING id", [job, path, adminId]);
    return r.id as string;
  };

  const imp1 = await newImport();
  const src1 = await newSource();
  const fetch1 = await insertRetrieval(imp1, src1);

  section("Authenticity: the five valid combinations");
  check("CONFIRMED by server fetch", fetch1 !== undefined);
  check("CONFIRMED by hash match of that fetch", await tryRetrieval(imp1, src1, { method: "UPLOADED", authenticity_method: "HASH_MATCHES_SERVER_FETCH", matched_retrieval_id: fetch1 }) === null);
  check("ATTESTED upload", await tryRetrieval(imp1, src1, { method: "UPLOADED", authenticity: "ATTESTED", authenticity_method: "ADMIN_ATTESTED", attested_by: adminId, attested_at: new Date().toISOString(), attestation_note: "downloaded from rrbcdg.gov.in by hand" }) === null);
  check("UNCONFIRMED upload", await tryRetrieval(imp1, src1, { method: "UPLOADED", authenticity: "UNCONFIRMED", authenticity_method: null }) === null);
  check("research: NOT_APPLICABLE", await tryRetrieval(imp1, src1, { method: "PASTED", declared_kind: "RESEARCH", origin_role: "NONE", origin_host: null, authenticity: "NOT_APPLICABLE", authenticity_method: null }) === null);

  section("Authenticity: invalid combinations and NULLs are refused");
  const bad: Array<[string, Record<string, unknown>]> = [
    ["authenticity NULL", { authenticity: null }],
    ["CONFIRMED with NULL method", { authenticity_method: null }],
    ["CONFIRMED fetch without a host", { origin_host: null }],
    ["CONFIRMED by hash without a matched retrieval", { method: "UPLOADED", authenticity_method: "HASH_MATCHES_SERVER_FETCH", matched_retrieval_id: null }],
    ["upload recorded as fetched by server", { method: "UPLOADED" }],
    ["fetch recorded as UNCONFIRMED", { authenticity: "UNCONFIRMED", authenticity_method: null }],
    ["UNCONFIRMED with a method", { method: "UPLOADED", authenticity: "UNCONFIRMED" }],
    ["ATTESTED without who", { method: "UPLOADED", authenticity: "ATTESTED", authenticity_method: "ADMIN_ATTESTED", attested_at: new Date().toISOString(), attestation_note: "downloaded by hand from site" }],
    ["ATTESTED without when", { method: "UPLOADED", authenticity: "ATTESTED", authenticity_method: "ADMIN_ATTESTED", attested_by: adminId, attestation_note: "downloaded by hand from site" }],
    ["ATTESTED without a note", { method: "UPLOADED", authenticity: "ATTESTED", authenticity_method: "ADMIN_ATTESTED", attested_by: adminId, attested_at: new Date().toISOString() }],
    ["ATTESTED with a NULL method", { method: "UPLOADED", authenticity: "ATTESTED", authenticity_method: null, attested_by: adminId, attested_at: new Date().toISOString(), attestation_note: "downloaded by hand from site" }],
    ["research declared CONFIRMED", { declared_kind: "RESEARCH" }],
    ["research declared UNCONFIRMED", { method: "PASTED", declared_kind: "RESEARCH", authenticity: "UNCONFIRMED", authenticity_method: null }],
    ["official declared NOT_APPLICABLE", { method: "PASTED", authenticity: "NOT_APPLICABLE", authenticity_method: null }],
  ];
  for (const [name, cols] of bad) check(name, await tryRetrieval(imp1, src1, cols) !== null);

  section("Hash match must point at a server fetch of the same document from the same host");
  const src2 = await newSource();
  const upload1 = await insertRetrieval(imp1, src1, { method: "UPLOADED", authenticity: "UNCONFIRMED", authenticity_method: null });
  check("matched to an upload → refused", /hash match/i.test(await tryRetrieval(imp1, src1, { method: "UPLOADED", authenticity_method: "HASH_MATCHES_SERVER_FETCH", matched_retrieval_id: upload1 }) ?? ""));
  check("matched to a fetch of another document → refused", /hash match/i.test(await tryRetrieval(imp1, src2, { method: "UPLOADED", authenticity_method: "HASH_MATCHES_SERVER_FETCH", matched_retrieval_id: fetch1 }) ?? ""));
  check("matched to a fetch from another host → refused", /hash match/i.test(await tryRetrieval(imp1, src1, { method: "UPLOADED", origin_host: "example.com", authenticity_method: "HASH_MATCHES_SERVER_FETCH", matched_retrieval_id: fetch1 }) ?? ""));
  check("same document twice in one import → two retrieval rows allowed", (await q("SELECT count(*)::int AS n FROM recruitment_source_retrievals WHERE import_id = $1 AND source_id = $2", [imp1, src1]))[0].n as number >= 2);

  section("Append-only tables");
  check("UPDATE a retrieval → refused", /append-only/.test(await refused("UPDATE recruitment_source_retrievals SET version_label = 'x' WHERE id = $1", [fetch1]) ?? ""));
  check("DELETE a retrieval → refused", /append-only/.test(await refused("DELETE FROM recruitment_source_retrievals WHERE id = $1", [upload1]) ?? ""));
  check("UPDATE a source → refused", /append-only/.test(await refused("UPDATE recruitment_sources SET text = 'x' WHERE id = $1", [src1]) ?? ""));

  section("Imports: keys immutable, status only forward");
  const impNew = await newImport({ mode: "NEW", idKey: "ADVT 99/2026" });
  check("NEW import without org+year key → refused", await refused(
    "INSERT INTO recruitment_imports (import_id, mode, proposal, created_by) VALUES ($1, 'NEW', $2, $3)", [randomUUID(), proposal(), adminId]) !== null);
  check("NEW import with empty org+year key → refused", await refused(
    "INSERT INTO recruitment_imports (import_id, mode, org_year_key, proposal, created_by) VALUES ($1, 'NEW', '', $2, $3)", [randomUUID(), proposal(), adminId]) !== null);
  for (const [col, val] of [["identity_key", "OTHER"], ["org_year_key", "x:2026"], ["base_revision", "rev-9"], ["proposal", proposal([{ id: "x" }])], ["mode", "EXISTING"]] as const) {
    check(`changing ${col} → refused`, await refused(`UPDATE recruitment_imports SET ${col} = $1 WHERE import_id = $2`, [val, col === "base_revision" ? imp1 : impNew]) !== null);
  }
  check("EXISTING import's job changed → refused", await refused("UPDATE recruitment_imports SET recruitment_id = $1 WHERE import_id = $2", [job2, imp1]) !== null);
  check("result set without applying → refused", await refused("UPDATE recruitment_imports SET result = '{}' WHERE import_id = $1", [imp1]) !== null);
  const impGone = await newImport();
  await q("UPDATE recruitment_imports SET status = 'DISCARDED' WHERE import_id = $1", [impGone]);
  check("DISCARDED → PREVIEWED → refused", await refused("UPDATE recruitment_imports SET status = 'PREVIEWED' WHERE import_id = $1", [impGone]) !== null);
  check("DELETE an import → refused", await refused("DELETE FROM recruitment_imports WHERE import_id = $1", [impGone]) !== null);

  section("Claims: consistency between job, import and evidence");
  const imp2 = await newImport({ job: job2 });
  const src3 = await newSource();
  const fetch2 = await insertRetrieval(imp2, src3, { origin_host: "ssc.gov.in" });
  const ins = (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    return refused(`INSERT INTO recruitment_field_claims (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((k) => cols[k]));
  };
  check("extracted claim with its own import's retrieval → accepted", await ins({ recruitment_id: job1, field_path: "dates.applicationCloseDate", kind: "EXTRACTED", value: '"2026-11-01"', retrieval_id: fetch1, import_id: imp1 }) === null);
  check("extracted claim citing another import's retrieval → refused", await ins({ recruitment_id: job1, field_path: "dates.applicationCloseDate", kind: "EXTRACTED", value: '"2026-11-01"', retrieval_id: fetch2, import_id: imp1 }) !== null);
  check("extracted claim on a job that is not its import's → refused", await ins({ recruitment_id: job2, field_path: "dates.applicationCloseDate", kind: "EXTRACTED", value: '"2026-11-01"', retrieval_id: fetch1, import_id: imp1 }) !== null);
  const revX = await newRevision(job1, "dates.applicationCloseDate");
  check("admin decision written with an import id → refused by its check", /violates check constraint/.test(await ins({ recruitment_id: job1, field_path: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", value: '"v"', page: 1, quote: "q", retrieval_id: fetch1, field_revision_id: revX, import_id: imp1, claimed_by: adminId }) ?? ""));

  section("Decisions: evidence requirements");
  const rev1 = await newRevision(job1, "financial.feeGeneral");
  const decide = (cols: Record<string, unknown>) => ins({ recruitment_id: job1, field_path: "financial.feeGeneral", claimed_by: adminId, field_revision_id: rev1, retrieval_id: fetch1, ...cols });
  check("VERIFIED with page and quote → accepted", await decide({ kind: "ADMIN_VERIFIED", value: "800", page: 3, quote: "Rs.800/- plus GST" }) === null);
  check("VERIFIED on a PDF without a page → refused", /page number/i.test(await decide({ kind: "ADMIN_VERIFIED", value: "800", quote: "Rs.800" }) ?? ""));
  check("VERIFIED without quote or table cell → refused", await decide({ kind: "ADMIN_VERIFIED", value: "800", page: 3 }) !== null);
  check("VERIFIED citing another job's document → refused", /not brought in for this job/.test(await decide({ kind: "ADMIN_VERIFIED", value: "800", page: 3, quote: "q", retrieval_id: fetch2 }) ?? ""));
  check("VERIFIED on another field's revision → refused", /revision of the same field/.test(await ins({ recruitment_id: job1, field_path: "financial.feeSCST", kind: "ADMIN_VERIFIED", value: "200", page: 3, quote: "q", retrieval_id: fetch1, field_revision_id: rev1, claimed_by: adminId }) ?? ""));
  check("NOT_APPLICABLE without quote → refused", await decide({ kind: "ADMIN_NOT_APPLICABLE", page: 3, justification: "No application fee is charged" }) !== null);
  check("NOT_APPLICABLE without justification → refused", await decide({ kind: "ADMIN_NOT_APPLICABLE", page: 3, quote: "No fee" }) !== null);
  check("NOT_APPLICABLE complete → accepted", await decide({ kind: "ADMIN_NOT_APPLICABLE", page: 3, quote: "No application fee", justification: "The notice says no fee is charged" }) === null);
  const scopes: Array<[string, string, boolean]> = [
    ["{}", "{}", false], ["no pages", '{"pages": []}', false], ["pages as a string", '{"pages": "1"}', false],
    ["whole_document false", '{"whole_document": false}', false], ['whole_document "true" (a string)', '{"whole_document": "true"}', false],
    ["whole_document true", '{"whole_document": true}', true], ["pages [1,2]", '{"pages": [1, 2]}', true], ["sections", '{"sections": ["Vacancies"]}', true],
  ];
  for (const [name, scope, ok] of scopes) {
    const err = await decide({ kind: "ADMIN_NOT_STATED", review_scope: scope, justification: "Vacancies will be notified later" });
    check(`NOT_STATED scope ${name} → ${ok ? "accepted" : "refused"}`, (err === null) === ok, err);
  }
  const partnerSrc = await newSource();
  const partner = await insertRetrieval(imp1, partnerSrc, { origin_host: "bfsissc.com", origin_role: "PARTNER", origin_purposes: "{exam,fee_payment}" });
  check("NOT_STATED from a partner host → refused", /recruiting body/.test(await decide({ kind: "ADMIN_NOT_STATED", retrieval_id: partner, review_scope: '{"whole_document": true}', justification: "Checked the whole notice" }) ?? ""));
  const unconf = await insertRetrieval(imp1, partnerSrc, { method: "UPLOADED", authenticity: "UNCONFIRMED", authenticity_method: null, origin_host: "lichousing.com" });
  check("VERIFIED from an unconfirmed upload → refused", /confirmed or attested/.test(await decide({ kind: "ADMIN_VERIFIED", value: "800", page: 3, quote: "q", retrieval_id: unconf }) ?? ""));

  section("Revocation: once only, same field");
  const [dec] = await q("SELECT id FROM recruitment_field_claims WHERE kind = 'ADMIN_VERIFIED' AND recruitment_id = $1 LIMIT 1", [job1]);
  check("revoking a decision → accepted", await ins({ recruitment_id: job1, field_path: "financial.feeGeneral", kind: "ADMIN_REVOKED", revokes_claim_id: dec.id, claimed_by: adminId }) === null);
  check("revoking it again → refused (unique index)", /uq_field_claims_revoked_once|duplicate key/.test(await ins({ recruitment_id: job1, field_path: "financial.feeGeneral", kind: "ADMIN_REVOKED", revokes_claim_id: dec.id, claimed_by: adminId }) ?? ""));
  const [ext] = await q("SELECT id FROM recruitment_field_claims WHERE kind = 'EXTRACTED' LIMIT 1");
  check("revoking an extracted claim → refused", await ins({ recruitment_id: job1, field_path: "dates.applicationCloseDate", kind: "ADMIN_REVOKED", revokes_claim_id: ext.id, claimed_by: adminId }) !== null);
  check("UPDATE a claim → refused", /append-only/.test(await refused("UPDATE recruitment_field_claims SET quote = 'x' WHERE id = $1", [dec.id]) ?? ""));
  check("DELETE a claim → refused", /append-only/.test(await refused("DELETE FROM recruitment_field_claims WHERE id = $1", [dec.id]) ?? ""));

  section("Supersession: same field only");
  await ins({ recruitment_id: job1, field_path: "financial.feeGeneral", kind: "EXTRACTED", value: "800", retrieval_id: fetch1, import_id: imp1 });
  const exts = await q("SELECT id, field_path FROM recruitment_field_claims WHERE kind = 'EXTRACTED' AND recruitment_id = $1 ORDER BY seq", [job1]);
  const date = exts.find((r) => r.field_path === "dates.applicationCloseDate")!;
  const fee = exts.find((r) => r.field_path === "financial.feeGeneral")!;
  await ins({ recruitment_id: job1, field_path: "dates.applicationCloseDate", kind: "EXTRACTED", value: '"2026-11-08"', retrieval_id: fetch1, import_id: imp1 });
  const [date2] = await q("SELECT id FROM recruitment_field_claims WHERE kind = 'EXTRACTED' AND field_path = 'dates.applicationCloseDate' ORDER BY seq DESC LIMIT 1");
  check("same-field pair → accepted", await refused("INSERT INTO recruitment_claim_supersessions (superseding_claim_id, superseded_claim_id, decided_by) VALUES ($1, $2, $3)", [date2.id, date.id, adminId]) === null);
  check("pair across two fields → refused", /same field/.test(await refused("INSERT INTO recruitment_claim_supersessions (superseding_claim_id, superseded_claim_id, decided_by) VALUES ($1, $2, $3)", [date2.id, fee.id, adminId]) ?? ""));

  section("Duplicate check (same rules as the duplicate detector)");
  const dups = async (key: string | null, org: string, year: number) => (await q("SELECT public.cms_job_duplicates($1, $2, $3) AS d", [key, org, year]))[0].d as Array<Row>;
  check("same notification number → match", (await dups("ADVT 10/2026", "other-org", 2025)).length === 1);
  check("number with extra spaces normalised", (await dups("ADVT 10/2026", "x", 1)).length === 1 && (await q("SELECT public.cms_job_duplicates('ADVT  10/2026', 'x', 1) AS d"))[0].d !== null);
  check("no number: same org + year → match", (await dups(null, "ssc", 2026)).length === 1);
  check("different number, same org + year where the job has a number → no match", (await dups("ADVT 11/2026", "lic-hfl", 2026)).length === 0);

  section("Apply: an existing job");
  const [row1] = await q("SELECT * FROM recruitments WHERE id = $1", [job1]);
  const recordOf = (row: Row, patch: Record<string, unknown>) => ({
    identity: row.identity, dates: row.dates, vacancies: row.vacancies, eligibility: row.eligibility, age: row.age,
    financial: row.financial, selection: row.selection, exam_pattern: row.exam_pattern, syllabus: row.syllabus,
    how_to_apply: row.how_to_apply, links: row.links, exam_stages: row.exam_stages, classification: row.classification,
    record_revision: "rev-2", organization_name: row.organization_name, title_text: row.title_text, gov_type: row.gov_type, ...patch,
  });
  const closeItem = { id: "i1", kind: "FIELD", fieldPath: "dates.applicationCloseDate", value: "2026-11-01" };
  const impA = await newImport({ items: [closeItem] });
  const srcA = await newSource();
  const fetchA = await insertRetrieval(impA, srcA);
  const record = recordOf(row1, { dates: { applicationCloseDate: field("2026-11-01") } });
  const payload = (rec: unknown, claimId = randomUUID(), revId = randomUUID()) => JSON.stringify({
    record: rec,
    revisions: [{ id: revId, fieldPath: "dates.applicationCloseDate", oldValue: null, newValue: field("2026-11-01"), reason: "Imported" }],
    claims: [{ id: claimId, fieldPath: "dates.applicationCloseDate", value: "2026-11-01", retrievalId: fetchA, page: 5, quote: "20.10.2026 to 01.11.2026" }],
  });
  const apply = (imp: string, selected: string[], pl: string, override: unknown = null) =>
    refused("SELECT public.cms_apply_import($1, $2, $3, $4, $5)", [imp, adminId, selected, override === null ? null : JSON.stringify(override), pl]);
  check("an id not in the proposal → refused, nothing written", /UNKNOWN_ITEM/.test(await apply(impA, ["nope"], payload(record)) ?? ""));
  check("record not holding the ticked value → refused", /ITEM_VALUE_MISMATCH/.test(await apply(impA, ["i1"], payload(recordOf(row1, { dates: { applicationCloseDate: field("2026-12-31") } }))) ?? ""));
  const claimsBefore = (await q("SELECT count(*)::int AS n FROM recruitment_field_claims"))[0].n;
  const brokenRev = JSON.parse(payload(record));
  brokenRev.claims[0].retrievalId = randomUUID();   // a claim that cannot be inserted, after the job update
  check("failure after the first write → refused", (await apply(impA, ["i1"], JSON.stringify(brokenRev))) !== null);
  const [afterFail] = await q("SELECT record_revision, dates FROM recruitments WHERE id = $1", [job1]);
  check("…and nothing was written (job, revisions, claims, import status)", afterFail.record_revision === "rev-1"
    && (await q("SELECT count(*)::int AS n FROM recruitment_field_claims"))[0].n === claimsBefore
    && (await q("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'dates.applicationCloseDate' AND reason = 'Imported'", [job1]))[0].n === 0
    && (await q("SELECT status FROM recruitment_imports WHERE import_id = $1", [impA]))[0].status === "PREVIEWED");
  const okErr = await apply(impA, ["i1"], payload(record));
  check("valid apply → succeeds", okErr === null, okErr);
  const [after] = await q("SELECT record_revision, dates FROM recruitments WHERE id = $1", [job1]);
  check("…job updated", after.record_revision === "rev-2" && (after.dates as Row).applicationCloseDate !== undefined);
  check("…revision, claim and audit event written", (await q("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'dates.applicationCloseDate' AND reason = 'Imported'", [job1]))[0].n === 1
    && (await q("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE event_type = 'IMPORT_APPLIED' AND recruitment_id = $1", [job1]))[0].n === 1);
  const replay = (await q("SELECT public.cms_apply_import($1, $2, $3, NULL, $4) AS r", [impA, adminId, ["i1"], payload(record)]))[0].r as Row;
  check("applying again → same result, marked replayed, nothing duplicated", replay.replayed === true
    && (await q("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE event_type = 'IMPORT_APPLIED' AND recruitment_id = $1", [job1]))[0].n === 1);
  const impStale = await newImport({ items: [closeItem], base: "rev-1" });
  check("job changed since the preview → STALE", /STALE/.test(await apply(impStale, ["i1"], payload(record)) ?? ""));

  section("Apply: a new job, duplicates and the override");
  const newRecord = (slug: string) => ({ ...recordOf(row1, { dates: { applicationCloseDate: field("2026-11-01") } }), slug,
    identity: { ...(row1.identity as Row), notificationNumber: field("ADVT 10/2026") }, lifecycle: { status: "DRAFT", conflicts: [], events: [] }, provenance: {} });
  const impDup = await newImport({ mode: "NEW", idKey: "ADVT 10/2026", items: [closeItem] });
  const dupErr = await apply(impDup, ["i1"], JSON.stringify({ record: newRecord("job-one-copy") }));
  check("same notification number as an existing job → DUPLICATE", /DUPLICATE/.test(dupErr ?? ""), dupErr);
  check("override with a too-short reason → still DUPLICATE", /DUPLICATE/.test(await apply(impDup, ["i1"], JSON.stringify({ record: newRecord("job-one-copy") }), { reason: "dup" }) ?? ""));
  const overErr = await apply(impDup, ["i1"], JSON.stringify({ record: newRecord("job-one-copy") }), { reason: "Separate notice for a different post" });
  check("override with a reason → created", overErr === null, overErr);
  const [created] = await q("SELECT recruitment_id FROM recruitment_imports WHERE import_id = $1", [impDup]);
  check("…import linked to the new job, override audited", created.recruitment_id !== null
    && (await q("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE event_type = 'DUPLICATE_OVERRIDE' AND recruitment_id = $1", [created.recruitment_id]))[0].n === 1);
  const impFresh = await newImport({ mode: "NEW", org: "upsc:2027", idKey: "05/2027-CSE", items: [closeItem] });
  const freshErr = await apply(impFresh, ["i1"], JSON.stringify({ record: { ...newRecord("upsc-cse-2027"), identity: { ...(row1.identity as Row), organizationId: "upsc", recruitmentYear: 2027 } } }));
  check("no duplicate → created without override", freshErr === null, freshErr);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
