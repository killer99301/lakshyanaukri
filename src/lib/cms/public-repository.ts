// ═══════════════════════════════════════════════════════════
// CMS Public Repository — read path for published_recruitments
// ═══════════════════════════════════════════════════════════
//
// Called only from the public read path (src/lib/repository.ts).
// Never called from admin routes — admin reads go through repository.ts.
// ═══════════════════════════════════════════════════════════

import { sql } from "@/lib/db";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

/**
 * Returns the most recent published snapshot for a given slug.
 * Joins through recruitments.slug (indexed) to published_recruitments.
 * Returns null if no published record exists for this slug.
 */
export async function getPublishedBySlug(
  slug: string,
): Promise<PublishedRecruitmentSnapshot | null> {
  const rows = await sql`
    SELECT pr.snapshot
    FROM published_recruitments pr
    JOIN recruitments r ON r.id = pr.recruitment_id
    WHERE r.slug = ${slug}
      AND r.last_published_revision IS NOT NULL
      AND r.draft_state != 'ARCHIVED'
    ORDER BY pr.published_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].snapshot as PublishedRecruitmentSnapshot;
}

/**
 * Returns all slugs with at least one published snapshot.
 * Used by generateStaticParams to include CMS records in the static route set.
 */
export async function getPublishedSlugs(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT r.slug
    FROM published_recruitments pr
    JOIN recruitments r ON r.id = pr.recruitment_id
    WHERE r.last_published_revision IS NOT NULL
      AND r.draft_state != 'ARCHIVED'
    ORDER BY r.slug
  `;
  return rows.map((r) => r.slug as string);
}

/**
 * Returns the most recent published snapshot for every recruitment that has
 * ever been published and is not ARCHIVED. Includes records reverted to DRAFT
 * after publication — public pages continue to serve their last snapshot.
 * Single batch query — no N+1. Used by the /jobs marketplace listing.
 */
export async function getAllPublishedSnapshots(): Promise<PublishedRecruitmentSnapshot[]> {
  const rows = await sql`
    SELECT DISTINCT ON (r.id) pr.snapshot
    FROM published_recruitments pr
    JOIN recruitments r ON r.id = pr.recruitment_id
    WHERE r.last_published_revision IS NOT NULL
      AND r.draft_state != 'ARCHIVED'
    ORDER BY r.id, pr.published_at DESC
  `;
  return rows.map((row) => row.snapshot as PublishedRecruitmentSnapshot);
}
