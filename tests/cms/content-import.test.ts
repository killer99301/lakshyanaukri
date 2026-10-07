// ═══════════════════════════════════════════════════════════
// Reading a prepared content file (exam pattern + syllabus)
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  CI01  papers with subjects, questions and marks are read as written
//  CI02  syllabus in "Paper / Subject / Topics" form
//  CI03  syllabus in "Heading, then bullet lines" form
//  CI04  a described (prose) exam pattern is not read, and says so
//  CI05  a file not from an official notice is flagged
//  CI06  over-long notes, subjects and too many topics are reported, never silently lost
//  CI07  what is read passes the server's own cleaning unchanged
//  CI08  text without the headings yields nothing and a plain reason
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { parseContentFile } from "@/lib/cms/content-import";
import { cleanExamPattern, cleanSyllabus } from "@/lib/cms/record-ops";

const FILE = `SOURCE
Basis: OFFICIAL NOTICE (this year)
Official notice: https://www.rrbapply.gov.in/assets/forms/CEN_05_2026_PM.pdf
Pages used: 15-16, 33

EXAM PATTERN

Paper: Computer Based Test (CBT)
Mode: Computer Based
Duration (minutes): 90
Total questions: 100
Total marks: 100
Negative marking: 1/3 of the marks allotted for each question
Note: Qualifying in nature
Subjects:
Professional ability | 70 | 70
General Awareness | 10 | 10
General science | 10

Paper: Typing Test
Mode: Skill test

SYLLABUS

Paper: Common for all posts
Subject: General Arithmetics
Topics:
Number systems
BODMAS
Calendar & Clock

Paper: Common for all posts
Subject: General Science
Topics:
Physics, Chemistry and Life Sciences (up to 10th Standard CBSE syllabus)

NOTES FOR ASHISH

- Age limit on the live page is empty.
Subject: this line is in the notes and must not become a subject
`;

suite("Prepared content file");

test("CI01 papers with subjects, questions and marks are read as written", () => {
  const { examPattern, basis, warnings } = parseContentFile(FILE);
  assert.equal(basis, "OFFICIAL NOTICE (this year)");
  assert.deepEqual(warnings, []);
  assert.equal(examPattern.length, 2);
  assert.deepEqual(examPattern[0], {
    name: "Computer Based Test (CBT)",
    mode: "Computer Based",
    durationMinutes: 90,
    totalQuestions: 100,
    totalMarks: 100,
    negativeMarking: "1/3 of the marks allotted for each question",
    note: "Qualifying in nature",
    sections: [
      { subject: "Professional ability", questions: 70, marks: 70 },
      { subject: "General Awareness", questions: 10, marks: 10 },
      { subject: "General science", questions: 10 },
    ],
  });
  assert.deepEqual(examPattern[1], { name: "Typing Test", mode: "Skill test", sections: [] });
});

test("CI02 syllabus in \"Paper / Subject / Topics\" form", () => {
  const { syllabus } = parseContentFile(FILE);
  assert.deepEqual(syllabus, [
    { subject: "General Arithmetics", topics: ["Number systems", "BODMAS", "Calendar & Clock"], paper: "Common for all posts" },
    { subject: "General Science", topics: ["Physics, Chemistry and Life Sciences (up to 10th Standard CBSE syllabus)"], paper: "Common for all posts" },
  ]);
});

test("CI03 syllabus in \"Heading, then bullet lines\" form", () => {
  const { syllabus } = parseContentFile(`SYLLABUS
Tier-I: English Language
- Spot the Error
- Fill in the Blanks

Tier-I: General Intelligence
- Semantic Analogy

General Awareness
* History
* Culture
`);
  assert.deepEqual(syllabus, [
    { subject: "English Language", topics: ["Spot the Error", "Fill in the Blanks"], paper: "Tier-I" },
    { subject: "General Intelligence", topics: ["Semantic Analogy"], paper: "Tier-I" },
    { subject: "General Awareness", topics: ["History", "Culture"] },
  ]);
});

test("CI04 a described (prose) exam pattern is not read, and says so", () => {
  const { examPattern, warnings } = parseContentFile(`EXAM PATTERN
The examination comprises two successive stages:
1. Preliminary Examination (Objective Type)
- Paper I: General Studies

SYLLABUS
Prelims: General Studies
- Current events
`);
  assert.deepEqual(examPattern, []);
  assert.ok(warnings.some((w) => /written as a description/.test(w)));
});

test("CI05 a file not from an official notice is flagged", () => {
  const { warnings, basis } = parseContentFile(`SOURCE
Basis: NOT FROM AN OFFICIAL NOTICE (own knowledge)

SYLLABUS
Subject: Reasoning
Topics:
Analogies
`);
  assert.equal(basis, "NOT FROM AN OFFICIAL NOTICE (own knowledge)");
  assert.ok(warnings.some((w) => /NOT from an official notice/.test(w)));
});

test("CI06 over-long notes, subjects and too many topics are reported, never silently lost", () => {
  const longNote = "x".repeat(601);
  const longSubject = "S".repeat(201);
  const topics = Array.from({ length: 81 }, (_, i) => `Topic ${i + 1}`).join("\n");
  const { examPattern, warnings } = parseContentFile(`EXAM PATTERN
Paper: Tier-I
Note: ${longNote}
Subjects:
${longSubject} | 10 | 10

SYLLABUS
Subject: Everything
Topics:
${topics}

Subject: Empty one
Topics:
`);
  assert.equal(examPattern[0].note, undefined);
  assert.ok(warnings.some((w) => /note is longer than 600/.test(w)));
  assert.ok(warnings.some((w) => /longer than 200 characters/.test(w)));
  assert.ok(warnings.some((w) => /has 81 topics/.test(w)));
  assert.ok(warnings.some((w) => /had no topics/.test(w)));
});

test("CI07 what is read passes the server's own cleaning unchanged", () => {
  const { examPattern, syllabus } = parseContentFile(FILE);
  assert.deepEqual(cleanExamPattern(examPattern), examPattern);
  assert.deepEqual(cleanSyllabus(syllabus), syllabus);
});

test("CI08 text without the headings yields nothing and a plain reason", () => {
  const out = parseContentFile("Subject: Maths\nTopics:\nAlgebra");
  assert.deepEqual(out.examPattern, []);
  assert.deepEqual(out.syllabus, []);
  assert.ok(out.warnings.some((w) => /heading was found/.test(w)));
});
