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

import type { UpdateRecord } from "@/types";

import type { Provenance } from "@/types";

import {
  buildFieldRevision,
  approveRecord,
  markPublished,
  revertRecord,
  computeRecordRevision,
  type FieldUpdateResult,
  type StateTransitionResult,
} from "@/lib/cms/record-ops";

import { validateRecord } from "@/lib/cms/validation";
import { isValidSlug } from "@/lib/cms/slug";

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
  exam_stages: unknown;
  exam_pattern?: unknown;
  syllabus?: unknown;
  taken_down?: unknown;
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
    takenDown:              (row.taken_down as RecruitmentRecord["takenDown"]) ?? undefined,
    identity:               row.identity as RecruitmentRecord["identity"],
    dates:                  row.dates as RecruitmentRecord["dates"],
    vacancies:              row.vacancies as RecruitmentRecord["vacancies"],
    eligibility:            row.eligibility as RecruitmentRecord["eligibility"],
    age:                    row.age as RecruitmentRecord["age"],
    financial:              row.financial as RecruitmentRecord["financial"],
    selection:              row.selection as RecruitmentRecord["selection"],
    examPattern:            (row.exam_pattern as RecruitmentRecord["examPattern"]) ?? undefined,
    syllabus:               (row.syllabus as RecruitmentRecord["syllabus"]) ?? undefined,
    howToApply:             row.how_to_apply as string[] | undefined,
    links:                  (row.links as RecruitmentRecord["links"]) ?? [],
    documents:              (row.documents as RecruitmentRecord["documents"]) ?? [],
    lifecycle:              row.lifecycle as RecruitmentRecord["lifecycle"],
    examStages:             (row.exam_stages as RecruitmentRecord["examStages"]) ?? [],
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

/** Every record the public can see: published at least once, not archived, not taken off the site. */
export async function listLiveRecruitments(): Promise<RecruitmentRecord[]> {
  const rows = await sql`
    SELECT * FROM recruitments
    WHERE published_at IS NOT NULL AND draft_state <> 'ARCHIVED' AND taken_down IS NULL
    ORDER BY updated_at DESC
    LIMIT 500
  `;
  return (rows as RecruitmentRow[]).map(rowToRecord);
}

