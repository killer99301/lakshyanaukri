// ═══════════════════════════════════════════════════════════
// Owner-controlled publication: who may publish, and refused attempts
// ═══════════════════════════════════════════════════════════
//
// docs/owner-controlled-publication-design.md, revision 3, §3.1 and §3.4.
//
// Publishers: CMS_PUBLISHERS holds admin IDs (UUIDs, comma or space
// separated). An admin ID never changes or is reused; a username could. An
// empty or unset list means nobody may publish, republish, take down, put
// back or revert (fail closed). Anything in the list that is not a UUID (a
// username, say) is ignored, never matched.
//
// Refused attempts: written as their own single-row insert, after the refused
// operation has ended, so they never travel with (or roll back with) it. They
// keep only what is needed: the action, the reason code, the record revision,
// the fields or rule codes involved. Never values, URLs, snapshots, tokens or
// request bodies. At most one row per admin, job, action and reason a minute.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PUBLISHERS_ENV = "CMS_PUBLISHERS";
export const OWNER_APPROVAL_EVENT = "OWNER_PUBLICATION_APPROVAL";
export const REFUSED_EVENT = "PUBLICATION_REFUSED";

/** The admin IDs allowed to publish; anything not a UUID is dropped. */
export function parsePublishers(raw: string | undefined | null): Set<string> {
  return new Set((raw ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s)));
}

export function isPublisher(adminId: string, env: Record<string, string | undefined> = process.env): boolean {
  const list = parsePublishers(env[PUBLISHERS_ENV]);
  return list.size > 0 && list.has(adminId.toLowerCase());
}

/** The refusal message: says why, and which ID the owner would add. */
export function notAPublisherMessage(adminId: string, env: Record<string, string | undefined> = process.env): string {
  return parsePublishers(env[PUBLISHERS_ENV]).size === 0
    ? "Publishing is closed: no publisher is set (CMS_PUBLISHERS). Only the owner or an authorised publisher can publish."
    : `Only the owner or an authorised publisher can do this. Your admin ID is ${adminId}.`;
}

export type PublicationAction = "PUBLISH" | "REPUBLISH" | "TAKE_DOWN" | "PUT_BACK" | "REVERT";
export type RefusalReason = "NOT_A_PUBLISHER" | "OWNER_REVIEW_REQUIRED" | "REVIEW_CHANGED" | "CONFLICT_NOT_ACKNOWLEDGED" | "HARD_RULE" | "STATE";

export interface RefusalInput {
  recruitmentId: string;
  adminId: string;
  action: PublicationAction;
  reason: RefusalReason;
  recordRevision?: string | null;
  fieldPaths?: string[];
  ruleCodes?: string[];
}

/** The metadata kept for a refusal: only these keys, only codes and field paths. */
export function refusalMetadata(r: RefusalInput): Record<string, unknown> {
  const clean = (xs: string[] | undefined) => (xs ?? []).filter((x) => typeof x === "string" && /^[A-Za-z0-9_.#-]{1,80}$/.test(x)).slice(0, 40);
  return {
    action: r.action,
    reason: r.reason,
    ...(r.recordRevision ? { recordRevision: String(r.recordRevision).slice(0, 64) } : {}),
    ...(r.fieldPaths?.length ? { fieldPaths: clean(r.fieldPaths) } : {}),
    ...(r.ruleCodes?.length ? { ruleCodes: clean(r.ruleCodes) } : {}),
  };
}

/**
 * Records a refused attempt. Its own statement, after the refused operation: never part of a publish, never
 * rolled back with one, and it touches no other table. Best-effort: a failure is logged and never changes the
 * response.
 */
export async function logPublicationRefusal(r: RefusalInput): Promise<void> {
  if (!UUID.test(r.recruitmentId) || !UUID.test(r.adminId)) return;
  const meta = refusalMetadata(r);
  try {
    const { sql } = await import("@/lib/db");
    await sql`
      INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
      SELECT r.id, ${r.adminId}::uuid, ${REFUSED_EVENT}, ${JSON.stringify(meta)}::jsonb
      FROM recruitments r
      WHERE r.id = ${r.recruitmentId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM recruitment_audit_events e
          WHERE e.recruitment_id = r.id AND e.admin_id = ${r.adminId}::uuid AND e.event_type = ${REFUSED_EVENT}
            AND e.metadata->>'action' = ${r.action} AND e.metadata->>'reason' = ${r.reason}
            AND e.created_at > now() - interval '1 minute')`;
  } catch (err) {
    console.error("[CMS] a refused publication attempt could not be recorded", err instanceof Error ? err.message : "error");
  }
}
