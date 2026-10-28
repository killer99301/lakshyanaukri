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
// The key is never printed. Requests are counted per job and in total, and
// no job starts once MAX_REQUESTS would be passed by its estimate.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, check, note, section, summary } from "./boot";

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

type Item = { id: string; fieldPath: string; value: unknown; flags: string[]; defaultTicked: boolean; supersedes: string[]; conflict: boolean; claims: Array<{ page: number | null; quote?: string; fromImage?: boolean }> };
type Proposal = { items: Item[]; warnings: string[]; replacedInImport?: unknown[]; meta: { sources: Array<Record<string, unknown>> } };

(async () => {
  const { adminId } = await boot();
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
    if (used + est.estimate > MAX_REQUESTS) { note(`NOT STARTED: ${used} used + ${est.estimate} would pass the budget of ${MAX_REQUESTS}`); return null; }
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
    if (!p.importId) { check(`${name}: preview built`, false, p.stateNote); return null; }
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

  /** Saves the ticked items of a preview, as the review's button does. */
  async function save(importId: string, proposal: Proposal) {
    const selected = proposal.items.filter((i) => i.defaultTicked).map((i) => i.id);
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

  if (CASES.has("ssc")) {
    const n = await read("ssc-cgl-2026", "ssc-cgl-2026.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "TEST RECORD SSC CGL 2026", org: "ssc-b26" });
    if (n) {
      const id = (await save(n.p.importId!, n.proposal))!;
      const before = await snapshot(id);
      writeFileSync(join(OUT, "ssc-before.json"), JSON.stringify(before, null, 1));
      const u = await read("ssc-cgl-reopen", "ssc-cgl-reopen.pdf", { kind: "OFFICIAL_CORRIGENDUM", recruitmentId: id, title: "", org: "" });
      if (u) {
        await save(u.p.importId!, u.proposal);
        const after = await snapshot(id);
        writeFileSync(join(OUT, "ssc-after.json"), JSON.stringify(after, null, 1));
        compare(before, after);
      }
    } else if (PHASE !== "run") {
      await read("ssc-cgl-reopen (estimate only)", "ssc-cgl-reopen.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "estimate", org: "ssc-est" });
    }
  }
  if (CASES.has("upsc")) await read("upsc-cse-2026", "upsc-cse-2026.pdf", { kind: "OFFICIAL_NOTIFICATION", title: "TEST RECORD UPSC CSE 2026", org: "upsc-b26" });
  if (CASES.has("bpsc")) {
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
