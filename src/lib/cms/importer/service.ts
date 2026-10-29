// ═══════════════════════════════════════════════════════════
// Importer: preview, apply, decisions and the check list
// ═══════════════════════════════════════════════════════════
//
// Server only. The routes only check the session, the origin and the switch,
// then call these. Nothing here publishes, verifies by itself, or writes a
// value the admin did not tick.

import { randomUUID } from "node:crypto";
import type { ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { sql } from "@/lib/db";
import { getRecruitmentById } from "@/lib/cms/repository";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { buildSlug } from "@/lib/cms/slug";
import { normalizeNotifNum } from "@/lib/cms/duplicate-detector";
import { extractPdfFromBuffer } from "@/intelligence/pdf-extractor";
import { MIN_SCAN_TEXT_CHARS, readScannedNotice } from "@/lib/cms/scan-reader";
import { fetchSource } from "@/lib/cms/importer/fetch-source";
import { readSource, htmlToText, type SourceReading } from "@/lib/cms/importer/extract";
import { sourceOwnLink } from "@/lib/cms/importer/links";
import { buildProposal, comparable, type DeclaredKind, type RetrievalSummary } from "@/lib/cms/importer/proposal";
import { classifyField, effectiveDecision, publishGate, type FieldVerdict } from "@/lib/cms/importer/classify";
import { contentHash, valueHash } from "@/lib/cms/importer/evidence-text";
import { CRITICAL_FIELDS, FIELD_DEFS, POSITIVE_FLAG, fieldDef, revisionPath } from "@/lib/cms/importer/fields";
import { authorityCovers, hostOf, originFor } from "@/lib/cms/importer/trusted-domains";
import { buildApplyPayload, blankRecord, editorValue } from "@/lib/cms/importer/apply-build";
import { mergeTables, readVacancyTables, tableFromSplit } from "@/lib/cms/importer/vacancy-tables";
import { readRemovals, type RemovalReading } from "@/lib/cms/importer/post-removal";
import type { VacancyTable } from "@/lib/vacancy-table";
import { createGate, retryingFetch } from "@/lib/cms/importer/pacing";
import type { TranscribedPage } from "@/lib/cms/importer/scan-tables";
import {
  applyImport, claimsFor, discardImport, fieldStates, fieldValue, findServerFetch, firstImportAt, getImport,
  isImportedJob, recordDecision, retrievalsFor, revokeDecision, storePreview, type NewRetrieval,
} from "@/lib/cms/importer/repository";

export const MAX_SOURCES = 4;
export const MAX_TEXT_CHARS = 200_000;
/** AI requests of one import in flight at a time (stage B2.2: four at once hit the per-minute limit). */
const AI_CONCURRENCY = 2;

export class ImportInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "ImportInputError"; }
}

export interface SourceInput {
  declaredKind: DeclaredKind;
  method: "url" | "upload" | "paste";
  url?: string;
  bytes?: Buffer;
  /** Pasted text, or the text the scan reader wrote out for an uploaded scan. */
  text?: string;
  /** "I downloaded this from <url> myself" — for official sites that block the server. */
  attestation?: string;
  versionLabel?: string;
  documentDate?: string;
}

export interface NewJobInput {
  organizationId: string;
  organizationName: string;
  recruitmentYear: number;
  title: string;
  govType?: "Central Govt" | "State Govt" | "PSU";
  notificationNumber?: string;
}

interface ReadSource {
  input: SourceInput;
  retrieval: NewRetrieval;
  summary: RetrievalSummary;
  reading: SourceReading;
  scan?: ReadInput["scan"];
}

const KIND_LABEL: Record<string, string> = {
  OFFICIAL_NOTIFICATION: "notification", OFFICIAL_CORRIGENDUM: "corrigendum", OFFICIAL_PAGE: "official page", RESEARCH: "research", OTHER: "other",
};

function summaryLabel(r: NewRetrieval): string {
  const where = r.originHost ?? (r.method === "PASTED" ? "pasted text" : "upload");
  const how = r.authenticity === "CONFIRMED" ? (r.authenticityMethod === "FETCHED_BY_SERVER" ? "fetched by the server" : "same file as the server's fetch")
    : r.authenticity === "ATTESTED" ? "attested by admin" : r.authenticity === "UNCONFIRMED" ? "not confirmed" : "research";
  const image = r.source.kind === "IMAGE" ? " (an image: its text was read by AI, compare with the image)" : "";
  if (r.declaredKind === "RESEARCH") return `${where} — research${image}`;
  return `${where} — ${KIND_LABEL[r.declaredKind] ?? r.declaredKind}${r.versionLabel ? ` (${r.versionLabel})` : ""}, ${how}${image}`;
}

/** An image's type from its first bytes; null when it is not a PNG, JPEG or WebP. */
export function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
/** Fewer characters than this read from an image is not a recruitment detail. */
const MIN_IMAGE_TEXT_CHARS = 40;

