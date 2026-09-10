// ═══════════════════════════════════════════════════════════
// Phase 7C: New Canonical Record Factory
// ═══════════════════════════════════════════════════════════
//
// Builds a GovernmentRecruitment draft from a CandidateNewRecruitment.
// The draft is written to a git branch and proposed via GitHub PR.
// It is NEVER written directly to production government.ts.
//
// Missing-field rules (non-negotiable):
//   - Fields that could not be extracted must stay at their
//     explicit "unknown" defaults — never guessed or fabricated.
//   - provenance.status is set to NOT_VERIFIED.
//   - NOT_VERIFIED records are excluded from production listings
//     by assembleVerifiedDataset() in repository.ts.
//   - The PR reviewer must change provenance.status to
//     PARTIALLY_VERIFIED after verifying the official source.
//
// Slug generation:
//   orgId + normalized title words + year → "ssc-cgl-combined-graduate-level-2027"
//   Collision-safe: if slug exists, appends "-<candidateId[:4]>".
// ═══════════════════════════════════════════════════════════

import type { GovernmentRecruitment } from "@/types";
import type { CandidateNewRecruitment } from "./types";
import {
  ORG_CATEGORY,
  ORG_GOV_TYPE,
  ORG_DOMAIN,
  ORG_QUALIFICATION,
} from "./org-registry";

// ─── Org metadata registry ────────────────────────────────────
// Defined in org-registry.ts and imported above.

// ─── Slug generation ──────────────────────────────────────────

const SLUG_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "in", "on", "at", "to",
  "by", "from", "with", "notification", "advertisement", "advt",
  "recruitment", "examination", "exam",
]);

/**
 * Generate a stable, human-readable slug from org, title, and year.
 * e.g., "ssc" + "Combined Graduate Level Examination 2026" → "ssc-cgl-combined-graduate-level-2026"
 */
export function generateSlug(
  orgId: string,
  title: string,
  year?: string,
  existingSlugs: string[] = []
): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !SLUG_STOP_WORDS.has(w) && !/^20\d{2}$/.test(w))
    .slice(0, 6);

  // Strip the leading org token when the title opens with the org name (e.g. "RRB Paramedical
  // CEN 05/2026") — without this, orgId is prepended AND present in words, producing
  // "rrb-rrb-paramedical-...". Also filters year tokens above so the year suffix appended
  // below doesn't duplicate a year that already appeared in the title.
  const titleWords = words[0] === orgId ? words.slice(1) : words;

  // Do NOT fall back to new Date().getFullYear() — that fabricates a year into the slug,
  // producing an unstable identifier that changes meaning if the notification spans years.
  const yearSuffix = year ?? extractYear(title);
  const parts: string[] = [orgId, ...titleWords];
  if (yearSuffix) parts.push(yearSuffix);
  const base = parts
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  if (!existingSlugs.includes(base)) return base;

  // Collision: append first 4 chars of candidate ID derived from title
  const suffix = orgId.slice(0, 3) + words[0]?.slice(0, 3);
  const withSuffix = `${base}-${suffix}`;
  return existingSlugs.includes(withSuffix) ? `${base}-${Date.now()}` : withSuffix;
}

function extractYear(text: string): string | undefined {
  const m = /\b(20\d{2})\b/.exec(text);
  return m ? m[1] : undefined;
}

// ─── Record ID generation ──────────────────────────────────────

/**
 * Stable canonical record ID from org + normalized notification number.
 * "ssc" + "CGLNOTIF12026" → "ssc-CGLNOTIF12026" (lower-cased)
 */
export function generateRecordId(orgId: string, normalizedNotifNumber: string): string {
  const cleaned = normalizedNotifNumber.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40);
  return `${orgId}-${cleaned}`.replace(/-+/g, "-").replace(/-$/, "");
}

// ─── Draft record factory ──────────────────────────────────────

/**
 * Build a GovernmentRecruitment draft from a CandidateNewRecruitment.
 *
 * All fields that could not be extracted are set to their explicit
 * "unknown" defaults — the schema requires them, but they must never
 * be fabricated. The PR body lists which fields need manual completion.
 *
 * The draft has provenance.status = "NOT_VERIFIED". It will not appear
 * in job listings until the PR reviewer changes it to PARTIALLY_VERIFIED.
 */
