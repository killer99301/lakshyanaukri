// ═══════════════════════════════════════════════════════════
// A library file made from a job's own syllabus
//
//   npx tsx --tsconfig tsconfig.json tests/cms/library-from-job.test.ts
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";
import { parseContentFile } from "@/lib/cms/content-import";
import { readLibraryFile, suggestFromLibrary } from "@/lib/cms/syllabus-library";
import { approvedBasis, autoBasis, buildLibraryFile, isAutoEntryOf, isUnapproved, libraryExamName, libraryMatchTerm, updatedBasis, withBasis } from "@/lib/cms/library-from-job";
import { compareWithLibrary } from "@/lib/cms/library-compare";

suite("Library file from a job");

test("LJ01 the exam name drops the year, the notice number and portal wording", () => {
  assert.equal(libraryExamName("TNPSC Group IV Recruitment 2026 (Combined Civil Services Examination-IV, Notification No. 11/2026)"), "TNPSC Group IV");
  assert.equal(libraryExamName("JKSSB MTS Recruitment 2026 - Apply Online for 2863 Class-IV (MTS) / Sanitation Worker Posts"), "JKSSB MTS");
  assert.equal(libraryExamName("MP Police Constable (Driver) Recruitment Test 2026"), "MP Police Constable Test");
  assert.equal(libraryExamName("SAIL Bhilai Steel Plant Apprentice Recruitment 2026-27"), "SAIL Bhilai Steel Plant Apprentice");
  assert.equal(libraryExamName("BPSC TRE 4.0 School Teacher Recruitment 2026 (Advt. No. 15/2026)"), "BPSC TRE 4.0 School Teacher");
});

test("LJ02 a title that leaves one word, or nothing, names no exam", () => {
  assert.equal(libraryExamName("Recruitment 2026"), null);
  assert.equal(libraryExamName("SSC Recruitment 2026"), null);
  assert.equal(libraryExamName(""), null);
});

const PATTERN: ExamPatternPaper[] = [
  {
    name: "Paper I", mode: "OMR based", durationMinutes: 180, totalQuestions: 200, totalMarks: 300,
    negativeMarking: "No negative marking", note: "Minimum 90 marks to qualify",
    sections: [{ subject: "Tamil Eligibility-cum-Scoring Test", questions: 100, marks: 150 }, { subject: "General Studies | Aptitude", questions: 100, marks: 150 }],
  },
  { name: "Typing Test", sections: [] },
];
const SYLLABUS: SyllabusSubject[] = [
  { paper: "Paper I", subject: "General Studies", topics: ["General Science", "Current Events", "History and Culture of India"] },
  { paper: "Paper I", subject: "Aptitude and Mental Ability", topics: ["Simplification", "Percentage"] },
  { subject: "Typing", topics: ["Tamil and English typewriting"] },
];

test("LJ03 the file reads back to the same pattern and syllabus", () => {
  const file = buildLibraryFile({ exam: "TNPSC Group IV", basis: autoBasis("TNPSC Group IV Recruitment 2026", "tnpsc-group-iv-2026", "12 Oct 2026"), examPattern: PATTERN, syllabus: SYLLABUS });
  const read = parseContentFile(file);
  // "|" separates columns in a file, so it is written as "/" inside a subject's name.
  const expected = PATTERN.map((p) => ({ ...p, sections: p.sections.map((s) => ({ ...s, subject: s.subject.replace(/\|/g, "/") })) }));
  assert.deepEqual(read.examPattern, expected);
  assert.deepEqual(read.syllabus, SYLLABUS);
  assert.deepEqual(read.warnings, []);
});

test("LJ04 the library accepts the file, and it is offered on next year's job only", () => {
  const file = buildLibraryFile({ exam: "TNPSC Group IV", basis: autoBasis("TNPSC Group IV Recruitment 2026", "tnpsc-group-iv-2026", "12 Oct 2026"), examPattern: PATTERN, syllabus: SYLLABUS });
  const header = readLibraryFile(file);
  assert.equal(header.exam, "TNPSC Group IV");
  assert.deepEqual(header.match, ["tnpsc group iv"]);
  assert.equal(libraryMatchTerm("TNPSC Group IV"), "tnpsc group iv");
  assert.match(header.basis ?? "", /^Saved automatically from the job “TNPSC Group IV Recruitment 2026” \(tnpsc-group-iv-2026\) on 12 Oct 2026\. Not checked/);
  const entry = { exam: header.exam, match: header.match };
  assert.equal(suggestFromLibrary([entry], ["TNPSC Group IV Recruitment 2027 (Notification No. 09/2027)"]).length, 1);
  assert.equal(suggestFromLibrary([entry], ["TNPSC Group II Recruitment 2027"]).length, 0);
  assert.equal(suggestFromLibrary([entry], ["TNPSC Group I Services 2027"]).length, 0);
});

test("LJ05 a syllabus with no exam pattern still makes a file", () => {
  const file = buildLibraryFile({ exam: "JKSSB MTS", basis: autoBasis("JKSSB MTS 2026", "jkssb-mts-2026", "12 Oct 2026"), examPattern: [], syllabus: SYLLABUS });
  assert.equal(readLibraryFile(file).subjects, 3);
  assert.doesNotMatch(file, /EXAM PATTERN/);
});

