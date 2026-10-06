// ═══════════════════════════════════════════════════════════
// Exam pattern and syllabus: write path, AI evidence rules, public mapping
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no network (the AI call is given a fake fetch).
//
//  XP01  exam pattern is cleaned, bounded and saved with a revision
//  XP02  syllabus is cleaned (blank and duplicate topics dropped) and saved
//  XP03  malformed values are rejected with a plain message
//  XP04  router: both paths are routable; a null value clears the block
//  XA01  AI pattern: unsupported numbers are dropped, not the paper
//  XA02  AI pattern: a paper without a quote in the source is dropped
//  XA03  AI syllabus: only topics found word for word are kept
//  XA04  AI syllabus: a subject or quote not in the source is dropped
//  XA05  no request is made when the source has no pattern or syllabus
//  XA06  one request; a failure leaves both fields untouched, with a reason
//  XS01  passages: pattern and syllabus headings are used; advice and other jobs are not
//  XM01  published snapshot and public job carry both; older snapshots have neither
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { PageSection } from "@/intelligence/page-structurer";
import { cleanExamPattern, cleanSyllabus, updateExamPattern, updateSyllabus } from "@/lib/cms/record-ops";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { buildEvidence } from "@/lib/cms/ai-assist-details";
import {
  buildSyllabusSections,
  extractPatternAndSyllabus,
  judgeExamPattern,
  judgeSyllabus,
} from "@/lib/cms/ai-assist-syllabus";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";

const ADMIN = randomUUID();
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["e1"], conflict: false, manuallyEdited: false });
const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });

function makeRecord(): RecruitmentRecord {
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "DRAFT",
    recordRevision: "abc",
    identity: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2026, title: pf("SSC CHSL Examination 2026") },
    dates: { applicationCloseDate: pf<string | null>("2026-10-07") },
    vacancies: {},
    financial: {},
    links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://ssc.gov.in/n.pdf", official: true }],
    documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const TIER1 = {
  name: "  Tier-I ",
  mode: "Computer Based Examination",
  durationMinutes: 60,
  negativeMarking: "0.50 marks for each wrong answer",
  totalQuestions: 100,
  totalMarks: 200,
  sections: [
    { subject: "General Intelligence", questions: 25, marks: 50 },
    { subject: "English Language", questions: 25, marks: 50 },
  ],
};

suite("Exam pattern and syllabus write path");

test("XP01 exam pattern is cleaned, bounded and saved with a revision", () => {
  const record = makeRecord();
  const { record: updated, revision } = updateExamPattern(record, pending([TIER1]), ADMIN, "Added pattern");
  assert.deepEqual(updated.examPattern?.value, [{ ...TIER1, name: "Tier-I" }]);
  assert.equal(updated.examPattern?.status, "PENDING");
  assert.equal(revision.fieldPath, "examPattern");
  assert.equal(updated.draftState, "DRAFT");
  assert.deepEqual(updated.identity, record.identity);
  assert.equal(record.examPattern, undefined);
  // Figures that are not sensible are dropped, never stored.
  const odd = cleanExamPattern([{ name: "Paper", durationMinutes: -5, totalQuestions: 2.5, totalMarks: "200", sections: [{ subject: "Maths", questions: 0, marks: 99999 }] }]);
  assert.deepEqual(odd, [{ name: "Paper", sections: [{ subject: "Maths" }] }]);
});

test("XP02 syllabus is cleaned and saved", () => {
  const record = makeRecord();
  const { record: updated, revision } = updateSyllabus(
    record,
    pending([{ paper: " Tier-I ", subject: "Quantitative  Aptitude", topics: ["Number System", " Percentage ", "", "Number System", 7] }]),
    ADMIN,
  );
  assert.deepEqual(updated.syllabus?.value, [{ paper: "Tier-I", subject: "Quantitative Aptitude", topics: ["Number System", "Percentage"] }]);
  assert.equal(revision.fieldPath, "syllabus");
});

