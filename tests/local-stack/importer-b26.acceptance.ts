// ═══════════════════════════════════════════════════════════
// B2.6 real-source acceptance with the REAL Gemini model, by hand
// ═══════════════════════════════════════════════════════════
//
// Not part of any automatic suite: it needs the test key and the network.
// On the in-memory test database only (never Neon). Each PDF goes through a
// reading job as the browser sends it (split with pdf-lib, scanned pages as
// their own pages). A notification is saved as a new draft; its update
// (SSC CGL's reopening notice, BPSC's corrigendum) is then imported against
// that draft as an official corrigendum, saved, and the job compared before
// and after: what changed, what stayed, what was removed or superseded.
//
//   PHASE=estimate npx tsx --env-file=.env.local --tsconfig tsconfig.json tests/local-stack/importer-b26.acceptance.ts <sources dir> <out dir>
//   PHASE=run CASES=ssc,upsc,bpsc MAX_REQUESTS=200 npx tsx … (same)
//
// <sources dir> holds ssc-cgl-2026.pdf, ssc-cgl-reopen.pdf, upsc-cse-2026.pdf,
// bpsc-72-cce.pdf, bpsc-72-corrigendum.pdf (copies of the owner's files).
//
// Since 2026-10-29 (the owner's decision, docs/importer-b2-plan.md §6) BPSC's
// Hindi tables come in through the paste route: case "bpsc" builds the job
// from the prepared table (tests/fixtures/paste), marked prepared outside,
// then reads the real scanned corrigendum against it, removes the deleted
// post when ticked, and restores it. Case "bpsc-notice" still reads the whole
// notification, best-effort, for its other fields.
// The key is never printed. Requests are counted per job and in total, and
// no job starts once MAX_REQUESTS would be passed by its estimate.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { blocked, boot, check, expectChecks, note, section, skipped, summary, ORIGIN } from "./boot";
import { bpscTable } from "../fixtures/paste/bpsc-72";

const [SRC, OUT] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY ?? "";
const PHASE = process.env.PHASE ?? "estimate";
const CASES = new Set((process.env.CASES ?? "ssc,upsc,bpsc").split(","));
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS ?? 0);
if (!SRC || !OUT) { console.error("usage: … <sources dir> <out dir>"); process.exit(2); }
if (PHASE === "run" && KEY.length < 20) { console.error("GEMINI_API_KEY is not set (expected in .env.local)"); process.exit(2); }
if (PHASE === "run" && !(MAX_REQUESTS > 0)) { console.error("Set MAX_REQUESTS for a run."); process.exit(2); }
const scrub = (s: string) => (KEY ? s.split(KEY).join("<key>") : s);
mkdirSync(OUT, { recursive: true });

// Every check that must run in a real run, by section, declared before anything runs (B2.6): one that did not run
// makes the suite INCOMPLETE, never "ALL PASS". Only the cases asked for are declared.
if (PHASE === "run") {
  if (CASES.has("ssc")) {
    expectChecks("ssc-cgl-2026", [
      "SSC: ages post by post, at least 36 posts, from the table of posts", "SSC: no one range applied to every post", "SSC: the Junior Statistical Officer's own 18-32",
      "SSC: an Auditor's own 18-27", "SSC: age counted on 1 August 2026", "SSC: PwBD (OBC) 13 kept apart from PwBD 10", "SSC: no announcement among the selection stages",
    ]);
    expectChecks("ssc-cgl-reopen", ["SSC reopened: the last date to apply is now 25 June 2026"]);
  }
  if (CASES.has("upsc")) {
    expectChecks("upsc-cse-2026", ["UPSC: notification number 05/2026-CSE, not the file number", "UPSC: age 21-32 as on 1 August 2026", "UPSC: relaxations SC/ST 5, OBC 3, PwBD 10", "UPSC: no announcement among the selection stages"]);
  }
  if (CASES.has("bpsc")) {
    expectChecks("BPSC 72nd CCE: the job with its pasted tables", ["BPSC: the pasted tables saved, 25 posts, 1,230"]);
    expectChecks("bpsc-72-corrigendum", [
      "BPSC corrigendum: the table without the deleted post is offered, unticked", "BPSC corrigendum: 24 posts, 1,186", "BPSC corrigendum: Sugarcane Officer is the one removed",
      "BPSC corrigendum: says what it removes and the total, 1230 − 44 = 1186", "BPSC corrigendum: its evidence is marked as read from the page image",
      "BPSC corrigendum: both sentences quoted (the post at serial 11; its deletion)", "BPSC corrigendum: the default ticks leave the 25 posts",
    ]);
    expectChecks("bpsc-72-corrigendum (ticked)", [
      "BPSC corrigendum ticked: saved and reopened at 1,186, Sugarcane Officer gone", "BPSC corrigendum ticked: the rows left are still prepared outside",
      "BPSC: restored from the history in one step, 1,230 and 25 posts",
    ]);
  }
}

