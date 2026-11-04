// What each source of an import left out, by the field it is about, so the
// review can say it beside that field (FR-D1): the source's name and the
// reason, which quotes the line. Pure and client-safe. An entry whose field
// cannot be told is not placed under any field; it stays in the source list.
// "Not read" messages are about a whole source and are not placed here.

import { FIELD_DEFS, FLAG_LABEL_PATHS } from "@/lib/cms/importer/fields";

export interface LeftOutNote { source: string; reason: string }

/** The field a left-out entry is about: its own path, or the field a check's label names; null when unknown. */
export function leftOutField(fieldPath: string): string | null {
  if (FIELD_DEFS[fieldPath] || fieldPath.startsWith("links#")) return fieldPath;
  if (FLAG_LABEL_PATHS[fieldPath]) return FLAG_LABEL_PATHS[fieldPath];
  if (fieldPath === "Title") return "identity.title"; // the title check names its field so
  return null;
}

/** Each field's left-out notes, source by source, each said once. */
export function leftOutByField(sources: Array<{ label: string; refused: Array<{ fieldPath: string; reason: string }> }>): Map<string, LeftOutNote[]> {
  const out = new Map<string, LeftOutNote[]>();
  for (const s of sources) {
    for (const r of s.refused) {
      const field = leftOutField(r.fieldPath);
      if (!field) continue;
      const notes = out.get(field) ?? [];
      if (!notes.some((n) => n.source === s.label && n.reason === r.reason)) notes.push({ source: s.label, reason: r.reason });
      out.set(field, notes);
    }
  }
  return out;
}
