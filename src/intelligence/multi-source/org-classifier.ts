// ═══════════════════════════════════════════════════════════
// Phase 9A: Org Keyword Classifier (shared across adapters)
// ═══════════════════════════════════════════════════════════
//
// Maps free-text titles/descriptions to orgIds.
// Short keywords (<=4 chars) use \b word boundary matching to
// prevent false positives such as "lic" matching "police".

const ORG_KEYWORDS: Record<string, string[]> = {
  ibps:      ["ibps", "institute of banking personnel"],
  sbi:       ["sbi", "state bank of india", "state bank"],
  rbi:       ["rbi", "reserve bank of india"],
  ssc:       ["ssc", "staff selection commission", "combined graduate level"],
  rrb:       ["rrb", "railway recruitment", "indian railways", "rrc", "ntpc group d"],
  upsc:      ["upsc", "union public service", "civil services"],
  bpsc:      ["bpsc", "bihar public service"],
  lic:       ["lic", "life insurance corporation"],
  nabard:    ["nabard", "national bank for agriculture"],
  indiapost: ["india post", "department of posts", "postal"],
};

function wordBoundaryTest(keyword: string, text: string): boolean {
  if (keyword.length <= 4) {
    return new RegExp(`\\b${keyword}\\b`, "i").test(text);
  }
  return text.includes(keyword);
}

export function detectOrgFromText(text: string, orgFilter?: string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const [orgId, keywords] of Object.entries(ORG_KEYWORDS)) {
    if (orgFilter && !orgFilter.includes(orgId)) continue;
    if (keywords.some((kw) => wordBoundaryTest(kw, lower))) return orgId;
  }
  return undefined;
}