test("LJ06 only the job that made an entry may refresh it", () => {
  const basis = autoBasis("TNPSC Group IV Recruitment 2026", "tnpsc-group-iv-2026", "12 Oct 2026");
  assert.equal(isAutoEntryOf(basis, "tnpsc-group-iv-2026"), true);
  assert.equal(isAutoEntryOf(basis, "tnpsc-group-iv-2027"), false);
  assert.equal(isAutoEntryOf("TNPSC notification 2024, checked by hand", "tnpsc-group-iv-2026"), false);
  assert.equal(isAutoEntryOf(undefined, "tnpsc-group-iv-2026"), false);
});


suite("Approving and replacing a library entry");

test("LJ07 approving rewrites only the source line, and the entry is then nobody's to refresh", () => {
  const basis = autoBasis("TNPSC Group IV Recruitment 2026", "tnpsc-group-iv-2026", "12 Oct 2026");
  const file = buildLibraryFile({ exam: "TNPSC Group IV", basis, examPattern: PATTERN, syllabus: SYLLABUS });
  assert.equal(isUnapproved(readLibraryFile(file).basis), true);
  const approved = withBasis(file, approvedBasis("13 Oct 2026", basis));
  const header = readLibraryFile(approved);
  assert.equal(header.basis, "Approved on 13 Oct 2026. First saved from the job “TNPSC Group IV Recruitment 2026”.");
  assert.equal(isUnapproved(header.basis), false);
  assert.equal(isAutoEntryOf(header.basis, "tnpsc-group-iv-2026"), false);
  assert.deepEqual(parseContentFile(approved).syllabus, SYLLABUS);
  assert.equal(approved.replace(/^Basis:.*$/m, ""), file.replace(/^Basis:.*$/m, ""));
});

test("LJ08 a file with no source section gets one; an entry's own match words are kept on replacing", () => {
  const bare = "LIBRARY\nExam: SSC CHSL\nMatch: ssc chsl\n\nSYLLABUS\nSubject: English\nTopics:\n- Grammar\n";
  assert.equal(readLibraryFile(withBasis(bare, "Approved on 13 Oct 2026.")).basis, "Approved on 13 Oct 2026.");
  const replaced = buildLibraryFile({ exam: "SSC CHSL (10+2)", match: ["ssc chsl", "combined higher secondary"], basis: updatedBasis("SSC CHSL 2027", "1 Sep 2027"), examPattern: [], syllabus: SYLLABUS });
  assert.deepEqual(readLibraryFile(replaced).match, ["ssc chsl", "combined higher secondary"]);
  assert.equal(readLibraryFile(replaced).basis, "Updated on 1 Sep 2027 from the job “SSC CHSL 2027” and approved.");
});

suite("Old against new");

test("LC01 the same content has no differences", () => {
  const same = compareWithLibrary({ examPattern: PATTERN, syllabus: SYLLABUS }, { examPattern: PATTERN, syllabus: SYLLABUS });
  assert.deepEqual([same.pattern, same.syllabus, same.notCompared], [[], [], []]);
});

test("LC02 a changed exam pattern is spelled out", () => {
  const now: ExamPatternPaper[] = [
    { ...PATTERN[0], durationMinutes: 150, totalMarks: 250, negativeMarking: "0.25 marks per wrong answer",
      sections: [{ subject: "Tamil Eligibility-cum-Scoring Test", questions: 100, marks: 150 }, { subject: "General Studies", questions: 75, marks: 100 }] },
    { name: "Interview", sections: [] },
  ];
  const d = compareWithLibrary({ examPattern: PATTERN, syllabus: [] }, { examPattern: now, syllabus: [] }).pattern;
  assert.ok(d.includes("New on this job: paper “Interview”."));
  assert.ok(d.includes("In the library but not on this job: paper “Typing Test”."));
  assert.ok(d.includes("“Paper I” duration (minutes): 180 in the library, 150 on this job."));
  assert.ok(d.includes("“Paper I” total marks: 300 in the library, 250 on this job."));
  assert.ok(d.includes("“Paper I” negative marking: No negative marking in the library, 0.25 marks per wrong answer on this job."));
  assert.ok(d.includes("“Paper I”: new subject “General Studies”."));
  assert.ok(d.includes("“Paper I”: subject “General Studies | Aptitude” no longer listed."));
});

test("LC03 syllabus: subjects and topics added or dropped; case and punctuation are not a change", () => {
  const now: SyllabusSubject[] = [
    { paper: "Paper I", subject: "General studies", topics: ["general science", "Current events", "Indian Polity"] },
    { paper: "Paper I", subject: "Tamil Language", topics: ["Grammar"] },
    { subject: "Typing", topics: ["Tamil and English typewriting"] },
  ];
  const d = compareWithLibrary({ examPattern: [], syllabus: SYLLABUS }, { examPattern: [], syllabus: now }).syllabus;
  assert.ok(d.includes("New on this job: subject “Paper I: Tamil Language”."));
  assert.ok(d.includes("In the library but not on this job: subject “Paper I: Aptitude and Mental Ability”."));
  assert.ok(d.includes("“Paper I: General studies”: 1 new topic — “Indian Polity”."));
  assert.ok(d.includes("“Paper I: General studies”: 1 topic no longer listed — “History and Culture of India”."));
  assert.equal(d.length, 4);
});

test("LC04 a part only one side has is reported, not counted as a difference", () => {
  const d = compareWithLibrary({ examPattern: PATTERN, syllabus: SYLLABUS }, { examPattern: [], syllabus: SYLLABUS });
  assert.deepEqual([d.pattern, d.syllabus], [[], []]);
  assert.deepEqual(d.notCompared, ["The library has an exam pattern for this exam; this job has none yet."]);
});