type Item = { id: string; fieldPath: string; value: unknown; flags: string[]; defaultTicked: boolean; supersedes: string[]; conflict: boolean; claims: Array<{ page: number | null; quote?: string; fromImage?: boolean }> };
type Proposal = { items: Item[]; warnings: string[]; replacedInImport?: unknown[]; meta: { sources: Array<Record<string, unknown>> } };

(async () => {
  const { adminId, token } = await boot();
  const jobs = await import("@/lib/cms/importer/jobs");
  const service = await import("@/lib/cms/importer/service");
  const { openPdf, splitPdf, onePage, sha256Hex } = await import("@/lib/cms/importer/pdf-split");
  const { getImport } = await import("@/lib/cms/importer/repository");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  note(`model: ${process.env.GEMINI_MODEL}; phase ${PHASE}; cases ${[...CASES].join(",")}; budget ${MAX_REQUESTS || "-"}`);
  let used = 0;

  /** Uploads one PDF into a reading job as the browser does; in the run phase reads it and returns the preview. */
  async function read(name: string, file: string, how: { kind: "OFFICIAL_NOTIFICATION" | "OFFICIAL_CORRIGENDUM"; recruitmentId?: string; title: string; org: string }) {
    section(name);
    const bytes = new Uint8Array(readFileSync(join(SRC, file)));
    const { doc, pages } = await openPdf(bytes);
    const { jobId } = await jobs.createReadingJob({
      adminId, mode: how.recruitmentId ? "EXISTING" : "NEW", ...(how.recruitmentId ? { recruitmentId: how.recruitmentId } : {}),
      ...(how.recruitmentId ? {} : { newJob: { organizationId: how.org, organizationName: how.org.toUpperCase(), recruitmentYear: 2026, title: how.title, govType: "Central Govt" } as never }),
      sources: [{ declaredKind: how.kind, fileName: file, pages, byteSize: bytes.byteLength, sha256: await sha256Hex(bytes) }],
    });
    for await (const piece of splitPdf(doc, { maxBytes: 3.9 * 1024 * 1024, maxPages: 40 })) {
      if ("oversized" in piece) { await jobs.recordFailedPart({ adminId, jobId, sourceNo: 1, first: piece.first, last: piece.last, reason: piece.reason }); continue; }
      const r = await jobs.uploadJobPart({ adminId, jobId, sourceNo: 1, first: piece.first, last: piece.last, bytes: Buffer.from(piece.bytes) });
      if (r.status !== "READ") note(`piece ${piece.first}-${piece.last}: ${r.status} ${r.reason ?? ""}`);
      for (const n of r.noTextPages) await jobs.uploadScanPage({ adminId, jobId, sourceNo: 1, page: n, bytes: Buffer.from(await onePage(doc, n)) });
    }
    const est = await jobs.startJob({ adminId, jobId, confirm: false });
    note(`${pages} pages, ${est.scanPages} scanned; about ${est.estimate} requests${est.missing.length ? `; MISSING ${JSON.stringify(est.missing)}` : ""}`);
    if (PHASE !== "run") return null;
    if (used + est.estimate > MAX_REQUESTS) { note(`NOT STARTED: ${used} used + ${est.estimate} would pass the budget of ${MAX_REQUESTS}`); blocked(`not started: ${used} requests used + about ${est.estimate} would pass the budget of ${MAX_REQUESTS}`); return null; }
    await jobs.startJob({ adminId, jobId, confirm: true });
    const t0 = Date.now();
    let p = await jobs.jobProgress({ adminId, jobId });
    for (let i = 0; i < 120 && (p.state === "READING" || p.state === "FINISHING"); i++) p = await jobs.stepJob({ adminId, jobId, apiKey: KEY });
    // Paused with failed parts: what the admin does is press Retry, once. Counted and said, never hidden.
    if (p.state === "PAUSED" && p.failedTasks.length > 0) {
      note(`PAUSED with ${p.failedTasks.length} failed part(s): ${p.failedTasks.map((f) => `${f.kind} ${f.first}: ${scrub(f.reason)}`).join("; ")} — retrying once, as the admin would`);
      await jobs.retryFailed({ adminId, jobId });
      for (let i = 0; i < 60 && (p.state === "READING" || p.state === "FINISHING" || p.state === "PAUSED"); i++) {
        p = await jobs.stepJob({ adminId, jobId, apiKey: KEY });
        if (p.state === "PAUSED") break;
      }
    }
    used += p.ai.sent;
    note(`${p.state}${p.complete ? ", complete" : ", NOT complete"} in ${Math.round((Date.now() - t0) / 1000)} s; ${p.ai.sent} requests (${p.ai.retried} resent); total so far ${used}; note: ${p.stateNote ?? "-"}; failed: ${p.failedTasks.map((f) => `${f.kind} ${f.first}: ${scrub(f.reason)}`).join("; ") || "none"}`);
    if (!p.importId) { check(`${name}: preview built`, false, p.stateNote); blocked(`no preview was built: ${p.stateNote ?? p.state}`); return null; }
    const proposal = (await getImport(p.importId))!.proposal as unknown as Proposal;
    writeFileSync(join(OUT, `${name}.json`), scrub(JSON.stringify({ progress: p, proposal }, null, 1)));
    for (const w of proposal.warnings) note(`warning: ${w.slice(0, 300)}`);
    for (const i of proposal.items.filter((x) => !x.fieldPath.startsWith("links#"))) {
      note(`${i.defaultTicked ? "[x]" : "[ ]"} ${i.fieldPath} = ${brief(i.fieldPath, i.value)}${i.supersedes.length ? `  SUPERSEDES ${i.supersedes.length}` : ""}${i.conflict ? "  CONFLICT" : ""}  (p${[...new Set(i.claims.map((c) => c.page))].join(",")})${i.flags.length ? `  flags: ${i.flags.join(" / ").slice(0, 400)}` : ""}`);
    }
    const vt = proposal.meta.sources[0]?.vacancyTables as { diff?: Record<string, unknown>; problems?: string[]; coverage?: { tables: Array<{ title: string; read: boolean; why?: string }>; unreadLines: unknown[] } } | null;
    if (vt) note(`vacancy tables: ${JSON.stringify(vt.coverage?.tables ?? []).slice(0, 400)}; unread lines ${vt.coverage?.unreadLines.length ?? 0}; diff ${JSON.stringify(vt.diff ? { added: vt.diff.added, changed: vt.diff.changed, removed: vt.diff.removed, same: vt.diff.same } : null)}; problems ${(vt.problems ?? []).length}`);
    return { p, proposal };
  }

  function brief(fieldPath: string, v: unknown): string {
    const o = v as Record<string, unknown> & unknown[];
    if (fieldPath === "vacancies.table") {
      const t = v as { rows: Array<{ at: Record<string, string>; total?: number; status: string }> };
      const posts = [...new Set(t.rows.map((r) => r.at.post))];
      return `${t.rows.length} rows, ${posts.length} posts, sum ${t.rows.reduce((n, r) => n + (r.total ?? 0), 0)}`;
    }
    if (fieldPath === "examPattern") return (o as Array<{ name: string; totalQuestions?: number; totalMarks?: number; durationMinutes?: number }>).map((p) => `${p.name.slice(0, 50)} ${p.totalQuestions}/${p.totalMarks}/${p.durationMinutes ?? "-"}m`).join(" | ");
    if (fieldPath === "examStages") return (o as Array<{ name: string; kind?: string; dateIso?: string; notes?: string }>).map((s) => `${s.name.slice(0, 45)}[${s.kind}]${s.dateIso ?? s.notes ?? ""}`).join(" | ");
    if (fieldPath === "age") {
      const a = v as { min?: number; max?: number; asOf?: string; categoryMax?: unknown[]; postWise?: Array<{ post: string; min?: number; max?: number; bornFrom?: string; bornTo?: string }> };
      return `min ${a.min} max ${a.max} asOf ${a.asOf} catMax ${JSON.stringify(a.categoryMax ?? [])} posts ${JSON.stringify((a.postWise ?? []).map((p) => [p.post.slice(0, 40), p.min, p.max, p.bornFrom, p.bornTo]))}`;
    }
    return JSON.stringify(v).slice(0, 300);
  }

  /** Every field of a job as one line each: value and status, to compare before and after an update. */
  async function snapshot(id: string): Promise<Record<string, string>> {
    const r = (await getRecruitmentById(id))! as unknown as Record<string, unknown>;
    const out: Record<string, string> = {};
    const walk = (prefix: string, v: unknown) => {
      if (v && typeof v === "object" && !Array.isArray(v) && "status" in (v as object) && "value" in (v as object)) {
        const f = v as { value: unknown; status: string };
        out[prefix] = `${f.status} ${prefix === "vacancies.table" && f.value ? brief("vacancies.table", f.value) : JSON.stringify(f.value).slice(0, 400)}`;
        return;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x);
    };
    for (const k of ["identity", "dates", "vacancies", "financial", "age", "eligibility", "selection", "examPattern", "syllabus", "howToApply", "conditions"]) walk(k, r[k]);
    out.examStages = JSON.stringify(((r.examStages as Array<{ name: string; kind?: string }>) ?? []).map((s) => `${s.name}[${s.kind}]`));
    return out;
  }

  /** Saves the ticked items of a preview, as the review's button does; `tick` adds what the admin ticks by hand. */
  async function save(importId: string, proposal: Proposal, tick: string[] = []) {
    const selected = [...new Set([...proposal.items.filter((i) => i.defaultTicked).map((i) => i.id), ...tick])];
    // Nothing ticked by default: nothing is saved, and the job stays as it was. Said, not forced.
    if (selected.length === 0) { note("nothing is ticked by default: nothing saved; the job is unchanged"); return null; }
    const res = await service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null });
    note(`saved ${selected.length} values into job ${res.recruitmentId}`);
    return String(res.recruitmentId);
  }

  function compare(before: Record<string, string>, after: Record<string, string>) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const k of keys) {
      if (before[k] === after[k]) continue;
      note(`CHANGED ${k}:\n      before ${before[k] ?? "(none)"}\n      after  ${after[k] ?? "(none)"}`);
    }
    note(`unchanged fields: ${keys.filter((k) => before[k] === after[k]).length} of ${keys.length}`);
  }

  const item = (p: Proposal, path: string) => p.items.find((i) => i.fieldPath === path);
  const { classifyStageName } = await import("@/lib/exam-stage-kind");
  /** The selection process holds stages of selection only, whatever the run (B2.6 part 3). */
  const selectionChecks = (name: string, p: Proposal) => {
    if (!p.items.some((i) => i.fieldPath === "selection")) skipped(`${name}: no announcement among the selection stages`, "the reading proposed no selection process");
    for (const s of p.items.filter((i) => i.fieldPath === "selection")) {
      const stages = (s.value as { stages?: Array<{ name: string }> }).stages ?? [];
      check(`${name}: no announcement among the selection stages`, stages.every((x) => ["SELECTION", "UNCLASSIFIED"].includes(classifyStageName(x.name))), stages.map((x) => x.name));
    }
  };

  if (CASES.has("ssc")) {
    const n = await read("ssc-cgl-2026", "ssc-cgl-2026.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "TEST RECORD SSC CGL 2026", org: "ssc-b26" });
    if (n) {
      // Ages post by post from the table of posts (B2.6 part 3), never one range for every post.
      const age = item(n.proposal, "age")?.value as { min?: number; max?: number; asOf?: string; postWise?: Array<{ post: string; min?: number; max?: number }>; relaxations?: Array<{ category: string; years?: number }> } | undefined;
      check("SSC: ages post by post, at least 36 posts, from the table of posts", (age?.postWise?.length ?? 0) >= 36, age?.postWise?.length);
      check("SSC: no one range applied to every post", age?.min === undefined && age?.max === undefined, [age?.min, age?.max]);
      check("SSC: the Junior Statistical Officer's own 18-32", age?.postWise?.some((x) => /^Junior Statistical Officer/.test(x.post) && x.min === 18 && x.max === 32) === true);
      check("SSC: an Auditor's own 18-27", age?.postWise?.some((x) => /^Auditor Offices under C&AG/.test(x.post) && x.min === 18 && x.max === 27) === true);
      check("SSC: age counted on 1 August 2026", age?.asOf === "2026-08-01", age?.asOf);
      check("SSC: PwBD (OBC) 13 kept apart from PwBD 10", age?.relaxations?.some((r) => r.category === "PwBD (OBC)" && r.years === 13) === true && age?.relaxations?.some((r) => r.category === "PwBD" && r.years === 10) === true, age?.relaxations);
      selectionChecks("SSC", n.proposal);
      const id = (await save(n.p.importId!, n.proposal))!;
      const before = await snapshot(id);
      writeFileSync(join(OUT, "ssc-before.json"), JSON.stringify(before, null, 1));
      const u = await read("ssc-cgl-reopen", "ssc-cgl-reopen.pdf", { kind: "OFFICIAL_CORRIGENDUM", recruitmentId: id, title: "", org: "" });
      if (u) {
        await save(u.p.importId!, u.proposal);
        const after = await snapshot(id);
        writeFileSync(join(OUT, "ssc-after.json"), JSON.stringify(after, null, 1));
        compare(before, after);
        check("SSC reopened: the last date to apply is now 25 June 2026", /"2026-06-25"/.test(after["dates.applicationCloseDate"] ?? ""), after["dates.applicationCloseDate"]);
      }
    } else if (PHASE === "run") {
      blocked("the SSC notification was not read, so there is no job to apply its reopening notice to", "ssc-cgl-reopen");
    }
    if (!n && PHASE !== "run") {
      await read("ssc-cgl-reopen (estimate only)", "ssc-cgl-reopen.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "estimate", org: "ssc-est" });
    }
  }
  if (CASES.has("upsc")) {
    const u = await read("upsc-cse-2026", "upsc-cse-2026.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "TEST RECORD UPSC CSE 2026", org: "upsc-b26" });
    if (u) {
      // A new job's number is what the admin typed when one was; this job was made with none, so the notice's is offered.
      const nn = item(u.proposal, "identity.notificationNumber");
      check("UPSC: notification number 05/2026-CSE, not the file number", nn?.value === "05/2026-CSE", nn?.value);
      const age = item(u.proposal, "age")?.value as { min?: number; max?: number; asOf?: string; relaxations?: Array<{ category: string; years?: number }> } | undefined;
      check("UPSC: age 21-32 as on 1 August 2026", age?.min === 21 && age?.max === 32 && age?.asOf === "2026-08-01", [age?.min, age?.max, age?.asOf]);
      const years = (re: RegExp) => age?.relaxations?.find((r) => re.test(r.category))?.years;
      check("UPSC: relaxations SC/ST 5, OBC 3, PwBD 10", years(/SC\/ST|Scheduled Caste/) === 5 && years(/OBC|Other Backward/) === 3 && years(/PwBD|Benchmark/) === 10, age?.relaxations);
      selectionChecks("UPSC", u.proposal);
    }
  }
  if (CASES.has("bpsc")) {
    // The job as the paste route makes it: BPSC's two tables, prepared outside (1,230), saved through the field route.
    section("BPSC 72nd CCE: the job with its pasted tables");
    const records = await import("@/app/api/admin/cms/records/route");
    const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
    const { restorable } = await import("@/lib/cms/restore-value");
    const { analyseVacancyTable } = await import("@/lib/vacancy-table");
    const req = (path: string, method: string, body?: unknown) =>
      new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const r0 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "bpsc-b26", organizationName: "Bihar Public Service Commission", govType: "State Govt", title: "TEST RECORD BPSC 72nd CCE (pasted tables)", recruitmentYear: 2026 }));
    const id: string = (await r0.json()).record.id;
    const rev = async () => (await getRecruitmentById(id))!.recordRevision;
    const put = async (field: unknown) => {
      const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "vacancies.table", field, clientRevision: await rev(), reason: "acceptance" }), { params: Promise.resolve({ id }) });
      return { status: r.status, body: await r.json() };
    };
    const pasted = await put({ value: bpscTable(), status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
    check("BPSC: the pasted tables saved, 25 posts, 1,230", pasted.status === 200 && pasted.body.record.vacancies.total.value === 1230, pasted.body.error);
    const before = await snapshot(id);
    const u = await read("bpsc-72-corrigendum", "bpsc-72-corrigendum.pdf", { kind: "OFFICIAL_CORRIGENDUM", recruitmentId: id, title: "", org: "" });
    if (!u && PHASE === "run") blocked("the corrigendum was not read, so nothing was offered to tick", "bpsc-72-corrigendum (ticked)");
    if (u) {
      const t = item(u.proposal, "vacancies.table");
      if (!t) blocked("no vacancy table was offered for the corrigendum, so there was nothing to tick", "bpsc-72-corrigendum (ticked)");
      const offered = t?.value as Parameters<typeof analyseVacancyTable>[0] | undefined;
      check("BPSC corrigendum: the table without the deleted post is offered, unticked", !!t && t.defaultTicked === false, t && [t.defaultTicked, t.flags]);
      check("BPSC corrigendum: 24 posts, 1,186", offered?.rows.length === 24 && analyseVacancyTable(offered).grandTotal?.value === 1186, offered && [offered.rows.length, analyseVacancyTable(offered).grandTotal?.value]);
      check("BPSC corrigendum: Sugarcane Officer is the one removed", !!offered && !offered.rows.some((r) => /ईख पदाधिकारी/.test(r.at.post)));
      check("BPSC corrigendum: says what it removes and the total, 1230 − 44 = 1186", t?.flags.some((f) => /removes what the corrigendum deletes: ईख पदाधिकारी.*44 posts.*1230 − 44 = 1186/.test(f)) === true, t?.flags);
      check("BPSC corrigendum: its evidence is marked as read from the page image", t?.claims.every((c) => c.fromImage === true && c.page === 1) === true, t?.claims);
      const removal = (u.proposal.meta.sources[0]?.vacancyTables as { removal?: { removals: Array<{ quotes: Array<{ text: string }> }> } } | null)?.removal;
      check("BPSC corrigendum: both sentences quoted (the post at serial 11; its deletion)", removal?.removals[0]?.quotes.length === 2 && /विलोपित/.test(removal.removals[0].quotes[1].text), removal?.removals[0]?.quotes.map((q) => q.text.slice(0, 80)));
      // Nothing is removed by the default ticks; ticked by the admin, it is.
      await save(u.p.importId!, u.proposal);
      check("BPSC corrigendum: the default ticks leave the 25 posts", (await getRecruitmentById(id))!.vacancies.table!.value!.rows.length === 25);
      if (t) {
        const u2 = await read("bpsc-72-corrigendum (ticked)", "bpsc-72-corrigendum.pdf", { kind: "OFFICIAL_CORRIGENDUM", recruitmentId: id, title: "", org: "" });
        const t2 = u2 ? item(u2.proposal, "vacancies.table") : undefined;
        if (u2 && t2) await save(u2.p.importId!, u2.proposal, [t2.id]);
        const job = (await getRecruitmentById(id))!;
        check("BPSC corrigendum ticked: saved and reopened at 1,186, Sugarcane Officer gone", job.vacancies.total?.value === 1186 && job.vacancies.table!.value!.rows.length === 24, job.vacancies.total?.value);
        check("BPSC corrigendum ticked: the rows left are still prepared outside", job.vacancies.table!.value!.rows.every((r) => r.source.readBy === "PREPARED"));
        const after = await snapshot(id);
        writeFileSync(join(OUT, "bpsc-after.json"), JSON.stringify(after, null, 1));
        compare(before, after);
        const { sql } = await import("@/lib/db");
        const history = (await sql`SELECT old_value FROM field_revisions WHERE recruitment_id = ${id} AND field_path = 'vacancies.table' ORDER BY revised_at DESC LIMIT 1`) as Array<{ old_value: unknown }>;
        const back = restorable(history[0]?.old_value);
        const restored = back.ok ? await put(back.field) : { status: 0, body: { error: back } };
        check("BPSC: restored from the history in one step, 1,230 and 25 posts", restored.status === 200 && restored.body.record.vacancies.total.value === 1230 && restored.body.record.vacancies.table.value.rows.length === 25, restored.body.error);
      }
    }
  }
  if (CASES.has("bpsc-notice")) {
    const n = await read("bpsc-72-cce", "bpsc-72-cce.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "TEST RECORD BPSC 72nd CCE", org: "bpsc-b26" });
    if (n) {
      const id = (await save(n.p.importId!, n.proposal))!;
      const before = await snapshot(id);
      writeFileSync(join(OUT, "bpsc-before.json"), JSON.stringify(before, null, 1));
      const u = await read("bpsc-72-corrigendum", "bpsc-72-corrigendum.pdf", { kind: "OFFICIAL_CORRIGENDUM", recruitmentId: id, title: "", org: "" });
      if (u) {
        await save(u.p.importId!, u.proposal);
        const after = await snapshot(id);
        writeFileSync(join(OUT, "bpsc-after.json"), JSON.stringify(after, null, 1));
        compare(before, after);
      }
    } else if (PHASE !== "run") {
      await read("bpsc-72-corrigendum (estimate only)", "bpsc-72-corrigendum.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "estimate", org: "bpsc-est" });
    }
  }
  note(`requests used in this run: ${used}`);
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", scrub(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
