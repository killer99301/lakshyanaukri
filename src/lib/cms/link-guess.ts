// ═══════════════════════════════════════════════════════════
// What kind of link an address probably is
// ═══════════════════════════════════════════════════════════
//
// Pure. When an address is pasted into the Links form, its type is guessed
// from the address itself ("…/admit-card…" is an admit card, a PDF is most
// often the notification), so the admin rarely has to change the drop-down.
// Only a guess: the drop-down stays as the admin sets it once they touch it.
//
// Whether a link is official is never guessed. The tick says the admin has
// checked the address is the recruiting body's own website; a government
// domain is only mentioned as a hint.

import type { RecruitmentLinkType } from "@/types/recruitment-record";

const RULES: Array<[RegExp, RecruitmentLinkType]> = [
  [/corrigend|addend|amendment|errata/i, "CORRIGENDUM"],
  [/admit[-_ ]?card|hall[-_ ]?ticket|call[-_ ]?letter|e[-_]?admit/i, "ADMIT_CARD"],
  [/answer[-_ ]?key|anskey|response[-_ ]?sheet/i, "ANSWER_KEY"],
  [/cut[-_ ]?off/i, "CUT_OFF"],
  [/result|merit[-_ ]?list|select(ed|ion)[-_ ]?list|score[-_ ]?card/i, "RESULT"],
  [/exam[-_ ]?(date|schedule|notice|city)|schedule[-_ ]?of[-_ ]?exam|city[-_ ]?intimation/i, "EXAM_NOTICE"],
  [/apply|registration|register|candidate[-_ ]?login|online[-_ ]?form|recruitment[-_ ]?portal|\/login/i, "APPLY_ONLINE"],
  [/notification|advert|advt|notice|\.pdf(\?|#|$)/i, "OFFICIAL_NOTIFICATION"],
];

export function guessLinkType(url: string): RecruitmentLinkType | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const raw = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  let where = raw;
  try { where = decodeURIComponent(raw); } catch { /* a stray % sign: read it as written */ }
  for (const [pattern, type] of RULES) if (pattern.test(where)) return type;
  // A bare domain, or its home page, is the body's website.
  if ((parsed.pathname === "/" || parsed.pathname === "") && !parsed.search && !parsed.hash) return "OFFICIAL_WEBSITE";
  return null;
}

/** True for addresses on an Indian government domain: a hint for the admin, never a tick. */
export function onGovernmentDomain(url: string): boolean {
  try {
    return /(^|\.)(gov\.in|nic\.in|gov)$/i.test(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}
