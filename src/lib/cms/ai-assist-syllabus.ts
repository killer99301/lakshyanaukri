// AI Assist — exam pattern and syllabus.
//
// One extra AI request per Assist click, sent only the passages of the source
// that talk about the pattern or the syllabus. Same rules as the rest of AI
// Assist, applied harder because this is a long list of small facts:
//   - a paper or subject is kept only if its quote is found in the source;
//   - every number must appear in the source, or that number is dropped;
//   - every topic must appear in the source text, word for word, or it is dropped.
// Whatever survives is stored as PENDING for the admin to check.

import type { PageSection } from "@/intelligence/page-structurer";
import { structureDocument, normalizeForMatching } from "@/intelligence/page-structurer";
import type { ExamPatternPaper, ExamPatternSection, SyllabusSubject } from "@/types/recruitment-record";
import { callAiJson, type SourceKind } from "@/lib/cms/ai-assist";
import {
  buildEvidence,
  isOtherJobHeading,
  quoteFound,
  subjectTokens,
  type DetailOutcome,
  type Evidence,
} from "@/lib/cms/ai-assist-details";
import { cleanExamPattern, cleanSyllabus } from "@/lib/cms/record-ops";

// ─── Passages ─────────────────────────────────────────────

const HEADING_RE = /syllabus|exam\s+pattern|scheme\s+of\s+exam|pattern\s+of\s+exam|tier|paper|subject[\s-]?wise|marks\s+distribution|marking\s+scheme|negative\s+marking/i;
// Advice and history are not notification facts.
const EXCLUDE_RE = /cut.?off|previous\s+year|books?|tips|strategy|how\s+to\s+prepare|preparation|analysis|faq|\bvs\b/i;
const PDF_RE = /scheme\s+of\s+(?:the\s+)?examination|indicative\s+syllabus|syllabus|pattern\s+of\s+examination|negative\s+marking/gi;

const MAX_SECTIONS = 10;
const MAX_SECTION_CHARS = 4500;
const MAX_TOTAL_CHARS = 24_000;
/** Syllabus answers are long lists; the default output cap would cut them off. */
export const SYLLABUS_MAX_OUTPUT_TOKENS = 8192;

function section(heading: string, text: string): PageSection {
  return { type: "other", heading, text, rawHtml: "", tables: [], lists: [], links: [], paragraphs: [] };
}

export function buildSyllabusSections(content: string, kind: SourceKind, url: string, subject?: string): PageSection[] {
  const picked: Array<{ title: string; text: string }> = [];
  const tokens = subjectTokens(subject);

  if (kind === "html") {
    for (const s of structureDocument(content, url).sections) {
      const text = s.text.trim();
      if (!text || !HEADING_RE.test(s.heading) || EXCLUDE_RE.test(s.heading) || isOtherJobHeading(s.heading, tokens)) continue;
      picked.push({ title: s.heading, text: `${s.heading}\n${text}` });
    }
  } else {
    let lastEnd = -1;
    for (const m of content.matchAll(PDF_RE)) {
      const start = Math.max(0, (m.index ?? 0) - 100);
      if (start < lastEnd) continue;
      lastEnd = start + MAX_SECTION_CHARS;
      picked.push({ title: m[0], text: content.slice(start, lastEnd) });
    }
  }

  const out: PageSection[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const p of picked) {
    if (out.length === MAX_SECTIONS) break;
    const text = p.text.slice(0, MAX_SECTION_CHARS);
    const key = normalizeForMatching(text).slice(0, 200);
    if (seen.has(key)) continue;
    if (total + text.length > MAX_TOTAL_CHARS) break;
    seen.add(key);
    total += text.length;
    out.push(section(`Part ${out.length + 1}: ${p.title.replace(/\s+/g, " ").slice(0, 60)}`, text));
  }
  return out;
}

