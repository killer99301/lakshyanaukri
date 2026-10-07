// ═══════════════════════════════════════════════════════════
// Syllabus library: reading a library file and offering it on a job
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  SY01  the LIBRARY block gives the exam name and tidy match words
//  SY02  a file without an exam name, match words or readable content is refused
//  SY03  match words that would fit unrelated jobs are refused
//  SY04  a file is offered only when all words of one alternative are in the job's names
//  SY05  whole words only: Graduate is not offered on an Undergraduate job
//  SY06  the most specific match comes first
//  SY07  the LIBRARY block is removed before the file goes into the paste box
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { parseContentFile } from "@/lib/cms/content-import";
import { examKey, readLibraryFile, stripLibraryBlock, suggestFromLibrary, LibraryFileError } from "@/lib/cms/syllabus-library";

const BODY = `SOURCE
Basis: OFFICIAL NOTICE (2026)

EXAM PATTERN

Paper: Tier-I
Subjects:
General Awareness | 25 | 50

SYLLABUS

Subject: General Awareness
Topics:
History
Geography
`;

const FILE = `LIBRARY
Exam:  SSC CHSL   (Combined Higher Secondary Level)
Match: SSC-CHSL; Combined Higher Secondary ; ssc chsl

${BODY}`;

suite("Syllabus library file");

test("SY01 the LIBRARY block gives the exam name and tidy match words", () => {
  const read = readLibraryFile(FILE);
  assert.equal(read.exam, "SSC CHSL (Combined Higher Secondary Level)");
  assert.deepEqual(read.match, ["ssc chsl", "combined higher secondary"]);
  assert.equal(read.basis, "OFFICIAL NOTICE (2026)");
  assert.equal(read.papers, 1);
  assert.equal(read.subjects, 1);
  assert.equal(examKey(read.exam), "ssc-chsl-combined-higher-secondary-level");
});

test("SY02 a file without an exam name, match words or readable content is refused", () => {
  assert.throws(() => readLibraryFile(BODY), LibraryFileError);
  assert.throws(() => readLibraryFile(`LIBRARY\nMatch: ssc chsl\n\n${BODY}`), /“Exam:” line/);
  assert.throws(() => readLibraryFile(`LIBRARY\nExam: SSC CHSL\n\n${BODY}`), /“Match:” line/);
  assert.throws(() => readLibraryFile("LIBRARY\nExam: SSC CHSL\nMatch: ssc chsl\n\nSOURCE\nBasis: x\n"), /nothing to keep/);
  // Lines after the block has ended are not read as its header.
  assert.throws(() => readLibraryFile(`LIBRARY\nExam: SSC CHSL\n\n${BODY}\nMatch: ssc chsl\n`), /“Match:” line/);
});

test("SY03 match words that would fit unrelated jobs are refused", () => {
  assert.throws(() => readLibraryFile(`LIBRARY\nExam: IBPS PO\nMatch: po\n\n${BODY}`), /too short/);
  assert.throws(() => readLibraryFile(`LIBRARY\nExam: IBPS PO\nMatch: ibps po; 2026\n\n${BODY}`), /too short/);
  assert.deepEqual(readLibraryFile(`LIBRARY\nExam: CTET\nMatch: ctet\n\n${BODY}`).match, ["ctet"]);
});

const LIBRARY = [
  { exam: "SSC CHSL", match: ["ssc chsl", "combined higher secondary"] },
  { exam: "RRB NTPC (Graduate)", match: ["rrb ntpc graduate"] },
  { exam: "RRB NTPC (Undergraduate)", match: ["rrb ntpc undergraduate"] },
  { exam: "RRB (any)", match: ["rrb"] },
  { exam: "IBPS PO", match: ["ibps po", "ibps probationary officer"] },
];
const offered = (...names: Array<string | undefined>) => suggestFromLibrary(LIBRARY, names).map((e) => e.exam);

suite("Offering a library file on a job");

test("SY04 a file is offered only when all words of one alternative are in the job's names", () => {
  assert.deepEqual(offered("SSC CHSL (10+2) Examination 2027"), ["SSC CHSL"]);
  assert.deepEqual(offered("Combined Higher Secondary Level Examination 2027", undefined, "Staff Selection Commission"), ["SSC CHSL"]);
  assert.deepEqual(offered("IBPS CRP PO/MT-XVII 2027"), ["IBPS PO"]);
  // The organisation name counts too.
  assert.deepEqual(offered("Probationary Officer Recruitment 2027", undefined, "IBPS"), ["IBPS PO"]);
  assert.deepEqual(offered("SSC CGL 2027"), []);
  assert.deepEqual(offered("IBPS Clerk 2027"), []);
  assert.deepEqual(offered(), []);
});

test("SY05 whole words only: Graduate is not offered on an Undergraduate job", () => {
  assert.deepEqual(offered("RRB NTPC Undergraduate Level Recruitment (CEN 07/2026)"), ["RRB NTPC (Undergraduate)", "RRB (any)"]);
  assert.deepEqual(offered("RRB NTPC Graduate Level Recruitment (CEN 06/2026)"), ["RRB NTPC (Graduate)", "RRB (any)"]);
  assert.deepEqual(offered("RRBs Group D"), []);
  // Notices also write it as two words, or hyphenated.
  assert.deepEqual(offered("RRB NTPC Under Graduate Level (CEN 07/2026)"), ["RRB NTPC (Undergraduate)", "RRB (any)"]);
  assert.deepEqual(offered("RRB NTPC Under-Graduate Posts"), ["RRB NTPC (Undergraduate)", "RRB (any)"]);
  assert.deepEqual(suggestFromLibrary([{ exam: "Graduate file", match: ["kvs graduate teacher"] }], ["KVS Post Graduate Teacher 2026"]), []);
});

test("SY06 the most specific match comes first", () => {
  assert.equal(offered("RRB NTPC Graduate Level 2026")[0], "RRB NTPC (Graduate)");
});

test("SY07 the LIBRARY block is removed before the file goes into the paste box", () => {
  const stripped = stripLibraryBlock(FILE);
  assert.ok(stripped.startsWith("SOURCE"));
  assert.ok(!/LIBRARY|Match:/.test(stripped));
  assert.deepEqual(parseContentFile(stripped), parseContentFile(BODY));
  assert.equal(stripLibraryBlock(BODY), BODY);
});
