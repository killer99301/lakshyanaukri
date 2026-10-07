// ═══════════════════════════════════════════════════════════
// Reading a prepared content file into exam pattern and syllabus
// ═══════════════════════════════════════════════════════════
//
// Content is researched outside the site and handed over as plain text with
// SOURCE / EXAM PATTERN / SYLLABUS / NOTES sections (docs/antigravity-content-brief.md).
// This turns the two middle sections into the shapes the editors save.
//
// Client-safe and pure. It only reads what is written: nothing is filled in,
// reordered or reworded, and anything it cannot place is reported, not guessed.
// What it returns still goes through the normal save path, which cleans,
// bounds and stores it as Pending.

import type { ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";

export interface ContentImport {
  examPattern: ExamPatternPaper[];
  syllabus: SyllabusSubject[];
  /** Where the file says its content came from, if it says. */
  basis?: string;
  /** Things the admin should know before saving. */
  warnings: string[];
}

const SECTION = /^(SOURCE|EXAM PATTERN|SYLLABUS|NOTES FOR ASHISH|NOTES)\s*:?\s*$/i;
const KEY = /^([A-Za-z][A-Za-z ()]*?)\s*:\s*(.*)$/;
const BULLET = /^\s*[-*•]\s+/;

function sections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = "";
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const heading = SECTION.exec(raw.trim());
    if (heading) {
      current = heading[1].toUpperCase().startsWith("NOTES") ? "NOTES" : heading[1].toUpperCase();
      out[current] = [];
      continue;
    }
    if (current) out[current].push(raw);
  }
  return out;
}

const number = (text: string): number | undefined => {
  const n = Number(text.replace(/,/g, "").trim());
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
};

function readPattern(lines: string[], warnings: string[]): ExamPatternPaper[] {
  const papers: ExamPatternPaper[] = [];
  let paper: ExamPatternPaper | null = null;
  let inSubjects = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { inSubjects = false; continue; }

    if (inSubjects && paper && !/^Paper\s*:/i.test(line)) {
      const [subject, questions, marks] = line.replace(BULLET, "").split("|").map((p) => p.trim());
      if (subject) {
        const q = number(questions ?? "");
        const m = number(marks ?? "");
        paper.sections.push({ subject, ...(q ? { questions: q } : {}), ...(m ? { marks: m } : {}) });
      }
      continue;
    }

    const pair = KEY.exec(line);
    if (!pair) continue;
    const key = pair[1].trim().toLowerCase();
    const value = pair[2].trim();

    if (key === "paper") {
      paper = { name: value, sections: [] };
      papers.push(paper);
      inSubjects = false;
    } else if (!paper) {
      continue;
    } else if (key === "mode") {
      if (value) paper.mode = value;
    } else if (key.startsWith("duration")) {
      const n = number(value);
      if (n) paper.durationMinutes = n;
    } else if (key === "total questions") {
      const n = number(value);
      if (n) paper.totalQuestions = n;
    } else if (key === "total marks") {
      const n = number(value);
      if (n) paper.totalMarks = n;
    } else if (key === "negative marking") {
      if (value) paper.negativeMarking = value;
    } else if (key === "note") {
      if (value.length > 600) warnings.push(`Exam pattern, “${paper.name}”: the note is longer than 600 characters and was left out. Shorten it and add it by hand if it matters.`);
      else if (value) paper.note = value;
    } else if (key === "subjects") {
      inSubjects = true;
    }
  }

  if (papers.length === 0 && lines.some((l) => l.trim())) {
    warnings.push("The exam pattern in this file is written as a description, not as papers with subjects, so it was not read. Use the Selection process section for it, or type the papers by hand.");
  }
  for (const p of papers) {
    if (p.name.length > 140) warnings.push(`Exam pattern: the paper name “${p.name.slice(0, 40)}…” is longer than 140 characters and will be refused. Shorten it in the box before saving.`);
    for (const s of p.sections) {
      if (s.subject.length > 200) warnings.push(`Exam pattern, “${p.name}”: the subject “${s.subject.slice(0, 40)}…” is longer than 200 characters and will be refused. Shorten it in the box before saving.`);
    }
  }
  return papers;
}