test("XP03 malformed values are rejected with a plain message", () => {
  assert.throws(() => cleanExamPattern("x"), /array of papers/);
  assert.throws(() => cleanExamPattern([{ sections: [] }]), /needs a name/);
  assert.throws(() => cleanExamPattern([{ name: "T", sections: "x" }]), /sections must be a list/);
  assert.throws(() => cleanExamPattern([{ name: "T", sections: [{ questions: 5 }] }]), /subject 1 needs a name/);
  assert.throws(() => cleanExamPattern(Array(9).fill({ name: "T", sections: [] })), /at most 8/);
  assert.throws(() => cleanSyllabus({}), /array of subjects/);
  assert.throws(() => cleanSyllabus([{ topics: ["a"] }]), /needs a name/);
  assert.throws(() => cleanSyllabus([{ subject: "S", topics: "a,b" }]), /topics must be a list/);
  assert.throws(() => cleanSyllabus([{ subject: "S", topics: ["", "  "] }]), /at least one topic/);
  assert.throws(() => cleanSyllabus([{ subject: "S", topics: Array(81).fill("t") }]), /more than 80/);
});

test("XP04 router: both paths are routable; a null value clears the block", () => {
  const record = makeRecord();
  const withPattern = routeFieldUpdate(record, "examPattern", pending([TIER1]) as ProvenanceField<unknown>, ADMIN).record;
  assert.equal(withPattern.examPattern?.value?.[0].name, "Tier-I");
  const withSyllabus = routeFieldUpdate(record, "syllabus", pending([{ subject: "English", topics: ["Grammar"] }]) as ProvenanceField<unknown>, ADMIN).record;
  assert.equal(withSyllabus.syllabus?.value?.[0].subject, "English");
  const cleared = routeFieldUpdate(
    withPattern, "examPattern",
    { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true }, ADMIN,
  ).record;
  assert.equal(cleared.examPattern?.value, null);
});

// ─── AI evidence rules ──────────────────────────────────────

const section = (heading: string, text: string): PageSection =>
  ({ type: "other", heading, text, rawHtml: "", tables: [], lists: [], links: [], paragraphs: [] });

const SOURCE = [
  section("Exam Pattern", "Tier-I will be a Computer Based Examination of 60 minutes. General Intelligence 25 questions 50 marks. English Language 25 questions 50 marks. Total 100 questions 200 marks. There will be negative marking of 0.50 marks for each wrong answer."),
  section("Syllabus", "Tier-I syllabus. Quantitative Aptitude: Number System, Percentage, Ratio and Proportion, Profit and Loss. English Language: Spot the Error, Fill in the Blanks, Synonyms."),
];
const EV = buildEvidence(SOURCE);

suite("AI Assist: exam pattern and syllabus evidence rules");

test("XA01 unsupported numbers are dropped, not the paper", () => {
  const out = judgeExamPattern([{
    name: "Tier-I", mode: "Computer Based Examination", durationMinutes: 90, totalQuestions: 100, totalMarks: 300,
    negativeMarking: "0.25 marks for each wrong answer",
    sections: [{ subject: "General Intelligence", questions: 25, marks: 50 }, { subject: "English Language", questions: 40, marks: 50 }],
    evidence: "Tier-I will be a Computer Based Examination of 60 minutes",
  }], EV);
  assert.equal(out.status, "accepted");
  if (out.status !== "accepted") return;
  const paper = out.value[0];
  assert.equal(paper.durationMinutes, undefined);   // 90 is not in the source
  assert.equal(paper.totalQuestions, 100);
  assert.equal(paper.totalMarks, undefined);        // 300 is not in the source
  assert.equal(paper.negativeMarking, undefined);   // 0.25 is not in the source
  assert.deepEqual(paper.sections, [
    { subject: "General Intelligence", questions: 25, marks: 50 },
    { subject: "English Language", marks: 50 },      // 40 questions is not in the source
  ]);
});

