// ═══════════════════════════════════════════════════════════
// Career Campus — Repository (Data Access Abstraction)
// ═══════════════════════════════════════════════════════════
// ALL data access goes through this file.
// Government recruitments: exclusively via CMS (published_recruitments).
// Private jobs and internships: via static TypeScript arrays.
// Components and pages NEVER import from data/ directly.
// ═══════════════════════════════════════════════════════════

import type { Opportunity, PrivateJob, Internship } from "@/types";
import { PRIVATE_JOBS } from "@/data/private";
import { INTERNSHIPS } from "@/data/internships";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
// public-repository imports db.ts which throws at module-init when DATABASE_URL is
// absent (e.g. in the browser). Import it dynamically inside the two async functions
// that need it so the client bundle for "use client" components never includes db.ts.

// ─── Internal Dataset Assembly ──────────────────────────

/**
 * Assembles ALL opportunities from static data files (including NOT_VERIFIED).
 * Government recruitments are exclusively in the CMS and not included here.
 * For internal/validation use only. Public-facing surfaces should use
 * assembleVerifiedDataset() instead.
 */
function assembleDataset(): Opportunity[] {
  return [
    ...PRIVATE_JOBS,
    ...INTERNSHIPS,
  ];
}

/**
 * Assembles only VERIFIED and PARTIALLY_VERIFIED opportunities.
 * NOT_VERIFIED records are excluded — they must never enter production listings.
 */
function assembleVerifiedDataset(): Opportunity[] {
  return assembleDataset().filter(
    (opp) =>
      opp.provenance.status === "VERIFIED" ||
      opp.provenance.status === "PARTIALLY_VERIFIED"
  );
}

// ─── Public Repository API ───────────────────────────────

/**
 * Returns ALL opportunities including NOT_VERIFIED.
 * Used only by the Trust Gate validation pipeline.
 * Pages and components MUST use getAllVerifiedOpportunities() instead.
 */
export function getAllOpportunities(): Opportunity[] {
  return assembleDataset();
}

/**
 * Returns only VERIFIED and PARTIALLY_VERIFIED opportunities.
 * This is the correct data source for all production-facing surfaces:
 * the jobs marketplace, job cards, filter counts, static params, etc.
 * NOT_VERIFIED records are never included.
 */
export function getAllVerifiedOpportunities(): Opportunity[] {
  return assembleVerifiedDataset();
}

/**
 * Find an opportunity by its URL slug. Returns undefined if not found.
 * CMS-first: checks published_recruitments before the static repository.
 * Falls back to static records if the CMS is unreachable or has no match.
 */
export async function getBySlug(slug: string): Promise<Opportunity | undefined> {
  try {
    const { getPublishedBySlug } = await import("@/lib/cms/public-repository");
    const snapshot = await getPublishedBySlug(slug);
    if (snapshot) return snapshotToGovernmentRecruitment(snapshot);
  } catch {
    // DB unavailable — fall through to static
  }
  return assembleVerifiedDataset().find((opp) => opp.slug === slug);
}

/**
 * Find an opportunity by its ID. Returns undefined if not found.
 * Only searches verified records.
 */
export function getById(id: string): Opportunity | undefined {
  return assembleVerifiedDataset().find((opp) => opp.id === id);
}

/**
 * Get slugs from the static data layer only — no DB call.
 * Used by validate.ts and other tooling that doesn't need CMS records.
 */
export function getAllStaticSlugs(): string[] {
  return assembleVerifiedDataset().map((opp) => opp.slug);
}

/**
 * Get all URL slugs — used for generateStaticParams() in Next.js.
 * CMS-first: CMS-published slugs take precedence over static.
 * Falls back to static slugs if the CMS is unreachable.
 */
export async function getAllSlugs(): Promise<string[]> {
  const staticSlugs = assembleVerifiedDataset().map((opp) => opp.slug);
  try {
    const { getPublishedSlugs } = await import("@/lib/cms/public-repository");
    const cmsSlugs = await getPublishedSlugs();
    const seen = new Set(cmsSlugs);
    for (const s of staticSlugs) seen.add(s);
    return Array.from(seen);
  } catch {
    return staticSlugs;
  }
}

/**
 * Get only private jobs. Returns verified only.
 */
export function getPrivateJobs(): PrivateJob[] {
  return PRIVATE_JOBS.filter(
    (j) =>
      j.provenance.status === "VERIFIED" ||
      j.provenance.status === "PARTIALLY_VERIFIED"
  );
}

/**
 * Get only internships. Returns verified only.
 */
export function getInternships(): Internship[] {
  return INTERNSHIPS.filter(
    (i) =>
      i.provenance.status === "VERIFIED" ||
      i.provenance.status === "PARTIALLY_VERIFIED"
  );
}

/**
 * Get opportunities in the same category or state as the given one.
 * Excludes the given opportunity. Used for "Related Jobs" sections.
 * Only searches verified records.
 */
export function getRelated(opportunity: Opportunity, limit = 4): Opportunity[] {
  return assembleVerifiedDataset()
    .filter(
      (o) =>
        o.id !== opportunity.id &&
        (o.category === opportunity.category || o.state === opportunity.state)
    )
    .slice(0, limit);
}

/**
 * Get opportunities matching a predicate. Uses verified dataset.
 */
export function getFilteredCount(predicate: (opp: Opportunity) => boolean): number {
  return assembleVerifiedDataset().filter(predicate).length;
}

/**
 * Total count of verified opportunities in the repository.
 */
export function getTotalCount(): number {
  return assembleVerifiedDataset().length;
}

