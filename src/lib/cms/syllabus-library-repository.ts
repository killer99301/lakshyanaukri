// ═══════════════════════════════════════════════════════════
// Syllabus library — database operations
// ═══════════════════════════════════════════════════════════
//
// Callers: API routes only. The checks live in syllabus-library.ts.

import { sql } from "@/lib/db";
import { examKey, readLibraryFile, type LibraryEntrySummary } from "@/lib/cms/syllabus-library";

interface Row {
  id: string;
  exam: string;
  match_terms: unknown;
  basis: string | null;
  content?: string;
  updated_at: string | Date;
}

function summary(row: Row): LibraryEntrySummary {
  const match = typeof row.match_terms === "string" ? JSON.parse(row.match_terms) : row.match_terms;
  return {
    id: row.id,
    exam: row.exam,
    match: Array.isArray(match) ? (match as string[]) : [],
    ...(row.basis ? { basis: row.basis } : {}),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listLibrary(): Promise<LibraryEntrySummary[]> {
  const rows = await sql`SELECT id, exam, match_terms, basis, updated_at FROM syllabus_library ORDER BY exam`;
  return (rows as Row[]).map(summary);
}

export async function getLibraryEntry(id: string): Promise<(LibraryEntrySummary & { content: string }) | null> {
  const rows = await sql`SELECT id, exam, match_terms, basis, content, updated_at FROM syllabus_library WHERE id = ${id}`;
  const row = (rows as Row[])[0];
  return row ? { ...summary(row), content: row.content ?? "" } : null;
}

/** Adds the file, or replaces the entry already kept for the same exam. */
export async function saveLibraryFile(text: string, adminId: string): Promise<{ entry: LibraryEntrySummary; replaced: boolean }> {
  const read = readLibraryFile(text);
  const key = examKey(read.exam);
  const before = await sql`SELECT id FROM syllabus_library WHERE exam_key = ${key}`;
  const rows = await sql`
    INSERT INTO syllabus_library (exam_key, exam, match_terms, basis, content, updated_by)
    VALUES (${key}, ${read.exam}, ${JSON.stringify(read.match)}, ${read.basis ?? null}, ${text}, ${adminId})
    ON CONFLICT (exam_key) DO UPDATE
      SET exam = EXCLUDED.exam, match_terms = EXCLUDED.match_terms, basis = EXCLUDED.basis,
          content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING id, exam, match_terms, basis, updated_at
  `;
  return { entry: summary((rows as Row[])[0]), replaced: before.length > 0 };
}
