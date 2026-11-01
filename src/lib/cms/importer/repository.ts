// ═══════════════════════════════════════════════════════════
// Importer: database access
// ═══════════════════════════════════════════════════════════
//
// Server only. Every write that must be all-or-nothing is one statement or
// one sql.transaction([...]) batch (the Neon driver's single transaction);
// the database's triggers and constraints refuse anything inconsistent
// (src/lib/cms/importer/schema.sql).

import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { Proposal } from "@/lib/cms/importer/proposal";
import type { ClaimView, FieldState } from "@/lib/cms/importer/classify";
import { CRITICAL_FIELDS, decisionRevisionPath, decisionRevisionPaths, revisionPath } from "@/lib/cms/importer/fields";
import type { OriginRole } from "@/lib/cms/importer/trusted-domains";
import { computeRecordRevision } from "@/lib/cms/record-ops";
import { validateRecord } from "@/lib/cms/validation";

const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

// ─── Preview ──────────────────────────────────────────────

export interface NewRetrieval {
  id: string;
  declaredKind: string;
  versionLabel?: string | null;
  documentDate?: string | null;
  method: "FETCHED" | "UPLOADED" | "PASTED";
  originUrl: string | null;
  originHost: string | null;
  originRole: OriginRole;
  originPurposes: string[];
  authenticity: "CONFIRMED" | "ATTESTED" | "UNCONFIRMED" | "NOT_APPLICABLE";
  authenticityMethod: "FETCHED_BY_SERVER" | "HASH_MATCHES_SERVER_FETCH" | "ADMIN_ATTESTED" | null;
  matchedRetrievalId: string | null;
  attestationNote: string | null;
  source: { sha256: string; kind: "PDF" | "HTML" | "TEXT" | "IMAGE"; byteSize: number; pageCount: number | null; text: string };
}