export function buildSyllabusPrompt(sections: PageSection[], url: string, subject?: string): string {
  const block = sections.map((s) => `## Section: ${s.heading}\n${s.text}`).join("\n\n");
  const scope = subject
    ? `\nThis record is about: ${subject}\nUse facts for THIS recruitment only. Ignore any other exam mentioned in the text.\n`
    : "";
  return `You are extracting the exam pattern and syllabus from an Indian government recruitment notice or a page describing one.

Source URL: ${url}
${scope}
${block}

---

Return ONE JSON object with the fields below. Include an item ONLY when the text above states it. Never guess and never use outside knowledge.

{
  "examPattern": [
    {
      "name": "name of the paper or tier, e.g. Tier-I",
      "mode": "e.g. Computer Based Examination",
      "durationMinutes": <integer>,
      "negativeMarking": "as written, e.g. 0.50 marks for each wrong answer",
      "totalQuestions": <integer>,
      "totalMarks": <number>,
      "sections": [ { "subject": "subject name as written", "questions": <integer>, "marks": <number> } ],
      "evidence": "verbatim quote (10–200 characters) from the text that names this paper"
    }
  ],
  "syllabus": [
    {
      "paper": "paper or tier this applies to, if the text says",
      "subject": "subject name as written",
      "topics": ["topic exactly as written", "..."],
      "evidence": "verbatim quote (10–200 characters) from the text that names this subject"
    }
  ]
}

Rules:
1. Omit any item, number or sub-field the text does not state.
2. Numbers must be exactly as written in the text.
3. "topics": copy each topic as a short phrase EXACTLY as it appears in the text. Do not reword, merge, translate or add topics. At most 60 topics per subject.
4. At most 8 papers and 30 subjects. Keep the order of the text.
5. Do not include preparation advice, book names, cut-offs or analysis.`;
}

// ─── Verification ─────────────────────────────────────────

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= max ? t : null;
};

/** Found in the source, ignoring case, spacing and punctuation. */
const inSource = (value: string, ev: Evidence): boolean => {
  const n = normalizeForMatching(value);
  return n.length >= 2 && ev.text.includes(n);
};

const numberStated = (n: unknown, ev: Evidence): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 && ev.numbers.has(String(n));

/** A duration is kept if its minutes appear in the source, or it is a whole number of hours that does. */
function durationStated(minutes: unknown, ev: Evidence): minutes is number {
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes <= 0) return false;
  if (ev.numbers.has(String(minutes))) return true;
  if (minutes % 60 !== 0) return false;
  const hours = minutes / 60;
  return new RegExp(`(?<!\\d)${hours}\\s*(?:hours?|hrs?)\\b`).test(ev.text);
}

const notStated = { status: "not_stated" } as const;

export function judgeExamPattern(raw: unknown, ev: Evidence): DetailOutcome<ExamPatternPaper[]> {
  if (!Array.isArray(raw) || raw.length === 0) return notStated;
  const papers: ExamPatternPaper[] = [];
  let dropped = 0;

  for (const item of raw.slice(0, 8)) {
    const p = (item ?? {}) as Record<string, unknown>;
    const name = text(p.name, 80);
    if (!name || !quoteFound(p.evidence, ev)) { dropped++; continue; }

    const sections: ExamPatternSection[] = [];
    for (const rs of Array.isArray(p.sections) ? p.sections.slice(0, 15) : []) {
      const s = (rs ?? {}) as Record<string, unknown>;
      const subject = text(s.subject, 100);
      if (!subject || !inSource(subject, ev)) { dropped++; continue; }
      sections.push({
        subject,
        ...(numberStated(s.questions, ev) && Number.isInteger(s.questions) ? { questions: s.questions } : {}),
        ...(numberStated(s.marks, ev) ? { marks: s.marks } : {}),
      });
    }

    const mode = text(p.mode, 80);
    const negative = text(p.negativeMarking, 160);
    const negativeOk = negative !== null && (negative.match(/\d+(?:\.\d+)?/g) ?? []).every((n) => ev.numbers.has(n.replace(/^0+(?=\d)/, "")));

    const paper: ExamPatternPaper = {
      name,
      ...(mode && inSource(mode, ev) ? { mode } : {}),
      ...(durationStated(p.durationMinutes, ev) ? { durationMinutes: p.durationMinutes } : {}),
      ...(negative && negativeOk ? { negativeMarking: negative } : {}),
      sections,
      ...(numberStated(p.totalQuestions, ev) && Number.isInteger(p.totalQuestions) ? { totalQuestions: p.totalQuestions } : {}),
      ...(numberStated(p.totalMarks, ev) ? { totalMarks: p.totalMarks } : {}),
    };
    // A paper with no subjects and no figures says nothing.
    if (sections.length === 0 && !paper.durationMinutes && !paper.totalQuestions && !paper.totalMarks && !paper.negativeMarking) {
      dropped++;
      continue;
    }
    papers.push(paper);
  }

  if (papers.length === 0) return { status: "rejected", reason: "no exam pattern item could be matched to the source text" };
  try {
    return { status: "accepted", value: cleanExamPattern(papers), dropped: dropped + Math.max(0, raw.length - 8) };
  } catch {
    return { status: "rejected", reason: "the exam pattern found was not in a usable form" };
  }
}

