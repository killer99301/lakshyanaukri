// ═══════════════════════════════════════════════════════════
// Importer: links found in a source
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe. Tracking parameters are removed without changing
// where a link goes; blog, post and portal addresses are flagged; a link is
// proposed as official only when its host is listed for the organisation.

import type { RecruitmentLinkType } from "@/types/recruitment-record";
import { guessLinkType } from "@/lib/cms/link-guess";
import { hostOf, originFor } from "@/lib/cms/importer/trusted-domains";

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|_ga)$/i;

/** The same address without tracking parameters; null when it is not an http(s) address. */
export function cleanUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Only tracking parameters go; the rest, including any #fragment (some
  // sites route their pages through it), is kept exactly as written.
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.toString();
}

/** Recruitment portals and coaching sites: never an official source. */
const PORTALS = /(^|\.)(bankersadda\.com|adda247\.com|govtjobguru\.in|careerpower\.in|freejobalert\.com|sarkariresult\.com|sarkariexam\.com|testbook\.com|jagranjosh\.com|naukri\.com|shiksha\.com|indiatoday\.in|ndtv\.com|timesofindia\.indiatimes\.com|chatgpt\.com|openai\.com)$/i;

function hadTracking(raw: string): boolean {
  try { return [...new URL(raw.trim()).searchParams.keys()].some((k) => TRACKING.test(k)); } catch { return false; }
}

// Help files that sit next to real notices as PDFs.
const HELP_FILE = /manual|user[-_ ]?guide|help|faq|instruction/i;

export function linkFlags(url: string, raw: string): string[] {
  const flags: string[] = [];
  const host = hostOf(url) ?? "";
  if (hadTracking(raw)) flags.push("tracking removed");
  if (PORTALS.test(host)) flags.push("portal or news site, not the recruiting body");
  if (/\/(blog|blog2|news|post|posts)\//i.test(url) || /post\.php|[?&]slug=/i.test(url)) flags.push("looks like a blog or article, not an apply page");
  return flags;
}

export interface FoundLink {
  type: RecruitmentLinkType;
  label: string;
  url: string;
  official: boolean;
  flags: string[];
  /** The words around the address in the source, for the preview. */
  context: string;
}

const LABEL: Record<string, string> = {
  APPLY_ONLINE: "Apply Online", OFFICIAL_NOTIFICATION: "Official Notification", OFFICIAL_WEBSITE: "Official Website",
  ADMIT_CARD: "Admit Card", RESULT: "Result", ANSWER_KEY: "Answer Key", CORRIGENDUM: "Corrigendum", EXAM_NOTICE: "Exam Notice", OTHER: "Link",
};

/** Every http(s) address in the text, cleaned, typed and judged, one per address. */
export function linksInText(text: string, organizationId: string): FoundLink[] {
  const out = new Map<string, FoundLink>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const raw = m[0].replace(/[.,;:]+$/, "");
    const url = cleanUrl(raw);
    if (!url || out.has(url)) continue;
    const origin = originFor(organizationId, hostOf(url));
    const flags = linkFlags(url, raw);
    let type = guessLinkType(url) ?? (origin.role === "AUTHORITY" && new URL(url).pathname.length <= 1 ? "OFFICIAL_WEBSITE" : "OTHER");
    // A partner's site (the apprenticeship or exam portal) is neither the
    // notification nor the body's website; a partner trusted for applications
    // is where candidates apply. A help file is never the notification:
    // portals keep user manuals as PDFs.
    if (origin.role === "PARTNER" && (type === "OFFICIAL_NOTIFICATION" || type === "OFFICIAL_WEBSITE" || type === "OTHER")) {
      type = origin.purposes.includes("application") && !HELP_FILE.test(new URL(url).pathname) ? "APPLY_ONLINE" : "OTHER";
    }
    if (type === "OFFICIAL_NOTIFICATION" && HELP_FILE.test(new URL(url).pathname)) type = "OTHER";
    const at = m.index ?? 0;
    out.set(url, {
      type,
      label: LABEL[type] ?? "Link",
      url,
      official: (origin.role === "AUTHORITY" || origin.role === "PARTNER") && flags.every((f) => f === "tracking removed"),
      flags,
      context: text.slice(Math.max(0, at - 80), at + raw.length + 40).replace(/\s+/g, " ").trim(),
    });
  }
  return [...out.values()];
}

/**
 * The notice's own address, offered as its notification (or corrigendum)
 * link: the strongest evidence there is for that link. Null for research,
 * for other kinds of source, and when the address is not known.
 */
export function sourceOwnLink(address: string | null | undefined, declaredKind: string, organizationId: string): FoundLink | null {
  const type = declaredKind === "OFFICIAL_NOTIFICATION" ? "OFFICIAL_NOTIFICATION" : declaredKind === "OFFICIAL_CORRIGENDUM" ? "CORRIGENDUM" : null;
  const url = type && address ? cleanUrl(address) : null;
  if (!type || !url) return null;
  const origin = originFor(organizationId, hostOf(url));
  const flags = linkFlags(url, address!);
  return {
    type, label: LABEL[type], url,
    official: (origin.role === "AUTHORITY" || origin.role === "PARTNER") && flags.every((f) => f === "tracking removed"),
    flags, context: "The address this document came from",
  };
}
