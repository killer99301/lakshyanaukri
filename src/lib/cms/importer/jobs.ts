// ═══════════════════════════════════════════════════════════
// Smart intake: reading jobs for long documents (stage B2.3)
// ═══════════════════════════════════════════════════════════
//
// Server only. See docs/importer-b2-3-mechanism.md. A document is uploaded
// in pieces of whole pages (split in the admin's browser); the server reads
// each piece's text itself. Reading is cut into tasks of well under a
// minute (one page batch, or one section reader), and the importer page
// asks for one step after another while it is open. Each step takes at most
// two tasks with a lease, and saves a task's result only if it still holds
// that lease, so two tabs never read or save the same task twice. Every
// finished task is in the database before the step returns: closing the
// tab, a refresh or a dropped connection loses nothing, and reopening the
// import carries on from the tasks not yet done.
//
// Every function checks that the job belongs to the admin asking. Nothing
// here publishes or verifies anything: a finished job ends in the ordinary
// preview, which the admin reviews and saves as before.

import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { extractPdfFromBuffer } from "@/intelligence/pdf-extractor";
import { readAiUsage, resolveDailyCap } from "@/lib/ai-usage";
import { contentHash } from "@/lib/cms/importer/evidence-text";
import {
  BATCH_FROM_CHARS, INCOMPLETE, mergeReadings, pageBatches, pageHasText, pagesOf, readArticle,
  type ArticleReading, type ReadingCoverage,
} from "@/lib/cms/importer/article";
import { combineReading, readSectionPart, skippedSection, type SectionOutcomes, type SectionPart } from "@/lib/cms/importer/extract";
import { createGate, retryingFetch } from "@/lib/cms/importer/pacing";
import { nearlyEmpty, pageText, transcribePage, type TranscribedPage } from "@/lib/cms/importer/scan-tables";
import type { DeclaredKind } from "@/lib/cms/importer/proposal";
import {
  ImportInputError, MAX_SOURCES, MAX_TEXT_CHARS, assemblePreview, finishSourceReading, resolveTarget,
  type NewJobInput, type ReadInput, type SourceInput,
} from "@/lib/cms/importer/service";

// ─── Limits ───────────────────────────────────────────────

export const JOB_LIMITS = {
  /** One whole PDF, before splitting. */
  fileBytes: 60 * 1024 * 1024,
  pages: 400,
  /** One uploaded piece: under the platform's 4.5 MB request limit. */
  partBytes: 4 * 1024 * 1024,
  partPages: 40,
} as const;
/** Tasks a step takes; each runs well under the route's 60 s. */
const TASKS_PER_STEP = 2;
const LEASE_SECONDS = 55;
/** A page batch's request may take this long, so a step ends inside 60 s. */
const TASK_TIMEOUT_MS = 40_000;
/** A task that fails is tried this many times in all before it is marked failed. */
const MAX_ATTEMPTS = 2;
/** A FINISHING job whose step died is taken up again after this long. */
const FINISH_STALE_SECONDS = 90;

export class JobError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "JobError"; }
}

export interface JobSourceInput {
  declaredKind: DeclaredKind;
  fileName: string;
  pages: number;
  byteSize: number;
  /** SHA-256 of the whole file, computed in the admin's browser (the server never receives the file in one piece). */
  sha256: string;
  url?: string;
  attestation?: string;
  versionLabel?: string;
  documentDate?: string;
  /** A pasted text instead of a PDF: stored at once as the source's one piece. */
  pastedText?: string;
}
interface JobSource extends Omit<JobSourceInput, "pastedText"> { no: number; kind: "pdf" | "text" }

type JobState = "UPLOADING" | "READING" | "PAUSED" | "FINISHING" | "DONE" | "CANCELLED" | "FAILED";
type TaskKind = "TEXT_BATCH" | "SECTION_AI" | "SECTION_DETAILS" | "SECTION_PATTERN" | "SCAN_PAGE";
type J = Record<string, unknown>;

const SECTION_OF: Record<Exclude<TaskKind, "TEXT_BATCH" | "SCAN_PAGE">, SectionPart> = { SECTION_AI: "ai", SECTION_DETAILS: "details", SECTION_PATTERN: "pattern" };

// ─── Reading the job's rows (always the asking admin's own) ──

async function ownJob(jobId: string, adminId: string): Promise<J> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new JobError("Reading not found", 404);
  const rows = await sql`SELECT * FROM recruitment_import_jobs WHERE job_id = ${jobId} AND created_by = ${adminId}`;
  // Another admin's job is "not found", the same as one that does not exist.
  if (rows.length === 0) throw new JobError("Reading not found", 404);
  return rows[0] as J;
}

const sourcesOf = (job: J): JobSource[] => (typeof job.sources === "string" ? JSON.parse(job.sources) : job.sources) as JobSource[];

async function partsOf(jobId: string, withText = false) {
  const rows = withText
    ? await sql`SELECT source_no, first_page, last_page, status, reason, sha256, byte_size, text, no_text_pages FROM recruitment_import_job_parts WHERE job_id = ${jobId} ORDER BY source_no, first_page`
    : await sql`SELECT source_no, first_page, last_page, status, reason, sha256, byte_size, no_text_pages, (pdf_base64 IS NOT NULL) AS kept FROM recruitment_import_job_parts WHERE job_id = ${jobId} ORDER BY source_no, first_page`;
  return rows.map((r) => ({
    sourceNo: Number(r.source_no), first: Number(r.first_page), last: Number(r.last_page), status: String(r.status) as "READ" | "FAILED",
    reason: (r.reason as string | null) ?? null, byteSize: Number(r.byte_size), text: (r.text as string | undefined) ?? null,
    noTextPages: ((r.no_text_pages as number[] | null) ?? []).map(Number), kept: r.kept === true,
  }));
}

/** The document's text from its pieces read so far, in page order (each page ends with its own page mark). */
function sourceText(parts: Awaited<ReturnType<typeof partsOf>>, sourceNo: number): string {
  return parts.filter((p) => p.sourceNo === sourceNo && p.status === "READ" && p.text).map((p) => p.text).join("\n");
}

/** Page ranges of a source that are not in any piece read: never uploaded, or uploaded and unreadable. */
function unavailableOf(source: JobSource, parts: Awaited<ReturnType<typeof partsOf>>, scans: Awaited<ReturnType<typeof scanPagesOf>> = []): Array<{ first: number; last: number; reason: string }> {
  const out: Array<{ first: number; last: number; reason: string }> = [];
  const mine = parts.filter((p) => p.sourceNo === source.no);
  for (const p of mine.filter((x) => x.status === "FAILED")) out.push({ first: p.first, last: p.last, reason: p.reason ?? "could not be read" });
  // A scanned page is read from its own image: without one, it cannot be read.
  for (const n of mine.filter((x) => x.status === "READ").flatMap((x) => x.noTextPages)) {
    const s = scans.find((x) => x.sourceNo === source.no && x.page === n);
    if (s?.status === "UPLOADED") continue;
    out.push({ first: n, last: n, reason: s?.status === "FAILED" ? `scanned page: ${s.reason}` : "scanned page: its image is not uploaded" });
  }
  const covered = new Set<number>();
  for (const p of mine) for (let n = p.first; n <= p.last; n++) covered.add(n);
  let start: number | null = null;
  for (let n = 1; n <= source.pages + 1; n++) {
    const missing = n <= source.pages && !covered.has(n);
    if (missing && start === null) start = n;
    if (!missing && start !== null) { out.push({ first: start, last: n - 1, reason: "not uploaded" }); start = null; }
  }
  return out.sort((a, b) => a.first - b.first);
}

