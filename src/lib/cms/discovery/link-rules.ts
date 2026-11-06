// ═══════════════════════════════════════════════════════════
// Discovery: what a portal link is (Stage 1 corrections)
// ═══════════════════════════════════════════════════════════
//
// Pure. Used by the portal readers when the CMS collector reads a page
// (keepUpdates mode); the older readers' own rules are unchanged. Found on the
// real pages (FreeJobAlert, SarkariResult, GovtJobGuru, IBPS):
//   - SarkariResult names most jobs "… Online Form 2026 | Last Date …", with no
//     older recruitment word: such a link is a job when it also gives a year,
//     a post count or a last date;
//   - "Food Safety Extension Officer" is a post, not a date extension;
//   - menu links ("Admit Card", "SARKARI RESULT®", "HOME RECRUITMENT EXAMS",
//     "IBPS Advertisement") are not leads;
//   - GovtJobGuru's link wraps a whole table row: its title runs on into the
//     post count and the eligibility cells.

import { isNewRecruitmentNotice } from "@/intelligence/discovery";

/** Courses, test series and shop pages: not announcements. */
const NOT_ANNOUNCEMENT = /batch|mock test|test series|course|enrol|enroll|mahapack|live class|ebook|previous year/i;

// An update of a recruitment. "Extension" counts only with a date or deadline: never "Extension Officer".
const UPDATE = new RegExp([
  String.raw`\bextended\b`,
  String.raw`\b(?:date|deadline|application|registration|form)s?\s+extension\b`,
  String.raw`\bextension\s+(?:of|in)\s+(?:the\s+)?(?:last\s+|closing\s+)?(?:date|deadline|application|registration|time)`,
  String.raw`postponed|rescheduled|admit card|hall ticket|call letter|\bresult|answer key|cut ?off|merit list|exam date|exam city|city intimation`,
  String.raw`corrigendum|addendum|\brevised\b|documents?\s+upload|document verification|correction (?:window|form)|edit form|correction\s*/\s*edit|\bre[\s-]?open(?:ed)?\b`,
  String.raw`score\s*card|\bcancell?ed\b|counsell?ing|choice filling`,
].join("|"), "i");

/** Recruitment forms a portal lists without an older recruitment word. */
const FORM = /\b(?:online|offline)\s+form\b|\bapply\s+offline\b|\bwalk[\s-]?in\b/i;
const CONTEXT = /\b20\d{2}\b|\b\d[\d,]*\s+(?:[a-z&.,()/'\- ]{0,50}\s)?posts?\b|last\s+date/i;

/** The link's text decoded and trimmed of a table row's trailing cells. */
export function cleanTitle(text: string): string {
  let t = decodeEntities(text).replace(/\s+/g, " ").trim();
  // "… Apply Online for 400 Posts 400 SDSC SHAR B.E./B.Tech …": the count is repeated where the next cell starts.
  // Cut only there, so "… 6574 Junior Assistant & Other Posts (Last Date Extended)" keeps what follows.
  const m = /^(.*?\b(\d[\d,]*)\s+(?:[^\d]{0,80}?\s)?posts?\)?)\s+\2\b/i.exec(t);
  if (m) t = m[1].trim();
  return t;
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, n) => named[n.toLowerCase()] ?? all);
}

/** A menu or section link: a few generic words with nothing that names one recruitment. */
export function isMenuLink(text: string, href?: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  // Something that names one recruitment: a number, a cycle (XV, 71st) or a code (CRP-SPL-XVI, PO/MT).
  const identifies = /\d/.test(text) || /\b[IVX]{2,5}\b/.test(text) || /\b[A-Z]{2,}[-/][A-Z0-9]/.test(text);
  if (identifies) return false;
  if (words.length <= 4) return true;
  // A section page ("/admitcard/", "/latestjob/") under a short title that names no recruitment.
  if (href && words.length <= 6) {
    try {
      const segs = new URL(href).pathname.split("/").filter(Boolean);
      if (segs.length <= 1 && !/\d/.test(segs[0] ?? "")) return true;
    } catch { /* not an address: the text decides */ }
  }
  return false;
}

export type LinkVerdict = { kind: "NEW" | "UPDATE"; title: string } | { skip: string; title: string };

/** What a portal link is, for the collector: a new recruitment, an update of one, or not a lead (and why). */
export function classifyLink(text: string, href?: string): LinkVerdict {
  const title = cleanTitle(text);
  if (NOT_ANNOUNCEMENT.test(title)) return { skip: "a course, test series or shop page", title };
  if (isMenuLink(title, href)) return { skip: "a menu or section link", title };
  if (UPDATE.test(title)) return { kind: "UPDATE", title };
  if (isNewRecruitmentNotice(title)) return { kind: "NEW", title };
  if (FORM.test(title) && CONTEXT.test(title)) return { kind: "NEW", title };
  return { skip: "no recruitment or update wording", title };
}
