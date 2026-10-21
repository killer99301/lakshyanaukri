// ═══════════════════════════════════════════════════════════
// Evidence: the source's own words behind each AI Assist value
// ═══════════════════════════════════════════════════════════
//
// AI Assist accepts a value only when the model quotes the source and the
// quote is found there word for word. Those quotes used to be thrown away;
// now each run keeps them, so the admin can see why a field says what it
// says before verifying it.
//
//   - One row in recruitment_evidence per AI Assist run, holding the source
//     address and one excerpt per field (fieldPath + quote).
//   - Stored with its own source type, AI_ASSIST, so it can never count as
//     the official source a publish requires.
//   - Never added to a field's evidenceIds: a field with evidence counts as
//     checked, and AI values stay Pending until the admin verifies them.
//   - No page numbers: the PDF reader does not know them, and none is guessed.
//   - Admin-only. Nothing here reaches the public page.
//   - Saving evidence can never fail the AI Assist run it belongs to.

import { sql } from "@/lib/db";
import { ASSIST_EVIDENCE_SOURCE, assistExcerpts } from "@/lib/cms/assist-excerpts";

export { ASSIST_EVIDENCE_SOURCE, assistExcerpts };

export async function saveAssistEvidence(opts: {
  recruitmentId: string;
  url: string;
  /** How the source reached us, as shown in the change history ("… (PDF uploaded by admin)"). */
  label: string;
  quotes: Map<string, string[]>;
  fields: Array<{ fieldPath: string; outcome: "filled" | "suggested" }>;
}): Promise<number> {
  try {
    const at = new Date().toISOString();
    const excerpts = assistExcerpts(opts.quotes, opts.fields, at);
    if (excerpts.length === 0) return 0;
    await sql`
      INSERT INTO recruitment_evidence (recruitment_id, url, title, source_type, authority_rank, fetched_at, excerpts)
      VALUES (${opts.recruitmentId}, ${opts.url}, ${opts.label.slice(0, 500)}, ${ASSIST_EVIDENCE_SOURCE}, 5, ${at}, ${JSON.stringify(excerpts)})
    `;
    return excerpts.length;
  } catch (err) {
    console.error("[CMS] AI Assist evidence not saved:", err instanceof Error ? err.message : "error");
    return 0;
  }
}

export interface EvidenceRow {
  id: string;
  url: string;
  title: string | null;
  sourceType: string;
  fetchedAt: string;
  excerpts: Array<{ fieldPath?: string; quote?: string; outcome?: string } | string>;
}

export async function listEvidence(recruitmentId: string): Promise<EvidenceRow[]> {
  const rows = await sql`
    SELECT id, url, title, source_type, fetched_at, excerpts
    FROM recruitment_evidence
    WHERE recruitment_id = ${recruitmentId}
    ORDER BY fetched_at DESC, created_at DESC
    LIMIT 50
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    url: String(r.url),
    title: (r.title as string | null) ?? null,
    sourceType: String(r.source_type),
    fetchedAt: new Date(r.fetched_at as string).toISOString(),
    excerpts: (typeof r.excerpts === "string" ? JSON.parse(r.excerpts) : r.excerpts) as EvidenceRow["excerpts"],
  }));
}
