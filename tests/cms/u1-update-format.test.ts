// CMS 2.0 step U1: the LN Update v1 reader. Pure: it returns proposed information and edits nothing.
// Every job, organisation, number, date and address here is SYNTHETIC test data (the repository is public);
// the shapes copy real cases (SAIL-like walk-in window, SSC CGL-like tiers, RRB-like separate days, IBPS-like
// post-wise papers, SAIL-like two portals), the content does not.
//   npx tsx --tsconfig tsconfig.json tests/cms/u1-update-format.test.ts
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { readUpdateText, updateVersion, checkIdentity, findTarget, type JobIdentity } from "@/lib/cms/importer/update-format";
import { readLabelledLines } from "@/lib/cms/importer/prepared-fields";
import { selectionStageType } from "@/lib/cms/importer/extract";

const STEEL: JobIdentity = { title: "Test Steel Plant Apprentice Recruitment 2026-27", organizationName: "Test Steel Authority Limited", organizationId: "tsal" };
const CGL: JobIdentity = { title: "TSC CGL 2026 (Combined Graduate Level Examination)", organizationName: "Test Selection Commission", organizationId: "tsc", notificationNumber: "HQ-T11018/5/2026-T-1" };

// SAIL-like correction (synthetic).
const STEEL_CORRECTION = `LN Update v1
Job: Test Steel Plant Apprentice Recruitment 2026-27
Notice number: None
Organisation: Test Steel Authority Limited, Test Steel Plant
Update type: Correction
Source: Test apprentice advertisement 2026-27, dated 30 Sep 2026
Source link: https://careers.example.in/advert-2026.pdf

Exam Stages:
Stage: Walk-in Document Verification | Status: Scheduled | From: 27 Oct 2026 | Until: 21 Nov 2026 | As written: 27 Oct – 21 Nov 2026 (trade-wise) | Confirmed
Note: Held trade by trade. Each trade has its own days within this period.

Supersede:
24 Oct 2026 – Walk-in Document Verification rescheduled | Reason: arose from CMS date corrections, not an official notice
29 Oct 2026 – Walk-in Document Verification rescheduled | Reason: arose from CMS date corrections, not an official notice
`;

// SSC CGL-like Tier-II update. SYNTHETIC: future dates invented for the test, not a real announcement.
const CGL_TIER2 = `LN Update v1
Job: TSC CGL 2026 (Combined Graduate Level Examination)
Notice number: HQ-T11018/5/2026-T-1
Organisation: Test Selection Commission
Update type: Schedule
Source: Test notice on Tier-II schedule, dated 20 Dec 2026

Exam Stages:
Stage: Tier-I (Computer Based Test) | Status: Result declared
Stage: Tier-II (Computer Based Test) | Status: Scheduled | From: 18 Jan 2027 | Until: 20 Jan 2027 | Tentative

Exam Pattern:
Stage: Tier-II (Computer Based Test) | Paper: Paper-I | Mode: Computer Based | Duration: 150 minutes | Negative marking: 1 mark per wrong answer
Subject: Mathematical Abilities: 30 Questions, 90 Marks
Subject: Reasoning and General Intelligence: 30 Questions, 90 Marks
Total: 60 Questions, 180 Marks

Syllabus:
Stage: Tier-II (Computer Based Test) | Paper: Paper-I
Subject: Mathematical Abilities: Number systems; Algebra; Geometry; Trigonometry; Statistics
Subject: Reasoning and General Intelligence: Analogy; Classification; Coding-decoding; Venn diagrams

Important Links:
Result: Tier-I result | https://tsc.example.gov.in/result-tier1.pdf
Admit Card: Not yet released

Announcement:
Title: Tier-II dates announced (18–20 Jan 2027, tentative)
Text: The Commission has announced Tier-II from 18 to 20 January 2027 (tentative).
The Tier-I result has been declared.
`;

suite("U1: format and header");

test("U1-01 a text without 'LN Update v1' is not read here (v0.3.1 texts go to the existing readers, unchanged)", () => {
  const v031 = "Test Bank PO Recruitment 2026\nApplication Fee: General/EWS/OBC Rs. 850, SC/ST Rs. 175\nAge Limit: Minimum 20 years, Maximum 30 years as on 1 Aug 2026\n";
  assert.equal(updateVersion(v031), null);
  const r = readUpdateText(v031, { job: STEEL });
  assert.equal(r.format, null);
  assert.equal(r.values.length + r.stages.length + r.links.length + r.unread.length, 0, "nothing read, nothing refused");
  // The v0.3.1 reader still reads the same text exactly as before.
  const old = readLabelledLines(v031, { stageType: selectionStageType });
  assert.ok(old.values.some((v) => v.fieldPath === "financial.feeGeneral" && v.value === 850));
});