/** An earlier server fetch of the same document from the same host, if any (for a hash match). */
export async function findServerFetch(sha256: string, host: string): Promise<string | null> {
  const rows = await sql`
    SELECT r.id FROM recruitment_source_retrievals r JOIN recruitment_sources s ON s.id = r.source_id
    WHERE s.content_sha256 = ${sha256} AND r.method = 'FETCHED' AND r.authenticity_method = 'FETCHED_BY_SERVER'
      AND r.origin_host = ${host}
    ORDER BY r.retrieved_at LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

/**
 * Stores the import, its documents (once each, by hash) and every retrieval,
 * in one transaction. Retrievals are written in the given order, so a server
 * fetch is stored before an upload that matches it.
 */
export async function storePreview(input: {
  importId: string;
  mode: "NEW" | "EXISTING";
  recruitmentId: string | null;
  baseRevision: string | null;
  identityKey: string | null;
  orgYearKey: string | null;
  proposal: Proposal & Record<string, unknown>;
  adminId: string;
  retrievals: NewRetrieval[];
}): Promise<void> {
  const queries = [
    sql`INSERT INTO recruitment_imports (import_id, mode, recruitment_id, base_revision, identity_key, org_year_key, proposal, created_by)
        VALUES (${input.importId}, ${input.mode}, ${input.recruitmentId}, ${input.baseRevision}, ${input.identityKey}, ${input.orgYearKey},
                ${JSON.stringify(input.proposal)}::jsonb, ${input.adminId})`,
  ];
  for (const r of input.retrievals) {
    queries.push(sql`
      INSERT INTO recruitment_sources (content_sha256, content_kind, byte_size, page_count, text)
      VALUES (${r.source.sha256}, ${r.source.kind}, ${r.source.byteSize}, ${r.source.pageCount}, ${r.source.text})
      ON CONFLICT (content_sha256) DO NOTHING`);
    queries.push(sql`
      INSERT INTO recruitment_source_retrievals
        (id, import_id, source_id, declared_kind, version_label, document_date, method, origin_url, origin_host,
         origin_role, origin_purposes, authenticity, authenticity_method, matched_retrieval_id,
         attested_by, attested_at, attestation_note, retrieved_by)
      SELECT ${r.id}, ${input.importId}, s.id, ${r.declaredKind}, ${r.versionLabel ?? null}, ${r.documentDate ?? null}::date,
             ${r.method}, ${r.originUrl}, ${r.originHost}, ${r.originRole}, ${r.originPurposes}::text[], ${r.authenticity},
             ${r.authenticityMethod}, ${r.matchedRetrievalId},
             ${r.authenticity === "ATTESTED" ? input.adminId : null}, ${r.authenticity === "ATTESTED" ? new Date().toISOString() : null}::timestamptz,
             ${r.attestationNote}, ${input.adminId}
      FROM recruitment_sources s WHERE s.content_sha256 = ${r.source.sha256}`);
  }
  await sql.transaction(queries);
}

export interface StoredImport {
  importId: string;
  mode: "NEW" | "EXISTING";
  recruitmentId: string | null;
  baseRevision: string | null;
  status: string;
  proposal: Proposal & { meta?: Record<string, unknown> };
  result: Record<string, unknown> | null;
  createdAt: string;
}

export async function getImport(importId: string): Promise<StoredImport | null> {
  const rows = await sql`SELECT * FROM recruitment_imports WHERE import_id = ${importId}`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    importId: String(r.import_id), mode: r.mode as "NEW" | "EXISTING", recruitmentId: (r.recruitment_id as string) ?? null,
    baseRevision: (r.base_revision as string) ?? null, status: String(r.status), proposal: parse(r.proposal),
    result: r.result ? parse(r.result) : null, createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export async function discardImport(importId: string): Promise<boolean> {
  const rows = await sql`UPDATE recruitment_imports SET status = 'DISCARDED' WHERE import_id = ${importId} AND status = 'PREVIEWED' RETURNING import_id`;
  return rows.length > 0;
}

// ─── Apply ────────────────────────────────────────────────

/** Column values for cms_apply_import, from a validated record. */
export function recordColumns(record: RecruitmentRecord, slug?: string): Record<string, unknown> {
  const validation = validateRecord(record);
  if (!validation.valid) throw new Error(`Refusing to apply an invalid record: ${validation.errors.map((e) => e.message).join("; ")}`);
  return {
    ...(slug ? { slug } : {}),
    identity: record.identity, dates: record.dates, vacancies: record.vacancies,
    eligibility: record.eligibility ?? null, age: record.age ?? null, financial: record.financial,
    selection: record.selection ?? null, exam_pattern: record.examPattern ?? null, syllabus: record.syllabus ?? null,
    how_to_apply: record.howToApply ?? null, links: record.links, exam_stages: record.examStages ?? null,
    classification: record.classification ?? null, conditions: record.conditions ?? null, lifecycle: record.lifecycle, provenance: record.provenance,
    documents: record.documents, updates: record.updates ?? [],
    record_revision: computeRecordRevision(record),
    organization_name: record.identity.organizationName ?? null, title_text: record.identity.title.value ?? null,
    gov_type: record.identity.govType ?? null,
  };
}

export class ImportApplyError extends Error {
  constructor(readonly code: string, message: string, readonly detail?: unknown) {
    super(message);
    this.name = "ImportApplyError";
  }
}

const APPLY_MESSAGES: Record<string, string> = {
  STALE: "The job was changed after this preview was made. Make a new preview.",
  DUPLICATE: "A job for this notification, or for this organisation and year, already exists.",
  IMPORT_NOT_PREVIEWED: "This import was already discarded or has expired.",
  UNKNOWN_ITEM: "A ticked item is not part of this preview.",
  ITEM_VALUE_MISMATCH: "A value to be saved does not match the preview. Nothing was saved.",
  NOTHING_SELECTED: "Tick at least one item to apply.",
};

export async function applyImport(input: {
  importId: string;
  adminId: string;
  selected: string[];
  override: { reason: string } | null;
  payload: { record: Record<string, unknown>; revisions: unknown[]; claims: unknown[]; supersessions: unknown[] };
}): Promise<{ recruitmentId: string; replayed: boolean }> {
  try {
    const rows = await sql`
      SELECT public.cms_apply_import(${input.importId}::uuid, ${input.adminId}::uuid, ${input.selected}::text[],
                                     ${input.override ? JSON.stringify(input.override) : null}::jsonb,
                                     ${JSON.stringify(input.payload)}::jsonb) AS result`;
    const result = parse<{ recruitmentId: string; replayed?: boolean }>(rows[0].result);
    return { recruitmentId: result.recruitmentId, replayed: result.replayed === true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = Object.keys(APPLY_MESSAGES).find((k) => message.includes(k)) ?? "FAILED";
    const detail = (e as { detail?: string }).detail;
    throw new ImportApplyError(code, APPLY_MESSAGES[code] ?? "The import could not be applied. Nothing was saved.", detail ? (() => { try { return JSON.parse(detail); } catch { return detail; } })() : undefined);
  }
}

// ─── Field states for the gate and the "Check before publishing" list ─────

export async function firstImportAt(recruitmentId: string): Promise<string | null> {
  const rows = await sql`SELECT min(applied_at) AS at FROM recruitment_imports WHERE recruitment_id = ${recruitmentId} AND status = 'APPLIED'`;
  return rows[0]?.at ? new Date(rows[0].at as string).toISOString() : null;
}

export async function claimsFor(recruitmentId: string): Promise<Array<ClaimView & { fieldPath: string }>> {
  const rows = await sql`
    SELECT c.id, c.seq, c.kind, c.field_path, c.value, c.field_revision_id, c.revokes_claim_id, c.public_note, c.quote, c.page,
           EXISTS (SELECT 1 FROM recruitment_claim_supersessions x WHERE x.superseded_claim_id = c.id) AS superseded,
           r.authenticity, r.origin_role, r.origin_purposes, r.declared_kind
    FROM recruitment_field_claims c
    LEFT JOIN recruitment_source_retrievals r ON r.id = c.retrieval_id
    WHERE c.recruitment_id = ${recruitmentId}
    ORDER BY c.seq`;
  return rows.map((r) => ({
    // jsonb arrives already decoded; a value that is itself a string must not be parsed again.
    id: String(r.id), seq: Number(r.seq), kind: r.kind as ClaimView["kind"], fieldPath: String(r.field_path),
    value: r.value ?? null, fieldRevisionId: (r.field_revision_id as string) ?? null,
    revokesClaimId: (r.revokes_claim_id as string) ?? null, publicNote: (r.public_note as string) ?? null,
    quote: (r.quote as string) ?? null, page: r.page == null ? null : Number(r.page), superseded: r.superseded === true,
    retrieval: r.authenticity ? {
      authenticity: String(r.authenticity), originRole: r.origin_role as OriginRole,
      originPurposes: (r.origin_purposes as string[]) ?? [], declaredKind: String(r.declared_kind),
    } : null,
  }));
}

/** The latest revision of each field (by path), newest first. */
export async function latestRevisions(recruitmentId: string): Promise<Map<string, { id: string; at: string }>> {
  const rows = await sql`
    SELECT DISTINCT ON (field_path) field_path, id, revised_at
    FROM field_revisions WHERE recruitment_id = ${recruitmentId}
    ORDER BY field_path, revised_at DESC, id DESC`;
  return new Map(rows.map((r) => [String(r.field_path), { id: String(r.id), at: new Date(r.revised_at as string).toISOString() }]));
}

/** The value a critical field holds on the record, in the same shape claims use. */
export function fieldValue(record: RecruitmentRecord, fieldPath: string): unknown {
  if (fieldPath.startsWith("links#")) {
    const type = fieldPath.slice(6);
    const link = record.links.find((l) => l.type === type);
    return link ? { type: link.type, label: link.label, url: link.url, official: link.official } : null;
  }
  const at = (obj: unknown, key: string) => (obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined);
  const unwrap = (f: unknown) => (f && typeof f === "object" && "status" in (f as object) ? (f as { value: unknown }).value : f);
  const [ns, key] = fieldPath.split(".");
  if (key) return unwrap(at(at(record, ns), key));
  if (fieldPath === "examStages") return record.examStages ?? null;
  if (fieldPath === "howToApply") return record.howToApply ?? null;
  if (fieldPath === "conditions") return record.conditions?.items ?? null;
  return unwrap(at(record, fieldPath));
}

export async function fieldStates(record: RecruitmentRecord, paths: string[] = CRITICAL_FIELDS): Promise<FieldState[]> {
  const [claims, revisions] = await Promise.all([claimsFor(record.id), latestRevisions(record.id)]);
  return paths.map((fieldPath) => {
    const value = fieldValue(record, fieldPath);
    // The newest of the paths that can unsettle a decision on this field.
    const rev = decisionRevisionPaths(fieldPath).map((p) => revisions.get(p)).filter(Boolean)
      .sort((a, b) => (a!.at < b!.at ? 1 : a!.at > b!.at ? -1 : 0))[0];
    return {
      fieldPath,
      value,
      hasValue: !(value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)),
      latestRevisionId: rev?.id ?? null,
      latestRevisionAt: rev?.at ?? null,
      claims: claims.filter((c) => c.fieldPath === fieldPath),
    };
  });
}

// ─── Decisions: verify, not applicable, not stated, revoke ─────────────

export class DecisionConflictError extends Error {
  constructor(message = "The field changed while you were checking it. Look at it again.") {
    super(message);
    this.name = "DecisionConflictError";
  }
}

const fieldLock = (recruitmentId: string, fieldPath: string) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`field:${recruitmentId}:${revisionPath(fieldPath)}`}, 0))`;

/**
 * Records an admin decision on a field, with its own field revision, in one
 * transaction (design §5.1, §5.3). `seen` is what the admin's screen showed:
 * the field's latest revision id and the decision then in force. If either has
 * changed, nothing is written.
 *
 * VERIFIED keeps the value and writes a baseline revision. NOT_APPLICABLE and
 * NOT_STATED save the field as not specified (`newRecord`, built by the caller
 * through routeFieldUpdate) and reference that new revision.
 */
export async function recordDecision(input: {
  record: RecruitmentRecord;
  newRecord: RecruitmentRecord | null;
  fieldPath: string;
  kind: "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED";
  adminId: string;
  seen: { revisionId: string | null; decisionId: string | null };
  claim: { value: unknown; valueHash: string | null; retrievalId: string; page: number | null; quote: string | null;
           tableCell: unknown; reviewScope: unknown; justification: string | null; publicNote: string | null };
  revision: { oldValue: unknown; newValue: unknown; reason: string };
}): Promise<{ claimId: string; revisionId: string }> {
  const { record, fieldPath, adminId, seen } = input;
  const path = decisionRevisionPath(fieldPath);
  const watched = decisionRevisionPaths(fieldPath);
  const revisionId = randomUUID();
  const claimId = randomUUID();
  const cols = input.newRecord ? recordColumns(input.newRecord) : null;
  const unchanged = cols === null;
  const latestCond = sql`(SELECT id FROM field_revisions WHERE recruitment_id = ${record.id} AND field_path = ANY(${watched}::text[])
                           ORDER BY revised_at DESC, id DESC LIMIT 1) IS NOT DISTINCT FROM ${seen.revisionId}::uuid`;
  const decisionCond = sql`(SELECT c.id FROM recruitment_field_claims c
                             WHERE c.recruitment_id = ${record.id} AND c.field_path = ${fieldPath}
                               AND c.kind IN ('ADMIN_VERIFIED', 'ADMIN_NOT_APPLICABLE', 'ADMIN_NOT_STATED')
                               AND c.field_revision_id IS NOT DISTINCT FROM ${seen.revisionId}::uuid
                               AND NOT EXISTS (SELECT 1 FROM recruitment_field_claims v WHERE v.revokes_claim_id = c.id)
                             ORDER BY c.seq DESC LIMIT 1) IS NOT DISTINCT FROM ${seen.decisionId}::uuid`;
  const c = input.claim;
  const write = unchanged
    ? sql`
      WITH ok AS (
        SELECT id FROM recruitments WHERE id = ${record.id} AND record_revision = ${record.recordRevision} AND ${latestCond} AND ${decisionCond}
      ), rev AS (
        INSERT INTO field_revisions (id, recruitment_id, field_path, revised_by, old_value, new_value, reason)
        SELECT ${revisionId}, id, ${path}, ${adminId}, ${JSON.stringify(input.revision.oldValue ?? null)}::jsonb,
               ${JSON.stringify(input.revision.newValue ?? null)}::jsonb, ${input.revision.reason} FROM ok RETURNING id
      )
      INSERT INTO recruitment_field_claims (id, recruitment_id, field_path, kind, value, value_hash, retrieval_id, page, quote,
                                            table_cell, review_scope, field_revision_id, justification, public_note, claimed_by)
      SELECT ${claimId}, ${record.id}, ${fieldPath}, ${input.kind}, ${JSON.stringify(c.value ?? null)}::jsonb, ${c.valueHash},
             ${c.retrievalId}, ${c.page}, ${c.quote}, ${c.tableCell === null ? null : JSON.stringify(c.tableCell)}::jsonb,
             ${c.reviewScope === null ? null : JSON.stringify(c.reviewScope)}::jsonb, rev.id, ${c.justification}, ${c.publicNote}, ${adminId}
      FROM rev RETURNING id`
    : sql`
      WITH upd AS (
        UPDATE recruitments SET
          identity = ${JSON.stringify(cols!.identity)}::jsonb, dates = ${JSON.stringify(cols!.dates)}::jsonb,
          vacancies = ${JSON.stringify(cols!.vacancies)}::jsonb, eligibility = ${JSON.stringify(cols!.eligibility)}::jsonb,
          age = ${JSON.stringify(cols!.age)}::jsonb, financial = ${JSON.stringify(cols!.financial)}::jsonb,
          selection = ${JSON.stringify(cols!.selection)}::jsonb, links = ${JSON.stringify(cols!.links)}::jsonb,
          record_revision = ${String(cols!.record_revision)}, updated_at = now(), updated_by = ${adminId}
        WHERE id = ${record.id} AND record_revision = ${record.recordRevision} AND ${latestCond} AND ${decisionCond}
        RETURNING id
      ), rev AS (
        INSERT INTO field_revisions (id, recruitment_id, field_path, revised_by, old_value, new_value, reason)
        SELECT ${revisionId}, id, ${path}, ${adminId}, ${JSON.stringify(input.revision.oldValue ?? null)}::jsonb,
               ${JSON.stringify(input.revision.newValue ?? null)}::jsonb, ${input.revision.reason} FROM upd RETURNING id
      )
      INSERT INTO recruitment_field_claims (id, recruitment_id, field_path, kind, value, value_hash, retrieval_id, page, quote,
                                            table_cell, review_scope, field_revision_id, justification, public_note, claimed_by)
      SELECT ${claimId}, ${record.id}, ${fieldPath}, ${input.kind}, ${JSON.stringify(c.value ?? null)}::jsonb, ${c.valueHash},
             ${c.retrievalId}, ${c.page}, ${c.quote}, ${c.tableCell === null ? null : JSON.stringify(c.tableCell)}::jsonb,
             ${c.reviewScope === null ? null : JSON.stringify(c.reviewScope)}::jsonb, rev.id, ${c.justification}, ${c.publicNote}, ${adminId}
      FROM rev RETURNING id`;
  const [, inserted] = await sql.transaction([fieldLock(record.id, fieldPath), write]);
  if ((inserted as unknown[]).length === 0) throw new DecisionConflictError();
  return { claimId, revisionId };
}

export async function revokeDecision(input: { recruitmentId: string; fieldPath: string; decisionId: string; adminId: string }): Promise<string> {
  const id = randomUUID();
  try {
    const [, rows] = await sql.transaction([
      fieldLock(input.recruitmentId, input.fieldPath),
      sql`INSERT INTO recruitment_field_claims (id, recruitment_id, field_path, kind, revokes_claim_id, claimed_by)
          VALUES (${id}, ${input.recruitmentId}, ${input.fieldPath}, 'ADMIN_REVOKED', ${input.decisionId}, ${input.adminId}) RETURNING id`,
    ]);
    if ((rows as unknown[]).length === 0) throw new DecisionConflictError();
    return id;
  } catch (e) {
    if (e instanceof Error && /uq_field_claims_revoked_once|duplicate key/.test(e.message)) throw new DecisionConflictError("That decision was already withdrawn.");
    throw e;
  }
}

/** Retrievals offered for a decision on this job: documents brought in by its imports. */
export async function retrievalsFor(recruitmentId: string) {
  const rows = await sql`
    SELECT r.id, r.declared_kind, r.version_label, r.document_date, r.method, r.origin_url, r.origin_host, r.origin_role,
           r.origin_purposes, r.authenticity, r.retrieved_at, s.content_kind, s.page_count, s.content_sha256
    FROM recruitment_source_retrievals r
    JOIN recruitment_imports i ON i.import_id = r.import_id
    JOIN recruitment_sources s ON s.id = r.source_id
    WHERE i.recruitment_id = ${recruitmentId}
    ORDER BY r.retrieved_at DESC`;
  return rows.map((r) => ({
    id: String(r.id), declaredKind: String(r.declared_kind), versionLabel: (r.version_label as string) ?? null,
    documentDate: r.document_date ? String(r.document_date).slice(0, 10) : null, method: String(r.method),
    originUrl: (r.origin_url as string) ?? null, originHost: (r.origin_host as string) ?? null,
    originRole: r.origin_role as OriginRole, originPurposes: (r.origin_purposes as string[]) ?? [],
    authenticity: String(r.authenticity), retrievedAt: new Date(r.retrieved_at as string).toISOString(),
    contentKind: String(r.content_kind), pageCount: r.page_count === null ? null : Number(r.page_count),
    sha256: String(r.content_sha256),
  }));
}

export async function isImportedJob(recruitmentId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM recruitment_imports WHERE recruitment_id = ${recruitmentId} AND status = 'APPLIED' LIMIT 1`;
  return rows.length > 0;
}