export async function getRecruitmentBySlug(slug: string): Promise<RecruitmentRecord | null> {
  const rows = await sql`
    SELECT * FROM recruitments WHERE slug = ${slug} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rowToRecord(rows[0] as RecruitmentRow);
}

/**
 * Change the address of a record that has never been public.
 *
 * The slug is a job's permanent URL, so this refuses anything that has been
 * published even once. The whole check is one statement: the row is updated
 * only if it is still a draft, was never published, and no other record
 * already has the new address. Resolves to false when nothing was changed.
 */
export async function renameUnpublishedSlug(id: string, newSlug: string): Promise<boolean> {
  if (!isValidSlug(newSlug)) return false;
  const rows = await sql`
    UPDATE recruitments r
    SET slug = ${newSlug}, updated_at = now()
    WHERE r.id = ${id}
      AND r.draft_state IN ('DRAFT', 'APPROVED')
      AND r.published_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM published_recruitments p WHERE p.recruitment_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM recruitments o WHERE o.slug = ${newSlug} AND o.id <> r.id)
    RETURNING r.id
  `;
  return rows.length === 1;
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

/** Thrown when a state transition finds the record no longer in the expected state. */
export class StateConflictError extends Error {
  constructor(expected: DraftState) {
    super(`Record is no longer in ${expected} state`);
    this.name = "StateConflictError";
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
  examStages?: RecruitmentRecord["examStages"];
  eligibility?: RecruitmentRecord["eligibility"];
  age?: RecruitmentRecord["age"];
  selection?: RecruitmentRecord["selection"];
  howToApply?: string[];
  links?: RecruitmentRecord["links"];
  documents?: RecruitmentRecord["documents"];
  updates?: RecruitmentRecord["updates"];
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
      eligibility, age, selection,
      exam_stages, how_to_apply,
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
      ${params.eligibility !== undefined ? JSON.stringify(params.eligibility) : null},
      ${params.age !== undefined ? JSON.stringify(params.age) : null},
      ${params.selection !== undefined ? JSON.stringify(params.selection) : null},
      ${params.examStages !== undefined ? JSON.stringify(params.examStages) : null},
      ${params.howToApply !== undefined ? JSON.stringify(params.howToApply) : null},
      ${JSON.stringify(lifecycle)},
      ${JSON.stringify(provenance)},
      ${JSON.stringify(params.links ?? [])},
      ${JSON.stringify(params.documents ?? [])},
      ${JSON.stringify(params.updates ?? [])},
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

/** A job found by the duplicate check: same organisation and year (or notification number). */
export interface JobDuplicate {
  id: string;
  slug: string;
  draftState: string;
  title: string;
  reason: "notification_number" | "org_year";
}

/**
 * The manual "New job" path: lock the organisation + year, check for
 * duplicates and insert, all in one database call (cms_create_job_checked),
 * so two people creating the same job at the same moment cannot both pass
 * the check. With matches and no `force`, nothing is inserted and the
 * matches are returned. Same columns and defaults as createRecruitment.
 */
export async function createRecruitmentChecked(
  params: CreateRecruitmentParams,
  force: boolean,
): Promise<{ record: RecruitmentRecord } | { duplicates: JobDuplicate[] }> {
  const { slug, identity, provenance, adminId } = params;
  const job = {
    slug,
    identity,
    dates: params.dates ?? {},
    vacancies: params.vacancies ?? {},
    financial: params.financial ?? {},
    eligibility: params.eligibility ?? null,
    age: params.age ?? null,
    selection: params.selection ?? null,
    exam_stages: params.examStages ?? null,
    how_to_apply: params.howToApply ?? null,
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance,
    links: params.links ?? [],
    documents: params.documents ?? [],
    updates: params.updates ?? [],
    classification: params.classification ?? null,
    organization_name: identity.organizationName ?? null,
    title_text: identity.title.value ?? null,
    gov_type: identity.govType ?? null,
  };
  const rows = await sql`
    SELECT public.cms_create_job_checked(
      ${JSON.stringify(job)}::jsonb, ${identity.organizationId}, ${identity.recruitmentYear}::int, ${force}, ${adminId}::uuid
    ) AS result
  `;
  const result = (typeof rows[0].result === "string" ? JSON.parse(rows[0].result) : rows[0].result) as { id?: string; duplicates?: JobDuplicate[] };
  if (result.duplicates) return { duplicates: result.duplicates };
  const record = await getRecruitmentById(String(result.id));
  if (!record) throw new Error(`Record ${result.id} not found after creation`);
  return { record };
}

/** The draft's own identity, used for the draft-promotion locks and duplicate rule. */
export interface DraftIdentity {
  draftId: string;
  organizationId: string | null;
  recruitmentYear: number | null;
  /** Normalised notification number (normalizeNotifNum), or null. */
  identityKey: string | null;
}

/**
 * The intelligence-draft promotion path: lock the draft, the organisation +
 * year and the notification number, check that the draft was not already
 * promoted, check for duplicates and insert, all in one database call
 * (cms_create_job_from_draft). Same locks as an import and a manual create,
 * so none of the three can race another past the duplicate check.
 */
export async function createRecruitmentFromDraftChecked(
  params: CreateRecruitmentParams,
  draft: DraftIdentity,
  force: boolean,
): Promise<
  | { record: RecruitmentRecord }
  | { existing: { id: string; slug: string } }
  | { duplicates: JobDuplicate[] }
> {
  const { slug, identity, provenance, adminId } = params;
  const job = {
    slug,
    identity,
    dates: params.dates ?? {},
    vacancies: params.vacancies ?? {},
    financial: params.financial ?? {},
    eligibility: params.eligibility ?? null,
    age: params.age ?? null,
    selection: params.selection ?? null,
    exam_stages: params.examStages ?? null,
    how_to_apply: params.howToApply ?? null,
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance,
    links: params.links ?? [],
    documents: params.documents ?? [],
    updates: params.updates ?? [],
    classification: params.classification ?? null,
    organization_name: identity.organizationName ?? null,
    title_text: identity.title.value ?? null,
    gov_type: identity.govType ?? null,
  };
  const rows = await sql`
    SELECT public.cms_create_job_from_draft(
      ${JSON.stringify(job)}::jsonb, ${draft.draftId}, ${draft.organizationId}, ${draft.recruitmentYear}::int,
      ${draft.identityKey}, ${force}, ${adminId}::uuid
    ) AS result
  `;
  const result = (typeof rows[0].result === "string" ? JSON.parse(rows[0].result) : rows[0].result) as {
    id?: string; existing?: { id: string; slug: string }; duplicates?: JobDuplicate[];
  };
  if (result.existing) return { existing: { id: String(result.existing.id), slug: String(result.existing.slug) } };
  if (result.duplicates) return { duplicates: result.duplicates };
  const record = await getRecruitmentById(String(result.id));
  if (!record) throw new Error(`Record ${result.id} not found after creation`);
  return { record };
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
  // The edited field's revision first, then those of fields worked out from it.
  const revisions = [revision, ...(result.extraRevisions ?? [])].map((r) => ({
    id: r.id, recruitment_id: r.recruitmentId, field_path: r.fieldPath, revised_by: r.revisedBy, revised_at: r.revisedAt,
    old_value: r.oldValue === undefined ? null : r.oldValue, new_value: r.newValue === undefined ? null : r.newValue, reason: r.reason ?? null,
  }));

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
        exam_pattern      = ${record.examPattern !== undefined ? JSON.stringify(record.examPattern) : null},
        syllabus          = ${record.syllabus !== undefined ? JSON.stringify(record.syllabus) : null},
        how_to_apply      = ${record.howToApply !== undefined ? JSON.stringify(record.howToApply) : null},
        links             = ${JSON.stringify(record.links)},
        documents         = ${JSON.stringify(record.documents)},
        lifecycle         = ${JSON.stringify(record.lifecycle)},
        exam_stages       = ${record.examStages !== undefined ? JSON.stringify(record.examStages) : null},
        conditions        = ${record.conditions !== undefined ? JSON.stringify(record.conditions) : null},
        classification    = ${record.classification !== undefined ? JSON.stringify(record.classification) : null},
        provenance        = ${JSON.stringify(record.provenance)},
        updates           = ${JSON.stringify(record.updates ?? [])},
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
    SELECT r.id, r.recruitment_id, r.field_path, r.revised_by, r.revised_at, r.old_value, r.new_value, r.reason
    FROM updated
    CROSS JOIN jsonb_to_recordset(${JSON.stringify(revisions)}::jsonb) AS r(
      id UUID, recruitment_id UUID, field_path TEXT, revised_by UUID, revised_at TIMESTAMPTZ,
      old_value JSONB, new_value JSONB, reason TEXT
    )
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

  // One statement: the Neon HTTP driver has no multi-statement transactions,
  // so the state change and its audit row must travel together.
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        draft_state = 'APPROVED',
        updated_at  = now(),
        updated_by  = ${adminId}
      WHERE id = ${record.id}
        AND draft_state = 'DRAFT'
      RETURNING id
    )
    INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    SELECT
      id,
      ${adminId},
      ${result.auditEvent.eventType},
      ${JSON.stringify(result.auditEvent.metadata)}
    FROM updated
    RETURNING recruitment_id
  `;

  if (rows.length === 0) {
    throw new StateConflictError("DRAFT");
  }

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after approval`);
  return saved;
}

/** Audit event for an approval undone because the publish that followed it failed. */
export const APPROVAL_WITHDRAWN_EVENT = "APPROVAL_WITHDRAWN";

/**
 * Undo an approval made a moment ago by Approve & Publish when the publish
 * itself then failed, so the job is not left looking Approved but not live.
 * APPROVED → DRAFT with an audit row, in one statement. Returns false if the
 * record is no longer APPROVED (someone else moved it on); nothing changes then.
 */
export async function persistApprovalWithdrawn(
  recordId: string,
  adminId: string,
  reason: string,
): Promise<boolean> {
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        draft_state = 'DRAFT',
        updated_at  = now(),
        updated_by  = ${adminId}
      WHERE id = ${recordId}
        AND draft_state = 'APPROVED'
      RETURNING id
    )
    INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    SELECT id, ${adminId}, ${APPROVAL_WITHDRAWN_EVENT}, ${JSON.stringify({ via: "approve-and-publish", reason })}
    FROM updated
    RETURNING recruitment_id
  `;
  return rows.length > 0;
}

