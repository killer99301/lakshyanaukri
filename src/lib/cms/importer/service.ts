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
import { MIN_SCAN_TEXT_CHARS } from "@/lib/cms/scan-reader";
import { fetchSource } from "@/lib/cms/importer/fetch-source";
import { readSource, htmlToText, type SourceReading } from "@/lib/cms/importer/extract";
import { sourceOwnLink } from "@/lib/cms/importer/links";
import { buildProposal, comparable, type DeclaredKind, type RetrievalSummary } from "@/lib/cms/importer/proposal";
import { classifyField, effectiveDecision, publishGate, type FieldVerdict } from "@/lib/cms/importer/classify";
import { contentHash, valueHash } from "@/lib/cms/importer/evidence-text";
import { CRITICAL_FIELDS, FIELD_DEFS, fieldDef, revisionPath } from "@/lib/cms/importer/fields";
import { authorityCovers, hostOf, originFor } from "@/lib/cms/importer/trusted-domains";
import { buildApplyPayload, blankRecord } from "@/lib/cms/importer/apply-build";
import {
  applyImport, claimsFor, discardImport, fieldStates, fieldValue, findServerFetch, firstImportAt, getImport,
  isImportedJob, recordDecision, retrievalsFor, revokeDecision, storePreview, type NewRetrieval,
} from "@/lib/cms/importer/repository";

export const MAX_SOURCES = 4;
export const MAX_TEXT_CHARS = 200_000;

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
}

const KIND_LABEL: Record<string, string> = {
  OFFICIAL_NOTIFICATION: "notification", OFFICIAL_CORRIGENDUM: "corrigendum", OFFICIAL_PAGE: "official page", RESEARCH: "research", OTHER: "other",
};

function summaryLabel(r: NewRetrieval): string {
  const where = r.originHost ?? (r.method === "PASTED" ? "pasted text" : "upload");
  const how = r.authenticity === "CONFIRMED" ? (r.authenticityMethod === "FETCHED_BY_SERVER" ? "fetched by the server" : "same file as the server's fetch")
    : r.authenticity === "ATTESTED" ? "attested by admin" : r.authenticity === "UNCONFIRMED" ? "not confirmed" : "research";
  return `${where} — ${KIND_LABEL[r.declaredKind] ?? r.declaredKind}${r.versionLabel ? ` (${r.versionLabel})` : ""}, ${how}`;
}

async function obtain(input: SourceInput, fetchSourceFn: typeof fetchSource): Promise<{ method: NewRetrieval["method"]; finalUrl: string | null; kind: "PDF" | "HTML" | "TEXT"; bytes: Buffer; text: string; pages: number | null }> {
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
  if (input.method === "upload") {
    if (!input.bytes || input.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ImportInputError("The uploaded file is not a PDF");
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

async function readOne(input: SourceInput, organizationId: string, subject: string, apiKey: string | undefined, fetchFn: typeof fetch | undefined, fetchSourceFn: typeof fetchSource): Promise<Omit<ReadSource, "retrieval" | "summary"> & { obtained: Awaited<ReturnType<typeof obtain>> }> {
  const obtained = await obtain(input, fetchSourceFn);
  const reading = await readSource({
    content: obtained.text, kind: obtained.kind === "PDF" ? "pdf" : "html", url: obtained.finalUrl ?? input.url ?? "",
    subject, organizationId, apiKey, fetchFn,
  });
  const own = sourceOwnLink(obtained.finalUrl ?? input.url, input.declaredKind, organizationId);
  if (own) reading.links = [own, ...reading.links.filter((l) => l.url !== own.url)];
  return { input, reading, obtained };
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
}) {
  if (opts.sources.length === 0) throw new ImportInputError("Add at least one source");
  if (opts.sources.length > MAX_SOURCES) throw new ImportInputError(`At most ${MAX_SOURCES} sources in one import`);

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

  // Read every source together (the AI requests of each run in parallel too).
  const read = await Promise.all(opts.sources.map((s) => readOne(s, organizationId, subject, opts.apiKey, opts.fetchFn, opts.fetchSourceFn ?? fetchSource)));

  // Retrievals: fetches first, so an upload of the same file can point at one.
  const order = [...read].sort((a, b) => (a.obtained.method === "FETCHED" ? 0 : 1) - (b.obtained.method === "FETCHED" ? 0 : 1));
  const sources: ReadSource[] = [];
  for (const r of order) {
    const { input, obtained } = r;
    const research = input.declaredKind === "RESEARCH";
    const originUrl = obtained.finalUrl ?? input.url ?? null;
    const host = hostOf(originUrl);
    const origin = originFor(organizationId, host);
    const sha = contentHash(obtained.bytes);
    let authenticity: NewRetrieval["authenticity"] = "UNCONFIRMED";
    let method: NewRetrieval["authenticityMethod"] = null;
    let matched: string | null = null;
    let note: string | null = null;
    if (research) authenticity = "NOT_APPLICABLE";
    else if (obtained.method === "FETCHED") { authenticity = "CONFIRMED"; method = "FETCHED_BY_SERVER"; }
    else if (obtained.method === "UPLOADED" && host) {
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
      source: { sha256: sha, kind: obtained.kind, byteSize: obtained.bytes.byteLength, pageCount: obtained.pages,
                text: (obtained.kind === "HTML" ? htmlToText(obtained.text) : obtained.text).slice(0, 1_000_000) },
    };
    sources.push({
      input, retrieval, reading: r.reading,
      summary: { id: retrieval.id, declaredKind: input.declaredKind, authenticity, originRole: retrieval.originRole,
                 originPurposes: retrieval.originPurposes, label: summaryLabel(retrieval), versionLabel: input.versionLabel, documentDate: input.documentDate },
    });
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
    current: (fieldPath) => record ? { value: fieldValue(record, fieldPath), verified: verifiedPaths.has(fieldPath) } : undefined,
    existingClaims: existing,
    currentLinks: record?.links ?? [],
  });

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
        notFound: s.reading.notFound, refused: s.reading.refused, summary: s.reading.summary })),
      duplicates,
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
  return { imported, ok: gate.ok, rows, blockers: gate.blockers.map((b) => b.fieldPath), retrievals };
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
