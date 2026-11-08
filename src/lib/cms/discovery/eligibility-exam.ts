// ═══════════════════════════════════════════════════════════
// Discovery: standalone eligibility exams (G1)
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe (the inbox uses it). Given a lead's cleaned title
// (link-rules cleanTitle: a GovtJobGuru row's eligibility cells, which often
// say "NET/SET", are cut off first).

// A standalone eligibility test (UGC NET, CSIR NET, CTET, a state TET or SET, GATE, SLET) qualifies a candidate;
// it recruits no one. Its lead is kept as found, said to be an eligibility exam, never dismissed. A recruitment
// that only asks for one ("PGT Recruitment 2026 – CTET Qualified", "NTPC Executive Trainee through GATE 2026",
// "Assistant Professor 120 Posts (NET/SET)") is still a recruitment: any recruitment or post wording wins.
// Upper-case names only (TET, SET, NET, GATE), so "set", "net" and "gate" in ordinary words never count.
const ELIGIBILITY_EXAM = new RegExp([
  String.raw`\b(?:UGC|CSIR|ICAR)[\s-]*(?:UGC[\s-]*)?NET\b`,
  String.raw`\bNET\s*(?:JRF|/\s*JRF)\b`,
  String.raw`\b[A-Z]{0,4}TET\b`,
  String.raw`\b[A-Z]{1,5}[\s-]?SET\b`,
  String.raw`\bSLET\b`,
  String.raw`\bGATE\b`,
].join("|"));
const ELIGIBILITY_WORDS = /\b(?:teacher|state|national)\s+eligibility\s+test\b/i;
// "Super TET" in Uttar Pradesh is the assistant-teacher recruitment exam itself, not an eligibility test.
const NOT_ELIGIBILITY_EXAM = /\bsuper\s*tet\b/i;
const RECRUITS = /recruit|vacanc|\bbharti\b|\bposts?\b|\bjobs?\b|\bappointment\b|\bthrough\s+(?:GATE|NET|CTET)\b|\b(?:PGT|TGT|PRT|lecturer|assistant\s+professor|teacher\s+recruitment|executive\s+trainee|management\s+trainee)\b/i;

/** Whether a lead's title announces a standalone eligibility exam rather than a recruitment. */
export function isEligibilityExam(title: string): boolean {
  const t = title.replace(/\s+/g, " ").trim();
  if (!(ELIGIBILITY_EXAM.test(t) || ELIGIBILITY_WORDS.test(t)) || NOT_ELIGIBILITY_EXAM.test(t)) return false;
  return !RECRUITS.test(t);
}

