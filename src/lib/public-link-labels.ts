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

/**
 * Application pages run by another body, each checked on the recruiting body's own site for one recruitment: the
 * exact registration path, never its whole host. A listed page is "Apply Online" with where applications are
 * taken; it is never called the body's own site, and the trusted-domains registry is not changed by it.
 */
export const VERIFIED_APPLICATION_PAGES: Array<{ organizationId: string; url: string; checked: string }> = [
  // SBI Assistant Manager (Engineer – Fire), CRPD/SCO/2026-27/29: SBI's careers page (sbi.bank.in) links to this
  // IBPS-run registration page. Checked by the owner, 10 Nov 2026. Other IBPS registration pages are not covered.
  { organizationId: "sbi", url: "https://ibpsreg.ibps.in/sbiameoct26/", checked: "2026-11-10" },
];

/** The listed page this link opens: the same host and the page's path or a page under it (no other host, no near path). */
function verifiedApplicationPage(organizationId: string | undefined, url: string | undefined | null) {
  if (!organizationId || !url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  return VERIFIED_APPLICATION_PAGES.find((p) => {
    if (p.organizationId !== organizationId) return false;
    const listed = new URL(p.url);
    const path = listed.pathname.endsWith("/") ? listed.pathname : `${listed.pathname}/`;
    const asked = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return u.host.toLowerCase() === listed.host && asked.startsWith(path);
  }) ?? null;
}

export function publicLinkWords(organizationId: string | undefined, url: string | undefined | null, kind: PublicLinkKind): PublicLinkWords {
  const host = hostOf(url ?? null);
  if (isAggregatorHost(host)) return { label: "Other link", official: false, asApply: false, host };
  const origin = originFor(organizationId ?? "", host);
  if (origin.role === "AUTHORITY") return { label: OFFICIAL[kind], official: true, asApply: kind === "apply", host };
  if (kind === "apply" && origin.role === "PARTNER" && (origin.purposes.includes("application") || origin.purposes.includes("all"))) {
    return { label: "Apply Online", official: false, asApply: true, note: `Applications are taken on ${host}`, host };
  }
  if (kind === "apply" && verifiedApplicationPage(organizationId, url)) {
    return { label: "Apply Online", official: false, asApply: true, note: `Applications are taken on ${host}`, host };
  }
  return { label: BY_KIND[kind], official: false, asApply: kind === "apply", host };
}

/** Shown where a job has no notification link (D5). */
export const NO_NOTICE_ADVICE = "Check the recruiting body's official notice before applying.";
