// ═══════════════════════════════════════════════════════════
// Selection stages and recruitment milestones
// ═══════════════════════════════════════════════════════════
//
// A notice's schedule mixes the steps that select candidates (examinations,
// interviews, skill tests) with announcements around them (call letters,
// results, pre-exam training). Both are kept; the class says which is which.
// The "next exam" line counts selection stages only; milestones stay on the
// dates list and the timeline.
//
// Classified by code from the stage's printed name, never by the AI. A name
// that matches no rule is UNCLASSIFIED: flagged for the admin, not guessed.
// A stored stage with no kind is a selection stage, as before.

import type { ExamStage, ExamStageKind } from "@/types";

export const EXAM_STAGE_KINDS: readonly ExamStageKind[] = ["SELECTION", "ADMIT_CARD", "RESULT", "TRAINING", "DOCUMENT", "OTHER_MILESTONE", "UNCLASSIFIED"];

export const STAGE_KIND_LABEL: Record<ExamStageKind, string> = {
  SELECTION: "Selection stage",
  ADMIT_CARD: "Admit card / call letter",
  RESULT: "Result",
  TRAINING: "Training",
  DOCUMENT: "Documents",
  OTHER_MILESTONE: "Other announcement",
  UNCLASSIFIED: "Not classified",
};

// Milestones are tried first: "Download of call letters for the online
// examination" and "Result of the preliminary examination" name an exam, but
// are not one. "PET" alone is left unclassified: pre-exam training in banking
// notices, physical efficiency test in police ones.
const RULES: Array<[ExamStageKind, RegExp]> = [
  ["TRAINING", /\bpre[\s-]*(?:exam(?:ination)?|recruitment)\s+training\b|\btraining\b|\bapprenticeship\s+(?:start|commencement|begins?)\b/i],
  ["ADMIT_CARD", /\bcall\s*letters?\b|\badmit\s*cards?\b|\bhall\s*tickets?\b|\be-?admit\b|\bcity\s+(?:intimation\s+)?slip\b|\bexam(?:ination)?\s+city\b/i],
  ["RESULT", /\bresults?\b|\bmerit\s+list\b|\bscore\s*cards?\b|\bscores?\s+(?:of|for)\b|\bselect\s+list\b|\bcut[\s-]?off\s+marks\b/i],
  // "Document verification" is a selection stage; sending documents or certificates is not.
  ["DOCUMENT", /\b(?:documents?|certificates?)\b(?!\s+verification)/i],
  ["OTHER_MILESTONE", /\banswer\s+keys?\b|\bprovisional\s+allotment\b|\ballotment\b|\bjoining\b|\b(?:appointment|engagement|offer)\s+letters?\b|\bcommencement\b|\bobjections?\b|\boption\s+entry\b|\bregistration\b|\bapplications?\b|\bapply\b|\bfees?\b|\bpayment\b|\bnotification\b|\badvertisement\b/i],
  ["SELECTION", /\bexam(?:ination)?s?\b|\btests?\b|\binterviews?\b|\bcbt\b|\btier[\s-]*(?:[ivx]+|\d+)\b|\bpapers?\b|\bphase\b|\bprelim(?:inary|s)?\b|\bmains?\b|\bskill\b|\bphysical\b|\bmedical\b|\bverification\b|\bviva\b|\btyping\b|\bstenography\b|\bgroup\s+discussion\b|\bpersonality\b|\bwalk[\s-]*in\b|\bassessment\b|\btrade\s+test\b|\bdv\b/i],
];

/** The class of a stage from its printed name; UNCLASSIFIED when no rule says. */
export function classifyStageName(name: string): ExamStageKind {
  for (const [kind, re] of RULES) if (re.test(name)) return kind;
  return "UNCLASSIFIED";
}

/** A selection stage, for the "next exam" line. A stored stage without a class is one, as before. */
export const isSelectionStage = (s: Pick<ExamStage, "kind">): boolean => !s.kind || s.kind === "SELECTION" || s.kind === "UNCLASSIFIED";

/** Anything but a selection stage: shown among the other announcements. */
export const isMilestone = (s: Pick<ExamStage, "kind">): boolean => !isSelectionStage(s);

/**
 * The public dates list: selection stages, then the other announcements, each
 * group in the notice's order. Without any milestone it is one untitled group,
 * so older records render exactly as before.
 */
export function stageGroups<S extends Pick<ExamStage, "kind" | "order">>(stages: S[]): Array<{ title: string | null; stages: S[] }> {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const milestones = ordered.filter(isMilestone);
  if (milestones.length === 0) return [{ title: null, stages }];
  return [
    { title: "Selection stages", stages: ordered.filter(isSelectionStage) },
    { title: "Other announcements", stages: milestones },
  ].filter((g) => g.stages.length > 0);
}