/**
 * Store a published snapshot and transition record to PUBLISHED.
 * The snapshot (PublishedRecruitment) must be built by the caller via projectToPublished().
 */
/** The job changed after the owner's review: nothing was published (owner-controlled publication, §3.3). */
export class StaleReviewError extends Error {
  constructor() { super("The job changed after it was reviewed: review it again before publishing."); this.name = "StaleReviewError"; }
}

export async function persistPublication(
  record: RecruitmentRecord,
  snapshot: unknown,
  projectionVersion: string,
  adminId: string,
  /**
   * Owner-controlled publication: the freshness the owner reviewed, rechecked inside this statement, and the
   * approval, written by this statement. Without it, the statement is as before (and writes no approval).
   */
  owner?: { freshness: { recordRevision: string; claimSeq: number; retrievals: number }; approval: Record<string, unknown>; eventType: string },
): Promise<RecruitmentRecord> {
  const sourceRevision = record.recordRevision;
  const result = markPublished(record, adminId, sourceRevision);

  // Owner approval: the job must still be exactly as reviewed. The record's revision covers every edit; the
  // latest claim covers confirmations, decisions and imports (they add claims without a new revision); the
  // number of documents covers a new source brought in without claims.
  const fresh = owner
    ? sql`AND record_revision = ${owner.freshness.recordRevision}
          AND (SELECT coalesce(max(seq), 0) FROM recruitment_field_claims WHERE recruitment_id = ${record.id}) = ${owner.freshness.claimSeq}
          AND (SELECT count(*) FROM recruitment_source_retrievals sr JOIN recruitment_imports si ON si.import_id = sr.import_id
               WHERE si.recruitment_id = ${record.id}) = ${owner.freshness.retrievals}`
    : sql``;

  // One statement: state change, snapshot, audit row and (owner-controlled) the approval succeed or fail
  // together. A failed snapshot insert must never leave the record marked PUBLISHED, nor an approval written.
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        draft_state             = 'PUBLISHED',
        published_at            = coalesce(published_at, now()),
        last_published_revision = ${sourceRevision},
        -- Publishing puts a job that was taken off the site back on it.
        taken_down              = NULL,
        updated_at              = now(),
        updated_by              = ${adminId}
      WHERE id = ${record.id}
        AND draft_state = 'APPROVED'
        ${fresh}
      RETURNING id
    ),
    approval AS (
      INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
      SELECT id, ${adminId}, ${owner?.eventType ?? "NONE"}, ${JSON.stringify(owner?.approval ?? {})}
      FROM updated WHERE ${owner ? true : false}
      RETURNING recruitment_id
    ),
    snap AS (
      INSERT INTO published_recruitments
        (recruitment_id, source_record_revision, projection_version, snapshot, published_by)
      SELECT
        id,
        ${sourceRevision},
        ${projectionVersion},
        ${JSON.stringify(snapshot)},
        ${adminId}
      FROM updated
      RETURNING recruitment_id
    )
    INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    SELECT
      id,
      ${adminId},
      ${result.auditEvent.eventType},
      ${JSON.stringify(result.auditEvent.metadata)}
    FROM updated
    RETURNING recruitment_id
  `;

  if (rows.length === 0) {
    // Nothing was written. Still APPROVED means the owner's freshness check is what failed.
    if (owner) {
      const now = (await sql`SELECT draft_state FROM recruitments WHERE id = ${record.id}`)[0]?.draft_state;
      if (now === "APPROVED") throw new StaleReviewError();
    }
    throw new StateConflictError("APPROVED");
  }

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after publication`);
  return saved;
}