// ─── Creating a job and receiving its pieces ──────────────

export async function createReadingJob(opts: {
  adminId: string; mode: "NEW" | "EXISTING"; recruitmentId?: string; newJob?: NewJobInput; sources: JobSourceInput[];
}): Promise<{ jobId: string }> {
  if (opts.sources.length === 0) throw new JobError("Add at least one PDF");
  if (opts.sources.length > MAX_SOURCES) throw new JobError(`At most ${MAX_SOURCES} sources in one import`);
  for (const s of opts.sources) {
    if (s.pastedText !== undefined) {
      const t = s.pastedText.trim();
      if (t.length < 100) throw new JobError("Pasted text is too short to read a recruitment from");
      if (t.length > MAX_TEXT_CHARS) throw new JobError("Pasted text is longer than 200,000 characters");
      continue;
    }
    if (!Number.isInteger(s.pages) || s.pages < 1) throw new JobError(`${s.fileName}: the page count is missing`);
    if (s.pages > JOB_LIMITS.pages) throw new JobError(`${s.fileName} has ${s.pages} pages; at most ${JOB_LIMITS.pages} can be read`);
    if (!Number.isFinite(s.byteSize) || s.byteSize > JOB_LIMITS.fileBytes) throw new JobError(`${s.fileName} is larger than ${JOB_LIMITS.fileBytes / 1024 / 1024} MB`);
    if (!/^[0-9a-f]{64}$/.test(s.sha256)) throw new JobError(`${s.fileName}: the file's fingerprint is missing`);
  }
  try {
    await resolveTarget(opts); // the job exists and is open for editing, or the new job is complete
  } catch (err) {
    if (err instanceof ImportInputError) throw new JobError(err.message, err.status);
    throw err;
  }
  await purgeOldJobs();
  const jobId = randomUUID();
  const sources: JobSource[] = opts.sources.map((s, i) => ({
    no: i + 1, kind: s.pastedText !== undefined ? "text" as const : "pdf" as const, declaredKind: s.declaredKind,
    fileName: s.pastedText !== undefined ? "Pasted text" : String(s.fileName).slice(0, 200),
    pages: s.pastedText !== undefined ? 1 : s.pages,
    byteSize: s.pastedText !== undefined ? Buffer.byteLength(s.pastedText.trim(), "utf8") : s.byteSize,
    sha256: s.pastedText !== undefined ? contentHash(Buffer.from(s.pastedText.trim(), "utf8")) : s.sha256,
    ...(s.url ? { url: s.url } : {}), ...(s.attestation ? { attestation: s.attestation.slice(0, 500) } : {}),
    ...(s.versionLabel ? { versionLabel: s.versionLabel.slice(0, 120) } : {}), ...(s.documentDate ? { documentDate: s.documentDate } : {}),
  }));
  await sql`INSERT INTO recruitment_import_jobs (job_id, created_by, mode, recruitment_id, new_job, sources)
            VALUES (${jobId}, ${opts.adminId}, ${opts.mode}, ${opts.recruitmentId ?? null}, ${opts.newJob ? JSON.stringify(opts.newJob) : null}::jsonb, ${JSON.stringify(sources)}::jsonb)`;
  // A pasted text is its source's one piece, there and then.
  for (const [i, s] of opts.sources.entries()) {
    if (s.pastedText === undefined) continue;
    const t = s.pastedText.trim();
    await sql`INSERT INTO recruitment_import_job_parts (job_id, source_no, first_page, last_page, status, sha256, byte_size, text)
              VALUES (${jobId}, ${i + 1}, 1, 1, 'READ', ${sources[i].sha256}, ${sources[i].byteSize}, ${t})`;
  }
  return { jobId };
}

/** The piece's own page marks, renumbered as pages of the whole document ("-- 3 of 8 --" in a piece from page 41 of 76 is "-- 43 of 76 --"). */
export function renumberPages(text: string, first: number, total: number): string {
  return text.replace(/^-- (\d+) of \d+ --$/gm, (_m, n: string) => `-- ${first + Number(n) - 1} of ${total} --`);
}

/**
 * One piece of a source: pages `first`–`last` of the original, as a PDF of
 * just those pages. The server reads its text; a page without text (a scan)
 * is noted, and the piece is kept for reading from the image later. The same
 * piece sent again replaces the earlier one.
 */
export async function uploadJobPart(opts: { adminId: string; jobId: string; sourceNo: number; first: number; last: number; bytes: Buffer }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  if (job.state !== "UPLOADING") throw new JobError("This reading is no longer taking pages", 409);
  const source = sourcesOf(job).find((s) => s.no === opts.sourceNo);
  if (!source || source.kind !== "pdf") throw new JobError("No such PDF in this reading");
  const { first, last } = opts;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > source.pages) throw new JobError("The piece's pages are outside the document");
  if (last - first + 1 > JOB_LIMITS.partPages) throw new JobError(`A piece holds at most ${JOB_LIMITS.partPages} pages`);
  if (opts.bytes.byteLength > JOB_LIMITS.partBytes) throw new JobError(`A piece is at most ${JOB_LIMITS.partBytes / 1024 / 1024} MB`, 413);
  const overlap = await sql`SELECT 1 FROM recruitment_import_job_parts WHERE job_id = ${opts.jobId} AND source_no = ${opts.sourceNo}
                            AND first_page <> ${first} AND first_page <= ${last} AND last_page >= ${first} LIMIT 1`;
  if (overlap.length > 0) throw new JobError("These pages overlap a piece already uploaded", 409);

  const sha = contentHash(opts.bytes);
  const save = async (status: "READ" | "FAILED", fields: { reason?: string; text?: string; noText?: number[]; keep?: boolean }) => {
    const b64 = fields.keep ? opts.bytes.toString("base64") : null;
    await sql`INSERT INTO recruitment_import_job_parts (job_id, source_no, first_page, last_page, status, reason, sha256, byte_size, pdf_base64, text, no_text_pages)
              VALUES (${opts.jobId}, ${opts.sourceNo}, ${first}, ${last}, ${status}, ${fields.reason ?? null}, ${sha}, ${opts.bytes.byteLength}, ${b64}, ${fields.text ?? null}, ${fields.noText ?? []}::int[])
              ON CONFLICT (job_id, source_no, first_page) DO UPDATE SET
                last_page = EXCLUDED.last_page, status = EXCLUDED.status, reason = EXCLUDED.reason, sha256 = EXCLUDED.sha256, byte_size = EXCLUDED.byte_size,
                pdf_base64 = EXCLUDED.pdf_base64, text = EXCLUDED.text, no_text_pages = EXCLUDED.no_text_pages, uploaded_at = now()`;
    await sql`UPDATE recruitment_import_jobs SET updated_at = now() WHERE job_id = ${opts.jobId}`;
    return { status, pages: [first, last], noTextPages: fields.noText ?? [], ...(fields.reason ? { reason: fields.reason } : {}) };
  };

  if (opts.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return save("FAILED", { reason: "the piece is not a PDF" });
  const pdf = await extractPdfFromBuffer(opts.bytes);
  const expected = last - first + 1;
  if (!pdf.ok) {
    // No text at all: every page is a scan; the browser sends each one as its own page to be read from the image.
    if (/text is empty/i.test(pdf.error ?? "")) {
      const pages = Array.from({ length: expected }, (_, i) => first + i);
      return save("READ", { text: pages.map((n) => `-- ${n} of ${source.pages} --`).join("\n"), noText: pages });
    }
    return save("FAILED", { reason: "the piece could not be opened (damaged or encrypted)" });
  }
  if (pdf.numPages !== undefined && pdf.numPages !== expected) return save("FAILED", { reason: `the piece has ${pdf.numPages} pages, not the ${expected} expected` });
  const text = renumberPages(pdf.text ?? "", first, source.pages);
  const pages = pagesOf(text) ?? [];
  const noText = Array.from({ length: expected }, (_, i) => first + i).filter((n) => !pages.some((p) => p.page === n && pageHasText(p)));
  return save("READ", { text, noText });
}

