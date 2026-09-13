// ═══════════════════════════════════════════════════════════
// Phase 10F: Intelligence Draft — Pure Business Logic
// ═══════════════════════════════════════════════════════════
//
// Pure functions only — no I/O, no DB, no side effects.
// API routes call these helpers then handle DB operations.
//
// INVARIANTS:
//   - Revision 1 is always the machine output from analysis.
//   - Each explicit Save Review creates the next revision.
//   - created_by / updated_by / saved_by are always the admin's
//     UUID from the admins table — never a username or display name.
//   - OCC: a save is valid only when the client sends the same
//     revision number that is currently stored (current_revision).
//     Mismatch → 409 Conflict; draft and revision log unchanged.
// ═══════════════════════════════════════════════════════════

export type DraftStatus = "DRAFT" | "IN_REVIEW";

/** Metadata for an intelligence draft (no snapshot). */
export interface DraftMeta {
  /** DB-assigned UUID — undefined before the first INSERT. */
  id?: string;
  status: DraftStatus;
  currentRevision: number;
  /** UUID from admins.id — authoritative audit identity. */
  createdBy: string;
  /** UUID from admins.id — set on every save. */
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Build the initial metadata for a new draft.
 * Call before the INSERT — `id` is assigned by the database.
 */
export function buildInitialDraftMeta(adminId: string): DraftMeta {
  const now = new Date().toISOString();
  return {
    status: "DRAFT",
    currentRevision: 1,
    createdBy: adminId,
    updatedBy: adminId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Returns true when the client's revision is out of date.
 * A client is stale when another save has incremented current_revision
 * since the client last loaded the draft.
 *
 * @param storedRevision  current_revision stored in the DB
 * @param clientRevision  revision the client claims to be editing from
 */
export function isConcurrentConflict(
  storedRevision: number,
  clientRevision: number,
): boolean {
  return storedRevision !== clientRevision;
}

/**
 * Compute the next metadata state after a successful Save Review.
 * Returns the updated meta and the new revision number to record.
 *
 * Note: this is pure — DB UPDATE/INSERT are the caller's responsibility.
 */
export function applyRevision(
  meta: DraftMeta,
  savedBy: string,
): { meta: DraftMeta; revisionNumber: number } {
  const revisionNumber = meta.currentRevision + 1;
  return {
    meta: {
      ...meta,
      currentRevision: revisionNumber,
      updatedBy: savedBy,
      status: "IN_REVIEW",
      updatedAt: new Date().toISOString(),
    },
    revisionNumber,
  };
}