/**
 * Transition PUBLISHED → DRAFT without touching lastPublishedRevision.
 * The published snapshot remains intact; public pages continue to serve it
 * while the record is being edited.
 *
 * OCC guard: draft_state must still be 'PUBLISHED'.
 * If another admin already reverted, throws OccConflictError.
 */
export async function persistRevert(
  record: RecruitmentRecord,
  adminId: string,
): Promise<RecruitmentRecord> {
  const { record: reverted, auditEvent } = revertRecord(record, adminId);

  const revision = buildFieldRevision(
    record.id,
    "draftState",
    "PUBLISHED",
    "DRAFT",
    adminId,
    "Reverted to DRAFT for editing",
  );

  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        draft_state = 'DRAFT',
        updated_at  = now(),
        updated_by  = ${adminId}
      WHERE id          = ${record.id}
        AND draft_state = 'PUBLISHED'
      RETURNING id
    ),
    rev AS (
      INSERT INTO field_revisions
        (id, recruitment_id, field_path, revised_by, revised_at, old_value, new_value, reason)
      SELECT
        ${revision.id},
        ${revision.recruitmentId},
        ${revision.fieldPath},
        ${revision.revisedBy},
        ${revision.revisedAt},
        ${JSON.stringify("PUBLISHED")},
        ${JSON.stringify("DRAFT")},
        ${revision.reason ?? null}
      FROM updated
      RETURNING recruitment_id
    )
    INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    SELECT
      ${record.id},
      ${adminId},
      ${auditEvent.eventType},
      ${JSON.stringify(auditEvent.metadata)}
    FROM updated
    RETURNING recruitment_id
  `;

  void reverted;

  if (rows.length === 0) {
    const current = await getRecruitmentById(record.id);
    throw new OccConflictError(current?.recordRevision ?? "unknown");
  }

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after revert`);
  return saved;
}