// ─── Scanned pages: each as its own one-page PDF (stage B2.4) ──

async function scanPagesOf(jobId: string) {
  const rows = await sql`SELECT source_no, page, status, reason, byte_size, (pdf_base64 IS NOT NULL) AS kept FROM recruitment_import_job_pages WHERE job_id = ${jobId} ORDER BY source_no, page`;
  return rows.map((r) => ({ sourceNo: Number(r.source_no), page: Number(r.page), status: String(r.status) as "UPLOADED" | "FAILED", reason: (r.reason as string | null) ?? null, kept: r.kept === true }));
}

/** Pages a PDF has, counted from its page objects (a one-page PDF has exactly one). */
const pdfPageCount = (bytes: Buffer) => (bytes.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

/**
 * A scanned page (one the server found no text on) as its own one-page PDF,
 * split in the browser. Kept to be read from its image, and to be shown
 * beside what was read from it. Sent again, it replaces the earlier one.
 */
export async function uploadScanPage(opts: { adminId: string; jobId: string; sourceNo: number; page: number; bytes: Buffer }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  if (job.state !== "UPLOADING") throw new JobError("This reading is no longer taking pages", 409);
  const parts = await partsOf(opts.jobId);
  if (!parts.some((p) => p.sourceNo === opts.sourceNo && p.status === "READ" && p.noTextPages.includes(opts.page))) throw new JobError(`Page ${opts.page} is not a scanned page of this reading`);
  if (opts.bytes.byteLength > JOB_LIMITS.partBytes) throw new JobError(`A page is at most ${JOB_LIMITS.partBytes / 1024 / 1024} MB`, 413);
  if (opts.bytes.subarray(0, 5).toString("latin1") !== "%PDF-" || pdfPageCount(opts.bytes) !== 1) throw new JobError("A scanned page must come as a PDF of that one page");
  await sql`INSERT INTO recruitment_import_job_pages (job_id, source_no, page, status, sha256, byte_size, pdf_base64)
            VALUES (${opts.jobId}, ${opts.sourceNo}, ${opts.page}, 'UPLOADED', ${contentHash(opts.bytes)}, ${opts.bytes.byteLength}, ${opts.bytes.toString("base64")})
            ON CONFLICT (job_id, source_no, page) DO UPDATE SET status = 'UPLOADED', reason = NULL, sha256 = EXCLUDED.sha256, byte_size = EXCLUDED.byte_size,
              pdf_base64 = EXCLUDED.pdf_base64, uploaded_at = now()`;
  await sql`UPDATE recruitment_import_jobs SET updated_at = now() WHERE job_id = ${opts.jobId}`;
  return { status: "UPLOADED" as const, page: opts.page };
}

/** A scanned page the browser could not send (over the size limit on its own), recorded with why. */
export async function recordFailedScanPage(opts: { adminId: string; jobId: string; sourceNo: number; page: number; reason: string }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  if (job.state !== "UPLOADING") throw new JobError("This reading is no longer taking pages", 409);
  await sql`INSERT INTO recruitment_import_job_pages (job_id, source_no, page, status, reason)
            VALUES (${opts.jobId}, ${opts.sourceNo}, ${opts.page}, 'FAILED', ${opts.reason.slice(0, 300)})
            ON CONFLICT (job_id, source_no, page) DO UPDATE SET status = 'FAILED', reason = EXCLUDED.reason, pdf_base64 = NULL, uploaded_at = now()`;
}

/** A scanned page's one-page PDF, to show beside what was read from it (the admin's own readings only). */
export async function scanPagePdf(opts: { adminId: string; jobId: string; sourceNo: number; page: number }): Promise<Buffer | null> {
  await ownJob(opts.jobId, opts.adminId);
  const rows = await sql`SELECT pdf_base64 FROM recruitment_import_job_pages WHERE job_id = ${opts.jobId} AND source_no = ${opts.sourceNo} AND page = ${opts.page} AND pdf_base64 IS NOT NULL`;
  return rows.length ? Buffer.from(String(rows[0].pdf_base64), "base64") : null;
}

/** What the AI wrote out from each scanned page read so far. */
async function transcriptionsOf(jobId: string): Promise<Array<{ sourceNo: number; page: TranscribedPage; suspect: boolean }>> {
  const rows = await sql`SELECT source_no, result FROM recruitment_import_job_tasks WHERE job_id = ${jobId} AND kind = 'SCAN_PAGE' AND status = 'DONE' ORDER BY first_page`;
  return rows.map((r) => {
    const res = (typeof r.result === "string" ? JSON.parse(r.result) : r.result) as { page: TranscribedPage; suspect?: boolean };
    return { sourceNo: Number(r.source_no), page: res.page, suspect: res.suspect === true };
  });
}

/** The source's text with each scanned page read so far replaced by what the AI wrote out from its image. */
function readingText(parts: Awaited<ReturnType<typeof partsOf>>, transcribed: Array<{ sourceNo: number; page: TranscribedPage }>, source: JobSource): string {
  const text = sourceText(parts, source.no);
  const mine = new Map(transcribed.filter((t) => t.sourceNo === source.no).map((t) => [t.page.page, pageText(t.page, source.pages)]));
  if (mine.size === 0) return text;
  return (pagesOf(text) ?? []).map((p) => mine.get(p.page) ?? p.text.trim()).join("\n");
}

/** A piece the browser could not send (one page over the size limit, or pages it could not split), recorded with why. */
export async function recordFailedPart(opts: { adminId: string; jobId: string; sourceNo: number; first: number; last: number; reason: string }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  if (job.state !== "UPLOADING") throw new JobError("This reading is no longer taking pages", 409);
  const source = sourcesOf(job).find((s) => s.no === opts.sourceNo);
  if (!source || opts.first < 1 || opts.last < opts.first || opts.last > source.pages) throw new JobError("The pages are outside the document");
  await sql`INSERT INTO recruitment_import_job_parts (job_id, source_no, first_page, last_page, status, reason)
            VALUES (${opts.jobId}, ${opts.sourceNo}, ${opts.first}, ${opts.last}, 'FAILED', ${opts.reason.slice(0, 300)})
            ON CONFLICT (job_id, source_no, first_page) DO UPDATE SET status = 'FAILED', reason = EXCLUDED.reason, text = NULL, pdf_base64 = NULL, uploaded_at = now()`;
}

// ─── Starting: the tasks, the estimate, the allowance ─────

async function allowanceLeft(): Promise<{ used: number; cap: number }> {
  const today = (await readAiUsage(1))[0];
  return { used: today?.total ?? 0, cap: resolveDailyCap() };
}

type PlannedTask = { sourceNo: number; kind: TaskKind; first: number | null; last: number | null };

/**
 * The first round of tasks: the text pages (the section readers and page
 * batches), and one task per scanned page with its image, which the AI
 * writes out. What the scanned pages say is read in a second round, added
 * once they are written out (`scanReadingTasks`); `later` estimates it.
 */
function plannedTasks(sources: JobSource[], parts: Awaited<ReturnType<typeof partsOf>>, scans: Awaited<ReturnType<typeof scanPagesOf>>) {
  const tasks: PlannedTask[] = [];
  let later = 0;
  for (const s of sources) {
    const text = sourceText(parts, s.no);
    const pageList = pagesOf(text);
    const hasText = pageList ? pageList.some(pageHasText) : text.trim().length >= 100;
    const scanned = scans.filter((x) => x.sourceNo === s.no && x.status === "UPLOADED").map((x) => x.page);
    if (hasText) {
      for (const kind of ["SECTION_AI", "SECTION_DETAILS", "SECTION_PATTERN"] as const) tasks.push({ sourceNo: s.no, kind, first: null, last: null });
      if (pageList && text.length > BATCH_FROM_CHARS) for (const b of pageBatches(pageList)) tasks.push({ sourceNo: s.no, kind: "TEXT_BATCH", first: b.first, last: b.last });
      else tasks.push({ sourceNo: s.no, kind: "TEXT_BATCH", first: null, last: null });
    }
    for (const n of scanned) tasks.push({ sourceNo: s.no, kind: "SCAN_PAGE", first: n, last: n });
    if (scanned.length > 0) later += Math.ceil(scanned.length / 8) + (hasText ? 0 : 3);
  }
  return { tasks, later };
}

/**
 * The second round, once the scanned pages are written out: their text read
 * in page batches like any text, and, for a document with no text pages, the
 * section readers over what was written out.
 */
function scanReadingTasks(sources: JobSource[], transcribed: Array<{ sourceNo: number; page: TranscribedPage }>, firstRound: J[]): PlannedTask[] {
  const tasks: PlannedTask[] = [];
  for (const s of sources) {
    const mine = transcribed.filter((t) => t.sourceNo === s.no).sort((a, b) => a.page.page - b.page.page);
    if (mine.length === 0) continue;
    const scanText = mine.map((t) => pageText(t.page, s.pages)).join("\n");
    if (!firstRound.some((t) => Number(t.source_no) === s.no && String(t.kind).startsWith("SECTION_"))) {
      for (const kind of ["SECTION_AI", "SECTION_DETAILS", "SECTION_PATTERN"] as const) tasks.push({ sourceNo: s.no, kind, first: null, last: null });
    }
    for (const b of pageBatches(pagesOf(scanText) ?? [])) tasks.push({ sourceNo: s.no, kind: "TEXT_BATCH", first: b.first, last: b.last });
  }
  return tasks;
}

/** A page batch's pages in two halves, for reading again after an incomplete answer; null when it is one page. */
function halvesOf(task: J, text: string): Array<{ first: number; last: number }> | null {
  const all = (pagesOf(text) ?? []).filter(pageHasText);
  const ps = task.first_page === null ? all : all.filter((p) => p.page >= Number(task.first_page) && p.page <= Number(task.last_page));
  if (ps.length < 2) return null;
  const mid = Math.ceil(ps.length / 2);
  return [ps.slice(0, mid), ps.slice(mid)].map((h) => ({ first: h[0].page, last: h[h.length - 1].page }));
}

/** New tasks numbered after the job's last; a number taken meanwhile by another step is tried again. */
async function addTasks(jobId: string, tasks: PlannedTask[]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const top = await sql`SELECT coalesce(max(task_no), 0)::int AS n FROM recruitment_import_job_tasks WHERE job_id = ${jobId}`;
    try {
      await insertTasks(jobId, tasks, Number(top[0].n) + 1);
      return;
    } catch (err) {
      if (attempt === 4 || !/duplicate|unique/i.test(err instanceof Error ? err.message : "")) throw err;
    }
  }
}

