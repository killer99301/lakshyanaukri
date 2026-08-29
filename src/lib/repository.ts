// ═══════════════════════════════════════════════════════════
// Career Campus — Repository (Data Access Abstraction)
// ═══════════════════════════════════════════════════════════
// ALL data access goes through this file.
// Today: reads TypeScript arrays (StaticRepository).
// Tomorrow: queries database / CMS API (DatabaseRepository).
// Components and pages NEVER import from data/ directly.
// ═══════════════════════════════════════════════════════════

import type { Opportunity, GovernmentRecruitment, PrivateJob, Internship } from "@/types";
import { GOVERNMENT_RECRUITMENTS } from "@/data/government";
import { PRIVATE_JOBS } from "@/data/private";
import { INTERNSHIPS } from "@/data/internships";

// ─── Internal Dataset Assembly ──────────────────────────

/**
 * Assembles ALL opportunities from canonical data files (including NOT_VERIFIED).
 * For internal/validation use only. Public-facing surfaces should use
 * assembleVerifiedDataset() instead.
 */
function assembleDataset(): Opportunity[] {
  return [
    ...GOVERNMENT_RECRUITMENTS,
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
 * Only searches verified records — NOT_VERIFIED records will not match.
 */
export function getBySlug(slug: string): Opportunity | undefined {
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
 * Get all URL slugs — used for generateStaticParams() in Next.js.
 * Only returns slugs for verified records (NOT_VERIFIED excluded from routing).
 */
export function getAllSlugs(): string[] {
  return assembleVerifiedDataset().map((opp) => opp.slug);
}

/**
 * Get only government recruitments. Returns verified only.
 */
export function getGovernmentRecruitments(): GovernmentRecruitment[] {
  return GOVERNMENT_RECRUITMENTS.filter(
    (r) =>
      r.provenance.status === "VERIFIED" ||
      r.provenance.status === "PARTIALLY_VERIFIED"
  );
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

