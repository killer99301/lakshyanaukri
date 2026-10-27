// ═══════════════════════════════════════════════════════════
// Reading jobs for long documents (stage B2.3), on the in-memory test
// database, with a stand-in for the model. The real IBPS CRP RRBs-XV PDF
// (76 pages) is split with pdf-lib exactly as the browser splits it.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-jobs.test.ts <path to ibps-crp-rrb-xv.pdf>
//
// Checks: pieces renumbered as pages of the whole document; limits; an
// interrupted upload; steps that take at most two tasks; a task's result
// saved only under the lease that took it (a late duplicate step cannot
// overwrite it); a failed task retried alone; pause and resume; the daily
// allowance; cancel and clean-up; another admin's reading not found; a
// reading with pages missing never called complete; the preview's pages.
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { boot, check, note, section, summary } from "./boot";

type Progress = Awaited<ReturnType<typeof import("@/lib/cms/importer/jobs")["jobProgress"]>>;
const PDF = process.argv[2];
if (!PDF) { console.error("usage: … importer-jobs.test.ts <ibps-crp-rrb-xv.pdf>"); process.exit(2); }

(async () => {
  const { pg, adminId } = await boot();
  const jobs = await import("@/lib/cms/importer/jobs");
  const { openPdf, splitPdf, sha256Hex } = await import("@/lib/cms/importer/pdf-split");
  const { resetMemoryUsage } = await import("@/lib/ai-usage");
  const { getImport } = await import("@/lib/cms/importer/repository");
  const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as Array<Record<string, unknown>>;

  const file = new Uint8Array(readFileSync(PDF));
  const { doc, pages } = await openPdf(file);
  const sha = await sha256Hex(file);
  const pieces: Array<{ first: number; last: number; bytes: Uint8Array }> = [];
  for await (const p of splitPdf(doc, { maxBytes: jobs.JOB_LIMITS.partBytes, maxPages: 10 })) if (!("oversized" in p)) pieces.push(p);
  note(`IBPS: ${pages} pages, ${(file.byteLength / 1024 / 1024).toFixed(1)} MB, split into ${pieces.length} pieces of at most 10 pages`);

  /** A stand-in model: page batches answer from what their pages say; the section readers find nothing. */
  let behaviour: (first: number, call: number) => "ok" | "503" | "hang" = () => "ok";
  const calls = new Map<number, number>();
  let release: (() => void) | null = null;
  const answer = (data: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchFn = (async (_u: unknown, init?: RequestInit) => {
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
    const m = /pages (\d+) to (\d+) of a 76-page notice/.exec(prompt);
    if (!m) return answer({});
    const first = Number(m[1]);
    const n = (calls.get(first) ?? 0) + 1;
    calls.set(first, n);
    const how = behaviour(first, n);
    if (how === "503") return new Response("{}", { status: 503 });
    if (how === "hang") await new Promise<void>((r) => { release = r; });
    const t = prompt.slice(prompt.indexOf("TEXT:"));
    const out: Record<string, unknown> = {};
    const stage = "Online Examination – Preliminary (Officers/OA) November / December, 2026";
    if (t.includes(stage)) out.examStages = [{ name: "Online Examination – Preliminary (Officers/OA)", date: null, dateText: "November / December, 2026", quote: stage }];
    const rule = "The structure of the Examinations which will be conducted online are as follows:";
    if (t.includes(rule)) out.notes = [{ text: rule, quote: rule }];
    out.howToApply = [{ step: `marker call ${first}.${n}`, quote: `marker call ${first}.${n}` }]; // not in the text: refused, but tells calls apart
    return answer(out);
  }) as unknown as typeof fetch;
  const newJob = (title: string, orgId: string) => ({ organizationId: orgId, organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, title, govType: "PSU" } as never);
  const source = { declaredKind: "OFFICIAL_NOTIFICATION" as const, fileName: "CRP-RRBs-XV-notification.pdf", pages, byteSize: file.byteLength, sha256: sha, url: "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf", attestation: "Downloaded from ibps.in myself for this test" };
  const upload = (jobId: string, p: { first: number; last: number; bytes: Uint8Array }) => jobs.uploadJobPart({ adminId, jobId, sourceNo: 1, first: p.first, last: p.last, bytes: Buffer.from(p.bytes) });
  const run = async (jobId: string, max = 40) => {
    let pr: Progress | null = null;
    for (let i = 0; i < max; i++) {
      pr = await jobs.stepJob({ adminId, jobId, apiKey: "test-key", fetchFn, retryBackoffMs: [1, 1] });
      if (pr.state !== "READING") break;
    }
    return pr!;
  };

  section("Upload: pieces of whole pages, numbered as in the original");
  const { jobId } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD IBPS reading job", "ibps-job"), sources: [source] });
  for (const p of pieces.slice(0, -2)) await upload(jobId, p);
  const part2 = (await q("SELECT text FROM recruitment_import_job_parts WHERE job_id = $1 AND first_page = 11", [jobId]))[0];
  check("the second piece's pages are 11–20 of 76, not 1–10 of 10", /^-- 11 of 76 --$/m.test(String(part2?.text)) && /^-- 20 of 76 --$/m.test(String(part2?.text)) && !/^-- \d+ of 10 --$/m.test(String(part2?.text)));
  check("pieces whose pages all have text are not kept (only their text)", (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1 AND pdf_base64 IS NOT NULL", [jobId]))[0].n === 0);

  section("An interrupted upload: the reading does not start with pages missing");
  const est = await jobs.startJob({ adminId, jobId, confirm: false });
  check("the estimate names the pages not uploaded", est.missing.length === 1 && est.missing[0].first === pieces[pieces.length - 2].first && est.missing[0].last === pages, est.missing);
  let refused = "";
  try { await jobs.startJob({ adminId, jobId, confirm: true }); } catch (e) { refused = (e as Error).message; }
  check("starting with pages missing is refused, with why", /not uploaded/.test(refused), refused);
  await upload(jobId, pieces[pieces.length - 2]);
  await upload(jobId, pieces[pieces.length - 2]); // sent twice after a dropped connection: replaced, not doubled
  await upload(jobId, pieces[pieces.length - 1]);
  check("a piece sent twice is one piece", (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1", [jobId]))[0].n === pieces.length);
  const ready = await jobs.startJob({ adminId, jobId, confirm: false });
  check("then nothing is missing; the estimate counts the requests (3 section readers + 10 page batches)", ready.missing.length === 0 && ready.estimate === 13, ready);

  section("Limits");
  const limit = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };
  check("a piece over 4 MB is refused", /at most 4 MB/.test(await limit(() => jobs.uploadJobPart({ adminId, jobId, sourceNo: 1, first: 1, last: 1, bytes: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4 * 1024 * 1024)]) }))));
  check("a piece of more than 40 pages is refused", /at most 40 pages/.test(await limit(() => jobs.uploadJobPart({ adminId, jobId, sourceNo: 1, first: 1, last: 41, bytes: Buffer.from("%PDF-") }))));
  check("a piece overlapping another is refused", /overlap/.test(await limit(() => jobs.uploadJobPart({ adminId, jobId, sourceNo: 1, first: 5, last: 12, bytes: Buffer.from(pieces[0].bytes) }))));
  check("a file over 400 pages is refused", /at most 400/.test(await limit(() => jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("x", "x-job"), sources: [{ ...source, pages: 401 }] }))));
  const { jobId: broken } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD damaged", "dmg-job"), sources: [{ ...source, pages: 2 }] });
  const damaged = await jobs.uploadJobPart({ adminId, jobId: broken, sourceNo: 1, first: 1, last: 2, bytes: Buffer.from("%PDF-1.7 this is not a real pdf") });
  check("a damaged piece is recorded as failed, with why", damaged.status === "FAILED" && /damaged or encrypted/.test(damaged.reason ?? ""), damaged);

  section("Another admin's reading is not found");
  check("progress, steps and cancel answer \"not found\" to another admin", /not found/.test(await limit(() => jobs.jobProgress({ adminId: "00000000-0000-4000-8000-000000000001", jobId })))
    && /not found/.test(await limit(() => jobs.cancelJob({ adminId: "00000000-0000-4000-8000-000000000001", jobId }))));

  section("Reading in steps, with a failed batch retried alone");
  behaviour = (first) => (first === 9 ? "503" : "ok"); // pages from 9 keep failing
  await jobs.startJob({ adminId, jobId, confirm: true });
  const first = await jobs.stepJob({ adminId, jobId, apiKey: "test-key", fetchFn, retryBackoffMs: [1, 1] });
  check("a step takes at most two tasks", first.tasks.done + first.tasks.failed <= 2 && first.tasks.running === 0, first.tasks);
  let pr = await run(jobId);
  const doneBefore = await q("SELECT task_no, updated_at::text AS at, ai_requests FROM recruitment_import_job_tasks WHERE job_id = $1 AND status = 'DONE' ORDER BY task_no", [jobId]);
  check("the failing batch is failed after its tries, with its pages; the reading waits, never \"complete\"", pr.state === "PAUSED" && pr.failedTasks.length === 1 && pr.failedTasks[0].first === 9 && !pr.complete && /failed/.test(pr.stateNote ?? ""), pr);
  behaviour = () => "ok";
  await jobs.retryFailed({ adminId, jobId });
  pr = await run(jobId);
  const doneAfter = await q("SELECT task_no, updated_at::text AS at, ai_requests FROM recruitment_import_job_tasks WHERE job_id = $1 AND status = 'DONE' AND task_no = ANY($2::int[]) ORDER BY task_no", [jobId, doneBefore.map((r) => r.task_no)]);
  check("retry read only the failed batch: the others were not read again", JSON.stringify(doneAfter) === JSON.stringify(doneBefore), { doneBefore, doneAfter });
  check("then the reading is done, complete, with its preview", pr.state === "DONE" && pr.complete && !!pr.importId && pr.tasks.done === 13, pr);
  const imp = await getImport(pr.importId!);
  const items = (imp?.proposal as unknown as { items: Array<{ fieldPath: string; value: unknown; claims: Array<{ page: number | null }> }> }).items;
  const stages = items.find((i) => i.fieldPath === "examStages");
  const notes = items.find((i) => i.fieldPath === "conditions");
  check("evidence keeps the original page numbers after splitting: stage on page 1, the exam structure on page 21", stages?.claims[0]?.page === 1 && notes?.claims[0]?.page === 21, { stages: stages?.claims, notes: notes?.claims });
  check("the vacancy tables were read from the whole document (280 rows)", (items.find((i) => i.fieldPath === "vacancies.table")?.value as { rows: unknown[] } | undefined)?.rows.length === 280);
  check("its fingerprint is the browser's, never used to confirm a server fetch", (await q("SELECT r.authenticity, s.content_sha256 FROM recruitment_source_retrievals r JOIN recruitment_sources s ON s.id = r.source_id WHERE r.import_id = $1", [pr.importId]))
    .every((r) => r.content_sha256 === sha && r.authenticity === "ATTESTED"));

  section("Two tabs: a result is saved only under the lease that took the task");
  const { jobId: twin } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD lease", "lease-job"), sources: [source] });
  for (const p of pieces) await upload(twin, p);
  await jobs.startJob({ adminId, jobId: twin, confirm: true });
  // Leave one page batch (pages 1–8, task 4): the other batches done with nothing found, the section readers failed for this test.
  await q("UPDATE recruitment_import_job_tasks SET status = 'DONE', result = '{\"values\":[],\"refused\":[]}'::jsonb WHERE job_id = $1 AND kind = 'TEXT_BATCH' AND task_no <> 4", [twin]);
  await q("UPDATE recruitment_import_job_tasks SET status = 'FAILED', reason = 'left out in this test' WHERE job_id = $1 AND kind <> 'TEXT_BATCH'", [twin]);
  calls.clear();
  behaviour = (_f, n) => (n === 1 ? "hang" : "ok");
  const stepA = jobs.stepJob({ adminId, jobId: twin, apiKey: "test-key", fetchFn, retryBackoffMs: [1, 1] }); // tab A takes the task, then stalls
  for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 20));
  const leased = (await q("SELECT status, lease_owner FROM recruitment_import_job_tasks WHERE job_id = $1 AND task_no = 4", [twin]))[0];
  const tabB1 = await jobs.stepJob({ adminId, jobId: twin, apiKey: "test-key", fetchFn, retryBackoffMs: [1, 1] });
  check("while tab A holds the lease, tab B does not take the task", leased.status === "RUNNING" && tabB1.tasks.running === 1 && (calls.get(1) ?? 0) === 1, { leased, tasks: tabB1.tasks });
  await q("UPDATE recruitment_import_job_tasks SET lease_until = now() - interval '1 second' WHERE job_id = $1 AND task_no = 4", [twin]); // A's lease runs out
  const tabB2 = await jobs.stepJob({ adminId, jobId: twin, apiKey: "test-key", fetchFn, retryBackoffMs: [1, 1] });
  const saved = (await q("SELECT result FROM recruitment_import_job_tasks WHERE job_id = $1 AND task_no = 4", [twin]))[0].result as { refused?: Array<{ reason: string }> };
  (release as unknown as () => void)();
  await stepA;
  const after = (await q("SELECT status, result, attempts FROM recruitment_import_job_tasks WHERE job_id = $1 AND task_no = 4", [twin]))[0];
  check("tab B took the task once A's lease ran out, and saved its own result", tabB2.tasks.running === 0 && JSON.stringify(saved).length > 2 && (calls.get(1) ?? 0) === 2, tabB2.tasks);
  check("tab A, late, could not overwrite it: the saved result is B's", JSON.stringify(after.result) === JSON.stringify(saved) && after.status === "DONE", after);

  section("Pause, resume, the daily allowance");
  const { jobId: paused } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD pause", "pause-job"), sources: [source] });
  for (const p of pieces) await upload(paused, p);
  await jobs.startJob({ adminId, jobId: paused, confirm: true });
  await jobs.pauseJob({ adminId, jobId: paused });
  const still = await jobs.stepJob({ adminId, jobId: paused, apiKey: "test-key", fetchFn });
  check("a paused reading takes no task", still.state === "PAUSED" && still.tasks.done === 0 && still.tasks.running === 0, still.tasks);
  await jobs.resumeJob({ adminId, jobId: paused });
  process.env.AI_DAILY_CAP = "1";
  resetMemoryUsage();
  const capped = await jobs.stepJob({ adminId, jobId: paused, apiKey: "test-key", fetchFn });
  const pending = await q("SELECT count(*)::int AS n, max(attempts)::int AS a FROM recruitment_import_job_tasks WHERE job_id = $1 AND status = 'PENDING'", [paused]);
  check("when the daily allowance runs out the reading pauses, saying why, and no task is marked failed or loses a try", capped.state === "PAUSED" && /allowance/.test(capped.stateNote ?? "") && capped.tasks.failed === 0 && pending[0].n >= 12, { capped: capped.stateNote, pending });
  process.env.AI_DAILY_CAP = "100000";
  resetMemoryUsage();

  section("Cancel, clean-up, and pages without text");
  const blank = await PDFDocument.create();
  for (let i = 0; i < 3; i++) blank.addPage([595, 842]);
  const blankBytes = Buffer.from(await blank.save());
  const { jobId: scans } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD scans", "scan-job"), sources: [{ ...source, pages: pages + 3 }] });
  for (const p of pieces) await upload(scans, p);
  const scanPart = await jobs.uploadJobPart({ adminId, jobId: scans, sourceNo: 1, first: pages + 1, last: pages + 3, bytes: blankBytes });
  check("pages without text are named, and their piece is kept to be read from the image later", scanPart.status === "READ" && scanPart.noTextPages.join() === "77,78,79"
    && (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1 AND pdf_base64 IS NOT NULL", [scans]))[0].n === 1, scanPart);
  const cancelled = await jobs.cancelJob({ adminId, jobId: scans });
  check("cancel drops every kept piece; no step works afterwards", cancelled.state === "CANCELLED"
    && (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1 AND pdf_base64 IS NOT NULL", [scans]))[0].n === 0
    && (await jobs.stepJob({ adminId, jobId: scans, apiKey: "test-key", fetchFn })).state === "CANCELLED");
  const { jobId: withScans } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD with scans", "scan2-job"), sources: [{ ...source, pages: pages + 3 }] });
  for (const p of pieces) await upload(withScans, p);
  await jobs.uploadJobPart({ adminId, jobId: withScans, sourceNo: 1, first: pages + 1, last: pages + 3, bytes: blankBytes });
  await jobs.startJob({ adminId, jobId: withScans, confirm: true });
  const ws = await run(withScans);
  const wsImp = await getImport(ws.importId!);
  check("a reading with scanned pages ends without \"complete\", and the preview says which pages were not read", ws.state === "DONE" && !ws.complete
    && ((wsImp?.proposal as unknown as { warnings: string[] }).warnings).some((w) => /pages 77, 78, 79 have no text/.test(w)), ws);
  check("…and its kept piece is dropped once the reading ends", (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1 AND pdf_base64 IS NOT NULL", [withScans]))[0].n === 0);

  section("Abandoned readings are cleaned up");
  const { jobId: old } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD abandoned", "old-job"), sources: [{ ...source, pages: 3 }] });
  await jobs.uploadJobPart({ adminId, jobId: old, sourceNo: 1, first: 1, last: 3, bytes: blankBytes });
  await q("UPDATE recruitment_import_jobs SET updated_at = now() - interval '8 days' WHERE job_id = $1", [old]);
  const purged = await jobs.purgeOldJobs();
  const oldRow = (await q("SELECT state FROM recruitment_import_jobs WHERE job_id = $1", [old]))[0];
  check("a reading untouched for 7 days is cancelled and its pieces dropped", purged.abandoned >= 1 && oldRow.state === "CANCELLED"
    && (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1 AND pdf_base64 IS NOT NULL", [old]))[0].n === 0);
  await q("UPDATE recruitment_import_jobs SET updated_at = now() - interval '31 days' WHERE job_id = $1", [old]);
  await jobs.purgeOldJobs();
  check("an ended reading older than 30 days is deleted with its pieces and tasks", (await q("SELECT count(*)::int AS n FROM recruitment_import_job_parts WHERE job_id = $1", [old]))[0].n === 0
    && (await q("SELECT count(*)::int AS n FROM recruitment_import_jobs WHERE job_id = $1", [old]))[0].n === 0);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