async function insertTasks(jobId: string, tasks: PlannedTask[], firstNo: number) {
  if (tasks.length === 0) return;
  await sql`INSERT INTO recruitment_import_job_tasks (job_id, task_no, source_no, kind, first_page, last_page)
            SELECT ${jobId}, t.n, t.s, t.k, t.f, t.l
            FROM unnest(${tasks.map((_, i) => firstNo + i)}::int[], ${tasks.map((t) => t.sourceNo)}::int[], ${tasks.map((t) => t.kind)}::text[],
                        ${tasks.map((t) => t.first)}::int[], ${tasks.map((t) => t.last)}::int[]) AS t(n, s, k, f, l)`;
}

/**
 * Before reading: what was uploaded, what is missing, how many AI requests
 * the reading will take, and what is left of today's allowance. With
 * `confirm`, the reading starts: only when every page is uploaded, or the
 * admin chose to read without the missing ones (they are then reported as
 * not read).
 */
export async function startJob(opts: { adminId: string; jobId: string; confirm: boolean; allowMissing?: boolean }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  if (job.state !== "UPLOADING") throw new JobError("This reading has already started", 409);
  const sources = sourcesOf(job);
  const parts = await partsOf(opts.jobId, true);
  const scans = await scanPagesOf(opts.jobId);
  const missing = sources.flatMap((s) => unavailableOf(s, parts, scans).map((u) => ({ sourceNo: s.no, ...u })));
  const { tasks, later } = plannedTasks(sources, parts, scans);
  const allowance = await allowanceLeft();
  const estimate = tasks.length + later;
  const scanPages = tasks.filter((t) => t.kind === "SCAN_PAGE").length;
  const out = { estimate, scanPages, allowance, missing, started: false };
  if (!opts.confirm) return out;
  if (missing.length > 0 && !opts.allowMissing) throw new JobError("Some pages are not uploaded or could not be read: send them again, or choose to read without them", 409);
  if (tasks.length === 0) throw new JobError("No page of the document can be read: no text, and no scanned page image", 409);
  const claimed = await sql`UPDATE recruitment_import_jobs SET state = 'READING', estimate = ${estimate}, state_note = NULL, updated_at = now()
                            WHERE job_id = ${opts.jobId} AND state = 'UPLOADING' RETURNING job_id`;
  if (claimed.length === 0) throw new JobError("This reading has already started", 409);
  await insertTasks(opts.jobId, tasks, 1);
  return { ...out, started: true };
}

// ─── A step: take tasks with a lease, read, save under the lease ──

/** A reading that failed for a reason worth another try (not a missing key or the daily allowance). */
const RETRYABLE = /unavailable|incomplete|took too long|rate limit|timed out|aborted|found almost nothing/i;
const NEARLY_EMPTY = "the AI found almost nothing on this scanned page";
// The site's own daily allowance, or the AI provider's daily quota: the task is not at fault, so it waits.
const CAP_REACHED = /AI limit for the site|daily request quota is used up/i;

