// The new job's details when a found job or a New Jobs Found lead is handed to Smart intake. Built fresh each time:
// nothing from the job that was there before carries over. Only what the lead reliably says comes in; anything it does
// not say is left empty for the admin to fill (never guessed).
import { ORG_GOV_TYPE, ORG_NAMES } from "@/intelligence/org-registry";
import { bareNotice } from "../discovery/lead-view";

export type GovChoice = "" | "Central Govt" | "State Govt" | "PSU";
export interface NewJobDraft {
  organizationId: string; organizationName: string; recruitmentYear: string; title: string; govType: GovChoice; notificationNumber: string;
}
export interface HandoffInput { title: string; organizationId?: string | null; organizationName?: string | null; notificationNumber?: string | null }

/** An empty new job: only the year starts filled (this year); the government type must be chosen. */
export function emptyNewJob(now = new Date()): NewJobDraft {
  return { organizationId: "", organizationName: "", recruitmentYear: String(now.getFullYear()), title: "", govType: "", notificationNumber: "" };
}

/**
 * The portal's title as a job title, its original kept by the caller in the source itself:
 * "RRB NTPC Recruitment 2026 Notification Out For 8850 Posts, Apply Online | Last Date 30 Nov 2026" → "RRB NTPC Recruitment 2026".
 */
export function cleanLeadTitle(title: string): string {
  const t = title
    .replace(/\s*[|–—-]\s*(?:last|closing|end)\s+date\b.*$/i, "")
    .replace(/\s*[|]\s*(?:apply|register)\b.*$/i, "")
    .replace(/\s+(?:notification\s+)?out\b.*$/i, "")
    .replace(/,.*$/, "")
    .replace(/\s*[|–—-]\s*$/, "")
    .trim();
  return (t || title.trim()).slice(0, 160);
}

/** The year the title names (2000–2099), when it names exactly one; otherwise this year. */
function yearOf(title: string, now: Date): string {
  const years = [...new Set(title.match(/\b20\d{2}\b/g) ?? [])];
  return years.length === 1 ? years[0] : String(now.getFullYear());
}

function govOf(orgId: string): GovChoice {
  const t = ORG_GOV_TYPE[orgId];
  return t === "PSU Bank" ? "PSU" : t ?? "";
}

export function handoffJob(lead: HandoffInput, now = new Date()): NewJobDraft {
  const orgId = (lead.organizationId ?? "").trim().toLowerCase();
  return {
    title: cleanLeadTitle(lead.title),
    organizationId: orgId,
    organizationName: (lead.organizationName ?? "").trim() || (orgId ? ORG_NAMES[orgId] ?? "" : ""),
    recruitmentYear: yearOf(lead.title, now),
    govType: orgId ? govOf(orgId) : "",
    notificationNumber: lead.notificationNumber ? bareNotice(lead.notificationNumber) : "",
  };
}
