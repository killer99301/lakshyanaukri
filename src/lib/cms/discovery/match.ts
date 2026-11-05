// ═══════════════════════════════════════════════════════════
// Discovery: which CMS job a lead may be (N2)
// ═══════════════════════════════════════════════════════════
//
// Pure. Compared with the CMS's own recruitments (never the retired static
// dataset). Reasons are kept so the admin sees why:
//   DUPLICATE  the same notice number as a job of the same organisation
//   STRONG     the same notice number with the organisation not recognised, or
//              the same organisation and year with titles that agree
//   POSSIBLE   titles that agree without the organisation confirming it, or the
//              same notice number under another organisation: for review
//   NONE       no job like it; UNRESOLVED when the organisation is not recognised
// A title alone never makes a DUPLICATE or STRONG match.

import { similarJobs } from "@/lib/cms/importer/discover";

export type MatchKind = "DUPLICATE" | "STRONG" | "POSSIBLE" | "NONE" | "UNRESOLVED";

export interface CmsJob { id: string; organizationId: string; title: string; notificationNumber: string | null; year: number | null }
export interface LeadForMatch { organizationId: string | null; title: string; notificationNumber: string | null }
export interface MatchCandidate { id: string; title: string; kind: Exclude<MatchKind, "NONE" | "UNRESOLVED">; reason: string }
export interface LeadMatch { kind: MatchKind; recruitmentId: string | null; reason: string | null; confidence: number | null; candidates: MatchCandidate[] }

const RANK: Record<MatchCandidate["kind"], number> = { DUPLICATE: 3, STRONG: 2, POSSIBLE: 1 };
const CONFIDENCE: Record<MatchCandidate["kind"], number> = { DUPLICATE: 0.95, STRONG: 0.75, POSSIBLE: 0.4 };

import { noticeKey } from "@/lib/cms/discovery/notice";
export { noticeKey };

export function matchLead(lead: LeadForMatch, jobs: CmsJob[]): LeadMatch {
  const key = noticeKey(lead.notificationNumber);
  const year = /\b20\d{2}\b/.exec(lead.title)?.[0];
  const candidates: MatchCandidate[] = [];
  for (const job of jobs) {
    const sameOrg = !!lead.organizationId && job.organizationId === lead.organizationId;
    const jobKey = noticeKey(job.notificationNumber);
    if (key && jobKey === key) {
      candidates.push(sameOrg
        ? { id: job.id, title: job.title, kind: "DUPLICATE", reason: `same notice number (${job.notificationNumber}) as this job` }
        : lead.organizationId
          ? { id: job.id, title: job.title, kind: "POSSIBLE", reason: `same notice number (${job.notificationNumber}), but this job is another organisation's` }
          : { id: job.id, title: job.title, kind: "STRONG", reason: `same notice number (${job.notificationNumber}); the lead's organisation was not recognised` });
      continue;
    }
    // The job's year counts when its title leaves it out.
    const jobTitle = job.year && year && !job.title.includes(year) && String(job.year) === year ? `${job.title} ${job.year}` : job.title;
    if (similarJobs(lead.title, [{ id: job.id, title: jobTitle }]).length === 0) continue;
    candidates.push(sameOrg && year
      ? { id: job.id, title: job.title, kind: "STRONG", reason: `same organisation and year (${year}), and the titles agree` }
      : { id: job.id, title: job.title, kind: "POSSIBLE", reason: lead.organizationId ? (sameOrg ? "same organisation and the titles agree, but no year to confirm it" : "the titles agree, but this job is another organisation's") : "the titles agree; the lead's organisation was not recognised" });
  }
  candidates.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  const top = candidates.slice(0, 5);
  const best = top[0];
  if (!best) return { kind: lead.organizationId ? "NONE" : "UNRESOLVED", recruitmentId: null, reason: lead.organizationId ? null : "organisation not recognised; no CMS job like it", confidence: null, candidates: [] };
  // Two different jobs both "strong" or both "duplicate": none is chosen, the admin decides.
  const tied = top.filter((c) => c.kind === best.kind && c.id !== best.id);
  if (tied.length > 0 && best.kind !== "POSSIBLE") {
    return { kind: "POSSIBLE", recruitmentId: null, reason: `${tied.length + 1} CMS jobs match as well as each other — choose the right one`, confidence: CONFIDENCE.POSSIBLE, candidates: top };
  }
  // A possible match names its job too, for the admin to confirm or reject; it is never treated as the job.
  const possibles = top.filter((c) => c.kind === "POSSIBLE");
  if (best.kind === "POSSIBLE" && possibles.length > 1) {
    return { kind: "POSSIBLE", recruitmentId: null, reason: `${possibles.length} CMS jobs may be this one — choose the right one`, confidence: CONFIDENCE.POSSIBLE, candidates: top };
  }
  return { kind: best.kind, recruitmentId: best.id, reason: best.reason, confidence: CONFIDENCE[best.kind], candidates: top };
}