test("U1-02 version and header read; a later version, a missing Job line, or two Job lines refuse the text", () => {
  const r = readUpdateText(STEEL_CORRECTION, { job: STEEL });
  assert.equal(r.format, "LN Update v1");
  assert.equal(r.refused, undefined);
  assert.equal(r.header.updateType, "CORRECTION");
  assert.equal(r.header.noticeNumber, null, "“None” is recorded as no number, not as missing");
  assert.equal(r.header.sourceDate, "2026-09-30");
  assert.equal(r.header.sourceLink, "https://careers.example.in/advert-2026.pdf");
  assert.match(readUpdateText("LN Update v2\nJob: X 2026\n").refused!, /v1 only/);
  assert.match(readUpdateText("LN Update v1\nUpdate type: Schedule\n").refused!, /no “Job:” line/);
  assert.match(readUpdateText("LN Update v1\nJob: A 2026\nJob: B 2026\n").refused!, /two different values/);
});

test("U1-03 an author given in the text is ignored and said (who changed what is recorded by the CMS)", () => {
  const r = readUpdateText(STEEL_CORRECTION.replace("Update type: Correction", "Update type: Correction\nBy: aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb")
    .replace("not an official notice\n", "not an official notice | By: someone\n"), { job: STEEL });
  assert.equal(r.attention.filter((a) => a.code === "ACTOR_IGNORED").length, 2);
  assert.ok(!JSON.stringify({ ...r, attention: [] }).includes("aaaaaaaa-1111"), "the id is not carried anywhere in what is proposed");
});

suite("U1: identity (map to the right job, never a new one)");

test("U1-04 the right job matches", () => {
  assert.equal(readUpdateText(STEEL_CORRECTION, { job: STEEL }).identity.result, "MATCH");
  assert.equal(readUpdateText(CGL_TIER2, { job: CGL }).identity.result, "MATCH");
});

test("U1-05 wrong job: another organisation, another notice number, another exam or another year refuse the text", () => {
  const otherOrg = readUpdateText(STEEL_CORRECTION, { job: { ...STEEL, organizationName: "Test Coal Corporation", organizationId: "tcc" } });
  assert.equal(otherOrg.identity.result, "MISMATCH");
  assert.match(otherOrg.refused!, /another recruitment/);
  const otherNumber = readUpdateText(CGL_TIER2, { job: { ...CGL, notificationNumber: "HQ-T11018/9/2026-T-2" } });
  assert.equal(otherNumber.identity.result, "MISMATCH");
  const otherExam = readUpdateText(CGL_TIER2.replace("Notice number: HQ-T11018/5/2026-T-1\n", ""), { job: { title: "TSC CHSL 2026 (Combined Higher Secondary Level)", organizationName: "Test Selection Commission" } });
  assert.equal(otherExam.identity.result, "MISMATCH", otherExam.identity.reasons.join("; "));
  const otherYear = checkIdentity({ job: "TSC CGL 2025", quotes: [] }, CGL);
  assert.equal(otherYear.result, "MISMATCH");
});

test("U1-06 a title that differs without pointing elsewhere is flagged, not refused", () => {
  const r = readUpdateText(STEEL_CORRECTION.replace("Job: Test Steel Plant Apprentice Recruitment 2026-27", "Job: Test Steel Plant Trade Apprentices 2026-27"), { job: STEEL });
  assert.notEqual(r.identity.result, "MISMATCH");
  assert.equal(r.refused, undefined);
});

suite("U1: SAIL-like stage window and supersession (synthetic)");

test("U1-07 the window is read with its last day; the note stays with its stage; nothing else is touched", () => {
  const r = readUpdateText(STEEL_CORRECTION, { job: STEEL });
  assert.equal(r.stages.length, 1);
  const s = r.stages[0];
  assert.equal(s.dateIso, "2026-10-27");
  assert.equal(s.dateEndIso, "2026-11-21");
  assert.equal(s.dateDisplay, "27 Oct – 21 Nov 2026 (trade-wise)");
  assert.equal(s.status, "SCHEDULED");
  assert.equal(s.certainty, "CONFIRMED");
  assert.match(s.notes!, /trade by trade/);
  assert.equal(s.line, 10);
  for (const k of ["selection", "examPattern", "syllabus", "links", "announcement", "fees", "age", "eligibility", "vacancies"] as const) {
    assert.equal(r.sections[k].state, "OMITTED", `${k} is not in the text: it must be kept, not cleared`);
  }
  assert.equal(r.unread.length, 0);
});