function failureOf(kind: TaskKind, result: unknown): string | null {
  if (kind === "TEXT_BATCH") return (result as ArticleReading).skipped ?? null;
  if (kind === "SCAN_PAGE") return (result as { skipped?: string }).skipped ?? null;
  const outcomes = Object.values(result as J).filter((o): o is { status: string; reason?: string } => !!o && typeof o === "object" && "status" in (o as J));
  const failed = outcomes.find((o) => o.status === "skipped" && o.reason && (RETRYABLE.test(o.reason) || CAP_REACHED.test(o.reason)));
  return failed?.reason ?? null;
}

async function runTask(task: J, ctx: { job: J; sources: JobSource[]; texts: Map<number, string>; subject: string; apiKey: string | undefined; fetchFn: typeof fetch }): Promise<unknown> {
  const source = ctx.sources.find((s) => s.no === Number(task.source_no))!;
  const text = ctx.texts.get(source.no) ?? "";
  const kind = task.kind as TaskKind;
  if (kind === "SCAN_PAGE") {
    // The page itself, as the model's image to read; its own one-page PDF.
    const page = Number(task.first_page);
    const rows = await sql`SELECT pdf_base64 FROM recruitment_import_job_pages WHERE job_id = ${String(ctx.job.job_id)} AND source_no = ${source.no} AND page = ${page} AND pdf_base64 IS NOT NULL`;
    if (rows.length === 0) return { skipped: "the page's image is no longer kept" };
    const r = await transcribePage({ pdfBase64: String(rows[0].pdf_base64), page, pages: source.pages, subject: ctx.subject, apiKey: ctx.apiKey, fetchFn: ctx.fetchFn });
    if (!r.ok) return { skipped: r.reason };
    // Almost nothing found on a page not called blank: read once more; then kept, but said to be checked.
    if (nearlyEmpty(r.page)) return Number(task.attempts) < MAX_ATTEMPTS ? { skipped: NEARLY_EMPTY } : { page: r.page, suspect: true };
    return { page: r.page };
  }
  if (kind !== "TEXT_BATCH") {
    // A pasted text is read as the one-request preview reads it (as a page's text).
    return readSectionPart(SECTION_OF[kind], { content: text, kind: source.kind === "text" ? "html" : "pdf", url: source.url ?? "", subject: ctx.subject, apiKey: ctx.apiKey, fetchFn: ctx.fetchFn });
  }
  if (task.first_page === null) return readArticle({ text, subject: ctx.subject, apiKey: ctx.apiKey, fetchFn: ctx.fetchFn, timeoutMs: TASK_TIMEOUT_MS });
  const first = Number(task.first_page), last = Number(task.last_page);
  const batch = (pagesOf(text) ?? []).filter((p) => p.page >= first && p.page <= last).map((p) => p.text).join("");
  return readArticle({ text: batch, subject: ctx.subject, apiKey: ctx.apiKey, fetchFn: ctx.fetchFn, part: { first, last, pages: source.pages }, timeoutMs: TASK_TIMEOUT_MS });
}

/**
 * One step of a reading: takes at most two tasks no one holds (or whose
 * holder's lease ran out), reads them, and saves each result only if this
 * step still holds that task's lease and the reading was not cancelled.
 * Then, when every task is settled, finishes the reading or waits for the
 * admin. Returns the progress.
 */
export async function stepJob(opts: { adminId: string; jobId: string; apiKey: string | undefined; fetchFn?: typeof fetch; retryBackoffMs?: number[] }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  // A preview whose building step died (its function ended) is built again by the next step.
  if (job.state === "FINISHING" && Date.now() - new Date(String(job.updated_at)).getTime() > FINISH_STALE_SECONDS * 1000) {
    await finishJob({ ...opts, acceptFailed: true }).catch(() => undefined);
  }
  if (job.state !== "READING") return jobProgress(opts);
  const lease = randomUUID();
  const claimed = await sql`
    UPDATE recruitment_import_job_tasks t SET status = 'RUNNING', lease_owner = ${lease}, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
      attempts = t.attempts + 1, updated_at = now()
    WHERE (t.job_id, t.task_no) IN (
      SELECT job_id, task_no FROM recruitment_import_job_tasks
      WHERE job_id = ${opts.jobId} AND (status = 'PENDING' OR (status = 'RUNNING' AND lease_until < now()))
      ORDER BY task_no LIMIT ${TASKS_PER_STEP} FOR UPDATE SKIP LOCKED)
    AND EXISTS (SELECT 1 FROM recruitment_import_jobs j WHERE j.job_id = ${opts.jobId} AND j.state = 'READING')
    RETURNING t.task_no, t.source_no, t.kind, t.first_page, t.last_page, t.attempts`;

  if (claimed.length > 0) {
    const sources = sourcesOf(job);
    const parts = await partsOf(opts.jobId, true);
    const transcribed = await transcriptionsOf(opts.jobId);
    const texts = new Map(sources.map((s) => [s.no, readingText(parts, transcribed, s)]));
    const { subject } = await resolveTarget({ mode: job.mode as "NEW" | "EXISTING", recruitmentId: (job.recruitment_id as string | null) ?? undefined, newJob: (job.new_job as NewJobInput | null) ?? undefined });
    const paced = retryingFetch(opts.fetchFn ?? ((input, init) => globalThis.fetch(input, init)), { backoffMs: opts.retryBackoffMs });
    const gate = createGate(TASKS_PER_STEP);
    let capReached = false;
    await Promise.all(claimed.map((task) => gate(async () => {
      const sent = paced.stats.sent;
      let result: unknown;
      try {
        result = await runTask(task as J, { job, sources, texts, subject, apiKey: opts.apiKey, fetchFn: paced.fetch });
      } catch (err) {
        result = { values: [], refused: [], skipped: err instanceof Error ? `the reading failed: ${err.message.slice(0, 120)}` : "the reading failed" };
      }
      const requests = paced.stats.sent - sent;
      const failure = failureOf(task.kind as TaskKind, result);
      let status: "DONE" | "FAILED" | "PENDING" | "SPLIT" = "DONE";
      let attempts = Number(task.attempts);
      // An answer cut off for a batch of several pages: read in halves instead, only that batch (B2.5).
      const halves = failure && INCOMPLETE.test(failure) && task.kind === "TEXT_BATCH" ? halvesOf(task as J, texts.get(Number(task.source_no)) ?? "") : null;
      if (failure && CAP_REACHED.test(failure)) { status = "PENDING"; attempts -= 1; capReached = true; } // not the task's fault: it waits
      else if (halves) status = "SPLIT";
      else if (failure) status = attempts < MAX_ATTEMPTS && RETRYABLE.test(failure) ? "PENDING" : "FAILED";
      // Saved only under this step's own lease, and never into a cancelled reading.
      const saved = await sql`
        UPDATE recruitment_import_job_tasks SET status = ${status}, attempts = ${attempts},
          result = ${status === "DONE" ? JSON.stringify(result) : null}::jsonb, reason = ${status === "DONE" ? null : failure},
          lease_owner = NULL, lease_until = NULL, ai_requests = ai_requests + ${requests}, updated_at = now()
        WHERE job_id = ${opts.jobId} AND task_no = ${task.task_no} AND status = 'RUNNING' AND lease_owner = ${lease}
          AND EXISTS (SELECT 1 FROM recruitment_import_jobs j WHERE j.job_id = ${opts.jobId} AND j.state IN ('READING', 'PAUSED'))
        RETURNING task_no`;
      if (halves && saved.length > 0) await addTasks(opts.jobId, halves.map((h) => ({ sourceNo: Number(task.source_no), kind: "TEXT_BATCH" as const, first: h.first, last: h.last })));
    })));
    await sql`UPDATE recruitment_import_jobs SET ai_sent = ai_sent + ${paced.stats.sent}, ai_retried = ai_retried + ${paced.stats.retried},
                ai_failed = ai_failed + ${paced.stats.failed}, updated_at = now(),
                state = CASE WHEN ${capReached} AND state = 'READING' THEN 'PAUSED' ELSE state END,
                state_note = CASE WHEN ${capReached} AND state = 'READING' THEN 'Today''s AI allowance (the site''s, or the AI provider''s daily quota) is used up. Resume when it resets, or when the allowance is raised.' ELSE state_note END
              WHERE job_id = ${opts.jobId}`;
  }

  // Every task settled: finish, or wait for the admin's decision on failed tasks.
  const open = await sql`SELECT count(*) FILTER (WHERE status IN ('PENDING', 'RUNNING'))::int AS open, count(*) FILTER (WHERE status = 'FAILED')::int AS failed
                         FROM recruitment_import_job_tasks WHERE job_id = ${opts.jobId}`;
  if (Number(open[0].open) === 0) {
    if (Number(open[0].failed) > 0) {
      await sql`UPDATE recruitment_import_jobs SET state = 'PAUSED', updated_at = now(),
                  state_note = ${`${open[0].failed} part(s) of the reading failed. Retry them, or finish without them (their pages are then reported as not read).`}
                WHERE job_id = ${opts.jobId} AND state = 'READING'`;
    } else if (!(await addScanReading(opts.jobId, job))) {
      await finishJob({ ...opts, acceptFailed: false });
    }
  }
  return jobProgress(opts);
}