async function obtain(input: SourceInput, fetchSourceFn: typeof fetchSource, read: { subject: string; apiKey: string | undefined; fetchFn?: typeof fetch }): Promise<{ method: NewRetrieval["method"]; finalUrl: string | null; kind: "PDF" | "HTML" | "TEXT" | "IMAGE"; bytes: Buffer; text: string; pages: number | null }> {
  if (input.method === "url") {
    if (!input.url) throw new ImportInputError("A source by address needs the address");
    const got = await fetchSourceFn(input.url);
    if (!got.ok) throw new ImportInputError(`${input.url}: ${got.error}`);
    const isPdf = /pdf/i.test(got.contentType) || got.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    if (isPdf) {
      const pdf = await extractPdfFromBuffer(got.bytes);
      if (!pdf.ok || !pdf.text) throw new ImportInputError(`${input.url}: the PDF has no text layer (a scan). Download it and upload it as a scan.`);
      return { method: "FETCHED", finalUrl: got.finalUrl, kind: "PDF", bytes: got.bytes, text: pdf.text, pages: pdf.numPages ?? null };
    }
    const html = got.bytes.toString("utf8");
    return { method: "FETCHED", finalUrl: got.finalUrl, kind: "HTML", bytes: got.bytes, text: html, pages: null };
  }
  if (input.method === "upload" && input.bytes && imageType(input.bytes)) {
    // A photo or screenshot: the AI writes out what it shows. The image itself
    // is not kept, only that text and the image's fingerprint (SHA-256).
    let text = input.text?.trim() ?? "";
    if (text.length < MIN_IMAGE_TEXT_CHARS) {
      const reading = await readScannedNotice({ data: input.bytes.toString("base64"), subject: read.subject, apiKey: read.apiKey, fetchFn: read.fetchFn, mimeType: imageType(input.bytes)!, minChars: MIN_IMAGE_TEXT_CHARS, feature: "import" });
      if (!reading.ok) throw new ImportInputError(`The image could not be read: ${reading.reason}`);
      text = reading.text;
    }
    return { method: "UPLOADED", finalUrl: null, kind: "IMAGE", bytes: input.bytes, text: text.slice(0, MAX_TEXT_CHARS), pages: null };
  }
  if (input.method === "upload") {
    if (!input.bytes || input.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ImportInputError("The uploaded file is not a PDF or an image (PNG, JPEG, WebP)");
    if (input.text && input.text.trim().length >= MIN_SCAN_TEXT_CHARS) {
      return { method: "UPLOADED", finalUrl: null, kind: "PDF", bytes: input.bytes, text: input.text.trim().slice(0, MAX_TEXT_CHARS), pages: null };
    }
    const pdf = await extractPdfFromBuffer(input.bytes);
    if (!pdf.ok || !pdf.text) throw new ImportInputError("This PDF is a scan with no text layer. Use \"Read the scan\" first.");
    return { method: "UPLOADED", finalUrl: null, kind: "PDF", bytes: input.bytes, text: pdf.text, pages: pdf.numPages ?? null };
  }
  const text = (input.text ?? "").trim();
  if (text.length < 100) throw new ImportInputError("Pasted text is too short to read a recruitment from");
  if (text.length > MAX_TEXT_CHARS) throw new ImportInputError("Pasted text is longer than 200,000 characters");
  return { method: "PASTED", finalUrl: null, kind: "TEXT", bytes: Buffer.from(text, "utf8"), text, pages: null };
}

async function readOne(input: SourceInput, organizationId: string, subject: string, apiKey: string | undefined, fetchFn: typeof fetch | undefined, fetchSourceFn: typeof fetchSource,
  pace: { gate: <T>(task: () => Promise<T>) => Promise<T>; deadline?: number }): Promise<Omit<ReadSource, "retrieval" | "summary"> & { obtained: Awaited<ReturnType<typeof obtain>> }> {
  const obtained = await obtain(input, fetchSourceFn, { subject, apiKey, fetchFn });
  const reading = await readSource({
    content: obtained.text, kind: obtained.kind === "PDF" ? "pdf" : "html", url: obtained.finalUrl ?? input.url ?? "",
    subject, organizationId, apiKey, fetchFn, gate: pace.gate, deadline: pace.deadline,
  });
  return { input, reading: finishSourceReading(input, obtained, reading, organizationId), obtained };
}

/** Every value as the editor would store it (one the editor refuses is left out, with its reason), and the source's own link. */
export function finishSourceReading(input: SourceInput, obtained: { finalUrl: string | null }, reading: SourceReading, organizationId: string): SourceReading {
  reading.values = reading.values.flatMap((v) => {
    const stored = editorValue(v.fieldPath, v.value);
    if (stored.ok) return [{ ...v, value: stored.value }];
    reading.refused.push({ fieldPath: v.fieldPath, reason: `the editor would refuse it: ${stored.reason}` });
    return [];
  });
  const own = sourceOwnLink(obtained.finalUrl ?? input.url, input.declaredKind, organizationId);
  if (own) reading.links = [own, ...reading.links.filter((l) => l.url !== own.url)];
  return reading;
}

export async function previewImport(opts: {
  adminId: string;
  mode: "NEW" | "EXISTING";
  recruitmentId?: string;
  newJob?: NewJobInput;
  sources: SourceInput[];
  apiKey: string | undefined;
  /** The AI requests' fetch (tests replace it). */
  fetchFn?: typeof fetch;
  /** Fetching a source by address (tests replace it; the real one checks every address is public). */
  fetchSourceFn?: typeof fetchSource;
  /** Epoch ms after which no new page batch of a long notice is started (the route's time limit). */
  deadline?: number;
  /** For tests: the waits between resends of a request refused for load. */
  retryBackoffMs?: number[];
}) {
  if (opts.sources.length === 0) throw new ImportInputError("Add at least one source");
  if (opts.sources.length > MAX_SOURCES) throw new ImportInputError(`At most ${MAX_SOURCES} sources in one import`);
  const { record, organizationId, subject } = await resolveTarget(opts);

  // Read every source together, but through one gate: at most AI_CONCURRENCY
  // AI requests of this import at a time, and a request refused for load is
  // resent after a wait, each resend counted against the daily allowance.
  const paced = retryingFetch(opts.fetchFn ?? ((input, init) => globalThis.fetch(input, init)), { backoffMs: opts.retryBackoffMs });
  const gate = createGate(AI_CONCURRENCY);
  const read = await Promise.all(opts.sources.map((s) => readOne(s, organizationId, subject, opts.apiKey, paced.fetch, opts.fetchSourceFn ?? fetchSource, { gate, deadline: opts.deadline })));
  return assemblePreview({ ...opts, record, organizationId, read, aiFetch: paced.fetch, aiStats: paced.stats });
}

/** The job an import goes into: an existing job open for editing, or a new one with an organisation, title and year. */
export async function resolveTarget(opts: { mode: "NEW" | "EXISTING"; recruitmentId?: string; newJob?: NewJobInput }): Promise<{ record: RecruitmentRecord | null; organizationId: string; subject: string }> {
  let record: RecruitmentRecord | null = null;
  let organizationId: string;
  let subject: string;
  if (opts.mode === "EXISTING") {
    record = opts.recruitmentId ? await getRecruitmentById(opts.recruitmentId) : null;
    if (!record) throw new ImportInputError("Job not found", 404);
    if (record.draftState !== "DRAFT" && record.draftState !== "APPROVED") throw new ImportInputError("Open the job for editing before importing into it", 409);
    organizationId = record.identity.organizationId;
    subject = `${record.identity.title.value ?? ""} — ${record.identity.organizationName}`;
  } else {
    const j = opts.newJob;
    if (!j || !j.organizationId || !j.title || !Number.isInteger(j.recruitmentYear)) throw new ImportInputError("A new job needs an organisation, a title and a year");
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(j.organizationId)) throw new ImportInputError("Organisation ID must be 2–40 lowercase letters, digits or hyphens");
    organizationId = j.organizationId;
    subject = `${j.title} — ${j.organizationName}`;
  }
  return { record, organizationId, subject };
}