test("U1-08 the supersessions are proposals with their reason; nothing is executed; no announcement for a correction", () => {
  const r = readUpdateText(STEEL_CORRECTION, { job: STEEL });
  assert.deepEqual(r.supersede.map((x) => [x.date, x.title, x.problems.length]), [["2026-10-24", "Walk-in Document Verification rescheduled", 0], ["2026-10-29", "Walk-in Document Verification rescheduled", 0]]);
  assert.equal(r.announcement, null);
  const withAnn = readUpdateText(`${STEEL_CORRECTION}\nAnnouncement:\nTitle: Walk-in dates corrected\nText: The walk-in runs to 21 Nov.\n`, { job: STEEL });
  assert.equal(withAnn.announcement?.offeredUnticked, true, "a correction's announcement is offered unticked");
});

test("U1-09 a stage window with the last day before the first, or Until without From, gives no date", () => {
  const bad = readUpdateText(STEEL_CORRECTION.replace("From: 27 Oct 2026 | Until: 21 Nov 2026", "From: 21 Nov 2026 | Until: 27 Oct 2026"), { job: STEEL });
  assert.equal(bad.stages[0].dateIso, undefined);
  assert.ok(bad.attention.some((a) => a.code === "BAD_DATE"));
  const noFrom = readUpdateText(STEEL_CORRECTION.replace("From: 27 Oct 2026 | ", ""), { job: STEEL });
  assert.equal(noFrom.stages[0].dateEndIso, undefined);
  assert.ok(noFrom.attention.some((a) => a.code === "BAD_DATE" && /needs a “From”/.test(a.message)));
});

test("U1-10 a supersession without a reason, or with one over 200 characters, is said", () => {
  const r = readUpdateText(`LN Update v1
Job: Test Steel Plant Apprentice Recruitment 2026-27
Update type: Correction

Supersede:
24 Oct 2026 – Walk-in rescheduled
29 Oct 2026 – Walk-in rescheduled again | Reason: ${"x".repeat(201)}
`, { job: STEEL });
  assert.match(r.supersede[0].problems.join(" "), /no reason/);
  assert.match(r.supersede[1].problems.join(" "), /keep it to 200/);
  assert.match(r.supersede[0].problems.join(" "), /say what replaces it/, "no source link in the header and none on the line");
});

suite("U1: SSC CGL-like stages, pattern and syllabus (synthetic)");

test("U1-11 Tier-I status only; Tier-II added as a tentative window", () => {
  const r = readUpdateText(CGL_TIER2, { job: CGL });
  const [t1, t2] = r.stages;
  assert.deepEqual([t1.name, t1.status, t1.dateIso], ["Tier-I (Computer Based Test)", "RESULT_DECLARED", undefined]);
  assert.deepEqual([t2.status, t2.dateIso, t2.dateEndIso, t2.certainty], ["SCHEDULED", "2027-01-18", "2027-01-20", "TENTATIVE"]);
});

test("U1-12 the pattern keeps its stage and paper; printed figures only; a wrong total is said, not corrected", () => {
  const r = readUpdateText(CGL_TIER2, { job: CGL });
  assert.equal(r.pattern.length, 1);
  const p = r.pattern[0];
  assert.deepEqual(p.context, { stage: "Tier-II (Computer Based Test)", paper: "Paper-I" });
  assert.deepEqual([p.name, p.mode, p.durationMinutes, p.negativeMarking, p.totalQuestions, p.totalMarks], ["Paper-I", "Computer Based", 150, "1 mark per wrong answer", 60, 180]);
  assert.deepEqual(p.sections.map((s) => [s.subject, s.questions, s.marks]), [["Mathematical Abilities", 30, 90], ["Reasoning and General Intelligence", 30, 90]]);
  assert.equal(p.problems.length, 0);
  assert.equal(p.scope, "ITEMS");
  const wrong = readUpdateText(CGL_TIER2.replace("Total: 60 Questions, 180 Marks", "Total: 65 Questions, 200 Marks"), { job: CGL });
  assert.match(wrong.pattern[0].problems[0], /add up to 60 questions and 180 marks/);
  assert.equal(wrong.pattern[0].totalQuestions, 65, "the printed total is kept as printed");
});

