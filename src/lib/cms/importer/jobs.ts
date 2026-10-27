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
  BATCH_FROM_CHARS, mergeReadings, pageBatches, pageHasText, pagesOf, readArticle,
  type ArticleReading, type ReadingCoverage,
} from "@/lib/cms/importer/article";
import { combineReading, readSectionPart, skippedSection, type SectionOutcomes, type SectionPart } from "@/lib/cms/importer/extract";
import { createGate, retryingFetch } from "@/lib/cms/importer/pacing";
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
type TaskKind = "TEXT_BATCH" | "SECTION_AI" | "SECTION_DETAILS" | "SECTION_PATTERN";
type J = Record<string, unknown>;

const SECTION_OF: Record<Exclude<TaskKind, "TEXT_BATCH">, SectionPart> = { SECTION_AI: "ai", SECTION_DETAILS: "details", SECTION_PATTERN: "pattern" };

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
function unavailableOf(source: JobSource, parts: Awaited<ReturnType<typeof partsOf>>): Array<{ first: number; last: number; reason: string }> {
  const out: Array<{ first: number; last: number; reason: string }> = [];
  const mine = parts.filter((p) => p.sourceNo === source.no);
  for (const p of mine.filter((x) => x.status === "FAILED")) out.push({ first: p.first, last: p.last, reason: p.reason ?? "could not be read" });
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
    // No text at all: every page is a scan, kept for reading from the image.
    if (/text is empty/i.test(pdf.error ?? "")) {
      const pages = Array.from({ length: expected }, (_, i) => first + i);
      return save("READ", { text: pages.map((n) => `-- ${n} of ${source.pages} --`).join("\n"), noText: pages, keep: true });
    }
    return save("FAILED", { reason: "the piece could not be opened (damaged or encrypted)" });
  }
  if (pdf.numPages !== undefined && pdf.numPages !== expected) return save("FAILED", { reason: `the piece has ${pdf.numPages} pages, not the ${expected} expected` });
  const text = renumberPages(pdf.text ?? "", first, source.pages);
  const pages = pagesOf(text) ?? [];
  const noText = Array.from({ length: expected }, (_, i) => first + i).filter((n) => !pages.some((p) => p.page === n && pageHasText(p)));
  return save("READ", { text, noText, keep: noText.length > 0 });
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

function plannedTasks(sources: JobSource[], parts: Awaited<ReturnType<typeof partsOf>>) {
  const tasks: Array<{ sourceNo: number; kind: TaskKind; first: number | null; last: number | null }> = [];
  for (const s of sources) {
    const text = sourceText(parts, s.no);
    const pageList = pagesOf(text);
    const hasText = pageList ? pageList.some(pageHasText) : text.trim().length >= 100;
    if (!hasText) continue; // nothing to read with text (B2.4 reads scanned pages)
    for (const kind of ["SECTION_AI", "SECTION_DETAILS", "SECTION_PATTERN"] as const) tasks.push({ sourceNo: s.no, kind, first: null, last: null });
    if (pageList && text.length > BATCH_FROM_CHARS) for (const b of pageBatches(pageList)) tasks.push({ sourceNo: s.no, kind: "TEXT_BATCH", first: b.first, last: b.last });
    else tasks.push({ sourceNo: s.no, kind: "TEXT_BATCH", first: null, last: null });
  }
  return tasks;
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
  const missing = sources.flatMap((s) => unavailableOf(s, parts).map((u) => ({ sourceNo: s.no, ...u })));
  const tasks = plannedTasks(sources, parts);
  const allowance = await allowanceLeft();
  const out = { estimate: tasks.length, allowance, missing, started: false };
  if (!opts.confirm) return out;
  if (missing.length > 0 && !opts.allowMissing) throw new JobError("Some pages are not uploaded or could not be read: send them again, or choose to read without them", 409);
  if (tasks.length === 0) throw new JobError("No page of the document has text to read", 409);
  const claimed = await sql`UPDATE recruitment_import_jobs SET state = 'READING', estimate = ${tasks.length}, state_note = NULL, updated_at = now()
                            WHERE job_id = ${opts.jobId} AND state = 'UPLOADING' RETURNING job_id`;
  if (claimed.length === 0) throw new JobError("This reading has already started", 409);
  await sql`INSERT INTO recruitment_import_job_tasks (job_id, task_no, source_no, kind, first_page, last_page)
            SELECT ${opts.jobId}, t.n, t.s, t.k, t.f, t.l
            FROM unnest(${tasks.map((_, i) => i + 1)}::int[], ${tasks.map((t) => t.sourceNo)}::int[], ${tasks.map((t) => t.kind)}::text[],
                        ${tasks.map((t) => t.first)}::int[], ${tasks.map((t) => t.last)}::int[]) AS t(n, s, k, f, l)`;
  return { ...out, started: true };
}

// ─── A step: take tasks with a lease, read, save under the lease ──