/** A source as read: what came in (with its fingerprint and size, when not computed here from its bytes) and its reading. */
export interface ReadInput {
  input: SourceInput;
  reading: SourceReading;
  obtained: { method: NewRetrieval["method"]; finalUrl: string | null; kind: "PDF" | "HTML" | "TEXT" | "IMAGE"; bytes: Buffer; text: string; pages: number | null;
    sha256?: string; byteSize?: number;
    /** The fingerprint was computed in the admin's browser (a file uploaded in pieces): it can never confirm a match with a server fetch. */
    shaFromBrowser?: boolean };
  /**
   * Scanned pages the AI wrote out from their images (stage B2.4): their
   * tables are read from the transcription, not from the text; `images`
   * says where each page's image can be seen beside what was read from it.
   */
  scan?: { pages: TranscribedPage[]; images?: { jobId: string; sourceNo: number; pages: number[] } };
}

/**
 * From the sources as read to the stored preview: retrievals, vacancy
 * tables, the proposal, warnings and duplicates. The one-request preview and
 * a finished reading job both end here.
 */
export async function assemblePreview(opts: {
  adminId: string; mode: "NEW" | "EXISTING"; newJob?: NewJobInput; apiKey: string | undefined;
  record: RecruitmentRecord | null; organizationId: string; read: ReadInput[];
  aiFetch?: typeof fetch; aiStats?: { sent: number; retried: number; failed: number };
}) {
  const { record, organizationId, read } = opts;
  const paced = { fetch: opts.aiFetch, stats: opts.aiStats ?? { sent: 0, retried: 0, failed: 0 } };

  // Retrievals: fetches first, so an upload of the same file can point at one.
  const order = [...read].sort((a, b) => (a.obtained.method === "FETCHED" ? 0 : 1) - (b.obtained.method === "FETCHED" ? 0 : 1));
  const sources: ReadSource[] = [];
  for (const r of order) {
    const { input, obtained } = r;
    const research = input.declaredKind === "RESEARCH";
    const originUrl = obtained.finalUrl ?? input.url ?? null;
    const host = hostOf(originUrl);
    const origin = originFor(organizationId, host);
    const sha = obtained.sha256 ?? contentHash(obtained.bytes);
    let authenticity: NewRetrieval["authenticity"] = "UNCONFIRMED";
    let method: NewRetrieval["authenticityMethod"] = null;
    let matched: string | null = null;
    let note: string | null = null;
    if (research) authenticity = "NOT_APPLICABLE";
    else if (obtained.method === "FETCHED") { authenticity = "CONFIRMED"; method = "FETCHED_BY_SERVER"; }
    else if (obtained.method === "UPLOADED" && host && !obtained.shaFromBrowser) {
      matched = sources.find((s) => s.retrieval.method === "FETCHED" && s.retrieval.source.sha256 === sha && s.retrieval.originHost === host)?.retrieval.id
        ?? await findServerFetch(sha, host);
      if (matched) { authenticity = "CONFIRMED"; method = "HASH_MATCHES_SERVER_FETCH"; }
    }
    if (authenticity === "UNCONFIRMED" && host && input.attestation && input.attestation.trim().length >= 10) {
      authenticity = "ATTESTED"; method = "ADMIN_ATTESTED"; note = input.attestation.trim().slice(0, 500);
    }
    const retrieval: NewRetrieval = {
      id: randomUUID(), declaredKind: input.declaredKind, versionLabel: input.versionLabel ?? null, documentDate: input.documentDate ?? null,
      method: obtained.method, originUrl, originHost: host, originRole: research ? "NONE" : origin.role,
      originPurposes: research ? [] : origin.purposes, authenticity, authenticityMethod: method, matchedRetrievalId: matched,
      attestationNote: note,
      source: { sha256: sha, kind: obtained.kind, byteSize: obtained.byteSize ?? obtained.bytes.byteLength, pageCount: obtained.pages,
                text: (obtained.kind === "HTML" ? htmlToText(obtained.text) : obtained.text).slice(0, 1_000_000) },
    };
    sources.push({
      input, retrieval, reading: r.reading, ...(r.scan ? { scan: r.scan } : {}),
      summary: { id: retrieval.id, declaredKind: input.declaredKind, authenticity, originRole: retrieval.originRole,
                 originPurposes: retrieval.originPurposes, label: summaryLabel(retrieval), versionLabel: input.versionLabel, documentDate: input.documentDate },
    });
  }

  // Vacancy tables: read from each document's text by code (the AI only for a
  // heading code cannot match), or built from a quoted category split when the
  // document prints no table; then brought into the job's own table by row
  // identity. What was read, merged and left out goes to the preview.
  const tableNotes = new Map<string, unknown>();
  const removals = new Map<string, RemovalReading>();
  for (const s of sources) {
    const breakdown = s.reading.values.find((v) => v.fieldPath === "vacancies.breakdown");
    const totalValue = s.reading.values.find((v) => v.fieldPath === "vacancies.total")?.value;
    const splitRows = Array.isArray(breakdown?.value) ? (breakdown!.value as Array<{ post: string; count: number; breakdown?: Record<string, unknown> }>) : [];
    const fallbackPost = (splitRows.length === 1 ? splitRows[0].post : null) ?? opts.newJob?.title ?? record?.identity.title.value ?? "All posts";
    // Scanned pages: their tables come from what the AI wrote out cell by cell, read by code, and join the
    // text tables they continue (or that continue them); those pages are not read again as text.
    const { table: read, coverage } = s.retrieval.source.text.trim()
      ? await readVacancyTables(s.retrieval.source.text, { retrievalId: s.retrieval.id, fallbackPost, apiKey: opts.apiKey, fetchFn: paced.fetch,
          ...(s.scan ? { scanPages: s.scan.pages } : {}) })
      : { table: null, coverage: { pages: null, tables: [], unreadLines: [] } as Awaited<ReturnType<typeof readVacancyTables>>["coverage"] };
    const readerProblems = coverage.problems ?? [];
    const fromSplit = !read && breakdown
      ? tableFromSplit(splitRows, typeof totalValue === "number" ? totalValue : null, { retrievalId: s.retrieval.id, page: breakdown.page ?? null, line: breakdown.quote ?? "" }, s.retrieval.source.text)
      : null;
    const table = read ?? fromSplit;
    let note: Record<string, unknown> = { coverage, from: read ? "tables" : fromSplit ? "split" : null, ...(readerProblems.length ? { problems: readerProblems } : {}) };
    if (table) {
      // Rows a re-issued notice no longer lists are removed only when every
      // table and line of it was read: a line that was not read may be one of them.
      const coverageComplete = coverage.tables.every((t) => t.read) && coverage.unreadLines.length === 0;
      const corrigendum = s.input.declaredKind === "OFFICIAL_CORRIGENDUM";
      const existingTable = record?.vacancies.table?.value ?? null;
      const merged = mergeTables(existingTable, table, corrigendum || !coverageComplete);
      const removalsHeld = !corrigendum && !coverageComplete && existingTable ? mergeTables(existingTable, table, false).diff.removed.length : 0;
      const stored = editorValue("vacancies.table", merged.table);
      if (stored.ok) {
        const first = table.rows[0]?.source;
        s.reading.values.push({ fieldPath: "vacancies.table", value: stored.value, quote: first?.line.split("\n").pop() ?? "", page: first?.page ?? null });
      } else {
        s.reading.refused.push({ fieldPath: "vacancies.table", reason: `the editor would refuse it: ${stored.reason}` });
      }
      const brief = (r: { at: Record<string, string>; status: string; total?: number; source: { page: number | null } }) => ({ at: r.at, status: r.status, total: r.total ?? null, page: r.source.page });
      note = { ...note, problems: [...readerProblems, ...merged.problems], removalsHeld, diff: {
        added: merged.diff.added.length, changed: merged.diff.changed.length, removed: merged.diff.removed.length, same: merged.diff.same,
        untouchedPosts: merged.diff.untouchedPosts,
        addedRows: merged.diff.added.slice(0, 60).map(brief),
        changedRows: merged.diff.changed.slice(0, 60).map((c) => ({ before: brief(c.before), after: brief(c.after) })),
        removedRows: merged.diff.removed.slice(0, 60).map(brief),
      } };
    }
    // Posts a corrigendum deletes (P2.3): read by code against the job's table (with what this corrigendum's
    // own table adds or changes), checked, and offered as the job's table without them. Never by a guess.
    if (s.input.declaredKind === "OFFICIAL_CORRIGENDUM" && record) {
      const at = s.reading.values.findIndex((v) => v.fieldPath === "vacancies.table");
      const base = at >= 0 ? (s.reading.values[at].value as VacancyTable) : record.vacancies.table?.value ?? null;
      const removal = readRemovals(s.retrieval.source.text, base, { retrievalId: s.retrieval.id });
      if (removal.found > 0) {
        note = { ...note, removal: removalNote(removal, base) };
        removals.set(s.retrieval.id, removal);
        if (removal.table) {
          const stored = editorValue("vacancies.table", removal.table);
          const quote = removal.removals[0].quotes[removal.removals[0].quotes.length - 1];
          if (stored.ok) {
            // A scanned corrigendum's words are the AI's reading of the page image: marked so, to be checked against it.
            const fromImage = !!s.scan?.pages.some((p) => p.page === quote.page);
            const value = { fieldPath: "vacancies.table", value: stored.value, quote: quote.text, page: quote.page, ...(fromImage ? { fromImage: true } : {}) };
            if (at >= 0) s.reading.values[at] = value; else s.reading.values.push(value);
          } else {
            s.reading.refused.push({ fieldPath: "vacancies.table", reason: `the editor would refuse it: ${stored.reason}` });
          }
        }
      }
    }
    tableNotes.set(s.retrieval.id, note);
  }

  // What the job holds now (for an existing job), and its earlier claims.
  let verifiedPaths = new Set<string>();
  let existing: Array<{ id: string; fieldPath: string; value: unknown; superseded: boolean }> = [];
  if (record) {
    const states = await fieldStates(record, Object.keys(FIELD_DEFS));
    const first = await firstImportAt(record.id);
    verifiedPaths = new Set(states.filter((s) => classifyField(s, first).cls === "VERIFIED").map((s) => s.fieldPath));
    existing = (await claimsFor(record.id)).filter((c) => c.kind === "EXTRACTED").map((c) => ({ id: c.id, fieldPath: c.fieldPath, value: c.value, superseded: c.superseded === true }));
  }
  const proposal = buildProposal({
    extractions: sources.map((s) => ({ retrieval: s.summary, values: s.reading.values, links: s.reading.links })),
    // A new job already has what the admin typed (title, maybe the number):
    // a document's heading is offered as a replacement, never ticked over it.
    current: (fieldPath) => record ? { value: fieldValue(record, fieldPath), verified: verifiedPaths.has(fieldPath) }
      : fieldPath === "identity.title" ? { value: opts.newJob?.title, verified: false }
      : fieldPath === "identity.notificationNumber" && opts.newJob?.notificationNumber ? { value: opts.newJob.notificationNumber, verified: false }
      : undefined,
    existingClaims: existing,
    currentLinks: record?.links ?? [],
    today: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
  });

  // A job with a vacancy table, or a vacancy table in this import, works its
  // total and breakdown out from the table: a figure read for them separately
  // is shown for reference, never ticked to save.
  const tableOffered = proposal.items.some((i) => i.fieldPath === "vacancies.table");
  if (record?.vacancies.table?.value || tableOffered) {
    for (const item of proposal.items) {
      if (item.fieldPath === "vacancies.total" || item.fieldPath === "vacancies.breakdown") {
        item.defaultTicked = false;
        item.flags = [...item.flags, tableOffered ? "worked out from the vacancy table below when it is saved" : "this job has a vacancy table: add the figures there"];
      }
    }
  }
  // The exam pattern: how many papers the notice prints, against how many were read. A partial pattern is
  // never offered as the whole: it is flagged, left unticked, and each paper not read is named with its page.
  for (const s of sources) {
    const pc = s.reading.patternCoverage;
    if (!pc) continue;
    const item = proposal.items.find((i) => i.fieldPath === "examPattern" && i.claims.some((c) => c.retrievalId === s.retrieval.id));
    const missing = pc.tables.filter((t) => !t.read).map((t) => `${t.heading ? `“${t.heading}”` : "a paper"} (page ${t.page ?? "?"})`);
    if (missing.length) {
      proposal.warnings.push(`${s.summary.label}: the notice prints ${pc.expected} exam-pattern table(s); ${pc.read} read. Not read: ${missing.join(", ")}. Enter ${missing.length === 1 ? "it" : "them"} in the editor's exam pattern.`);
      if (item) { item.defaultTicked = false; item.flags = [...item.flags, `incomplete: ${pc.read} of ${pc.expected} papers read — not read: ${missing.join(", ")}`]; }
    } else if (item) {
      item.flags = [...item.flags, `${POSITIVE_FLAG}all ${pc.expected} papers read by code from the notice's tables`];
    }
    // A paper's figures against its printed total: a difference is a warning; a paper that prints no total has
    // nothing to check against, which is said as that, not as a disagreement.
    if (item && pc.problems.length) {
      item.flags = [...item.flags, ...pc.problems.map((p) => /: no printed total under the table$/.test(p)
        ? `${p.replace(/: no printed total under the table$/, "")} prints no total under its table: its questions and marks could not be checked against one`
        : `the figures do not match the printed total — ${p}`)];
    }
  }
  // Tables found but not read, and lines in a table that were not read, are said.
  for (const s of sources) {
    const note = tableNotes.get(s.retrieval.id) as { coverage?: { tables: Array<{ title: string; pages: number[]; read: boolean; why?: string }>; unreadLines: unknown[] } } | undefined;
    for (const t of note?.coverage?.tables.filter((x) => !x.read) ?? []) {
      proposal.warnings.push(`A vacancy table${t.title ? ` (“${t.title}”)` : ""} on page ${t.pages.join(", ") || "?"} was not read: ${t.why}. Its rows are not in this preview; enter them in the editor's vacancy table.`);
    }
    if (note?.coverage?.unreadLines.length) proposal.warnings.push(`${note.coverage.unreadLines.length} line(s) inside a vacancy table could not be read as rows; check them in the preview.`);
  }
  // A corrigendum's deletion: the job's table without the posts is offered unticked, saying exactly what goes;
  // one that could not be matched for certain removes nothing, and says why.
  for (const s of sources) {
    const removal = removals.get(s.retrieval.id);
    if (!removal) continue;
    if (removal.table) {
      const item = proposal.items.find((i) => i.fieldPath === "vacancies.table" && i.claims.some((c) => c.retrievalId === s.retrieval.id));
      const what = removal.removals.map((r) => `${r.post} (${r.count} post${r.count === 1 ? "" : "s"}${r.table ? `, table ${r.table}` : ""}${r.serial ? `, serial ${r.serial}` : ""})`).join("; ");
      if (item) {
        item.defaultTicked = false;
        item.flags = [...item.flags, `removes what the corrigendum deletes: ${what} — every figure in ${removal.removals.length === 1 ? "its rows goes with it" : "their rows goes with them"}${removal.total ? `; the total becomes ${removal.total.before} − ${removal.total.removed} = ${removal.total.after}, as printed` : ""}. Tick to remove; the table before is kept in its history and can be restored.`];
      }
    } else if (removal.refused.length > 0) {
      proposal.warnings.push(`${s.summary.label} deletes ${removal.found === 1 ? "a post" : "posts"}, but nothing is removed: ${removal.refused.map((x) => `${x.reason} (“${x.quote.slice(0, 160)}”)`).join("; ")}. Check the corrigendum and remove ${removal.found === 1 ? "it" : "them"} in the job editor if it means that.`);
    }
  }

  // Pages the whole-text reading did not read are said, page range by page range.
  for (const s of sources) {
    const cov = s.reading.readingCoverage;
    if (!cov) continue;
    const unread = cov.batches.filter((b) => b.status !== "read");
    if (cov.mode === "batches" && unread.length > 0) {
      proposal.warnings.push(`${s.summary.label}: pages ${unread.map((b) => b.first === b.last ? `${b.first}` : `${b.first}–${b.last}`).join(", ")} of ${cov.pages} were not read (${[...new Set(unread.map((b) => b.reason))].join("; ")}). What those pages state is missing from this preview.`);
    }
    for (const u of cov.unavailable ?? []) {
      proposal.warnings.push(`${s.summary.label}: ${u.first === u.last ? `page ${u.first}` : `pages ${u.first}–${u.last}`} of ${cov.pages} ${u.reason === "not uploaded" ? "were not uploaded" : `could not be read (${u.reason})`}. What those pages state is missing from this preview.`);
    }
    if (cov.suspectPages?.length) {
      proposal.warnings.push(`${s.summary.label}: on scanned ${cov.suspectPages.length === 1 ? "page" : "pages"} ${cov.suspectPages.join(", ")} the AI found almost nothing, twice. Something printed there may be missing from this preview: check the ${cov.suspectPages.length === 1 ? "page" : "pages"}.`);
    }
    if (cov.noTextPages.length > 0) {
      proposal.warnings.push(`${s.summary.label}: pages ${cov.noTextPages.join(", ")} have no text (scanned pages); they were not read.`);
    }
  }
  // Spellings the AI thinks are misprinted on scanned pages: kept as printed, the suggestions said, never applied (B2.6).
  for (const s of sources) {
    for (const p of s.scan?.pages ?? []) {
      if (!p.corrections?.length) continue;
      proposal.warnings.push(`${s.summary.label}: on scanned page ${p.page} the AI suggests other spellings for ${p.corrections.length === 1 ? "a word" : "words"} — kept exactly as printed; apply a suggestion only if the notice means it: ${p.corrections.map((c) => `“${c.printed}” → “${c.suggested}”`).join("; ")}.`);
    }
  }

  // Keys for the duplicate lock and check of a new job.
  let identityKey: string | null = null;
  let orgYearKey: string | null = null;
  let duplicates: unknown[] = [];
  if (opts.mode === "NEW") {
    const j = opts.newJob!;
    const extractedNumber = proposal.items.find((i) => i.fieldPath === "identity.notificationNumber" && !i.conflict)?.value as string | undefined;
    identityKey = normalizeNotifNum(j.notificationNumber || extractedNumber) ?? null;
    orgYearKey = `${j.organizationId}:${j.recruitmentYear}`;
    const rows = await sql`SELECT public.cms_job_duplicates(${identityKey}, ${j.organizationId}, ${j.recruitmentYear}::int) AS d`;
    duplicates = (typeof rows[0].d === "string" ? JSON.parse(rows[0].d) : rows[0].d) as unknown[];
  }

  const importId = randomUUID();
  const stored = {
    ...proposal,
    meta: {
      mode: opts.mode,
      newJob: opts.newJob ?? null,
      sources: sources.map((s) => ({ ...s.summary, method: s.retrieval.method, originUrl: s.retrieval.originUrl,
        notFound: s.reading.notFound, refused: s.reading.refused, summary: s.reading.summary,
        ...(s.reading.articleSkipped ? { articleSkipped: s.reading.articleSkipped } : {}),
        vacancyTables: tableNotes.get(s.retrieval.id) ?? null, reading: s.reading.readingCoverage ?? null, ...(s.reading.patternCoverage ? { pattern: s.reading.patternCoverage } : {}),
        ...(s.scan?.images ? { pageImages: s.scan.images } : {}) })),
      duplicates,
      aiRequests: { ...paced.stats },
    },
  };
  await storePreview({
    importId, mode: opts.mode, recruitmentId: record?.id ?? null, baseRevision: record?.recordRevision ?? null,
    identityKey, orgYearKey, proposal: stored, adminId: opts.adminId, retrievals: sources.map((s) => s.retrieval),
  });
  return { importId, proposal: stored, duplicates };
}