test("XA02 a paper without a quote in the source, or with nothing to say, is dropped", () => {
  const out = judgeExamPattern([
    { name: "Tier-II", sections: [{ subject: "General Intelligence", questions: 25 }], evidence: "Tier-II will be descriptive and held in two sessions" },
    { name: "Tier-I", sections: [{ subject: "Reasoning Puzzles", questions: 25 }], evidence: "Tier-I will be a Computer Based Examination of 60 minutes" },
  ], EV);
  assert.equal(out.status, "rejected");
  assert.equal(judgeExamPattern([], EV).status, "not_stated");
  assert.equal(judgeExamPattern(undefined, EV).status, "not_stated");
  // Hours are accepted when the source states the hours.
  const hours = buildEvidence([section("Pattern", "Paper II is descriptive, of 3 hours duration, 100 marks.")]);
  const p2 = judgeExamPattern([{ name: "Paper II", durationMinutes: 180, totalMarks: 100, sections: [], evidence: "Paper II is descriptive, of 3 hours duration" }], hours);
  assert.equal(p2.status === "accepted" && p2.value[0].durationMinutes, 180);
});

test("XA03 only topics found word for word are kept", () => {
  const out = judgeSyllabus([{
    paper: "Tier-I", subject: "Quantitative Aptitude",
    topics: ["Number System", "Percentage", "Trigonometry", "Profit & Loss", "ratio and proportion"],
    evidence: "Quantitative Aptitude: Number System, Percentage",
  }], EV);
  assert.equal(out.status, "accepted");
  if (out.status !== "accepted") return;
  assert.deepEqual(out.value, [{ paper: "Tier-I", subject: "Quantitative Aptitude", topics: ["Number System", "Percentage", "ratio and proportion"] }]);
  assert.equal(out.dropped, 2); // Trigonometry (not in the source) and "Profit & Loss" (reworded)
});

test("XA04 a subject, quote or paper not in the source is dropped", () => {
  const out = judgeSyllabus([
    { subject: "General Awareness", topics: ["Number System"], evidence: "Quantitative Aptitude: Number System, Percentage" },
    { subject: "English Language", topics: ["Synonyms"], evidence: "English Language covers vocabulary and grammar in depth" },
    { paper: "Tier-III", subject: "English Language", topics: ["Synonyms", "Spot the Error"], evidence: "English Language: Spot the Error, Fill in the Blanks" },
  ], EV);
  assert.equal(out.status, "accepted");
  if (out.status !== "accepted") return;
  assert.deepEqual(out.value, [{ subject: "English Language", topics: ["Synonyms", "Spot the Error"] }]); // Tier-III is not in the source
  assert.equal(judgeSyllabus([{ subject: "English Language", topics: ["Idioms"], evidence: "English Language: Spot the Error, Fill in the Blanks" }], EV).status, "rejected");
});

