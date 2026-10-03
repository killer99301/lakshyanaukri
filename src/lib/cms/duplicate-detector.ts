// ═══════════════════════════════════════════════════════════
// Phase E: CMS Duplicate Detection
//
// Detects whether an intelligence draft being promoted to a CMS
// record would duplicate an existing record.
//
// Matching rules (in priority order):
//   1. STRONG — both records have notification numbers that match
//      (case-insensitive, trimmed). Different notification numbers
//      for the same org+year are NOT duplicates.
//   2. WEAK   — notification number is absent on either side;
//      fall back to org + year equality.
//
// The pure function computeDuplicateMatch() is exported for unit
// testing without a database.
// ═══════════════════════════════════════════════════════════

import type { RecruitmentIntelligenceDraft } from "@/intelligence/draft-types";

export interface DuplicateCandidate {
  id: string;
  slug: string;
  title: string | undefined;
  organizationId: string;
  organizationName: string | undefined;
  notificationNumber: string | undefined;
  recruitmentYear: number | undefined;
  draftState: string;
  matchReason: "notification_number" | "org_year";
}

export function normalizeNotifNum(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const n = s.trim().toUpperCase().replace(/\s+/g, " ");
  return n || undefined;
}

/**
 * Pure matching logic — no DB.
 *
 * Returns the match reason when the two records are duplicates,
 * or null when they are not.
 */
export function computeDuplicateMatch(
  draft: { notifNum?: string; orgId?: string; year?: number },
  record: { notifNum?: string; orgId?: string; year?: number },
): "notification_number" | "org_year" | null {
  const draftNN = normalizeNotifNum(draft.notifNum);
  const recordNN = normalizeNotifNum(record.notifNum);

  // Both have notification numbers — only strong match applies.
  // Different numbers for the same org+year must NOT be treated as duplicates.
  if (draftNN && recordNN) {
    return draftNN === recordNN ? "notification_number" : null;
  }

  // Notification number missing on at least one side — weak fallback: org + year.
  if (
    draft.orgId &&
    draft.year !== undefined &&
    draft.orgId === record.orgId &&
    draft.year === record.year
  ) {
    return "org_year";
  }

  return null;
}

function rowToCandidate(
  row: Record<string, unknown>,
  matchReason: "notification_number" | "org_year",
): DuplicateCandidate {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: row.title ? String(row.title) : undefined,
    organizationId: String(row.organization_id),
    organizationName: row.organization_name ? String(row.organization_name) : undefined,
    notificationNumber: row.notification_number ? String(row.notification_number) : undefined,
    recruitmentYear: row.recruitment_year != null ? Number(row.recruitment_year) : undefined,
    draftState: String(row.draft_state),
    matchReason,
  };
}

/**
 * Queries the CMS for a potential duplicate of the given draft.
 *
 * Returns null when no duplicate is found; returns a DuplicateCandidate
 * when a match is found. Never returns ARCHIVED records.
 */
export async function findCmsDuplicate(
  draft: RecruitmentIntelligenceDraft,
): Promise<DuplicateCandidate | null> {
  const { sql } = await import("@/lib/db");

  const draftNotifNum = normalizeNotifNum(
    draft.identity.notificationNumber?.value ?? undefined,
  );
  const draftOrgId = draft.identity.organizationId?.value ?? undefined;
  const draftYear =
    typeof draft.identity.recruitmentYear?.value === "number"
      ? draft.identity.recruitmentYear.value
      : undefined;

  if (draftNotifNum) {
    // Strong match: CMS record with the same notification number.
    const rows = await sql`
      SELECT
        id, slug, draft_state, organization_id, organization_name,
        identity->'notificationNumber'->>'value' AS notification_number,
        (identity->>'recruitmentYear')::int       AS recruitment_year,
        identity->'title'->>'value'               AS title
      FROM recruitments
      WHERE draft_state != 'ARCHIVED'
        AND UPPER(TRIM(COALESCE(identity->'notificationNumber'->>'value', ''))) = ${draftNotifNum}
      LIMIT 1
    `;
    if (rows.length > 0) {
      return rowToCandidate(rows[0] as Record<string, unknown>, "notification_number");
    }

    // No strong match. Weak fallback: same org+year but the CMS record is missing
    // its notification number (the CMS record is the "either" side that is missing).
    if (draftOrgId && draftYear !== undefined) {
      const weakRows = await sql`
        SELECT
          id, slug, draft_state, organization_id, organization_name,
          identity->'notificationNumber'->>'value' AS notification_number,
          (identity->>'recruitmentYear')::int       AS recruitment_year,
          identity->'title'->>'value'               AS title
        FROM recruitments
        WHERE draft_state != 'ARCHIVED'
          AND organization_id = ${draftOrgId}
          AND identity->>'recruitmentYear' IS NOT NULL
          AND (identity->>'recruitmentYear')::int = ${draftYear}
          AND (
            identity->'notificationNumber'->>'value' IS NULL
            OR TRIM(identity->'notificationNumber'->>'value') = ''
          )
        LIMIT 1
      `;
      if (weakRows.length > 0) {
        return rowToCandidate(weakRows[0] as Record<string, unknown>, "org_year");
      }
    }
    return null;
  }

  // Draft has no notification number: weak fallback by org + year only.
  if (draftOrgId && draftYear !== undefined) {
    const rows = await sql`
      SELECT
        id, slug, draft_state, organization_id, organization_name,
        identity->'notificationNumber'->>'value' AS notification_number,
        (identity->>'recruitmentYear')::int       AS recruitment_year,
        identity->'title'->>'value'               AS title
      FROM recruitments
      WHERE draft_state != 'ARCHIVED'
        AND organization_id = ${draftOrgId}
        AND identity->>'recruitmentYear' IS NOT NULL
        AND (identity->>'recruitmentYear')::int = ${draftYear}
      LIMIT 1
    `;
    if (rows.length > 0) {
      return rowToCandidate(rows[0] as Record<string, unknown>, "org_year");
    }
  }

  return null;
}