/**
 * Once every scanned page is written out, the second round: reading what
 * they say. Added once only (two tabs may both get here); false when there
 * is nothing to add, so the reading can finish.
 */
async function addScanReading(jobId: string, job: J): Promise<boolean> {
  const transcribed = await transcriptionsOf(jobId);
  if (transcribed.length === 0) return false;
  const took = await sql`UPDATE recruitment_import_jobs SET scan_reading_added = true, updated_at = now()
                         WHERE job_id = ${jobId} AND state = 'READING' AND scan_reading_added = false RETURNING job_id`;
  if (took.length === 0) return false;
  const firstRound = await sql`SELECT task_no, source_no, kind FROM recruitment_import_job_tasks WHERE job_id = ${jobId}`;
  const tasks = scanReadingTasks(sourcesOf(job), transcribed, firstRound as J[]);
  await insertTasks(jobId, tasks, firstRound.reduce((n, t) => Math.max(n, Number(t.task_no)), 0) + 1);
  return tasks.length > 0;
}

// ─── Finishing: the preview from the saved results ────────

/**
 * Builds the ordinary preview from the saved task results: the readings
 * put together by code (B2.2), the vacancy tables (B1), the proposal. Only
 * one step can do it: the job is moved to FINISHING first. Pages not read
 * (failed tasks, pieces not uploaded or unreadable, scanned pages) are in
 * the coverage and the warnings; the reading is never called complete
 * while one is missing.
 */
export async function finishJob(opts: { adminId: string; jobId: string; apiKey: string | undefined; fetchFn?: typeof fetch; acceptFailed: boolean }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  const counts = await sql`SELECT count(*) FILTER (WHERE status IN ('PENDING', 'RUNNING'))::int AS open, count(*) FILTER (WHERE status = 'FAILED')::int AS failed
                           FROM recruitment_import_job_tasks WHERE job_id = ${opts.jobId}`;
  if (Number(counts[0].open) > 0) throw new JobError("The reading is not finished yet", 409);
  if (Number(counts[0].failed) > 0 && !opts.acceptFailed) throw new JobError("Some parts of the reading failed: retry them, or choose to finish without them", 409);
  // Finishing without failed pages still reads what the scanned pages that were written out say.
  if (job.scan_reading_added === false && job.state !== "FINISHING" && (await transcriptionsOf(opts.jobId)).length > 0) {
    await sql`UPDATE recruitment_import_jobs SET state = 'READING', state_note = NULL, updated_at = now() WHERE job_id = ${opts.jobId} AND state IN ('READING', 'PAUSED')`;
    if (await addScanReading(opts.jobId, job)) return;
  }
  const took = await sql`UPDATE recruitment_import_jobs SET state = 'FINISHING', updated_at = now()
                         WHERE job_id = ${opts.jobId} AND (state IN ('READING', 'PAUSED')
                           OR (state = 'FINISHING' AND updated_at < now() - make_interval(secs => ${FINISH_STALE_SECONDS})))
                         RETURNING job_id`;
  if (took.length === 0) return; // another step is finishing it, or it is done or cancelled
  try {
    const { importId, unreadLines, papersMissing } = await buildJobPreview(job, opts);
    // Every page read, but table lines or exam-pattern papers that could not be read are missing data: said, and never "complete".
    const note = [
      unreadLines > 0 ? `${unreadLines} line(s) inside a vacancy table could not be read as rows; the review lists them.` : "",
      papersMissing > 0 ? `${papersMissing} exam-pattern paper(s) printed in the notice could not be read; the review names them.` : "",
    ].filter(Boolean).join(" ") || null;
    await sql`UPDATE recruitment_import_jobs SET state = 'DONE', import_id = ${importId}, state_note = ${note}, updated_at = now() WHERE job_id = ${opts.jobId} AND state = 'FINISHING'`;
    await dropPieces(opts.jobId);
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    await sql`UPDATE recruitment_import_jobs SET state = 'PAUSED', state_note = ${`The preview could not be built: ${why}. Try finishing again.`}, updated_at = now()
              WHERE job_id = ${opts.jobId} AND state = 'FINISHING'`;
    throw err instanceof JobError ? err : new JobError(`The preview could not be built: ${why}`, 500);
  }
}

