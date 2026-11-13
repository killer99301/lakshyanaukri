// ═══════════════════════════════════════════════════════════
// Exam stage editor: example text that must never be saved as a fact
// ═══════════════════════════════════════════════════════════
//
// NICL AO (12 Nov 2026): the stage editor's example "City slip from 5 Dec" was
// typed into a live job's note and shown to applicants. The boxes now show
// guidance only (no invented dates or bodies), and a value that is exactly one
// of the examples, old or new, with or without "e.g.", is refused by the editor
// and by the server. Pure.

/** Every example the stage boxes have shown (kept, so an old example copied into a note is still caught). */
export const STAGE_EXAMPLE_TEXTS: readonly string[] = [
  // Shown until 13 Nov 2026.
  "City slip from 5 Dec",
  "12–20 Dec 2026, or December 2026",
  "SSC exam calendar, 1 Oct 2026",
  "Tier-I Exam, Skill Test, Document Verification…",
  // The guidance shown from 13 Nov 2026 (STAGE_PLACEHOLDERS below).
  "As the official notice names it",
  "As printed in the notice: a range or a month",
  "Optional: only what the official notice says",
  "Optional: the notice's name and date",
];

/** Guidance in the empty boxes: says what to enter, never a value that could pass for a real one. */
export const STAGE_PLACEHOLDERS = {
  name: "As the official notice names it",
  dateDisplay: "As printed in the notice: a range or a month",
  notes: "Optional: only what the official notice says",
  dateProvenance: "Optional: the notice's name and date",
} as const;

const normal = (s: string) => s.replace(/^\s*(e\.?\s*g\.?|eg|for example)[:,]?\s*/i, "").replace(/[…]|\.{3}/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const EXAMPLES = new Set(STAGE_EXAMPLE_TEXTS.map(normal));

/** True when a value is one of the boxes' examples or guidance, not information from a notice. */
export function isStageExampleText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "" && EXAMPLES.has(normal(value));
}

const FIELD_LABEL: Record<string, string> = { name: "name", dateDisplay: "date as written", notes: "note", dateProvenance: "date source" };

/** The first stage field holding example text, as "the note of stage 2", or null. */
export function exampleTextIn(stages: Array<Record<string, unknown>>): string | null {
  for (let i = 0; i < stages.length; i++) {
    for (const f of Object.keys(FIELD_LABEL)) {
      if (isStageExampleText(stages[i]?.[f])) return `the ${FIELD_LABEL[f]} of stage ${i + 1} (“${String(stages[i][f]).trim()}”) is the editor's example text, not information from the notice`;
    }
  }
  return null;
}