export function judgeSyllabus(raw: unknown, ev: Evidence): DetailOutcome<SyllabusSubject[]> {
  if (!Array.isArray(raw) || raw.length === 0) return notStated;
  const subjects: SyllabusSubject[] = [];
  let dropped = 0;

  for (const item of raw.slice(0, 30)) {
    const s = (item ?? {}) as Record<string, unknown>;
    const subject = text(s.subject, 100);
    if (!subject || !inSource(subject, ev) || !quoteFound(s.evidence, ev)) { dropped++; continue; }

    const topics: string[] = [];
    for (const t of Array.isArray(s.topics) ? s.topics.slice(0, 60) : []) {
      const topic = text(t, 160);
      // Word for word: a topic the source does not contain is never stored.
      if (topic && inSource(topic, ev)) topics.push(topic);
      else dropped++;
    }
    if (topics.length === 0) { dropped++; continue; }

    const paper = text(s.paper, 80);
    subjects.push({ ...(paper && inSource(paper, ev) ? { paper } : {}), subject, topics });
  }

  if (subjects.length === 0) return { status: "rejected", reason: "no syllabus item could be matched to the source text" };
  try {
    return { status: "accepted", value: cleanSyllabus(subjects), dropped: dropped + Math.max(0, raw.length - 30) };
  } catch {
    return { status: "rejected", reason: "the syllabus found was not in a usable form" };
  }
}

// ─── Request ──────────────────────────────────────────────

export interface SyllabusExtraction {
  examPattern: DetailOutcome<ExamPatternPaper[]>;
  syllabus: DetailOutcome<SyllabusSubject[]>;
}

/** One AI request for the exam pattern and syllabus. Never throws. */
export async function extractPatternAndSyllabus(opts: {
  sections: PageSection[];
  url: string;
  apiKey: string | undefined;
  subject?: string;
  fetchFn?: typeof fetch;
  maxOutputTokens?: number;
}): Promise<SyllabusExtraction> {
  const skipped = (reason: string): SyllabusExtraction => ({
    examPattern: { status: "skipped", reason },
    syllabus: { status: "skipped", reason },
  });
  // No request is made when the source has nothing on either subject.
  if (opts.sections.length === 0) return { examPattern: notStated, syllabus: notStated };

  const answer = await callAiJson({
    prompt: buildSyllabusPrompt(opts.sections, opts.url, opts.subject),
    apiKey: opts.apiKey,
    fetchFn: opts.fetchFn,
    maxOutputTokens: opts.maxOutputTokens ?? SYLLABUS_MAX_OUTPUT_TOKENS,
  });
  if (!answer.ok) return skipped(answer.reason);

  const ev = buildEvidence(opts.sections);
  return {
    examPattern: judgeExamPattern(answer.data.examPattern, ev),
    syllabus: judgeSyllabus(answer.data.syllabus, ev),
  };
}

export const SYLLABUS_FIELDS: Array<{ key: keyof SyllabusExtraction; fieldPath: string; label: string }> = [
  { key: "examPattern", fieldPath: "examPattern", label: "Exam Pattern" },
  { key: "syllabus",    fieldPath: "syllabus",    label: "Syllabus" },
];
