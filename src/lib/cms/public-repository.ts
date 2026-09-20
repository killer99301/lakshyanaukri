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
      AND r.draft_state = 'PUBLISHED'
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
    WHERE r.draft_state = 'PUBLISHED'
    ORDER BY r.slug
  `;
  return rows.map((r) => r.slug as string);
}