/** A reading that failed for a reason worth another try (not a missing key or the daily allowance). */
const RETRYABLE = /unavailable|incomplete|took too long|rate limit|timed out|aborted/i;
const CAP_REACHED = /AI limit for the site/i;

function failureOf(kind: TaskKind, result: unknown): string | null {
  if (kind === "TEXT_BATCH") return (result as ArticleReading).skipped ?? null;
  const outcomes = Object.values(result as J).filter((o): o is { status: string; reason?: string } => !!o && typeof o === "object" && "status" in (o as J));
  const failed = outcomes.find((o) => o.status === "skipped" && o.reason && (RETRYABLE.test(o.reason) || CAP_REACHED.test(o.reason)));
  return failed?.reason ?? null;
}

async function runTask(task: J, ctx: { job: J; sources: JobSource[]; texts: Map<number, string>; subject: string; apiKey: string | undefined; fetchFn: typeof fetch }): Promise<unknown> {
  const source = ctx.sources.find((s) => s.no === Number(task.source_no))!;
  const text = ctx.texts.get(source.no) ?? "";
  const kind = task.kind as TaskKind;
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
    const texts = new Map(sources.map((s) => [s.no, sourceText(parts, s.no)]));
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
      let status: "DONE" | "FAILED" | "PENDING" = "DONE";
      let attempts = Number(task.attempts);
      if (failure && CAP_REACHED.test(failure)) { status = "PENDING"; attempts -= 1; capReached = true; } // not the task's fault: it waits
      else if (failure) status = attempts < MAX_ATTEMPTS && RETRYABLE.test(failure) ? "PENDING" : "FAILED";
      // Saved only under this step's own lease, and never into a cancelled reading.
      await sql`
        UPDATE recruitment_import_job_tasks SET status = ${status}, attempts = ${attempts},
          result = ${status === "DONE" ? JSON.stringify(result) : null}::jsonb, reason = ${status === "DONE" ? null : failure},
          lease_owner = NULL, lease_until = NULL, ai_requests = ai_requests + ${requests}, updated_at = now()
        WHERE job_id = ${opts.jobId} AND task_no = ${task.task_no} AND status = 'RUNNING' AND lease_owner = ${lease}
          AND EXISTS (SELECT 1 FROM recruitment_import_jobs j WHERE j.job_id = ${opts.jobId} AND j.state IN ('READING', 'PAUSED'))`;
    })));
    await sql`UPDATE recruitment_import_jobs SET ai_sent = ai_sent + ${paced.stats.sent}, ai_retried = ai_retried + ${paced.stats.retried},
                ai_failed = ai_failed + ${paced.stats.failed}, updated_at = now(),
                state = CASE WHEN ${capReached} AND state = 'READING' THEN 'PAUSED' ELSE state END,
                state_note = CASE WHEN ${capReached} AND state = 'READING' THEN 'Today''s AI allowance is used up. Resume tomorrow, or when the allowance is raised.' ELSE state_note END
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
    } else {
      await finishJob({ ...opts, acceptFailed: false });
    }
  }
  return jobProgress(opts);
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
  const took = await sql`UPDATE recruitment_import_jobs SET state = 'FINISHING', updated_at = now()
                         WHERE job_id = ${opts.jobId} AND (state IN ('READING', 'PAUSED')
                           OR (state = 'FINISHING' AND updated_at < now() - make_interval(secs => ${FINISH_STALE_SECONDS})))
                         RETURNING job_id`;
  if (took.length === 0) return; // another step is finishing it, or it is done or cancelled
  try {
    const importId = await buildJobPreview(job, opts);
    await sql`UPDATE recruitment_import_jobs SET state = 'DONE', import_id = ${importId}, state_note = NULL, updated_at = now() WHERE job_id = ${opts.jobId} AND state = 'FINISHING'`;
    await dropPieces(opts.jobId);
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    await sql`UPDATE recruitment_import_jobs SET state = 'PAUSED', state_note = ${`The preview could not be built: ${why}. Try finishing again.`}, updated_at = now()
              WHERE job_id = ${opts.jobId} AND state = 'FINISHING'`;
    throw err instanceof JobError ? err : new JobError(`The preview could not be built: ${why}`, 500);
  }
}

async function buildJobPreview(job: J, opts: { adminId: string; jobId: string; apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<string> {
  const sources = sourcesOf(job);
  const parts = await partsOf(opts.jobId, true);
  const taskRows = await sql`SELECT task_no, source_no, kind, first_page, last_page, status, result, reason FROM recruitment_import_job_tasks WHERE job_id = ${opts.jobId} ORDER BY task_no`;
  const mode = job.mode as "NEW" | "EXISTING";
  const newJob = (job.new_job as NewJobInput | null) ?? undefined;
  const { record, organizationId } = await resolveTarget({ mode, recruitmentId: (job.recruitment_id as string | null) ?? undefined, newJob });
  const parsed = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

  const read: ReadInput[] = [];
  for (const s of sources) {
    const text = sourceText(parts, s.no);
    const mine = taskRows.filter((t) => Number(t.source_no) === s.no);
    const section = <P extends SectionPart>(kind: TaskKind, part: P): SectionOutcomes[P] => {
      const t = mine.find((x) => x.kind === kind);
      if (!t) return skippedSection(part, "not read: no page had text");
      return t.status === "DONE" ? parsed(t.result) as SectionOutcomes[P] : skippedSection(part, `this reading failed: ${t.reason ?? "unknown"}`);
    };
    const batches = mine.filter((t) => t.kind === "TEXT_BATCH");
    const whole = batches.length === 1 && batches[0].first_page === null;
    const doneParts = batches.filter((t) => t.status === "DONE").map((t) => parsed(t.result) as ArticleReading);
    const merged = mergeReadings(doneParts.map((r) => ({ values: r.values, refused: r.refused })));
    const noTextPages = [...new Set(parts.filter((p) => p.sourceNo === s.no && p.status === "READ").flatMap((p) => p.noTextPages))].sort((a, b) => a - b);
    const coverage: ReadingCoverage = {
      mode: whole ? "whole" : "batches", pages: s.kind === "text" ? null : s.pages, noTextPages,
      batches: batches.map((t) => ({ first: t.first_page === null ? 1 : Number(t.first_page), last: t.last_page === null ? s.pages : Number(t.last_page),
        status: t.status === "DONE" ? "read" as const : "failed" as const, ...(t.status === "DONE" ? {} : { reason: String(t.reason ?? "failed") }),
        values: t.status === "DONE" ? (parsed(t.result) as ArticleReading).values.length : 0 })),
      unavailable: unavailableOf(s, parts),
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
      : { method: "UPLOADED", finalUrl: null, kind: "PDF", bytes: Buffer.alloc(0), text, pages: s.pages, sha256: s.sha256, byteSize: s.byteSize, shaFromBrowser: true } });
  }
  const paced = retryingFetch(opts.fetchFn ?? ((input, init) => globalThis.fetch(input, init)));
  const out = await assemblePreview({
    adminId: opts.adminId, mode, newJob, apiKey: opts.apiKey, record, organizationId, read,
    aiFetch: paced.fetch, aiStats: { sent: Number(job.ai_sent) + paced.stats.sent, retried: Number(job.ai_retried), failed: Number(job.ai_failed) },
  });
  return out.importId;
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
  return jobProgress(opts);
}

async function dropPieces(jobId: string) {
  await sql`UPDATE recruitment_import_job_parts SET pdf_base64 = NULL WHERE job_id = ${jobId} AND pdf_base64 IS NOT NULL`;
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
  const pagesOfTask = (t: J, s: JobSource) => t.first_page === null ? s.pages : Number(t.last_page) - Number(t.first_page) + 1;

  const perSource = sources.map((s) => {
    const mine = parts.filter((p) => p.sourceNo === s.no);
    const uploaded = mine.filter((p) => p.status === "READ").reduce((n, p) => n + p.last - p.first + 1, 0);
    const noText = [...new Set(mine.flatMap((p) => p.noTextPages))].sort((a, b) => a - b);
    const batches = tasks.filter((t) => Number(t.source_no) === s.no && t.kind === "TEXT_BATCH");
    const textPages = uploaded - noText.length;
    const processed = batches.filter((t) => t.status === "DONE").reduce((n, t) => n + Math.min(pagesOfTask(t as J, s), textPages), 0);
    return {
      no: s.no, kind: s.kind, fileName: s.fileName, sha256: s.sha256, pages: s.pages, uploadedPages: uploaded, noTextPages: noText,
      unavailable: unavailableOf(s, parts), textPages, processedPages: Math.min(processed, textPages),
      piecesKept: mine.filter((p) => p.kept).length,
    };
  });
  const failedTasks = tasks.filter((t) => t.status === "FAILED").map((t) => ({
    sourceNo: Number(t.source_no), kind: t.kind as TaskKind, first: t.first_page === null ? null : Number(t.first_page), last: t.last_page === null ? null : Number(t.last_page), reason: String(t.reason ?? ""),
  }));
  const allRead = perSource.every((s) => s.unavailable.length === 0 && s.noTextPages.length === 0 && s.processedPages === s.textPages) && failedTasks.length === 0;
  return {
    jobId: opts.jobId, state: job.state as JobState, stateNote: (job.state_note as string | null) ?? null, importId: (job.import_id as string | null) ?? null,
    mode: job.mode, recruitmentId: job.recruitment_id ?? null,
    title: (job.new_job as NewJobInput | null)?.title ?? null,
    sources: perSource,
    tasks: { total: tasks.length, done: count("DONE"), running: count("RUNNING"), pending: count("PENDING"), failed: count("FAILED") },
    failedTasks,
    ai: { estimate: job.estimate === null ? null : Number(job.estimate), sent: Number(job.ai_sent), retried: Number(job.ai_retried), failed: Number(job.ai_failed) },
    allowance: await allowanceLeft(),
    /** True only when every page was uploaded, had text and was read, and nothing failed. */
    complete: job.state === "DONE" && allRead,
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
