// New Jobs Found (N3): how a lead is described in the inbox. Pure and client-safe.
//
// A lead is research. Its label says what the collector worked out about it,
// never that it is official or verified; anything uncertain is said, not hidden.

import type { Lead } from "@/lib/cms/discovery/repository";

export type Tone = "green" | "amber" | "red" | "muted" | "accent";

/** A link from a lead, only when it is a plain web address; anything else is shown as text. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

export function classify(lead: Lead): { label: string; tone: Tone } {
  if (lead.kind === "UPDATE") return { label: lead.match.recruitmentId && lead.match.kind !== "POSSIBLE" ? "Update of a CMS job" : "Possible update", tone: "amber" };
  switch (lead.match.kind) {
    case "DUPLICATE": return { label: "Duplicate of a CMS job", tone: "muted" };
    case "STRONG": return { label: "Strong match to a CMS job", tone: "accent" };
    case "POSSIBLE": return { label: "Possible match — choose the job", tone: "amber" };
    case "UNRESOLVED": return { label: "New job · organisation not recognised", tone: "amber" };
    default: return { label: "New job", tone: "green" };
  }
}

/** What needs the admin's eye on this lead. */
export function attention(lead: Lead): string[] {
  const out: string[] = [];
  if (!lead.organizationId) out.push("The organisation was not recognised: check who is recruiting.");
  if (lead.match.kind === "POSSIBLE") out.push(lead.match.reason ? `Possible match: ${lead.match.reason}.` : "It may be a job already in the CMS.");
  if (lead.relatedLeads.length) out.push(`${lead.relatedLeads.length} other lead${lead.relatedLeads.length === 1 ? "" : "s"} may be the same recruitment (titles alike, not merged).`);
  if (!lead.notificationNumber) out.push("No notice number was printed with it.");
  if (lead.sources.every((s) => !s.official)) out.push("Seen only on portals: research, to be checked against the official notice.");
  else out.push("One link is on an official site; that is where to look, not a check of anything.");
  return out;
}

export const STATUS_LABEL: Record<Lead["status"], string> = {
  NEW: "New", PROCESSING: "Processing", READY_FOR_REVIEW: "Ready for review", NEEDS_SOURCE: "Needs source",
  NEEDS_CORRECTION: "Needs correction", DUPLICATE: "Duplicate", DISMISSED: "Dismissed",
};

/** An update lead and the CMS job it is tied to: matched (by notice number, or organisation, year and title), possible (only the admin can confirm it), or none. */
export type UpdateTie = "MATCHED" | "POSSIBLE" | "NONE";
export function tieOf(lead: Lead): UpdateTie {
  if (lead.match.recruitmentId && (lead.match.kind === "DUPLICATE" || lead.match.kind === "STRONG")) return "MATCHED";
  return lead.match.kind === "POSSIBLE" && lead.match.candidates.length > 0 ? "POSSIBLE" : "NONE";
}

/** What kind of update a lead's title announces; "Update" when its words name none of these. */
export function updateType(title: string): string {
  const t = title.toLowerCase();
  if (/corrigendum|addendum|revised|revision/.test(t)) return "Corrigendum";
  if (/extend|extension|last date/.test(t)) return "Date extended";
  if (/postpone|reschedul/.test(t)) return "Postponed or rescheduled";
  if (/admit card|hall ticket|call letter/.test(t)) return "Admit card";
  if (/city intimation|exam city/.test(t)) return "Exam city";
  if (/answer key/.test(t)) return "Answer key";
  if (/cut ?off|merit list/.test(t)) return "Cut-off or merit list";
  if (/result/.test(t)) return "Result";
  if (/exam date|schedule/.test(t)) return "Exam date";
  return "Update";
}

/** The job editor's Check for updates panel (it runs only when the admin presses Check there). */
export const checkUpdatesHref = (recordId: string) => `/admin/cms/${recordId}#check-updates`;

/** A notice number without its label, for Smart intake's notice-number field: "Advt No. 05/2026" → "05/2026". */
export function bareNotice(n: string | null | undefined): string {
  return (n ?? "").trim().replace(/^(?:(?:advt|advertisement|notification|notice|employment notice)\.?\s*)?(?:no|number)\.?\s*[:.\-]?\s*/i, "");
}

/** Smart intake with the lead's sources as research; into a CMS job only when the admin chose that job. */
export function intakeHref(lead: Lead, recordId?: string): string {
  const q = new URLSearchParams({ lead: lead.id });
  if (recordId) q.set("record", recordId);
  return `/admin/cms/import?${q.toString()}`;
}

/** The research sources Smart intake starts with: each distinct link (its PDF when it has one), at most four. */
export const MAX_HANDOFF_SOURCES = 4;
export function handoffUrls(lead: Lead): string[] {
  const urls: string[] = [];
  for (const s of lead.sources) {
    for (const u of [s.pdfUrl, s.itemUrl]) {
      const href = safeHref(u);
      if (href && !urls.includes(href)) { urls.push(href); break; }
    }
  }
  return urls;
}
