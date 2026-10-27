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
import { NextRequest } from "next/server";
import { boot, check, note, section, summary, ORIGIN } from "./boot";

type Progress = Awaited<ReturnType<typeof import("@/lib/cms/importer/jobs")["jobProgress"]>>;
const PDF = process.argv[2];
if (!PDF) { console.error("usage: … importer-jobs.test.ts <ibps-crp-rrb-xv.pdf>"); process.exit(2); }

(async () => {
  const { pg, adminId, token } = await boot();
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

  /** Answers given in turn for a page, for the "almost nothing found" test; empty otherwise. */
  let emptyScript: Record<number, unknown[]> = {};
  const scanCalls = new Map<number, number>();
  /** What the stand-in "reads" on each scanned page: a table running over three pages, a row repeated at a break, unreadable, zero, NR. */
  const SCAN_ANSWERS: Record<number, unknown> = {
    77: { lines: ["Annexure S: vacancies by city"], tables: [{ title: "Annexure S", continues: false, columns: ["State", "City", "Number of Vacancies"], rows: [["Bihar", "Patna", "3"], ["Bihar", "Gaya", "2"]] }] },
    78: { lines: [], tables: [{ title: "", continues: true, columns: [], rows: [["Bihar", "Gaya", "2"], ["Assam", "Silchar", "[unclear]"], ["Assam", "Guwahati", "0"], ["Assam", "Dima", "Hasao", "1"]] }] },
    79: { lines: ["Download of admit cards from 05.11.2026"], tables: [{ title: "", continues: true, columns: [], rows: [["Kerala", "Kochi", "NR"]] }] },
  };
  /** A stand-in model: page batches answer from what their pages say; the section readers find nothing. */
  let behaviour: (first: number, call: number) => "ok" | "503" | "hang" = () => "ok";
  /** Batches whose answer the stand-in cuts off (not whole JSON), as a model does when an answer runs too long (B2.5). */
  let cutOff: (first: number, last: number) => boolean = () => false;
  const calls = new Map<number, number>();
  let release: (() => void) | null = null;
  const answer = (data: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchFn = (async (_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = body.contents[0].parts[0].text as string;
    // A scanned page sent as its image: the stand-in "reads" it from a script.
    if (body.contents[0].parts[1]?.inline_data) {
      const pm = /page (\d+) of (\d+) of a scanned/.exec(prompt);
      const pageNo = Number(pm?.[1]);
      const scripted = emptyScript[pageNo];
      if (scripted) { const k = scanCalls.get(pageNo) ?? 0; scanCalls.set(pageNo, k + 1); return answer(scripted[Math.min(k, scripted.length - 1)]); }
      return answer(SCAN_ANSWERS[pageNo] ?? { lines: [], tables: [] });
    }
    const m = /pages (\d+) to (\d+) of a \d+-page notice/.exec(prompt);
    if (!m) return answer({});
    const first = Number(m[1]);
    if (cutOff(first, Number(/pages \d+ to (\d+)/.exec(prompt)![1]))) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"examStages":[{"name":"Online Exam' }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    const admit = "Download of admit cards from 05.11.2026";
    if (t.includes(admit)) out.dates = { admitCardDate: { value: "2026-11-05", quote: admit } };
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

  section("An answer cut off for a page batch: read again in halves, only that batch");
  behaviour = () => "ok";
  calls.clear();
  cutOff = (first, last) => first === 1 && last - first + 1 > 4; // pages 1–8 too much for one answer; 1–4 and 5–8 fine
  const { jobId: cut } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD cut-off answer", "cut-job"), sources: [source] });
  for (const p of pieces) await upload(cut, p);
  await jobs.startJob({ adminId, jobId: cut, confirm: true });
  const cp = await run(cut, 60);
  const cutTasks = await q("SELECT kind, first_page, last_page, status FROM recruitment_import_job_tasks WHERE job_id = $1 AND kind = 'TEXT_BATCH' ORDER BY first_page, task_no", [cut]);
  const ranges = (st: string) => cutTasks.filter((t) => t.status === st).map((t) => `${t.first_page}-${t.last_page}`);
  check("the cut-off batch is marked split, and its halves are read", ranges("SPLIT").join() === "1-8" && ranges("DONE").slice(0, 2).join() === "1-4,5-8", cutTasks);
  const covered = cutTasks.filter((t) => t.status === "DONE").flatMap((t) => Array.from({ length: Number(t.last_page) - Number(t.first_page) + 1 }, (_, i) => Number(t.first_page) + i));
  check("every page read once, none twice, none missing", covered.length === new Set(covered).size && covered.length === pages, covered.length);
  check("the reading is complete; progress counts the split apart, not as a task to do", cp.state === "DONE" && cp.complete && cp.tasks.split === 1 && cp.tasks.done === 14 && cp.tasks.failed === 0, cp.tasks);
  const cutItems = ((await getImport(cp.importId!))?.proposal as unknown as { items: Array<{ fieldPath: string; claims: Array<{ page: number | null }> }>; meta: { sources: Array<{ reading?: { split?: Array<{ first: number; last: number }>; batches: Array<{ first: number; last: number }> } }> } });
  check("evidence keeps its page (the stage on page 1); the preview records the split and lists the halves in page order", cutItems.items.find((i) => i.fieldPath === "examStages")?.claims[0]?.page === 1
    && cutItems.meta.sources[0].reading?.split?.map((r) => `${r.first}-${r.last}`).join() === "1-8"
    && cutItems.meta.sources[0].reading?.batches.slice(0, 3).map((r) => `${r.first}-${r.last}`).join() === "1-4,5-8,9-16", cutItems.meta.sources[0].reading);

  cutOff = (first) => first === 9; // pages 9–16 cut off at every size, down to one page
  const { jobId: cut2 } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD cut-off always", "cut2-job"), sources: [source] });
  for (const p of pieces) await upload(cut2, p);
  await jobs.startJob({ adminId, jobId: cut2, confirm: true });
  const cp2 = await run(cut2, 80);
  check("a page still cut off alone is failed, with why; the reading is never called complete", cp2.state === "PAUSED" && !cp2.complete
    && cp2.failedTasks.length === 1 && cp2.failedTasks[0].first === 9 && /incomplete/i.test(cp2.failedTasks[0].reason ?? ""), { state: cp2.state, failed: cp2.failedTasks, tasks: cp2.tasks });
  cutOff = () => false;

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

  section("Scanned pages: their own images, read by the AI, marked, shown, dropped");
  behaviour = () => "ok"; // the two-tab test left the stand-in stalling on first calls
  calls.clear();
  const blank = await PDFDocument.create();
  for (let i = 0; i < 3; i++) blank.addPage([595, 842]);
  const blankBytes = Buffer.from(await blank.save());
  const { onePage } = await import("@/lib/cms/importer/pdf-split");
  const scanPage = async (jobId: string, n: number) => jobs.uploadScanPage({ adminId, jobId, sourceNo: 1, page: n, bytes: Buffer.from(await onePage(blank, n - pages)) });
  const kept = async (table: string, jobId: string) => (await q(`SELECT count(*)::int AS n FROM ${table} WHERE job_id = $1 AND pdf_base64 IS NOT NULL`, [jobId]))[0].n as number;

  const { jobId: withScans } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD with scans", "scan2-job"), sources: [{ ...source, pages: pages + 3 }] });
  for (const p of pieces) await upload(withScans, p);
  const scanPart = await jobs.uploadJobPart({ adminId, jobId: withScans, sourceNo: 1, first: pages + 1, last: pages + 3, bytes: blankBytes });
  check("pages without text are named; the piece itself is not kept", scanPart.status === "READ" && scanPart.noTextPages.join() === "77,78,79" && await kept("recruitment_import_job_parts", withScans) === 0, scanPart);
  const before = await jobs.startJob({ adminId, jobId: withScans, confirm: false });
  check("until each scanned page's own image is uploaded, those pages are missing", before.missing.filter((m) => /image is not uploaded/.test(m.reason)).map((m) => m.first).join() === "77,78,79", before.missing);
  check("a page that has text, or a PDF of two pages, is refused as a scanned page",
    /not a scanned page/.test(await limit(() => jobs.uploadScanPage({ adminId, jobId: withScans, sourceNo: 1, page: 5, bytes: Buffer.from(pieces[0].bytes) })))
    && /one page/.test(await limit(() => jobs.uploadScanPage({ adminId, jobId: withScans, sourceNo: 1, page: 77, bytes: blankBytes }))));
  for (const n of [77, 78, 79]) await scanPage(withScans, n);
  const ready2 = await jobs.startJob({ adminId, jobId: withScans, confirm: false });
  check("with the images in, nothing is missing; the estimate adds one request per scanned page and one for reading what they say", ready2.missing.length === 0 && ready2.scanPages === 3 && ready2.estimate === 13 + 3 + 1 && await kept("recruitment_import_job_pages", withScans) === 3, ready2);
  await jobs.startJob({ adminId, jobId: withScans, confirm: true });
  const ws = await run(withScans, 60);
  const wsTasks = await q("SELECT kind, first_page, status FROM recruitment_import_job_tasks WHERE job_id = $1 ORDER BY task_no", [withScans]);
  check("each scanned page was read from its image once, then what they say was read as text (pages 77–79)", wsTasks.filter((t) => t.kind === "SCAN_PAGE" && t.status === "DONE").length === 3
    && wsTasks.some((t) => t.kind === "TEXT_BATCH" && t.first_page === 77 && t.status === "DONE"), wsTasks);
  check("every page was read, but a table row the AI split into too many cells was not: said, and never called complete", ws.state === "DONE" && !ws.complete
    && ws.sources[0].scanRead.join() === "77,78,79" && /1 line\(s\) inside a vacancy table could not be read/.test(ws.stateNote ?? ""), ws);
  const wsImp = await getImport(ws.importId!);
  const wsProposal = wsImp?.proposal as unknown as { items: Array<{ fieldPath: string; value: unknown; flags: string[]; claims: Array<{ page: number | null; fromImage?: boolean }> }>; meta: { sources: Array<{ pageImages?: { pages: number[] }; vacancyTables: { problems?: string[] } }> } };
  const scanTable = wsProposal.items.find((i) => i.fieldPath === "vacancies.table")!.value as { rows: Array<{ at: Record<string, string>; status: string; total?: number; unclear?: string[]; source: { page: number; readBy?: string } }> };
  const fromImg = scanTable.rows.filter((r) => r.source.readBy === "AI_IMAGE");
  check("the scanned table's rows: Gaya repeated at the page break counted once; unreadable, zero and NR kept apart; all marked AI-read with their pages",
    fromImg.map((r) => `${r.at.city}:${r.status}:${r.total ?? "-"}:${r.source.page}${r.unclear ? ":unclear" : ""}`).join(" ") === "Patna:STATED:3:77 Gaya:STATED:2:77 Silchar:NO_FIGURE:-:78:unclear Guwahati:NIL:0:78 Kochi:NOT_REPORTED:-:79"
    && scanTable.rows.length === 280 + 5, fromImg);
  check("the repeated row is said in the review", (wsProposal.meta.sources[0].vacancyTables.problems ?? []).some((p) => /repeated from the foot of page 77; counted once/.test(p)), wsProposal.meta.sources[0].vacancyTables.problems);
  const admit = wsProposal.items.find((i) => i.fieldPath === "dates.admitCardDate");
  check("a date read from a scanned page carries its page and the AI-read mark", admit?.value === "2026-11-05" && admit.claims[0].page === 79 && admit.claims[0].fromImage === true
    && admit.flags.some((f) => /read from a scanned page by AI/.test(f)), admit);
  check("the review knows where each scanned page can be seen", wsProposal.meta.sources[0].pageImages?.pages.join() === "77,78,79");
  check("a scanned page's image is served to its admin only", (await jobs.scanPagePdf({ adminId, jobId: withScans, sourceNo: 1, page: 78 }))?.subarray(0, 5).toString() === "%PDF-"
    && /not found/.test(await limit(() => jobs.scanPagePdf({ adminId: "00000000-0000-4000-8000-000000000001", jobId: withScans, sourceNo: 1, page: 78 }))));
  check("the images are kept after the reading ends, for the review", await kept("recruitment_import_job_pages", withScans) === 3);
  const discard = await import("@/app/api/admin/cms/import/[importId]/discard/route");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  await switchRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/switch`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify({ on: true, confirm: true }) }));
  const discarded = await discard.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/${ws.importId}/discard`, { method: "POST", headers: { origin: ORIGIN, cookie: `admin_sid=${token}` } }), { params: Promise.resolve({ importId: ws.importId! }) });
  check("…and dropped when the preview is discarded", discarded.status === 200 && await kept("recruitment_import_job_pages", withScans) === 0, discarded.status);

  const { jobId: scans } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD scans", "scan-job"), sources: [{ ...source, pages: pages + 3 }] });
  for (const p of pieces) await upload(scans, p);
  await jobs.uploadJobPart({ adminId, jobId: scans, sourceNo: 1, first: pages + 1, last: pages + 3, bytes: blankBytes });
  await scanPage(scans, 77);
  const cancelled = await jobs.cancelJob({ adminId, jobId: scans });
  check("cancel drops every kept image; no step works afterwards", cancelled.state === "CANCELLED" && await kept("recruitment_import_job_pages", scans) === 0
    && (await jobs.stepJob({ adminId, jobId: scans, apiKey: "test-key", fetchFn })).state === "CANCELLED");

  section("A scanned page where the AI finds almost nothing");
  // Page 77: empty the first time, then a table. Page 78: empty twice. Page 79: blank, says the AI.
  emptyScript = { 77: [{ lines: ["7"], tables: [] }, SCAN_ANSWERS[77]], 78: [{ lines: [], tables: [] }, { lines: ["8"], tables: [] }], 79: [{ lines: ["9"], tables: [], blank: true }] };
  const { jobId: thin } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: newJob("TEST RECORD thin scans", "thin-job"), sources: [{ ...source, pages: pages + 3 }] });
  for (const p of pieces) await upload(thin, p);
  await jobs.uploadJobPart({ adminId, jobId: thin, sourceNo: 1, first: pages + 1, last: pages + 3, bytes: blankBytes });
  for (const n of [77, 78, 79]) await scanPage(thin, n);
  await jobs.startJob({ adminId, jobId: thin, confirm: true });
  const th = await run(thin, 60);
  const thTasks = await q("SELECT first_page, attempts, status, result->>'suspect' AS suspect FROM recruitment_import_job_tasks WHERE job_id = $1 AND kind = 'SCAN_PAGE' ORDER BY first_page", [thin]);
  check("a page the AI found almost nothing on is read once more; then its table is read", thTasks[0].attempts === 2 && thTasks[0].status === "DONE" && thTasks[0].suspect === null, thTasks);
  check("a page still almost empty the second time is kept but flagged; a page the AI calls blank is accepted", thTasks[1].suspect === "true" && thTasks[2].attempts === 1 && thTasks[2].suspect === null, thTasks);
  const thImp = await getImport(th.importId!);
  check("the reading is not called complete, and the preview says which page to check", th.state === "DONE" && !th.complete && th.sources[0].scanSuspect.join() === "78"
    && ((thImp?.proposal as unknown as { warnings: string[] }).warnings).some((w) => /on scanned page 78 the AI found almost nothing, twice/.test(w)), th.sources[0]);
  emptyScript = {};

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