test("U1-13 the syllabus keeps its stage and paper; topics as written; only the subjects given", () => {
  const r = readUpdateText(CGL_TIER2, { job: CGL });
  assert.equal(r.syllabus.length, 1);
  assert.deepEqual(r.syllabus[0].context, { stage: "Tier-II (Computer Based Test)", paper: "Paper-I" });
  assert.deepEqual(r.syllabus[0].subjects.map((s) => [s.subject, s.topics.length]), [["Mathematical Abilities", 5], ["Reasoning and General Intelligence", 4]]);
  assert.equal(r.syllabus[0].scope, "ITEMS", "two subjects given: changes to those two, never a whole new syllabus");
});

test("U1-14 links, a link not yet released, and one announcement (continued lines kept)", () => {
  const r = readUpdateText(CGL_TIER2, { job: CGL });
  assert.deepEqual(r.links.map((l) => [l.type, l.label]), [["RESULT", "Tier-I result"]]);
  assert.deepEqual(r.pendingLinks.map((l) => [l.type, l.says]), [["ADMIT_CARD", "Not yet released"]]);
  assert.equal(r.announcement?.title, "Tier-II dates announced (18–20 Jan 2027, tentative)");
  assert.match(r.announcement!.text!, /result has been declared/);
  assert.equal(r.announcement?.offeredUnticked, false);
  assert.equal(r.unread.length, 0);
  assert.equal(r.attention.length, 0);
});

suite("U1: partial additions versus explicit replacement");

test("U1-15 only Mathematics given: a change to Mathematics; the other subjects are not mentioned (kept)", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: New information\n\nSyllabus:\nStage: Tier-I (Computer Based Test)\nSubject: Quantitative Aptitude: Percentage; Ratio and proportion\n`, { job: CGL });
  assert.equal(r.syllabus[0].scope, "ITEMS");
  assert.equal(r.syllabus[0].subjects.length, 1);
  assert.equal(r.sections.syllabus.scope, "ITEMS");
});

test("U1-16 'Complete list' is the only way to replace a whole list: per block, or per section", () => {
  const block = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: Corrigendum\n\nSyllabus:\nStage: Tier-I (Computer Based Test) | Complete list\nSubject: English: Grammar; Vocabulary\n`, { job: CGL });
  assert.equal(block.syllabus[0].scope, "COMPLETE_LIST");
  assert.equal(block.sections.syllabus.scope, "ITEMS", "the rest of the syllabus (other stages) is not replaced");
  const section = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: Corrigendum\n\nExam Pattern: Complete list\nStage: Tier-I (Computer Based Test)\nSubject: English: 25 Questions, 50 Marks\n`, { job: CGL });
  assert.equal(section.sections.examPattern.scope, "COMPLETE_LIST");
});

suite("U1: post-wise and stage-wise differences (IBPS-like, synthetic)");

const POSTWISE = `LN Update v1
Job: Test Bank Specialist Officers 2026
Organisation: Test Banking Personnel Institute
Update type: New information

Exam Pattern:
Stage: Mains | Post: IT Officer | Duration: 45 minutes
Subject: Professional Knowledge: 60 Questions, 60 Marks
Stage: Mains | Post: Law Officer | Duration: 45 minutes
Subject: Professional Knowledge: 60 Questions, 60 Marks