// ─── Taking a live job off the website, and putting it back ──

export const TAKEN_DOWN_EVENT = "TAKEN_OFF_SITE";
export const PUT_BACK_EVENT = "PUT_BACK_ON_SITE";

/** Thrown when a job is not in the state a take-down or put-back needs (someone else got there first, or it was never live). */
export class SiteVisibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteVisibilityError";
  }
}

/**
 * Hide a live job from every public page at once, keeping the record, its
 * published snapshots and all its history. Records who did it, when and why.
 * Neither the content nor record_revision changes, so an editor open on the
 * record keeps working. Nothing is posted anywhere.
 *
 * Guard: the job has been published, is not archived and is not already off
 * the site. Otherwise throws SiteVisibilityError.
 */
export async function persistTakeDown(
  record: RecruitmentRecord,
  adminId: string,
  reason: string,
): Promise<RecruitmentRecord> {
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        taken_down = jsonb_build_object(
          'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'by', ${adminId}::text,
          'byName', (SELECT username FROM admins WHERE id = ${adminId}),
          'reason', ${reason}::text
        ),
        updated_at = now(),
        updated_by = ${adminId}
      WHERE id = ${record.id}
        AND last_published_revision IS NOT NULL
        AND draft_state <> 'ARCHIVED'
        AND taken_down IS NULL
      RETURNING id
    )
    INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    SELECT id, ${adminId}, ${TAKEN_DOWN_EVENT}, ${JSON.stringify({ reason })}
    FROM updated
    RETURNING recruitment_id
  `;
  if (rows.length === 0) throw new SiteVisibilityError("This job is not live on the site, so there is nothing to take off. It may already have been taken off.");

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after taking it off the site`);
  return saved;
}

/**
 * Show a job that was taken off the site again. The public pages serve its
 * last published snapshot, exactly as visitors last saw it; edits made since
 * stay in the draft until they are published the usual way.
 *
 * Guard: the job is off the site. Otherwise throws SiteVisibilityError.
 */
