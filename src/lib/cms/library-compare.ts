// ═══════════════════════════════════════════════════════════
// What changed between the library's copy and this job's
// ═══════════════════════════════════════════════════════════
//
// Pure. An exam's pattern and syllabus mostly repeat from one year to the
// next, and sometimes do not. With the library holding last cycle's copy and
// the job holding what this year's notice says, the differences are listed in
// plain words, so the admin sees at a glance what the new notice changed.
//
// Papers and subjects are paired by name, ignoring case and punctuation. A
// paper or subject that was renamed therefore shows as one removed and one
// added, which is the honest reading: it cannot be known that they are the same.

import type { ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";

export interface PatternAndSyllabus {
  examPattern: ExamPatternPaper[];
  syllabus: SyllabusSubject[];
}

export interface LibraryComparison {
  /** One plain sentence per difference. Empty when the two are the same. */
  pattern: string[];
  syllabus: string[];
  /** One side has no exam pattern (or no syllabus) at all, so that part was not compared. */
  notCompared: string[];
}

const key = (text: string | undefined) => (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const list = (names: string[], max = 4) => names.slice(0, max).map((n) => `“${n}”`).join(", ") + (names.length > max ? ` and ${names.length - max} more` : "");

function changed(label: string, was: string | number | undefined, now: string | number | undefined): string | null {
  const a = was === undefined || was === "" ? undefined : String(was);
  const b = now === undefined || now === "" ? undefined : String(now);
  if (key(a) === key(b)) return null;
  if (a === undefined) return `${label} is now ${b} (the library has none).`;
  if (b === undefined) return `${label} was ${a} in the library; this job gives none.`;
  return `${label}: ${a} in the library, ${b} on this job.`;
}

function comparePattern(old: ExamPatternPaper[], now: ExamPatternPaper[]): string[] {
  const out: string[] = [];
  const before = new Map(old.map((p) => [key(p.name), p]));
  const after = new Map(now.map((p) => [key(p.name), p]));

  const added = now.filter((p) => !before.has(key(p.name))).map((p) => p.name);
  const removed = old.filter((p) => !after.has(key(p.name))).map((p) => p.name);
  if (added.length > 0) out.push(`New on this job: ${added.length === 1 ? "paper" : "papers"} ${list(added)}.`);
  if (removed.length > 0) out.push(`In the library but not on this job: ${removed.length === 1 ? "paper" : "papers"} ${list(removed)}.`);

  for (const paper of now) {
    const was = before.get(key(paper.name));
    if (!was) continue;
    const name = `“${paper.name}”`;
    for (const line of [
      changed(`${name} duration (minutes)`, was.durationMinutes, paper.durationMinutes),
      changed(`${name} total questions`, was.totalQuestions, paper.totalQuestions),
      changed(`${name} total marks`, was.totalMarks, paper.totalMarks),
      changed(`${name} negative marking`, was.negativeMarking, paper.negativeMarking),
      changed(`${name} mode`, was.mode, paper.mode),
    ]) if (line) out.push(line);

    const wasSubjects = new Map(was.sections.map((s) => [key(s.subject), s]));
    const nowSubjects = new Map(paper.sections.map((s) => [key(s.subject), s]));
    const plus = paper.sections.filter((s) => !wasSubjects.has(key(s.subject))).map((s) => s.subject);
    const minus = was.sections.filter((s) => !nowSubjects.has(key(s.subject))).map((s) => s.subject);
    if (plus.length > 0) out.push(`${name}: new ${plus.length === 1 ? "subject" : "subjects"} ${list(plus)}.`);
    if (minus.length > 0) out.push(`${name}: ${minus.length === 1 ? "subject" : "subjects"} ${list(minus)} no longer listed.`);
    for (const s of paper.sections) {
      const prev = wasSubjects.get(key(s.subject));
      if (!prev) continue;
      for (const line of [
        changed(`${name}, ${s.subject}: questions`, prev.questions, s.questions),
        changed(`${name}, ${s.subject}: marks`, prev.marks, s.marks),
      ]) if (line) out.push(line);
    }
  }
  return out;
}

const subjectKey = (s: SyllabusSubject) => `${key(s.paper)}|${key(s.subject)}`;
const subjectName = (s: SyllabusSubject) => (s.paper ? `${s.paper}: ${s.subject}` : s.subject);

function compareSyllabus(old: SyllabusSubject[], now: SyllabusSubject[]): string[] {
  const out: string[] = [];
  const before = new Map(old.map((s) => [subjectKey(s), s]));
  const after = new Map(now.map((s) => [subjectKey(s), s]));

  const added = now.filter((s) => !before.has(subjectKey(s))).map(subjectName);
  const removed = old.filter((s) => !after.has(subjectKey(s))).map(subjectName);
  if (added.length > 0) out.push(`New on this job: ${added.length === 1 ? "subject" : "subjects"} ${list(added)}.`);
  if (removed.length > 0) out.push(`In the library but not on this job: ${removed.length === 1 ? "subject" : "subjects"} ${list(removed)}.`);

  for (const subject of now) {
    const was = before.get(subjectKey(subject));
    if (!was) continue;
    const wasTopics = new Set(was.topics.map(key));
    const nowTopics = new Set(subject.topics.map(key));
    const plus = subject.topics.filter((t) => !wasTopics.has(key(t)));
    const minus = was.topics.filter((t) => !nowTopics.has(key(t)));
    const name = `“${subjectName(subject)}”`;
    if (plus.length > 0) out.push(`${name}: ${plus.length} new ${plus.length === 1 ? "topic" : "topics"} — ${list(plus, 5)}.`);
    if (minus.length > 0) out.push(`${name}: ${minus.length} ${minus.length === 1 ? "topic" : "topics"} no longer listed — ${list(minus, 5)}.`);
  }
  return out;
}

/** `old` is the library's copy; `now` is what is on the job. */
export function compareWithLibrary(old: PatternAndSyllabus, now: PatternAndSyllabus): LibraryComparison {
  const notCompared: string[] = [];
  let pattern: string[] = [];
  let syllabus: string[] = [];

  if (old.examPattern.length > 0 && now.examPattern.length > 0) pattern = comparePattern(old.examPattern, now.examPattern);
  else if (old.examPattern.length > 0) notCompared.push("The library has an exam pattern for this exam; this job has none yet.");
  else if (now.examPattern.length > 0) notCompared.push("This job has an exam pattern; the library entry has none.");

  if (old.syllabus.length > 0 && now.syllabus.length > 0) syllabus = compareSyllabus(old.syllabus, now.syllabus);
  else if (old.syllabus.length > 0) notCompared.push("The library has a syllabus for this exam; this job has none yet.");
  else if (now.syllabus.length > 0) notCompared.push("This job has a syllabus; the library entry has none.");

  return { pattern, syllabus, notCompared };
}