Syllabus:
Stage: Mains | Post: IT Officer
Subject: Professional Knowledge: Data structures; Networking; Databases
Post: Law Officer
Subject: Professional Knowledge: Contract law; Banking regulation
`;
const BANK: JobIdentity = { title: "Test Bank Specialist Officers 2026", organizationName: "Test Banking Personnel Institute" };

test("U1-17 the same stage and subject for two posts are two blocks, each with its post", () => {
  const r = readUpdateText(POSTWISE, { job: BANK });
  assert.deepEqual(r.pattern.map((p) => p.context), [{ stage: "Mains", post: "IT Officer" }, { stage: "Mains", post: "Law Officer" }]);
  assert.deepEqual(r.syllabus.map((b) => [b.context.stage, b.context.post, b.subjects[0].topics[0]]), [["Mains", "IT Officer", "Data structures"], ["Mains", "Law Officer", "Contract law"]]);
  assert.equal(r.attention.length, 0);
  assert.equal(r.unread.length, 0);
});

test("U1-18 the same stage given for one post and also with no post: flagged as ambiguous", () => {
  const r = readUpdateText(POSTWISE.replace("Post: Law Officer\nSubject: Professional Knowledge: Contract law", "Stage: Mains\nSubject: Professional Knowledge: Contract law"), { job: BANK });
  assert.ok(r.attention.some((a) => a.code === "AMBIGUOUS_CONTEXT" && /syllabus/.test(a.message)));
});

test("U1-19 a syllabus or pattern row with no stage above it is held back and said", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: New information\n\nSyllabus:\nSubject: English: Grammar; Vocabulary\n\nExam Pattern:\nSubject: English: 25 Questions, 50 Marks\n`, { job: CGL });
  assert.deepEqual(r.syllabus[0].context, {});
  assert.equal(r.attention.filter((a) => a.code === "NO_CONTEXT").length, 2);
  assert.equal(r.pattern.length, 0);
  assert.equal(r.unread.length, 1);
});

test("U1-20 matching to the job's items: a stage name alone is not enough when the job keeps it post by post", () => {
  type B = { name: string; post?: string; paper?: string };
  const job: B[] = [{ name: "Mains", post: "IT Officer" }, { name: "Mains", post: "Law Officer" }, { name: "Prelims" }];
  const d = (b: B) => b;
  assert.equal(findTarget(job, { name: "Mains", post: "IT Officer" }, d).kind, "MATCH");
  const noPost = findTarget(job, { name: "Mains" }, d);
  assert.equal(noPost.kind, "AMBIGUOUS");
  assert.equal(findTarget(job, { name: "Mains", post: "HR Officer" }, d).kind, "AMBIGUOUS", "a new post's Mains is a question, not a silent copy");
  assert.equal(findTarget(job, { name: "prelims" }, d).kind, "MATCH");
  assert.equal(findTarget(job, { name: "Interview" }, d).kind, "NONE");
  const loose = findTarget([{ name: "Tier-II (Computer Based Test)" }], { name: "Tier-II" }, d);
  assert.ok(loose.kind === "MATCH" && loose.loose, "a contained name matches only as a loose match, which the review shows");
  const twoTiers = findTarget([{ name: "Tier I Exam" }, { name: "Tier I Exam Paper 2" }], { name: "Tier I Exam Paper" }, d);
  assert.notEqual(twoTiers.kind, "MATCH");
});

suite("U1: RRB-like separate days and multiple portals (synthetic)");

test("U1-21 two separate days are kept as written: never one date, never a window", () => {
  const r = readUpdateText(`LN Update v1\nJob: Test Railway Paramedical 2026\nUpdate type: Schedule\n\nExam Stages:\nStage: CBT | Status: Scheduled | Date: 23 & 25 Nov 2026 | Tentative\n`);
  const s = r.stages[0];
  assert.deepEqual(s.days, ["2026-11-23", "2026-11-25"]);
  assert.equal(s.dateEndIso, undefined);
  assert.equal(s.dateDisplay, "23 & 25 Nov 2026");
  assert.equal(s.certainty, "TENTATIVE");
});

test("U1-22 two Apply Online portals, each with its label and who it is for", () => {
  const r = readUpdateText(`LN Update v1
Job: Test Steel Plant Apprentice Recruitment 2026-27
Update type: New information

Important Links:
Apply Online: NATS portal | https://nats.example.gov.in/ | For: Graduate and Diploma apprentices
Apply Online: Apprenticeship portal | https://apprentice.example.gov.in/ | For: ITI trade apprentices
Official Notification: Advertisement 2026-27 | https://careers.example.in/advert-2026.pdf
Apply Online: https://nats.example.gov.in/
`, { job: STEEL });
  const apply = r.links.filter((l) => l.type === "APPLY_ONLINE");
  assert.equal(apply.length, 2, "the same portal given twice is read once");
  assert.deepEqual(apply.map((l) => l.appliesTo), ["Graduate and Diploma apprentices", "ITI trade apprentices"]);
  assert.ok(r.attention.some((a) => a.code === "CONFLICT" && /link/.test(a.message)) === false);
  assert.ok(r.attention.some((a) => a.code === "DUPLICATE" || a.code === "CONFLICT"));
  assert.equal(r.links.find((l) => l.type === "OFFICIAL_NOTIFICATION")?.url, "https://careers.example.in/advert-2026.pdf");
});