export async function persistPutBack(
  record: RecruitmentRecord,
  adminId: string,
): Promise<RecruitmentRecord> {
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        taken_down = NULL,
        updated_at = now(),
        updated_by = ${adminId}
      WHERE id = ${record.id}
        AND taken_down IS NOT NULL
      RETURNING id
    )
    INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
    SELECT id, ${adminId}, ${PUT_BACK_EVENT}, ${JSON.stringify({ via: "put-back", takenDown: record.takenDown ?? null })}
    FROM updated
    RETURNING recruitment_id
  `;
  if (rows.length === 0) throw new SiteVisibilityError("This job is not off the site. It may already have been put back.");

  const saved = await getRecruitmentById(record.id);
  if (!saved) throw new Error(`Record ${record.id} not found after putting it back`);
  return saved;
}

/**
 * Append an announcement-only UpdateRecord to the record's updates array, on a job open for editing (DRAFT or
 * APPROVED). It goes live only with the job's next publish, through the owner's publication review, which lists it
 * and covers it in its fingerprint (owner-controlled publication; update-workflow safety fix, 11 Nov 2026). A
 * published job is never changed here: put it back to draft first, and the public keeps the last published version
 * until the reviewed publish. Does NOT touch structural fields or record_revision; concurrent appends both succeed.
 */
export async function persistUpdateAppend(
  recordId: string,
  entry: UpdateRecord,
  adminId: string,
): Promise<{ record: RecruitmentRecord; revision: FieldRevision; wentLive: false }> {
  const revision = buildFieldRevision(
    recordId,
    "updates",
    null,
    entry,
    adminId,
    `Announcement: ${entry.type}`,
  );

  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        updates    = COALESCE(updates, '[]'::jsonb) || ${JSON.stringify(entry)}::jsonb,
        updated_at = now(),
        updated_by = ${adminId}
      WHERE id          = ${recordId}
        AND draft_state IN ('DRAFT', 'APPROVED')
      RETURNING id, draft_state
    )
    -- Nothing here writes to what the public sees: the entry waits in the job
    -- and goes live with the next publish the owner approves.
    INSERT INTO field_revisions
      (id, recruitment_id, field_path, revised_by, revised_at, old_value, new_value, reason)
    SELECT
      ${revision.id},
      ${revision.recruitmentId},
      ${revision.fieldPath},
      ${revision.revisedBy},
      ${revision.revisedAt},
      ${null},
      ${JSON.stringify(entry)},
      ${revision.reason ?? null}
    FROM updated
    RETURNING recruitment_id
  `;

  if (rows.length === 0) {
    return Promise.reject(new Error(`Record ${recordId} not found, or not open for editing (published or ARCHIVED)`));
  }

  const saved = await getRecruitmentById(recordId);
  if (!saved) throw new Error(`Record ${recordId} not found after update append`);
  return { record: saved, revision, wentLive: false };
}

/**
 * Save a job's announcement list after announcements were marked superseded or made current again
 * (src/lib/cms/announcements.ts). Like an announcement append: only while the job is open for editing, never
 * on the live version, and nothing public changes until the owner's reviewed publish. The write happens only
 * if the list is still exactly the one the change was worked out from (another tab or person may have changed
 * it), and the whole list before and after goes into the job's change history with the reason.
 */
export async function persistUpdatesNote(
  recordId: string,
  before: UpdateRecord[],
  after: UpdateRecord[],
  adminId: string,
  reason: string,
): Promise<{ record: RecruitmentRecord; revision: FieldRevision }> {
  const revision = buildFieldRevision(recordId, "updates", before, after, adminId, reason);
  const rows = await sql`
    WITH updated AS (
      UPDATE recruitments SET
        updates    = ${JSON.stringify(after)}::jsonb,
        updated_at = now(),
        updated_by = ${adminId}
      WHERE id          = ${recordId}
        AND draft_state IN ('DRAFT', 'APPROVED')
        AND COALESCE(updates, '[]'::jsonb) = ${JSON.stringify(before)}::jsonb
      RETURNING id
    )
    INSERT INTO field_revisions
      (id, recruitment_id, field_path, revised_by, revised_at, old_value, new_value, reason)
    SELECT ${revision.id}, ${revision.recruitmentId}, ${revision.fieldPath}, ${revision.revisedBy}, ${revision.revisedAt},
      ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${revision.reason ?? null}
    FROM updated
    RETURNING recruitment_id
  `;
  if (rows.length === 0) throw new UpdatesChangedError();
  const saved = await getRecruitmentById(recordId);
  if (!saved) throw new Error(`Record ${recordId} not found after saving its announcements`);
  return { record: saved, revision };
}

/** The job's announcements changed, or it is no longer open for editing, since the change was worked out. */
export class UpdatesChangedError extends Error {
  constructor() { super("The announcements changed, or the job is not open for editing. Reload the page and try again."); }
}

// Re-export buildFieldRevision so callers can build revisions without
// importing record-ops directly. The repository is the single entry point.
export { buildFieldRevision };
