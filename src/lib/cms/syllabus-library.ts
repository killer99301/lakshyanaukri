// ═══════════════════════════════════════════════════════════
// Syllabus library: one prepared file per recurring exam
// ═══════════════════════════════════════════════════════════
//
// A library file is an ordinary content file (see content-import.ts) with a
// LIBRARY block on top that names the exam and the words a job title must
// contain for the file to be offered:
//
//   LIBRARY
//   Exam: SSC CHSL (Combined Higher Secondary Level)
//   Match: ssc chsl; combined higher secondary
//
// Client-safe and pure. Matching only ever produces a suggestion for the
// admin: nothing here puts a syllabus on a record. A library file is last
// cycle's syllabus until the new notice confirms it.

import { parseContentFile } from "@/lib/cms/content-import";

export const LIBRARY_LIMITS = { exam: 120, terms: 12, term: 80, content: 200_000 } as const;

/** A reason, written for the admin, why a file cannot go in the library. */
export class LibraryFileError extends Error {}

export interface LibraryHeader {
  exam: string;
  match: string[];
}

export interface LibraryEntrySummary {
  id: string;
  exam: string;
  match: string[];
  basis?: string;
  updatedAt: string;
}

/**
 * Lower-case words and numbers; "RRB-NTPC (Graduate)" → ["rrb", "ntpc", "graduate"].
 * "Under Graduate" and "Post Graduate" are read as one word each, so a file for
 * a graduate-level exam is not offered on an "Under Graduate Level" job.
 */
export function tokens(text: string): string[] {
  const joined = text.toLowerCase().replace(/\b(under|post)[\s-]+graduate/g, "$1graduate");
  return joined.match(/[a-z0-9]+/g) ?? [];
}

/** The address-like key one exam is stored under: "SSC CHSL (10+2)" → "ssc-chsl-10-2". */
export function examKey(exam: string): string {
  return tokens(exam).join("-");
}

/**
 * Reads and checks a library file. Throws a plain-language reason if the file
 * cannot go in the library as it is.
 */
export function readLibraryFile(text: string): LibraryHeader & { basis?: string; papers: number; subjects: number; warnings: string[] } {
  if (text.length > LIBRARY_LIMITS.content) throw new LibraryFileError("This file is too long for the library (200,000 characters at most).");

  let exam = "";
  let matchLine = "";
  let inBlock = false;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (/^LIBRARY\s*:?\s*$/i.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (/^(SOURCE|EXAM PATTERN|SYLLABUS|NOTES)/i.test(line)) break;
    const pair = /^(Exam|Match)\s*:\s*(.+)$/i.exec(line);
    if (!pair) continue;
    if (pair[1].toLowerCase() === "exam") exam = pair[2].trim().replace(/\s+/g, " ");
    else matchLine = pair[2];
  }

  if (!exam) throw new LibraryFileError("The file needs a LIBRARY block with an “Exam:” line naming the exam.");
  if (exam.length > LIBRARY_LIMITS.exam) throw new LibraryFileError("The exam name is longer than 120 characters.");
  if (!examKey(exam)) throw new LibraryFileError("The exam name needs letters or numbers in it.");

  const match = [...new Set(matchLine.split(";").map((t) => tokens(t).join(" ")).filter(Boolean))];
  if (match.length === 0) throw new LibraryFileError("The LIBRARY block needs a “Match:” line: the words a job title must contain, with “;” between alternatives.");
  if (match.length > LIBRARY_LIMITS.terms) throw new LibraryFileError("The “Match:” line has more than 12 alternatives.");
  for (const term of match) {
    if (term.length > LIBRARY_LIMITS.term) throw new LibraryFileError(`The match words “${term.slice(0, 30)}…” are longer than 80 characters.`);
    // A lone short word ("exam", "po", "2026") would be offered on unrelated jobs.
    if (!term.includes(" ") && (term.length < 3 || /^\d+$/.test(term))) {
      throw new LibraryFileError(`“${term}” is too short to match on by itself. Use at least two words, or one word of three letters or more.`);
    }
  }

  const read = parseContentFile(text);
  if (read.examPattern.length === 0 && read.syllabus.length === 0) {
    throw new LibraryFileError("No exam pattern or syllabus could be read from this file, so there is nothing to keep in the library.");
  }
  return { exam, match, ...(read.basis ? { basis: read.basis } : {}), papers: read.examPattern.length, subjects: read.syllabus.length, warnings: read.warnings };
}

/**
 * Library entries whose match words all appear, as whole words, in the job's
 * names. Most specific first (the entry that matched on the most words).
 * "rrb ntpc graduate" does not match an "RRB NTPC Undergraduate" job.
 */
export function suggestFromLibrary<T extends Pick<LibraryEntrySummary, "exam" | "match">>(entries: T[], jobNames: Array<string | null | undefined>): T[] {
  const have = new Set(tokens(jobNames.filter(Boolean).join(" ")));
  const scored: Array<{ entry: T; score: number }> = [];
  for (const entry of entries) {
    let best = 0;
    for (const term of entry.match) {
      const words = term.split(" ");
      if (words.every((w) => have.has(w))) best = Math.max(best, words.length);
    }
    if (best > 0) scored.push({ entry, score: best });
  }
  return scored.sort((a, b) => b.score - a.score || a.entry.exam.localeCompare(b.entry.exam)).map((s) => s.entry);
}

/** The content file without its LIBRARY block, as it goes into the paste box. */
export function stripLibraryBlock(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^LIBRARY\s*:?\s*$/i.test(l.trim()));
  if (start < 0) return text;
  let end = start + 1;
  while (end < lines.length && !/^(SOURCE|EXAM PATTERN|SYLLABUS|NOTES)/i.test(lines[end].trim())) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").trimStart();
}