suite("U1: missing, not specified, not applicable, removed");

test("U1-23 'Not specified in the notice' and 'Not applicable' are recorded, distinct from not mentioned", () => {
  const r = readUpdateText(`LN Update v1
Job: TSC CGL 2026
Update type: New information

Syllabus: Not specified in the notice
Exam Pattern:
Stage: Document Verification | Not applicable
Age Limit: Not applicable
`, { job: CGL });
  assert.equal(r.sections.syllabus.state, "NOT_SPECIFIED");
  assert.equal(r.sections.age.state, "NOT_APPLICABLE");
  assert.equal(r.pattern[0].state, "NOT_APPLICABLE");
  assert.equal(r.sections.fees.state, "OMITTED");
  assert.equal(r.sections.eligibility.state, "OMITTED");
  assert.equal(r.values.length, 0, "a state is not a value: nothing is cleared by it");
});

test("U1-24 a single subject 'Not specified' stays a state on that subject; other subjects untouched", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: New information\n\nSyllabus:\nStage: Tier-I (Computer Based Test)\nSubject: General Awareness: Not specified in the notice\n`, { job: CGL });
  assert.deepEqual(r.syllabus[0].subjects.map((s) => [s.subject, s.state, s.topics.length]), [["General Awareness", "NOT_SPECIFIED", 0]]);
});

test("U1-25 'Unchanged' is read as not mentioned, and said", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: New information\n\nSyllabus: Unchanged\n`, { job: CGL });
  assert.equal(r.sections.syllabus.state, "OMITTED");
  assert.ok(r.attention.some((a) => a.code === "UNCHANGED_WORD"));
});

test("U1-26 removals: only when written out, each with its kind and context", () => {
  const r = readUpdateText(`LN Update v1
Job: Test Bank Specialist Officers 2026
Update type: Corrigendum

Remove: Post: Rajbhasha Adhikari
Remove: Link: https://old.example.in/apply
Syllabus:
Stage: Mains | Post: IT Officer
Remove: Subject: Networking
Remove:
Stage: Interview
Paper: Something vague
Remove: Whatever this is
`, { job: BANK });
  assert.deepEqual(r.removals.map((x) => [x.target, x.name, x.context.stage ?? null, x.context.post ?? null]), [
    ["POST", "Rajbhasha Adhikari", null, null],
    ["LINK", "https://old.example.in/apply", null, null],
    ["SUBJECT", "Networking", "Mains", "IT Officer"],
    ["STAGE", "Interview", null, null],
    ["PAPER", "Something vague", null, null],
  ]);
  assert.equal(r.unread.length, 1, "a removal that does not say what kind of item is not guessed");
});

suite("U1: duplicates, conflicts and unread lines");

test("U1-27 two lines that disagree about one stage give nothing for it; both are shown", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: Schedule\n\nExam Stages:\nStage: Tier-II | Status: Scheduled | Date: 18 Jan 2027\nStage: Tier-II | Status: Scheduled | Date: 19 Jan 2027\nStage: Tier-I | Status: Result declared\nStage: Tier-I | Status: Result declared\n`, { job: CGL });
  assert.deepEqual(r.stages.map((s) => s.name), ["Tier-I"]);
  const c = r.attention.find((a) => a.code === "CONFLICT")!;
  assert.deepEqual(c.lines, [6, 7]);
  assert.ok(r.attention.some((a) => a.code === "DUPLICATE"));
});

test("U1-28 two different topic lists for one subject: conflict; two announcements: none offered", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: Schedule\n\nSyllabus:\nStage: Tier-I\nSubject: English: Grammar\nSubject: English: Vocabulary\n\nAnnouncement:\nTitle: One\nText: First.\nTitle: Two\nText: Second.\n`, { job: CGL });
  assert.equal(r.syllabus[0].subjects.length, 0);
  assert.ok(r.attention.some((a) => a.code === "CONFLICT" && /syllabus subject/.test(a.message)));
  assert.equal(r.announcement, null);
  assert.ok(r.attention.some((a) => a.code === "TWO_ANNOUNCEMENTS"));
});