function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchFn = (async (url: unknown) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const answer = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

test("XA05 no request is made when the source has no pattern or syllabus", async () => {
  const { fetchFn, calls } = fakeFetch(answer({}));
  const out = await extractPatternAndSyllabus({ sections: [], url: "https://example.com", apiKey: "test-key", fetchFn });
  assert.equal(calls.length, 0);
  assert.equal(out.examPattern.status, "not_stated");
  assert.equal(out.syllabus.status, "not_stated");
});

test("XA06 one request; a failure leaves both untouched, with a reason and no secrets", async () => {
  const ok = fakeFetch(answer({
    examPattern: [{ name: "Tier-I", totalQuestions: 100, totalMarks: 200, sections: [], evidence: "Total 100 questions 200 marks" }],
    syllabus: [{ subject: "English Language", topics: ["Synonyms"], evidence: "English Language: Spot the Error" }],
  }));
  const good = await extractPatternAndSyllabus({ sections: SOURCE, url: "https://example.com", apiKey: "test-key", fetchFn: ok.fetchFn });
  assert.equal(ok.calls.length, 1);
  assert.equal(good.examPattern.status, "accepted");
  assert.equal(good.syllabus.status, "accepted");

  const limited = fakeFetch({ error: { message: "quota for key test-key" } }, 429);
  const bad = await extractPatternAndSyllabus({ sections: SOURCE, url: "https://example.com", apiKey: "test-key", fetchFn: limited.fetchFn });
  assert.equal(limited.calls.length, 1); // no retry
  assert.equal(bad.examPattern.status, "skipped");
  assert.equal(bad.syllabus.status, "skipped");
  assert.equal(JSON.stringify(bad).includes("test-key"), false);

  const noKey = await extractPatternAndSyllabus({ sections: SOURCE, url: "https://example.com", apiKey: undefined, fetchFn: ok.fetchFn });
  assert.equal(noKey.syllabus.status, "skipped");
  assert.equal(ok.calls.length, 1); // still only the first call
});

suite("AI Assist: which passages are sent");

test("XS01 pattern and syllabus headings are used; advice and other jobs are not", () => {
  const html = `<html><body><main>
    <h2>SSC CHSL Exam Pattern 2026</h2><p>Tier-I has 100 questions for 200 marks in 60 minutes.</p>
    <h2>SSC CHSL Syllabus 2026</h2><p>Quantitative Aptitude: Number System, Percentage.</p>
    <h2>Best Books for SSC CHSL Syllabus</h2><p>Book A, Book B.</p>
    <h2>SSC CHSL Syllabus Preparation Tips</h2><p>Study daily for six hours.</p>
    <h2>SSC CHSL Previous Year Cut Off</h2><p>UR 157.36</p>
    <h2>RRB NTPC Recruitment 2026 Exam Pattern</h2><p>CBT-1 has 100 questions.</p>
    <h2>How to Apply</h2><p>Visit ssc.gov.in.</p>
  </main></body></html>`;
  const sections = buildSyllabusSections(html, "html", "https://example.com/chsl", "SSC CHSL Examination 2026 — Staff Selection Commission");
  const joined = sections.map((s) => s.text).join("\n");
  assert.ok(joined.includes("100 questions for 200 marks"));
  assert.ok(joined.includes("Number System"));
  assert.equal(joined.includes("Book A"), false);
  assert.equal(joined.includes("six hours"), false);
  assert.equal(joined.includes("157.36"), false);
  assert.equal(joined.includes("CBT-1"), false);
  assert.equal(joined.includes("ssc.gov.in"), false);
  assert.equal(buildSyllabusSections("<html><body><h2>How to Apply</h2><p>Visit the site.</p></body></html>", "html", "https://example.com").length, 0);
});

suite("Public mapping");

test("XM01 published snapshot and public job carry both; older snapshots have neither", () => {
  let record = makeRecord();
  record = updateExamPattern(record, pending([TIER1]), ADMIN).record;
  record = updateSyllabus(record, pending([{ paper: "Tier-I", subject: "English Language", topics: ["Synonyms"] }]), ADMIN).record;
  const snapshot = projectForPreview(record);
  const job = snapshotToGovernmentRecruitment(snapshot);
  assert.equal(job.examPattern?.[0].name, "Tier-I");
  assert.equal(job.examPattern?.[0].sections.length, 2);
  assert.deepEqual(job.syllabus, [{ paper: "Tier-I", subject: "English Language", topics: ["Synonyms"] }]);

  const older = { ...snapshot } as Record<string, unknown>;
  delete older.examPattern;
  delete older.syllabus;
  const oldJob = snapshotToGovernmentRecruitment(older as never);
  assert.equal(oldJob.examPattern, undefined);
  assert.equal(oldJob.syllabus, undefined);
});