export async function applyImportFlow(opts: {
  importId: string;
  adminId: string;
  selected: string[];
  confirmReplaceVerified: boolean;
  override: { reason: string } | null;
}) {
  const imp = await getImport(opts.importId);
  if (!imp) throw new ImportInputError("Import not found", 404);
  if (imp.status === "APPLIED") return { recruitmentId: String(imp.result?.recruitmentId), replayed: true };
  if (imp.status !== "PREVIEWED") throw new ImportInputError("This import was discarded or has expired", 409);
  if (Date.now() - Date.parse(imp.createdAt) > 7 * 86_400_000) throw new ImportInputError("This preview is more than 7 days old. Make a new one.", 409);

  const meta = (imp.proposal as unknown as { meta: { newJob: NewJobInput | null; sources: Array<{ label: string }> } }).meta;
  let record: RecruitmentRecord;
  let slug: string | undefined;
  if (imp.mode === "EXISTING") {
    const r = await getRecruitmentById(imp.recruitmentId!);
    if (!r) throw new ImportInputError("Job not found", 404);
    record = r;
  } else {
    const j = meta.newJob!;
    record = blankRecord({
      organizationId: j.organizationId, organizationName: j.organizationName, govType: j.govType, recruitmentYear: j.recruitmentYear,
      title: { value: j.title, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true },
    } as RecruitmentRecord["identity"], opts.adminId);
    slug = buildSlug(j.organizationId, j.title, j.recruitmentYear);
  }
  const payload = buildApplyPayload({
    record, proposal: imp.proposal, selected: opts.selected, confirmReplaceVerified: opts.confirmReplaceVerified,
    adminId: opts.adminId, sourceLabel: meta.sources.map((s) => s.label).join("; ").slice(0, 300), slug,
  });
  return applyImport({ importId: opts.importId, adminId: opts.adminId, selected: opts.selected, override: opts.override, payload });
}