async function buildJobPreview(job: J, opts: { adminId: string; jobId: string; apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<{ importId: string; unreadLines: number; papersMissing: number }> {
  const sources = sourcesOf(job);
  const parts = await partsOf(opts.jobId, true);
  const taskRows = await sql`SELECT task_no, source_no, kind, first_page, last_page, status, result, reason FROM recruitment_import_job_tasks WHERE job_id = ${opts.jobId} ORDER BY task_no`;
  const mode = job.mode as "NEW" | "EXISTING";
  const newJob = (job.new_job as NewJobInput | null) ?? undefined;
  const { record, organizationId } = await resolveTarget({ mode, recruitmentId: (job.recruitment_id as string | null) ?? undefined, newJob });
  const parsed = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  const scans = await scanPagesOf(opts.jobId);
  const transcribed = await transcriptionsOf(opts.jobId);

  const read: ReadInput[] = [];
  for (const s of sources) {
    // Scanned pages read from their images are in the text as the AI wrote them out.
    const text = readingText(parts, transcribed, s);
    const scanPages = transcribed.filter((t) => t.sourceNo === s.no).map((t) => t.page);
    const scanned = new Set(scanPages.map((p) => p.page));
    const mine = taskRows.filter((t) => Number(t.source_no) === s.no);
    const section = <P extends SectionPart>(kind: TaskKind, part: P): SectionOutcomes[P] => {
      const t = mine.find((x) => x.kind === kind);
      if (!t) return skippedSection(part, "not read: no page had text");
      return t.status === "DONE" ? parsed(t.result) as SectionOutcomes[P] : skippedSection(part, `this reading failed: ${t.reason ?? "unknown"}`);
    };
    // A batch read again in halves is replaced by its halves; its range is listed as split.
    // In page order: halves are added after the other batches, but lists joined from them keep the document's order.
    const batches = mine.filter((t) => t.kind === "TEXT_BATCH" && t.status !== "SPLIT").sort((a, b) => Number(a.first_page ?? 0) - Number(b.first_page ?? 0));
    const splitRanges = mine.filter((t) => t.kind === "TEXT_BATCH" && t.status === "SPLIT").map((t) => ({ first: t.first_page === null ? 1 : Number(t.first_page), last: t.last_page === null ? s.pages : Number(t.last_page) }));
    const whole = batches.length === 1 && batches[0].first_page === null;
    const doneParts = batches.filter((t) => t.status === "DONE").map((t) => parsed(t.result) as ArticleReading);
    const merged = mergeReadings(doneParts.map((r) => ({ values: r.values, refused: r.refused })));
    // What was read from a scanned page is the AI's reading of a picture: marked so.
    merged.values = merged.values.map((v) => (v.page != null && scanned.has(v.page) ? { ...v, fromImage: true } : v));
    // Pages with no text that were not read from their image either.
    const noTextPages = [...new Set(parts.filter((p) => p.sourceNo === s.no && p.status === "READ").flatMap((p) => p.noTextPages))]
      .filter((n) => !scanned.has(n) && !unavailableOf(s, parts, scans).some((u) => u.first <= n && u.last >= n)).sort((a, b) => a - b);
    const coverage: ReadingCoverage = {
      mode: whole ? "whole" : "batches", pages: s.kind === "text" ? null : s.pages, noTextPages,
      batches: batches.map((t) => ({ first: t.first_page === null ? 1 : Number(t.first_page), last: t.last_page === null ? s.pages : Number(t.last_page),
        status: t.status === "DONE" ? "read" as const : "failed" as const, ...(t.status === "DONE" ? {} : { reason: String(t.reason ?? "failed") }),
        values: t.status === "DONE" ? (parsed(t.result) as ArticleReading).values.length : 0 })),
      unavailable: unavailableOf(s, parts, scans),
      suspectPages: transcribed.filter((t) => t.sourceNo === s.no && t.suspect).map((t) => t.page.page),
      ...(splitRanges.length ? { split: splitRanges } : {}),
    };
    const article = { ...merged, coverage, ...(doneParts.length === 0 ? { skipped: batches[0]?.reason ? String(batches[0].reason) : "no page was read" } : {}) };
    const pasted = s.kind === "text";
    const input: SourceInput = { declaredKind: s.declaredKind, method: pasted ? "paste" : "upload", url: s.url, attestation: s.attestation, versionLabel: s.versionLabel, documentDate: s.documentDate };
    const reading = finishSourceReading(input, { finalUrl: null }, combineReading({
      content: text, kind: pasted ? "html" : "pdf", url: s.url ?? "", organizationId,
      ai: section("SECTION_AI", "ai"), details: section("SECTION_DETAILS", "details"), pattern: section("SECTION_PATTERN", "pattern"), article,
    }), organizationId);
    read.push({ input, reading, obtained: pasted
      ? { method: "PASTED", finalUrl: null, kind: "TEXT", bytes: Buffer.from(text, "utf8"), text, pages: null }
      : { method: "UPLOADED", finalUrl: null, kind: "PDF", bytes: Buffer.alloc(0), text, pages: s.pages, sha256: s.sha256, byteSize: s.byteSize, shaFromBrowser: true },
      ...(scanPages.length ? { scan: { pages: scanPages, images: { jobId: opts.jobId, sourceNo: s.no, pages: scans.filter((x) => x.sourceNo === s.no && x.status === "UPLOADED").map((x) => x.page) } } } : {}) });
  }
  const paced = retryingFetch(opts.fetchFn ?? ((input, init) => globalThis.fetch(input, init)));
  const out = await assemblePreview({
    adminId: opts.adminId, mode, newJob, apiKey: opts.apiKey, record, organizationId, read,
    aiFetch: paced.fetch, aiStats: { sent: Number(job.ai_sent) + paced.stats.sent, retried: Number(job.ai_retried), failed: Number(job.ai_failed) },
  });
  const unreadLines = (out.proposal.meta.sources as Array<{ vacancyTables?: { coverage?: { unreadLines?: unknown[] } } | null }>)
    .reduce((n, src) => n + (src.vacancyTables?.coverage?.unreadLines?.length ?? 0), 0);
  const papersMissing = (out.proposal.meta.sources as Array<{ pattern?: { expected: number; read: number } }>)
    .reduce((n, src) => n + (src.pattern ? src.pattern.expected - src.pattern.read : 0), 0);
  return { importId: out.importId, unreadLines, papersMissing };
}

// ─── The admin's controls ─────────────────────────────────

export async function pauseJob(opts: { adminId: string; jobId: string }) {
  await ownJob(opts.jobId, opts.adminId);
  await sql`UPDATE recruitment_import_jobs SET state = 'PAUSED', state_note = 'Paused by you.', updated_at = now() WHERE job_id = ${opts.jobId} AND state = 'READING'`;
  return jobProgress(opts);
}

export async function resumeJob(opts: { adminId: string; jobId: string }) {
  await ownJob(opts.jobId, opts.adminId);
  await sql`UPDATE recruitment_import_jobs SET state = 'READING', state_note = NULL, updated_at = now() WHERE job_id = ${opts.jobId} AND state = 'PAUSED'`;
  return jobProgress(opts);
}

/** Puts only the failed tasks back to be read; tasks already done are not read again. */
export async function retryFailed(opts: { adminId: string; jobId: string }) {
  await ownJob(opts.jobId, opts.adminId);
  await sql`UPDATE recruitment_import_job_tasks SET status = 'PENDING', attempts = 0, reason = NULL, updated_at = now() WHERE job_id = ${opts.jobId} AND status = 'FAILED'`;
  await sql`UPDATE recruitment_import_jobs SET state = 'READING', state_note = NULL, updated_at = now() WHERE job_id = ${opts.jobId} AND state = 'PAUSED'`;
  return jobProgress(opts);
}

/** Stops the reading for good; a task still running finishes but its result is not saved. The uploaded pieces are dropped. */
export async function cancelJob(opts: { adminId: string; jobId: string }) {
  await ownJob(opts.jobId, opts.adminId);
  await sql`UPDATE recruitment_import_jobs SET state = 'CANCELLED', state_note = 'Cancelled by you.', updated_at = now()
            WHERE job_id = ${opts.jobId} AND state NOT IN ('DONE', 'CANCELLED')`;
  await dropPieces(opts.jobId);
  await sql`UPDATE recruitment_import_job_pages SET pdf_base64 = NULL WHERE job_id = ${opts.jobId} AND pdf_base64 IS NOT NULL`;
  return jobProgress(opts);
}

async function dropPieces(jobId: string) {
  await sql`UPDATE recruitment_import_job_parts SET pdf_base64 = NULL WHERE job_id = ${jobId} AND pdf_base64 IS NOT NULL`;
}

/**
 * The scanned page images of the reading that made this preview, dropped
 * once the preview is saved or discarded: the review that shows them
 * beside their tables is over. Never throws (before the importer's tables
 * exist, there is nothing to drop).
 */
export async function dropPageImagesForImport(importId: string): Promise<void> {
  try {
    await sql`UPDATE recruitment_import_job_pages SET pdf_base64 = NULL WHERE pdf_base64 IS NOT NULL
              AND job_id IN (SELECT job_id FROM recruitment_import_jobs WHERE import_id = ${importId})`;
  } catch {
    // Clean-up is also done by purgeOldJobs.
  }
}

/**
 * Clean-up, run whenever a reading is started and by the daily job: a
 * reading untouched for 7 days is cancelled; pieces of ended readings are
 * dropped; ended readings older than 30 days are deleted with their pieces
 * and tasks (a finished reading's preview stays in recruitment_imports).
 */
export async function purgeOldJobs(): Promise<{ abandoned: number; deleted: number }> {
  const abandoned = await sql`UPDATE recruitment_import_jobs SET state = 'CANCELLED', state_note = 'Not touched for 7 days.', updated_at = now()
                              WHERE state NOT IN ('DONE', 'CANCELLED', 'FAILED') AND updated_at < now() - interval '7 days' RETURNING job_id`;
  await sql`UPDATE recruitment_import_job_parts SET pdf_base64 = NULL WHERE pdf_base64 IS NOT NULL
            AND job_id IN (SELECT job_id FROM recruitment_import_jobs WHERE state IN ('DONE', 'CANCELLED', 'FAILED'))`;
  // Scanned page images: kept for the review only, so until its preview is saved or discarded, and 7 days at most.
  await sql`UPDATE recruitment_import_job_pages SET pdf_base64 = NULL WHERE pdf_base64 IS NOT NULL AND job_id IN (
              SELECT j.job_id FROM recruitment_import_jobs j LEFT JOIN recruitment_imports i ON i.import_id = j.import_id
              WHERE j.state IN ('CANCELLED', 'FAILED') OR (j.state = 'DONE' AND (i.status IS DISTINCT FROM 'PREVIEWED' OR j.updated_at < now() - interval '7 days')))`;
  const deleted = await sql`DELETE FROM recruitment_import_jobs WHERE state IN ('DONE', 'CANCELLED', 'FAILED') AND updated_at < now() - interval '30 days' RETURNING job_id`;
  return { abandoned: abandoned.length, deleted: deleted.length };
}

// ─── Progress ─────────────────────────────────────────────

export async function jobProgress(opts: { adminId: string; jobId: string }) {
  const job = await ownJob(opts.jobId, opts.adminId);
  const sources = sourcesOf(job);
  const parts = await partsOf(opts.jobId);
  const tasks = await sql`SELECT task_no, source_no, kind, first_page, last_page, status, reason, attempts, ai_requests FROM recruitment_import_job_tasks WHERE job_id = ${opts.jobId} ORDER BY task_no`;
  const count = (st: string) => tasks.filter((t) => t.status === st).length;

  const scans = await scanPagesOf(opts.jobId);
  const suspects = (await transcriptionsOf(opts.jobId)).filter((t) => t.suspect);
  const perSource = sources.map((s) => {
    const mine = parts.filter((p) => p.sourceNo === s.no);
    const uploaded = mine.filter((p) => p.status === "READ").reduce((n, p) => n + p.last - p.first + 1, 0);
    const noText = [...new Set(mine.flatMap((p) => p.noTextPages))].sort((a, b) => a - b);
    const textPages = uploaded - noText.length;
    // Text pages read: those inside a page batch that is done (a whole-text reading covers them all).
    const readPages = new Set<number>();
    for (const t of tasks.filter((x) => Number(x.source_no) === s.no && x.kind === "TEXT_BATCH" && x.status === "DONE")) {
      const [a, b] = t.first_page === null ? [1, s.pages] : [Number(t.first_page), Number(t.last_page)];
      for (let n = a; n <= b; n++) if (!noText.includes(n)) readPages.add(n);
    }
    const scanTasks = tasks.filter((x) => Number(x.source_no) === s.no && x.kind === "SCAN_PAGE");
    return {
      no: s.no, kind: s.kind, fileName: s.fileName, sha256: s.sha256, pages: s.pages, uploadedPages: uploaded, noTextPages: noText,
      unavailable: unavailableOf(s, parts, scans), textPages, processedPages: Math.min(readPages.size, textPages),
      /** Scanned pages: their images uploaded, and read from the image by the AI. */
      scanImages: scans.filter((x) => x.sourceNo === s.no && x.status === "UPLOADED").map((x) => x.page),
      scanRead: scanTasks.filter((x) => x.status === "DONE").map((x) => Number(x.first_page)),
      /** Scanned pages where the AI found almost nothing, twice: to be checked against the page. */
      scanSuspect: suspects.filter((t) => t.sourceNo === s.no).map((t) => t.page.page),
      piecesKept: scans.filter((x) => x.sourceNo === s.no && x.kept).length,
    };
  });
  const failedTasks = tasks.filter((t) => t.status === "FAILED").map((t) => ({
    sourceNo: Number(t.source_no), kind: t.kind as TaskKind, first: t.first_page === null ? null : Number(t.first_page), last: t.last_page === null ? null : Number(t.last_page), reason: String(t.reason ?? ""),
  }));
  // Complete: every page uploaded; every text page read; every scanned page read from its image; nothing failed.
  const allRead = perSource.every((s) => s.unavailable.length === 0 && s.noTextPages.every((n) => s.scanRead.includes(n)) && s.scanSuspect.length === 0 && s.processedPages === s.textPages) && failedTasks.length === 0;
  return {
    jobId: opts.jobId, state: job.state as JobState, stateNote: (job.state_note as string | null) ?? null, importId: (job.import_id as string | null) ?? null,
    mode: job.mode, recruitmentId: job.recruitment_id ?? null,
    title: (job.new_job as NewJobInput | null)?.title ?? null,
    sources: perSource,
    // A batch split after an incomplete answer is not counted: its halves are.
    tasks: { total: tasks.length - count("SPLIT"), done: count("DONE"), running: count("RUNNING"), pending: count("PENDING"), failed: count("FAILED"), split: count("SPLIT") },
    failedTasks,
    ai: { estimate: job.estimate === null ? null : Number(job.estimate), sent: Number(job.ai_sent), retried: Number(job.ai_retried), failed: Number(job.ai_failed) },
    allowance: await allowanceLeft(),
    /** True only when every page was uploaded, had text and was read, and nothing failed. */
    complete: job.state === "DONE" && allRead && !job.state_note,
    updatedAt: job.updated_at,
  };
}

/** The admin's readings not yet finished or cancelled, newest first, to reopen. */
export async function listOpenJobs(adminId: string) {
  const rows = await sql`SELECT job_id, state, state_note, new_job, recruitment_id, sources, updated_at FROM recruitment_import_jobs
                         WHERE created_by = ${adminId} AND state NOT IN ('DONE', 'CANCELLED', 'FAILED') ORDER BY updated_at DESC LIMIT 20`;
  return rows.map((r) => ({
    jobId: r.job_id as string, state: r.state as JobState, stateNote: (r.state_note as string | null) ?? null,
    title: (r.new_job as NewJobInput | null)?.title ?? null, recruitmentId: (r.recruitment_id as string | null) ?? null,
    files: sourcesOf(r as J).map((s) => s.fileName), updatedAt: r.updated_at,
  }));
}
