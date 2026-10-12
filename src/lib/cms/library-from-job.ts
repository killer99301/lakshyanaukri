// ═══════════════════════════════════════════════════════════
// A library file made from a job's own syllabus
// ═══════════════════════════════════════════════════════════
//
// Pure. When a syllabus is saved on a job for an exam the library does not
// have, the job's exam pattern and syllabus are written out as an ordinary
// library file (see syllabus-library.ts and content-import.ts), so the next
// job for the same exam is offered it.
//
// Such a file is a copy of what was on one job, checked by nobody. Its
// "Basis" line says so and names the job, which is also how a later save on
// the same job knows it may replace the file. A file added to the library by
// hand is never touched.

import type { ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";
import { tokens } from "@/lib/cms/syllabus-library";

/** Starts the Basis line of every file made here. */
export const AUTO_BASIS_PREFIX = "Saved automatically from the job";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The exam a job is for, without what changes from year to year:
 * "TNPSC Group IV Recruitment 2026 (CCSE-IV, Notification No. 11/2026)" → "TNPSC Group IV".
 * Null when too little is left to name an exam by.
 */
export function libraryExamName(title: string): string | null {
  const name = oneLine(
    title
      .replace(/\([^)]*\)/g, " ")                       // notice numbers and asides
      .split(/\s[-–—:|]\s/)[0]                           // "… - Apply Online for 2863 Posts"
      .replace(/\b(19|20)\d{2}(\s*[-/–]\s*\d{2,4})?\b/g, " ") // 2026, 2026-27
      .replace(/\b(recruitment|notification|vacanc(y|ies)|online form|apply online|advertisement|advt)\b\.?/gi, " ")
      .replace(/[\s,.-]+$/g, " "),
  );
  const words = tokens(name);
  // One short word ("SSC", "Clerk") would be offered on unrelated jobs.
  if (words.length < 2 || name.length > 120) return null;
  return name;
}

/** The words a later job's title must all contain: the exam's own name. */
export function libraryMatchTerm(exam: string): string {
  return tokens(exam).join(" ");
}

export function autoBasis(jobTitle: string, slug: string, todayText: string): string {
  return `${AUTO_BASIS_PREFIX} “${oneLine(jobTitle).slice(0, 160)}” (${slug}) on ${todayText}. Not checked against the official notice.`;
}

/** The Basis line once the admin has looked the entry over. It is theirs from then on. */
export function approvedBasis(todayText: string, was?: string): string {
  const from = was && was.startsWith(AUTO_BASIS_PREFIX) ? /“(.+?)”/.exec(was)?.[1] : undefined;
  return `Approved on ${todayText}${from ? `. First saved from the job “${from}”` : ""}.`;
}

/** The Basis line when the admin replaces an entry with a newer job's version. */
export function updatedBasis(jobTitle: string, todayText: string): string {
  return `Updated on ${todayText} from the job “${oneLine(jobTitle).slice(0, 160)}” and approved.`;
}

/** True when an entry was saved automatically and nobody has approved it yet. */
export const isUnapproved = (basis: string | undefined): boolean => Boolean(basis) && basis!.startsWith(AUTO_BASIS_PREFIX);

/** A library file with its Basis line replaced (or added, if it had none). */
export function withBasis(text: string, basis: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => /^Basis\s*:/i.test(l.trim()));
  if (at >= 0) {
    lines[at] = `Basis: ${basis}`;
    return lines.join("\n");
  }
  const source = lines.findIndex((l) => /^SOURCE\s*:?\s*$/i.test(l.trim()));
  if (source >= 0) {
    lines.splice(source + 1, 0, `Basis: ${basis}`);
    return lines.join("\n");
  }
  // No SOURCE section: put one after the LIBRARY block.
  const next = lines.findIndex((l) => /^(EXAM PATTERN|SYLLABUS|NOTES)/i.test(l.trim()));
  lines.splice(next >= 0 ? next : lines.length, 0, "SOURCE", `Basis: ${basis}`, "");
  return lines.join("\n");
}

/** True when a library entry was made here from this very job, so it may be refreshed. */
export function isAutoEntryOf(basis: string | undefined, slug: string): boolean {
  return Boolean(basis) && basis!.startsWith(AUTO_BASIS_PREFIX) && basis!.includes(`(${slug})`);
}

/** The library file for a job's exam pattern and syllabus. Reads back to the same content. */
export function buildLibraryFile(opts: {
  exam: string;
  basis: string;
  examPattern: ExamPatternPaper[];
  syllabus: SyllabusSubject[];
  /** The match words of the entry being replaced; a new entry matches on its exam name. */
  match?: string[];
}): string {
  const match = opts.match && opts.match.length > 0 ? opts.match.join("; ") : libraryMatchTerm(opts.exam);
  const lines: string[] = ["LIBRARY", `Exam: ${opts.exam}`, `Match: ${match}`, "", "SOURCE", `Basis: ${opts.basis}`, ""];

  if (opts.examPattern.length > 0) {
    lines.push("EXAM PATTERN");
    for (const paper of opts.examPattern) {
      lines.push(`Paper: ${oneLine(paper.name)}`);
      if (paper.mode) lines.push(`Mode: ${oneLine(paper.mode)}`);
      if (paper.durationMinutes) lines.push(`Duration (minutes): ${paper.durationMinutes}`);
      if (paper.totalQuestions) lines.push(`Total questions: ${paper.totalQuestions}`);
      if (paper.totalMarks) lines.push(`Total marks: ${paper.totalMarks}`);
      if (paper.negativeMarking) lines.push(`Negative marking: ${oneLine(paper.negativeMarking)}`);
      if (paper.note) lines.push(`Note: ${oneLine(paper.note)}`);
      if (paper.sections.length > 0) {
        lines.push("Subjects:");
        for (const s of paper.sections) {
          // "|" separates the columns, so it cannot appear inside a subject's name.
          lines.push(`- ${oneLine(s.subject).replace(/\|/g, "/")} | ${s.questions ?? ""} | ${s.marks ?? ""}`);
        }
      }
      lines.push("");
    }
  }

  if (opts.syllabus.length > 0) lines.push("SYLLABUS");
  let paper: string | undefined;
  let first = true;
  for (const subject of opts.syllabus) {
    const of = subject.paper ? oneLine(subject.paper) : undefined;
    if (first || of !== paper) {
      lines.push(`Paper: ${of ?? ""}`);
      paper = of;
      first = false;
    }
    lines.push(`Subject: ${oneLine(subject.subject)}`);
    lines.push("Topics:");
    for (const topic of subject.topics) lines.push(`- ${oneLine(topic)}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