function readSyllabus(lines: string[], warnings: string[]): SyllabusSubject[] {
  const subjects: SyllabusSubject[] = [];
  let paper: string | undefined;
  let subject: SyllabusSubject | null = null;
  let topicsOpen = false;

  const start = (name: string, ofPaper: string | undefined) => {
    subject = { subject: name, topics: [], ...(ofPaper ? { paper: ofPaper } : {}) };
    subjects.push(subject);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { topicsOpen = false; continue; }

    // "- Number System": a topic of the subject above.
    if (BULLET.test(lines[i])) {
      if (subject) (subject as SyllabusSubject).topics.push(line.replace(BULLET, "").trim());
      continue;
    }

    const pair = KEY.exec(line);
    const key = pair?.[1].trim().toLowerCase();

    if (key === "paper") { paper = pair![2].trim() || undefined; subject = null; topicsOpen = false; continue; }
    if (key === "subject") { start(pair![2].trim(), paper); topicsOpen = false; continue; }
    if (key === "topics") {
      topicsOpen = true;
      // "Topics: a, b, c" on one line is also accepted.
      const inline = pair![2].trim();
      if (inline && subject) (subject as SyllabusSubject).topics.push(...inline.split(/,\s*/).map((t) => t.trim()).filter(Boolean));
      continue;
    }

    if (topicsOpen && subject) { (subject as SyllabusSubject).topics.push(line); continue; }

    // A plain heading followed by bullet lines: "Tier-I: English Language".
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (next && BULLET.test(next)) {
      const cut = line.indexOf(":");
      if (cut > 0 && cut < line.length - 1) start(line.slice(cut + 1).trim(), line.slice(0, cut).trim());
      else start(line.replace(/:$/, "").trim(), undefined);
      topicsOpen = false;
    }
  }

  const kept = subjects.filter((s) => s.subject && s.topics.length > 0);
  if (kept.length < subjects.length) warnings.push(`${subjects.length - kept.length} subject${subjects.length - kept.length === 1 ? "" : "s"} had no topics and ${subjects.length - kept.length === 1 ? "was" : "were"} left out.`);
  if (kept.length > 40) warnings.push(`This file has ${kept.length} subjects; the site allows 40 per job, so saving will be refused. Merge or remove some in the box first.`);
  for (const s of kept) {
    if (s.topics.length > 80) warnings.push(`“${s.subject}” has ${s.topics.length} topics; the site allows 80 per subject, so saving will be refused.`);
    const long = s.topics.filter((t) => t.length > 160).length;
    if (long > 0) warnings.push(`“${s.subject}”: ${long} topic${long === 1 ? " is" : "s are"} longer than 160 characters and will be dropped on saving.`);
  }
  return kept;
}

export function parseContentFile(text: string): ContentImport {
  const warnings: string[] = [];
  const parts = sections(text);

  const basis = (parts.SOURCE ?? []).map((l) => /^Basis\s*:\s*(.+)$/i.exec(l.trim())?.[1]).find(Boolean);
  if (basis && /not from an official notice/i.test(basis)) {
    warnings.push("This file says its content is NOT from an official notice. Check it against the notification before publishing.");
  }

  const examPattern = readPattern(parts["EXAM PATTERN"] ?? [], warnings);
  const syllabus = readSyllabus(parts.SYLLABUS ?? [], warnings);

  if (!parts["EXAM PATTERN"] && !parts.SYLLABUS) {
    warnings.push("No “EXAM PATTERN” or “SYLLABUS” heading was found. Paste the whole file, headings included.");
  }
  return { examPattern, syllabus, ...(basis ? { basis } : {}), warnings };
}