export { discardImport, getImport };

// ─── The check list and decisions ─────────────────────────

export interface CheckRow extends FieldVerdict {
  tier?: "A" | "B";
  value: unknown;
  latestRevisionId: string | null;
  decisionId: string | undefined;
}

export async function checksFor(record: RecruitmentRecord) {
  const imported = await isImportedJob(record.id);
  const [states, first, retrievals] = await Promise.all([fieldStates(record, CRITICAL_FIELDS), firstImportAt(record.id), retrievalsFor(record.id)]);
  const gate = publishGate(states, first);
  const rows: CheckRow[] = gate.verdicts.map((v) => {
    const s = states.find((x) => x.fieldPath === v.fieldPath)!;
    return { ...v, tier: fieldDef(v.fieldPath).tier, value: s.value, latestRevisionId: s.latestRevisionId, decisionId: effectiveDecision(s)?.id };
  });
  // Every imported field's state, for the editor's badges (critical or not).
  // Derived from the claims and the field's current revision; the field's own
  // CMS status is left as it is.
  const fields: Record<string, string> = {};
  if (imported) {
    const all = await fieldStates(record, Object.keys(FIELD_DEFS).filter((p) => !p.startsWith("links#") && p !== "identity.title"));
    for (const s of all) if (s.hasValue || s.claims.length > 0) fields[s.fieldPath] = classifyField(s, first).cls;
    for (const r of rows) fields[r.fieldPath] = r.cls;
  }
  return { imported, ok: gate.ok, rows, blockers: gate.blockers.map((b) => b.fieldPath), retrievals, fields };
}