test("U1-29 every line is accounted for: lines not understood are listed with the reason, never dropped", () => {
  const r = readUpdateText(`LN Update v1
Job: TSC CGL 2026
Update type: Schedule
Prepared on: 1 Dec 2026

Exam Stages:
Tier-II will probably be in January
Stage: Tier-II | Status: Maybe | Venue: Delhi

Important Links:
Apply Online: see the website
Some heading-less sentence about the exam.
See https://example.in/notice.pdf for details.
`, { job: CGL });
  const lines = r.unread.map((u) => u.line);
  assert.deepEqual(lines, [4, 7, 11, 12, 13]);
  assert.ok(r.attention.some((a) => /“Maybe”/.test(a.message)));
  assert.ok(r.attention.some((a) => /“venue”/.test(a.message)));
  assert.equal(r.stages.length, 1, "the stage line itself is still read; only what is not understood is set aside");
});

test("U1-30 a web address outside Important Links is not read as a link", () => {
  const r = readUpdateText(`LN Update v1\nJob: TSC CGL 2026\nUpdate type: Schedule\n\nAge Limit: Minimum 18 years, Maximum 32 years as on 1 Aug 2026\nDetails at https://example.in/notice.pdf\n`, { job: CGL });
  assert.ok(r.attention.some((a) => a.code === "URL_OUTSIDE_LINKS"));
  assert.equal(r.links.length, 0);
});

suite("U1: v0.3.1 sections inside an update, and compatibility");

test("U1-31 fees, age and selection written the v0.3.1 way are read by the existing readers, with quotes", () => {
  const r = readUpdateText(`LN Update v1
Job: Test Bank Specialist Officers 2026
Update type: Corrigendum

Application Fee: General/EWS/OBC Rs. 850, SC/ST/PwBD Rs. 175
Age Limit: Minimum 20 years, Maximum 30 years as on 1 Aug 2026

Selection Process
Stage: Preliminary Examination
Subject: English Language: 30 Questions, 30 Marks
Subject: Reasoning Ability: 35 Questions, 35 Marks
Stage: Main Examination
Stage: Interview | Qualifying
Merit List: Main Examination and Interview marks in the ratio 80:20
`, { job: BANK });
  assert.ok(r.values.some((v) => v.fieldPath === "financial.feeGeneral" && v.value === 850 && /Rs\. 850/.test(v.quote)));
  assert.ok(r.values.some((v) => v.fieldPath === "age"));
  assert.equal(r.sections.fees.state, "PROVIDED");
  assert.deepEqual(r.selection.items.map((s) => [s.name, s.qualifying ?? false]), [["Preliminary Examination", false], ["Main Examination", false], ["Interview", true]]);
  assert.equal(r.selection.items[2].type, "INTERVIEW");
  assert.equal(r.selection.merit?.text, "Main Examination and Interview marks in the ratio 80:20");
  assert.deepEqual(r.pattern.map((p) => [p.context.stage, p.sections.length]), [["Preliminary Examination", 2]], "the v0.3.1 pattern rows under a stage are that stage's pattern");
  assert.equal(r.unread.length, 0);
});

test("U1-32 the reader is pure: the same text read twice gives the same result, and the text is not changed", () => {
  const a = JSON.stringify(readUpdateText(CGL_TIER2, { job: CGL }));
  const b = JSON.stringify(readUpdateText(CGL_TIER2, { job: CGL }));
  assert.equal(a, b);
});

test("U1-33 the reader saves, publishes and calls nothing: no database, network, AI or Telegram imports", () => {
  const src = readFileSync("src/lib/cms/importer/update-format.ts", "utf8");
  for (const forbidden of [/from\s+["']@\/lib\/db/, /neon|postgres/i, /\bfetch\(/, /gemini/i, /telegram/i, /record-ops/, /repository/]) {
    assert.ok(!forbidden.test(src.replace(/\/\/.*$/gm, "")), `must not use ${forbidden}`);
  }
});

test("U1-34 the GPT instruction template's own example reads cleanly", () => {
  const doc = readFileSync("docs/ln-update-v1-gpt-instructions.md", "utf8");
  const example = /```text\n(LN Update v1[\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(example, "the template contains an example");
  const r = readUpdateText(example!, { job: { title: "Example Steel Plant Apprentice Recruitment 2026-27", organizationName: "Example Steel Limited" } });
  assert.equal(r.refused, undefined, r.refused);
  assert.equal(r.unread.length, 0, JSON.stringify(r.unread));
  assert.equal(r.attention.length, 0, JSON.stringify(r.attention));
});