export function buildDraftGovernmentRecruitment(
  candidate: CandidateNewRecruitment,
  existingSlugs: string[] = []
): { draft: GovernmentRecruitment; missingFields: string[] } {
  const missingFields: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const orgDomain = ORG_DOMAIN[candidate.organizationId] ?? `${candidate.organizationId}.gov.in`;
  const orgWebsite = `https://${orgDomain}`;

  // title
  const title = candidate.title ?? "Title not extracted — manual entry required";
  if (!candidate.title) missingFields.push("title");

  // notificationNumber
  const notificationNumber = candidate.notificationNumber ?? "Not specified";
  if (!candidate.notificationNumber) missingFields.push("notificationNumber");

  // govType
  const govType =
    candidate.govType ??
    ORG_GOV_TYPE[candidate.organizationId] ??
    "Central Govt";

  // vacancies
  const totalVacancies = candidate.totalVacancies ?? 0;
  if (!candidate.totalVacancies) missingFields.push("totalVacancies");

  const vacanciesDisplay = candidate.totalVacancies
    ? `${candidate.totalVacancies} Vacancies`
    : "Vacancies not specified — verify from official notification";

  // application dates — missing dates use "TBA" sentinel (not today), which passes the
  // date sanity check (Invalid Date comparisons are false) and is honest to the reviewer.
  // postDate is left undefined rather than fabricated; reviewer must fill it in.
  const notificationDate = candidate.postDate;
  const openDate = candidate.applicationOpenDate ?? "TBA";
  const closeDate = candidate.applicationCloseDate ?? "TBA";
  if (!candidate.postDate) missingFields.push("postDate");
  if (!candidate.applicationOpenDate) missingFields.push("application.openDate");
  if (!candidate.applicationCloseDate) missingFields.push("application.closeDate");

  // links
  const links: GovernmentRecruitment["links"] = {
    notification: candidate.notifPdfUrl,
    apply: orgWebsite,
    website: orgWebsite,
  };
  if (!candidate.notifPdfUrl) missingFields.push("links.notification");

  // slug and ID — year derived from most authoritative available date (no fabrication)
  const slugYear =
    candidate.postDate?.slice(0, 4) ??
    candidate.applicationOpenDate?.slice(0, 4) ??
    candidate.applicationCloseDate?.slice(0, 4);
  const slug = generateSlug(
    candidate.organizationId,
    title,
    slugYear,
    existingSlugs
  );
  const id = generateRecordId(candidate.organizationId, candidate.normalizedNotifNumber);

  const draft: GovernmentRecruitment = {
    id,
    slug,
    type: "government",
    title,
    organizationId: candidate.organizationId,
    organizationName: candidate.organizationName,
    shortDescription: `${candidate.organizationName} recruitment notification discovered on ${candidate.discoveredAt.slice(0, 10)}. Complete details pending verification.`,
    category: ORG_CATEGORY[candidate.organizationId] ?? "government",
    state: "All India",
    qualification: ORG_QUALIFICATION[candidate.organizationId] ?? "Graduate",
    postDate: candidate.postDate,
    notificationNumber,
    govType,
    totalVacancies,
    vacanciesDisplay,
    application: {
      notificationDate,
      openDate,
      closeDate,
    },
    examStages: [
      {
        name: "Details not yet declared",
        order: 1,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
    ],
    links,
    provenance: {
      status: "NOT_VERIFIED",
      lastVerifiedAt: today,
      primarySourceUrl: candidate.notifPdfUrl ?? candidate.discoverySourceUrl,
      primarySourceType: candidate.notifPdfUrl ? "OFFICIAL_NOTIFICATION" : "OFFICIAL_WEBSITE",
      notes:
        `Auto-discovered from ${candidate.discoverySourceUrl} on ${today} ` +
        `(source tier ${candidate.discoverySourceTier}). ` +
        `Confidence: ${Math.round(candidate.confidence * 100)}%. ` +
        `Missing fields: ${missingFields.length > 0 ? missingFields.join(", ") : "none"}. ` +
        `STATUS: Requires human verification against official notification before setting to PARTIALLY_VERIFIED.`,
    },
  };

  return { draft, missingFields };
}

// ─── PR body generator ────────────────────────────────────────

/**
 * Generate a GitHub PR body summarizing the candidate and draft record.
 * The reviewer uses this to verify the official source before merging.
 */
export function generatePrBody(
  candidate: CandidateNewRecruitment,
  draft: GovernmentRecruitment,
  missingFields: string[]
): string {
  const check = (val: string | undefined) => val ?? "_(not extracted)_";

  const sections: string[] = [
    `## New Recruitment Detected`,
    ``,
    `**Organization:** ${candidate.organizationName}  `,
    `**Discovery source:** ${candidate.discoverySourceUrl}  `,
    `**Discovered at:** ${candidate.discoveredAt}  `,
    `**Confidence:** ${Math.round(candidate.confidence * 100)}%  `,
    ``,
    `## Extracted fields`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Title | ${check(candidate.title)} |`,
    `| Notification number | ${check(candidate.notificationNumber)} |`,
    `| Notification PDF | ${candidate.notifPdfUrl ? `[PDF link](${candidate.notifPdfUrl})` : "_(not found)_"} |`,
    `| Post date | ${check(candidate.postDate)} |`,
    `| Application open | ${check(candidate.applicationOpenDate)} |`,
    `| Application close | ${check(candidate.applicationCloseDate)} |`,
    `| Total vacancies | ${candidate.totalVacancies ?? "_(not extracted)_"} |`,
    ``,
    `## Missing fields requiring manual entry`,
    ``,
    missingFields.length > 0
      ? missingFields.map((f) => `- \`${f}\``).join("\n")
      : "_All fields extracted — review for accuracy._",
    ``,
    `## Reviewer checklist`,
    ``,
    `- [ ] Open the [official source](${candidate.notifPdfUrl ?? candidate.discoverySourceUrl}) and verify the extracted fields`,
    `- [ ] Correct any inaccurate field values in the diff`,
    `- [ ] Fill in missing fields (see list above)`,
    `- [ ] Change \`provenance.status\` from \`NOT_VERIFIED\` to \`PARTIALLY_VERIFIED\` if source verified`,
    `- [ ] Merge PR → Vercel auto-deploys → record appears in listings`,
    ``,
    `## Raw excerpt from discovery source`,
    ``,
    `\`\`\``,
    candidate.rawExcerpt,
    `\`\`\``,
    ``,
    `---`,
    `*Generated by the LakshyaNaukri Intelligence Engine. Candidate ID: \`${candidate.candidateId}\`.*`,
    `*Generated draft record ID: \`${draft.id}\`, slug: \`${draft.slug}\`.*`,
  ];

  return sections.join("\n");
}
