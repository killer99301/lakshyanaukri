// The excerpts one AI Assist run keeps (see assist-evidence.ts). Pure, so it
// can be tested without a database.

import { randomUUID } from "node:crypto";

export const ASSIST_EVIDENCE_SOURCE = "AI_ASSIST";
const MAX_QUOTE_CHARS = 300;
const MAX_QUOTES_PER_FIELD = 12;

export interface AssistExcerpt {
  id: string;
  fieldPath: string;
  quote: string;
  extractionMethod: "LLM";
  extractedAt: string;
  /** Whether the value went straight into an empty field or was offered for the admin to apply. */
  outcome: "filled" | "suggested";
}

/** The excerpts to keep for one run. Pure. */
export function assistExcerpts(
  quotes: Map<string, string[]>,
  fields: Array<{ fieldPath: string; outcome: "filled" | "suggested" }>,
  at: string,
): AssistExcerpt[] {
  const out: AssistExcerpt[] = [];
  const seen = new Set<string>();
  for (const { fieldPath, outcome } of fields) {
    if (seen.has(fieldPath)) continue;
    seen.add(fieldPath);
    const words = [...new Set((quotes.get(fieldPath) ?? []).map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean))];
    for (const quote of words.slice(0, MAX_QUOTES_PER_FIELD)) {
      out.push({ id: randomUUID(), fieldPath, quote: quote.slice(0, MAX_QUOTE_CHARS), extractionMethod: "LLM", extractedAt: at, outcome });
    }
  }
  return out;
}

