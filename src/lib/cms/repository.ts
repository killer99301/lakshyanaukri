// ═══════════════════════════════════════════════════════════
// CMS Repository — Database operations for RecruitmentRecord
// ═══════════════════════════════════════════════════════════
//
// All DB access for the CMS goes through this file.
// Business logic lives in record-ops.ts.
// Callers: API routes only — never called from components.
//
// Pattern mirrors src/lib/intelligence/draft-ops.ts:
//   record-ops.ts   = pure functions
//   repository.ts   = DB I/O
// ═══════════════════════════════════════════════════════════

import { sql } from "@/lib/db";

import type {
  RecruitmentRecord,
  FieldRevision,
  DraftState,
} from "@/types/recruitment-record";

import type { Provenance } from "@/types";

import {
  buildFieldRevision,
  approveRecord,
  markPublished,
  computeRecordRevision,
  type FieldUpdateResult,
  type StateTransitionResult,
} from "@/lib/cms/record-ops";

import { validateRecord } from "@/lib/cms/validation";

// ─── Row shape from DB ────────────────────────────────────

interface RecruitmentRow {
  id: string;
  slug: string;
  draft_state: string;
  record_revision: string;
  published_at: string | null;
  last_published_revision: string | null;
  identity: unknown;
  dates: unknown;
  vacancies: unknown;
  eligibility: unknown;
  age: unknown;
  financial: unknown;
  selection: unknown;
  how_to_apply: unknown;
  links: unknown;
  documents: unknown;
  lifecycle: unknown;
  conditions: unknown;
  classification: unknown;
  provenance: unknown;
  updates: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

function rowToRecord(row: RecruitmentRow): RecruitmentRecord {
  return {
    id:                     row.id,
    slug:                   row.slug,
    draftState:             row.draft_state as DraftState,
    recordRevision:         row.record_revision,
    publishedAt:            row.published_at ?? undefined,
    lastPublishedRevision:  row.last_published_revision ?? undefined,
    identity:               row.identity as RecruitmentRecord["identity"],
    dates:                  row.dates as RecruitmentRecord["dates"],
    vacancies:              row.vacancies as RecruitmentRecord["vacancies"],
    eligibility:            row.eligibility as RecruitmentRecord["eligibility"],
    age:                    row.age as RecruitmentRecord["age"],
    financial:              row.financial as RecruitmentRecord["financial"],
    selection:              row.selection as RecruitmentRecord["selection"],
    howToApply:             row.how_to_apply as string[] | undefined,
    links:                  (row.links as RecruitmentRecord["links"]) ?? [],
    documents:              (row.documents as RecruitmentRecord["documents"]) ?? [],
    lifecycle:              row.lifecycle as RecruitmentRecord["lifecycle"],
    conditions:             row.conditions as RecruitmentRecord["conditions"],
    classification:         row.classification as RecruitmentRecord["classification"],
    provenance:             row.provenance as Provenance,
    updates:                (row.updates as RecruitmentRecord["updates"]) ?? [],
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
    createdBy:              row.created_by ?? undefined,
    updatedBy:              row.updated_by ?? undefined,
  };
}

// ─── Read operations ──────────────────────────────────────

export async function getRecruitmentById(id: string): Promise<RecruitmentRecord | null> {
  const rows = await sql`
    SELECT * FROM recruitments WHERE id = ${id} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToRecord(rows[0] as RecruitmentRow);
}

export async function getRecruitmentBySlug(slug: string): Promise<RecruitmentRecord | null> {
  const rows = await sql`
    SELECT * FROM recruitments WHERE slug = ${slug} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToRecord(rows[0] as RecruitmentRow);
}

export async function getFieldRevisions(
  recruitmentId: string,
  fieldPath?: string,
): Promise<FieldRevision[]> {
  const rows = fieldPath
    ? await sql`
        SELECT * FROM field_revisions
        WHERE recruitment_id = ${recruitmentId}
          AND field_path = ${fieldPath}
        ORDER BY revised_at ASC
      `
    : await sql`
        SELECT * FROM field_revisions
        WHERE recruitment_id = ${recruitmentId}
        ORDER BY revised_at ASC
      `;

  return rows.map((r) => ({
    id:            r.id as string,
    recruitmentId: r.recruitment_id as string,
    fieldPath:     r.field_path as string,
    revisedBy:     r.revised_by as string,
    revisedAt:     r.revised_at as string,
    oldValue:      r.old_value,
    newValue:      r.new_value,
    reason:        (r.reason as string) ?? undefined,
  }));
}

// ─── OCC conflict error ───────────────────────────────────

export class OccConflictError extends Error {
  readonly serverRevision: string;
  constructor(serverRevision: string) {
    super(`Record modified concurrently — server revision: ${serverRevision}`);
    this.name = "OccConflictError";
    this.serverRevision = serverRevision;
  }
}

// ─── Write operations ─────────────────────────────────────
//
// Every write that modifies a field MUST go through these functions.
// There is no direct UPDATE path that bypasses FieldRevision creation.

export interface CreateRecruitmentParams {
  slug: string;
  identity: RecruitmentRecord["identity"];
  dates?: RecruitmentRecord["dates"];
  vacancies?: RecruitmentRecord["vacancies"];
  financial?: RecruitmentRecord["financial"];
  classification?: RecruitmentRecord["classification"];
  provenance: RecruitmentRecord["provenance"];
  adminId: string;
}

export async function createRecruitment(
  params: CreateRecruitmentParams,
): Promise<RecruitmentRecord> {
  const { slug, identity, provenance, adminId } = params;

  const dates = params.dates ?? {};
  const vacancies = params.vacancies ?? {};
  const financial = params.financial ?? {};

  const lifecycle: RecruitmentRecord["lifecycle"] = {
    status: "DRAFT",
    conflicts: [],
    events: [],
  };

  const now = new Date().toISOString();

  const rows = await sql`
    INSERT INTO recruitments (
      slug,
      identity, dates, vacancies, financial,
      lifecycle, provenance, links, documents, updates,
      classification,
      organization_id, organization_name, title_text, gov_type,
      created_by, updated_by
    )
    VALUES (
      ${slug},
      ${JSON.stringify(identity)},
      ${JSON.stringify(dates)},
      ${JSON.stringify(vacancies)},
      ${JSON.stringify(financial)},
      ${JSON.stringify(lifecycle)},
      ${JSON.stringify(provenance)},
      ${JSON.stringify([])},
      ${JSON.stringify([])},
      ${JSON.stringify([])},
      ${params.classification !== undefined ? JSON.stringify(params.classification) : null},
      ${identity.organizationId},
      ${identity.organizationName ?? null},
      ${identity.title.value ?? null},
      ${identity.govType ?? null},
      ${adminId},
      ${adminId}
    )
    RETURNING *
  `;

  return rowToRecord(rows[0] as RecruitmentRow);
  void now;
}

/**
 * Persist a field update (new record state + FieldRevision) atomically.
 *
 * Enforces strict OCC: clientRevision must match the record's current
 * record_revision in the database. On mismatch, throws OccConflictError
 * with the server's current revision so the caller can return 409.
 *
 * Uses a single data-modifying CTE so the UPDATE and INSERT are atomic
 * with no explicit BEGIN/COMMIT needed.
 */
export async function persistFieldUpdate(
  result: FieldUpdateResult,
  clientRevision: string,
): Promise<{ record: RecruitmentRecord; revision: FieldRevision }> {
  const { record, revision } = result;

  const validation = validateRecord(record);
  if (!validation.valid) {
    throw new Error(
      `Refusing to persist invalid record: ${validation.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const updatedRevision = computeRecordRevision(record);

  // Atomic CTE: UPDATE iff record_revision matches, then INSERT the revision row.
  // If UPDATE matches 0 rows (OCC conflict), the INSERT inserts nothing and
  // RETURNING returns 0 rows — detected below.
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        identity          = ${JSON.stringify(record.identity)},
        dates             = ${JSON.stringify(record.dates)},
        vacancies         = ${JSON.stringify(record.vacancies)},
        eligibility       = ${record.eligibility !== undefined ? JSON.stringify(record.eligibility) : null},
        age               = ${record.age !== undefined ? JSON.stringify(record.age) : null},
        financial         = ${JSON.stringify(record.financial)},
        selection         = ${record.selection !== undefined ? JSON.stringify(record.selection) : null},
        how_to_apply      = ${record.howToApply !== undefined ? JSON.stringify(record.howToApply) : null},
        links             = ${JSON.stringify(record.links)},
        documents         = ${JSON.stringify(record.documents)},
        lifecycle         = ${JSON.stringify(record.lifecycle)},
        conditions        = ${record.conditions !== undefined ? JSON.stringify(record.conditions) : null},
        classification    = ${record.classification !== undefined ? JSON.stringify(record.classification) : null},
        provenance        = ${JSON.stringify(record.provenance)},
        record_revision   = ${updatedRevision},
        organization_name = ${record.identity.organizationName ?? null},
        title_text        = ${record.identity.title.value ?? null},
        gov_type          = ${record.identity.govType ?? null},
        updated_at        = now(),
        updated_by        = ${record.updatedBy ?? null}
      WHERE id = ${record.id}
        AND record_revision = ${clientRevision}
      RETURNING id
    )
    INSERT INTO field_revisions
      (id, recruitment_id, field_path, revised_by, revised_at, old_value, new_value, reason)
    SELECT
      ${revision.id},
      ${revision.recruitmentId},
      ${revision.fieldPath},
      ${revision.revisedBy},
      ${revision.revisedAt},
      ${revision.oldValue !== undefined ? JSON.stringify(revision.oldValue) : null},
      ${revision.newValue !== undefined ? JSON.stringify(revision.newValue) : null},
      ${revision.reason ?? null}
    FROM updated
    RETURNING recruitment_id
  `;

  if (rows.length === 0) {
    const current = await getRecruitmentById(record.id);
    throw new OccConflictError(current?.recordRevision ?? "unknown");
  }

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after update`);

  return { record: saved, revision };
}

/**
 * Transition a record to APPROVED.
 * Validates, transitions state, writes to DB, and records an audit event.
 */
export async function persistApproval(
  record: RecruitmentRecord,
  adminId: string,
): Promise<RecruitmentRecord> {
  const result: StateTransitionResult = approveRecord(record, adminId);

  await sql`BEGIN`;
  try {
    await sql`
      UPDATE recruitments SET
        draft_state = 'APPROVED',
        updated_at  = now(),
        updated_by  = ${adminId}
      WHERE id = ${record.id}
        AND draft_state = 'DRAFT'
    `;

    await sql`
      INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
      VALUES (
        ${record.id},
        ${adminId},
        ${result.auditEvent.eventType},
        ${JSON.stringify(result.auditEvent.metadata)}
      )
    `;

    await sql`COMMIT`;
  } catch (err) {
    await sql`ROLLBACK`;
    throw err;
  }

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after approval`);
  return saved;
}

/**
 * Store a published snapshot and transition record to PUBLISHED.
 * The snapshot (PublishedRecruitment) must be built by the caller via projectToPublished().
 */
export async function persistPublication(
  record: RecruitmentRecord,
  snapshot: unknown,
  projectionVersion: string,
  adminId: string,
): Promise<RecruitmentRecord> {
  const sourceRevision = record.recordRevision;
  const result = markPublished(record, adminId, sourceRevision);

  await sql`BEGIN`;
  try {
    await sql`
      UPDATE recruitments SET
        draft_state             = 'PUBLISHED',
        published_at            = coalesce(published_at, now()),
        last_published_revision = ${sourceRevision},
        updated_at              = now(),
        updated_by              = ${adminId}
      WHERE id = ${record.id}
        AND draft_state = 'APPROVED'
    `;

    await sql`
      INSERT INTO published_recruitments
        (recruitment_id, source_record_revision, projection_version, snapshot, published_by)
      VALUES (
        ${record.id},
        ${sourceRevision},
        ${projectionVersion},
        ${JSON.stringify(snapshot)},
        ${adminId}
      )
    `;

    await sql`
      INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
      VALUES (
        ${record.id},
        ${adminId},
        ${result.auditEvent.eventType},
        ${JSON.stringify(result.auditEvent.metadata)}
      )
    `;

    await sql`COMMIT`;
  } catch (err) {
    await sql`ROLLBACK`;
    throw err;
  }

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after publication`);
  return saved;
}

// Re-export buildFieldRevision so callers can build revisions without
// importing record-ops directly. The repository is the single entry point.
export { buildFieldRevision };