/** The publish gate for one job: only imported jobs are gated. */
export async function publishGateFor(record: RecruitmentRecord): Promise<{ gated: boolean; ok: boolean; blockers: FieldVerdict[]; verdicts: FieldVerdict[] }> {
  if (!(await isImportedJob(record.id))) return { gated: false, ok: true, blockers: [], verdicts: [] };
  const gate = publishGate(await fieldStates(record, CRITICAL_FIELDS), await firstImportAt(record.id));
  return { gated: true, ...gate };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export async function decide(opts: {
  recruitmentId: string;
  adminId: string;
  fieldPath: string;
  kind: "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED";
  retrievalId: string;
  page: number | null;
  quote: string | null;
  tableCell: { page?: number; row?: string; column?: string; text: string } | null;
  reviewScope: { whole_document?: boolean; pages?: number[]; sections?: string[] } | null;
  justification: string | null;
  publicNote: string | null;
  seen: { revisionId: string | null; decisionId: string | null };
}) {
  if (!(opts.fieldPath in FIELD_DEFS)) throw new ImportInputError("Unknown field");
  const record = await getRecruitmentById(opts.recruitmentId);
  if (!record) throw new ImportInputError("Job not found", 404);
  if (record.draftState !== "DRAFT" && record.draftState !== "APPROVED") throw new ImportInputError("Open the job for editing first", 409);

  const retrieval = (await retrievalsFor(record.id)).find((r) => r.id === opts.retrievalId);
  if (!retrieval) throw new ImportInputError("That document was not brought in for this job");
  if (retrieval.authenticity !== "CONFIRMED" && retrieval.authenticity !== "ATTESTED") throw new ImportInputError("Only a confirmed or attested document can support a decision");
  const purpose = fieldDef(opts.fieldPath).purpose;
  if (opts.kind === "ADMIN_NOT_STATED" ? retrieval.originRole !== "AUTHORITY" : !authorityCovers(retrieval.originRole, retrieval.originPurposes, purpose)) {
    throw new ImportInputError(opts.kind === "ADMIN_NOT_STATED"
      ? "\"Not stated\" must be checked against the recruiting body's own document"
      : `${retrieval.originHost ?? "This source"} is not trusted for ${purpose.replace(/_/g, " ")} details of this organisation`);
  }
  // The words cited must be in the document (a table cell is shown as typed).
  if (opts.quote) {
    const text = (await sql`SELECT s.text FROM recruitment_sources s JOIN recruitment_source_retrievals r ON r.source_id = s.id WHERE r.id = ${opts.retrievalId}`)[0]?.text as string | undefined;
    if (!text || !squash(text).includes(squash(opts.quote))) throw new ImportInputError("Those words are not in the document. Copy them exactly.");
  }

  const path = revisionPath(opts.fieldPath);
  const current = fieldValue(record, opts.fieldPath);
  const currentField = path.includes(".")
    ? (record as unknown as Record<string, Record<string, unknown>>)[path.split(".")[0]]?.[path.split(".")[1]]
    : (record as unknown as Record<string, unknown>)[path === "examPattern" ? "examPattern" : path];
  let newRecord: RecruitmentRecord | null = null;
  let revision: { oldValue: unknown; newValue: unknown; reason: string };
  const docName = `${retrieval.originHost ?? "document"}${retrieval.versionLabel ? `, ${retrieval.versionLabel}` : ""}${opts.page ? `, p.${opts.page}` : ""}`;
  if (opts.kind === "ADMIN_VERIFIED") {
    if (current === null || current === undefined) throw new ImportInputError("There is no value to verify");
    revision = { oldValue: currentField ?? null, newValue: currentField ?? null, reason: `Checked against ${docName}` };
  } else if (opts.fieldPath.startsWith("links#")) {
    revision = { oldValue: record.links, newValue: record.links, reason: `${opts.kind === "ADMIN_NOT_STATED" ? "Recorded as not stated" : "Recorded as not applicable"} (${docName}): ${opts.justification}` };
  } else {
    const field: ProvenanceField<unknown> = { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true };
    const reason = `${opts.kind === "ADMIN_NOT_STATED" ? "Recorded as not stated" : "Recorded as not applicable"} (${docName}): ${opts.justification}`;
    const result = routeFieldUpdate(record, path, field, opts.adminId, reason);
    newRecord = result.record;
    revision = { oldValue: result.revision.oldValue ?? null, newValue: result.revision.newValue ?? null, reason };
  }

  return recordDecision({
    record, newRecord, fieldPath: opts.fieldPath, kind: opts.kind, adminId: opts.adminId, seen: opts.seen,
    claim: {
      value: opts.kind === "ADMIN_VERIFIED" ? current : null,
      valueHash: opts.kind === "ADMIN_VERIFIED" ? valueHash(comparable(opts.fieldPath, current)) : null,
      retrievalId: opts.retrievalId, page: opts.page, quote: opts.quote, tableCell: opts.tableCell, reviewScope: opts.reviewScope,
      justification: opts.justification, publicNote: opts.publicNote,
    },
    revision,
  });
}

export async function revoke(opts: { recruitmentId: string; adminId: string; fieldPath: string; decisionId: string }) {
  return revokeDecision(opts);
}

/** A corrigendum's deletion for the review: each post with its rows and every figure in them, the quotes, the totals. */
function removalNote(r: RemovalReading, table: VacancyTable | null) {
  return {
    removals: r.removals.map((x) => ({
      post: x.post, count: x.count, printedCount: x.printedCount, serial: x.serial, table: x.table, quotes: x.quotes,
      rows: x.rows.map((row) => ({ at: row.at, total: row.total ?? null, page: row.source.page, line: row.source.line,
        prepared: row.source.readBy === "PREPARED", cells: (table?.categories ?? []).filter((c) => typeof row.cells[c.key] === "number").map((c) => ({ label: c.label, value: row.cells[c.key], within: c.kind === "HORIZONTAL" })) })),
    })),
    total: r.total,
    droppedTotals: r.droppedTotals.map((s) => ({ at: s.at, total: s.total, page: s.source.page })),
    refused: r.refused,
  };
}
