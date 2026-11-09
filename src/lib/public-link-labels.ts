// ═══════════════════════════════════════════════════════════
// Public link labels (owner-controlled publication, design rev. 3, §1.3)
// ═══════════════════════════════════════════════════════════
//
// A public link is called "official" only when its host is listed for the
// job's organisation in the code-reviewed registry (trusted-domains.ts,
// subdomains included). A listed application partner is "Apply Online" with
// the words "Applications are taken on <host>", never presented as the body's
// own site. Anything else is named by kind only. A job-news or aggregator site
// is never an Apply destination: it can only be "Other link".
//
// Worked out when the page is rendered, from the job's links and its
// organisation, so an existing published page takes these words at the next
// build without being published again. Pure: no database, no network.

import { hostOf, originFor } from "@/lib/cms/importer/trusted-domains";
import { PORTALS } from "@/lib/cms/importer/links";
import { KNOWN_AGGREGATORS } from "@/intelligence/org-registry";

/** A job-news site or aggregator: never an Apply Online destination (P2). */
export function isAggregatorHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  if (PORTALS.test(h)) return true;
  return Object.keys(KNOWN_AGGREGATORS).some((d) => h === d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`));
}

export type PublicLinkKind = "notification" | "website" | "apply";

export interface PublicLinkWords {
  /** The words on the button or link. */
  label: string;
  /** The host is the recruiting body's own (AUTHORITY for this organisation). */
  official: boolean;
  /** May be shown as the Apply Online button. False for an aggregator, always. */
  asApply: boolean;
  /** A line under an application partner's button: where applications are taken. */
  note?: string;
  host: string | null;
}

const BY_KIND: Record<PublicLinkKind, string> = { notification: "Notification link", website: "Website link", apply: "Application link" };
const OFFICIAL: Record<PublicLinkKind, string> = { notification: "Notification", website: "Official Website", apply: "Apply Online" };

export function publicLinkWords(organizationId: string | undefined, url: string | undefined | null, kind: PublicLinkKind): PublicLinkWords {
  const host = hostOf(url ?? null);
  if (isAggregatorHost(host)) return { label: "Other link", official: false, asApply: false, host };
  const origin = originFor(organizationId ?? "", host);
  if (origin.role === "AUTHORITY") return { label: OFFICIAL[kind], official: true, asApply: kind === "apply", host };
  if (kind === "apply" && origin.role === "PARTNER" && (origin.purposes.includes("application") || origin.purposes.includes("all"))) {
    return { label: "Apply Online", official: false, asApply: true, note: `Applications are taken on ${host}`, host };
  }
  return { label: BY_KIND[kind], official: false, asApply: kind === "apply", host };
}

/** Shown where a job has no notification link (D5). */
export const NO_NOTICE_ADVICE = "Check the recruiting body's official notice before applying.";
