// Smart intake, pure parts: the whole-text reading's checks, links written
// without https://, and the preview's warnings. No database, no network.
//
// The article is a fixture in the shape of a portal's write-up of BTSC Food
// Safety Officer 2026 (overview table, dates table, category table, single
// fee, category-wise maximum age, paper table, syllabus table, pay); the
// wording is the test's own.

import { suite, test, assert } from "../intelligence/suite";
import { buildArticlePrompt, dateInQuote, judgeArticle, mergeCategoryRows } from "@/lib/cms/importer/article";
import { linksInText } from "@/lib/cms/importer/links";
import { buildProposal, type RetrievalSummary } from "@/lib/cms/importer/proposal";

const ARTICLE = `BTSC Food Safety Officer Recruitment 2026: 105 Posts
Posted on 15 October 2026 by a portal editor.
Bihar Technical Service Commission has advertised 105 Food Safety Officer posts in the Health Department under Advertisement No. 29/2026.
Overview
Particulars\tDetails
Advertisement Number\t29/2026
Total Vacancies\t105
Application Start Date\t25 September 2026
Last Date to Apply\t24 October 2026
Pay Level\tLevel 6
Grade Pay\t₹4,200
Official Website\tbtsc.bihar.gov.in
Important Dates
Online Application Begins\t25 September 2026
Last Date to Apply Online\t24 October 2026
CBT Exam Date\tTo be announced
Category-Wise Vacancy Details
Unreserved (UR)\t41
Economically Weaker Section (EWS)\t11
Scheduled Caste (SC)\t17
Scheduled Tribe (ST)\t2
Extremely Backward Class (EBC)\t18
Backward Class (BC)\t12
Backward Class Women\t4
Total\t105
Application Fee\t₹100
Age: the minimum age is 21 years as on 1 August 2026.
Unreserved (Male)\t37 years
Unreserved (Female)\t40 years
Scheduled Caste / Scheduled Tribe (Male and Female)\t42 years
Qualification: a degree in Food Technology, Dairy Technology, Biotechnology, Chemistry or Medicine.
Computer-Based Test (CBT): a 100-mark paper on the prescribed syllabus.
Document Verification: shortlisted candidates bring their original certificates.
Paper 1\tGeneral Studies and Mental Ability\t25\t25
Paper 2\tChemistry and Food Nutrition\t75\t75
Food Technology\tFood processing and preservation
Minimum qualifying marks: General 40%, BC 36.5%, EBC 34%, SC/ST 32%.
Register or log in to the application portal.
Pay the application fee online.
Enrol in our FSO complete batch today for Rs 3,409!`;

// A model's answer, as the prompt asks for it.
const ANSWER = {
  notificationNumber: { value: "29/2026", quote: "Advertisement Number\t29/2026" },
  dates: {
    applicationOpenDate: { value: "2026-09-25", quote: "Application Start Date\t25 September 2026" },
    applicationCloseDate: { value: "2026-10-24", quote: "Last Date to Apply Online\t24 October 2026" },
    examDate: { value: "2026-10-15", quote: "Posted on 15 October 2026 by a portal editor." },
  },
  totalVacancies: { value: 105, quote: "Total Vacancies\t105" },
  vacancyRows: [{
    post: "Food Safety Officer", count: 105, quote: "Total\t105",
    categories: [
      { category: "Unreserved (UR)", count: 41, quote: "Unreserved (UR)\t41" },
      { category: "Economically Weaker Section (EWS)", count: 11, quote: "Economically Weaker Section (EWS)\t11" },
      { category: "Scheduled Caste (SC)", count: 17, quote: "Scheduled Caste (SC)\t17" },
      { category: "Scheduled Tribe (ST)", count: 2, quote: "Scheduled Tribe (ST)\t2" },
      { category: "Extremely Backward Class (EBC)", count: 18, quote: "Extremely Backward Class (EBC)\t18" },
      { category: "Backward Class (BC)", count: 12, quote: "Backward Class (BC)\t12" },
      { category: "Backward Class Women", count: 4, quote: "Backward Class Women\t4" },
      { category: "Divyang", count: 9, quote: "Divyang\t9" },
    ],
  }],
  feeGeneral: { value: 100, quote: "Application Fee\t₹100" },
  payScale: { value: "Pay Level 6, Grade Pay ₹4,200", quote: "Grade Pay\t₹4,200" },
  age: {
    min: 21, asOf: "2026-08-01", quote: "the minimum age is 21 years as on 1 August 2026",
    categoryMax: [
      { category: "Unreserved (Male)", max: 37, quote: "Unreserved (Male)\t37 years" },
      { category: "Unreserved (Female)", max: 40, quote: "Unreserved (Female)\t40 years" },
      { category: "SC / ST", max: 42, quote: "Scheduled Caste / Scheduled Tribe (Male and Female)\t42 years" },
    ],
  },
  eligibility: [{ post: "Food Safety Officer", qualifications: ["a degree in Food Technology, Dairy Technology, Biotechnology, Chemistry or Medicine", "a PhD in anything"], quote: "Qualification: a degree in Food Technology" }],
  selectionStages: [
    { name: "Computer-Based Test (CBT)", type: "CBT", description: "a 100-mark paper on the prescribed syllabus", quote: "Computer-Based Test (CBT): a 100-mark paper" },
    { name: "Document Verification", type: "DOCUMENT_VERIFICATION", description: "candidates must bring every certificate they have", quote: "Document Verification: shortlisted candidates" },
  ],
  examStages: [{ name: "Computer-Based Test", date: null, dateText: "To be announced", quote: "CBT Exam Date\tTo be announced" }],
  examPattern: [{ name: "Written examination", totalQuestions: 100, totalMarks: 100, quote: "Paper 1\tGeneral Studies and Mental Ability\t25\t25",
    sections: [{ subject: "General Studies and Mental Ability", questions: 25, marks: 25 }, { subject: "Chemistry and Food Nutrition", questions: 75, marks: 75 }] }],
  syllabus: [{ subject: "Food Technology", topics: ["Food processing and preservation", "Quantum physics"], quote: "Food Technology\tFood processing and preservation" }],
  howToApply: [{ step: "Register or log in to the application portal.", quote: "Register or log in" }, { step: "Pay the application fee online.", quote: "Pay the application fee online." }, { step: "Apply before the rush.", quote: "Apply before the rush." }],
  notes: [{ text: "Minimum qualifying marks: General 40%, BC 36.5%, EBC 34%, SC/ST 32%.", quote: "Minimum qualifying marks" }, { text: "Women get 35% reservation.", quote: "Women get 35% reservation." }],
};

const read = judgeArticle(ANSWER, ARTICLE);
const value = (path: string) => read.values.find((v) => v.fieldPath === path)?.value as Record<string, unknown> & unknown[];

suite("Whole-text reading: what is kept");
test("IA01 number, dates, totals and fee, each with its quote", () => {
  assert.equal(value("identity.notificationNumber") as unknown, "29/2026");
  assert.equal(value("dates.applicationOpenDate") as unknown, "2026-09-25");
  assert.equal(value("dates.applicationCloseDate") as unknown, "2026-10-24");
  assert.equal(value("vacancies.total") as unknown, 105);
  assert.equal(value("financial.feeGeneral") as unknown, 100);
  assert.equal(read.values.find((v) => v.fieldPath === "financial.feeSCST"), undefined, "one fee for all is not an SC/ST fee");
});
test("IA02 the category table becomes the breakdown, in the editor's flat form", () => {
  assert.deepEqual(value("vacancies.breakdown"), [{ post: "Food Safety Officer", count: 105, breakdown: {
    ur: 41, ews: 11, sc: 17, st: 2, "Extremely Backward Class (EBC)": 18, "Backward Class (BC)": 12, "Backward Class Women": 4,
  } }]);
});
test("IA03 category-wise maximum ages are kept as printed: no relaxation years and no general maximum worked out from them", () => {
  const age = value("age") as unknown as Record<string, unknown>;
  assert.deepEqual({ ...age, evidence: undefined }, { min: 21, asOf: "2026-08-01", relaxations: [], evidence: undefined, categoryMax: [
    { category: "Unreserved (Male)", max: 37 },
    { category: "Unreserved (Female)", max: 40 },
    { category: "SC / ST", max: 42 },
  ] });
  // Each value with the notice's own words behind it.
  assert.deepEqual((age.evidence as Array<{ about: string; value: string; quote: string }>).map((e) => [e.about, e.value, e.quote]), [
    ["min", "21", "the minimum age is 21 years as on 1 August 2026"],
    ["asOf", "2026-08-01", "the minimum age is 21 years as on 1 August 2026"],
    ["categoryMax: Unreserved (Male)", "37", "Unreserved (Male)\t37 years"],
    ["categoryMax: Unreserved (Female)", "40", "Unreserved (Female)\t40 years"],
    ["categoryMax: SC / ST", "42", "Scheduled Caste / Scheduled Tribe (Male and Female)\t42 years"],
  ]);
});
test("IA04 stages, pattern, syllabus, steps and notes keep only words from the text", () => {
  const sel = value("selection") as unknown as { stages: Array<{ name: string; description?: string; type: string }> };
  assert.equal(sel.stages.length, 2);
  assert.equal(sel.stages[0].description, "a 100-mark paper on the prescribed syllabus");
  assert.equal(sel.stages[1].description, undefined, "a description not in the text is dropped");
  const stage = (value("examStages") as unknown as Array<Record<string, unknown>>)[0];
  assert.equal(stage.status, "NOT_DECLARED");
  assert.equal(stage.certainty, "TBA");
  assert.equal(stage.dateDisplay, undefined, "not a date: the editor refuses date text without a certainty");
  assert.equal(stage.notes, "To be announced");
  assert.equal((value("examPattern") as unknown as Array<{ sections: unknown[] }>)[0].sections.length, 2);
  assert.deepEqual((value("syllabus") as unknown as Array<{ topics: string[] }>)[0].topics, ["Food processing and preservation"]);
  assert.deepEqual(value("eligibility") as unknown, [{ post: "Food Safety Officer", qualification: ["a degree in Food Technology, Dairy Technology, Biotechnology, Chemistry or Medicine"] }]);
  assert.deepEqual(value("howToApply") as unknown, ["Register or log in to the application portal.", "Pay the application fee online."]);
  assert.deepEqual(value("conditions") as unknown, ["Minimum qualifying marks: General 40%, BC 36.5%, EBC 34%, SC/ST 32%."]);
  assert.equal(value("financial.payScale") as unknown, "Pay Level 6, Grade Pay ₹4,200");
});

suite("Whole-text reading: what is refused");
test("IA05 the article's own posting date is refused as an exam date (not in its quote)", () => {
  assert.equal(read.values.find((v) => v.fieldPath === "dates.examDate"), undefined);
  assert.ok(read.refused.some((r) => r.fieldPath === "dates.examDate"));
});
test("IA06 a category not in the text, and a made-up quote, are dropped", () => {
  assert.equal(JSON.stringify(value("vacancies.breakdown")).includes("Divyang"), false);
  const bad = judgeArticle({ totalVacancies: { value: 150, quote: "Total Vacancies\t105" }, feeGeneral: { value: 100, quote: "fee is one hundred rupees" } }, ARTICLE);
  assert.equal(bad.values.length, 0);
  assert.deepEqual(bad.refused.map((r) => r.fieldPath).sort(), ["financial.feeGeneral", "vacancies.total"]);
});
test("IA07 dates must be written in their quote", () => {
  assert.ok(dateInQuote("2026-10-24", "Last Date to Apply\t24 October 2026"));
  assert.ok(dateInQuote("2026-07-04", "receipt of online applications: 04-07-2026 (23:00)"));
  assert.ok(dateInQuote("2026-03-06", "can be filled up to 06.03.2026 till 6:00 PM"));
  assert.ok(dateInQuote("2026-08-01", "on the 1st August, 2026"));
  assert.ok(!dateInQuote("2026-10-25", "Last Date to Apply\t24 October 2026"));
  assert.ok(!dateInQuote("2026-09-01", "September 2026"), "a month without a day is not a date");
  assert.ok(!dateInQuote("2026-02-30", "30 February 2026"));
});

suite("Links written without https://");
test("IA08 a bare government site is found and judged; label before an address types it", () => {
  const found = linksInText("Official Website\tbtsc.bihar.gov.in\nApply Online: https://btsc.pariksha.nic.in/Agencies.aspx\nContact help@btsc.bihar.gov.in", "btsc");
  const site = found.find((l) => l.url === "https://btsc.bihar.gov.in/");
  assert.equal(site?.type, "OFFICIAL_WEBSITE");
  assert.equal(site?.official, true);
  const apply = found.find((l) => l.url.startsWith("https://btsc.pariksha.nic.in/"));
  assert.equal(apply?.type, "APPLY_ONLINE");
  assert.equal(apply?.official, true, "BTSC's PARIKSHA portal: a partner for applications");
  assert.equal(linksInText("https://upsc.pariksha.nic.in/ and https://btsc.pariksha.nic.in/", "btsc").find((l) => l.url.includes("upsc"))?.official, false, "only BTSC's own portal");
  assert.equal(found.length, 2, "an e-mail address is not a link");
});

suite("Preview warnings");
const research: RetrievalSummary = { id: "r1", declaredKind: "RESEARCH", authenticity: "NOT_APPLICABLE", originRole: "NONE", originPurposes: [], label: "pasted text — research" };
test("IA09 a passed last date is flagged and kept; research-only and missing links are warned", () => {
  const p = buildProposal({
    extractions: [{ retrieval: research, values: read.values, links: [] }],
    current: () => undefined,
    today: "2026-10-25",
  });
  const close = p.items.find((i) => i.fieldPath === "dates.applicationCloseDate")!;
  assert.equal(close.value, "2026-10-24");
  assert.ok(close.flags.includes("this date has passed (today is 2026-10-25)"));
  assert.ok(!p.items.find((i) => i.fieldPath === "dates.applicationOpenDate")!.flags.some((f) => /passed/.test(f)), "an opening date is not a deadline");
  assert.equal(p.warnings.length, 3);
  assert.ok(p.warnings.some((w) => /official notification link/.test(w)));
  assert.ok(p.warnings.some((w) => /official apply link/.test(w)));
  assert.ok(p.warnings.some((w) => /Every source here is research/.test(w)));
});

suite("Category tables and long notices");
test("IA10 one post's category table returned as one row per category is put back into one row", () => {
  const rows = [
    { post: "Food Safety Officer", count: 41, breakdown: { ur: 41 } },
    { post: "Food Safety Officer", count: 11, breakdown: { ews: 11 } },
    { post: "Food Safety Officer", count: 17, breakdown: { sc: 17 } },
    { post: "Food Safety Officer", count: 2, breakdown: { st: 2 } },
    { post: "food safety officer", count: 18, breakdown: { "Extremely Backward Class (EBC)": 18 } },
    { post: "Food Safety Officer", count: 12, breakdown: { "Backward Class (BC)": 12 } },
    { post: "Food Safety Officer", count: 4, breakdown: { "Backward Class Women": 4 } },
  ] as never;
  const out = mergeCategoryRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].post, "Food Safety Officer");
  assert.equal(out[0].count, 105, "Backward Class Women is its own column in Bihar, so it counts");
  assert.deepEqual(out[0].breakdown, { ur: 41, ews: 11, sc: 17, st: 2, "Extremely Backward Class (EBC)": 18, "Backward Class (BC)": 12, "Backward Class Women": 4 });
});
test("IA11 horizontal seats are not added to the total; ordinary rows are left alone", () => {
  const split = mergeCategoryRows([
    { post: "Clerk", count: 60, breakdown: { ur: 60 } },
    { post: "Clerk", count: 40, breakdown: { obc: 40 } },
    { post: "Clerk", count: 30, breakdown: { women: 30 } },
  ] as never);
  assert.equal(split[0].count, 100);
  assert.equal((split[0].breakdown as Record<string, number>).women, 30);
  const normal = [
    { post: "Assistant", count: 50, breakdown: { ur: 25, obc: 25 } },
    { post: "Assistant", count: 6 },
    { post: "Steno", count: 4, breakdown: { ur: 4 } },
    { post: "Driver", count: 3, payScale: "Level 2" },
  ] as never;
  assert.deepEqual(mergeCategoryRows(normal), normal, "two Assistant rows that are not one-category rows stay as given; a lone one-category row stays");
});
test("IA12 judging a split answer keeps every quoted number and returns one row", () => {
  const text = "Category-Wise Vacancy Details\nUnreserved (UR) 41\nScheduled Caste (SC) 17\nTotal 58 Food Safety Officer posts";
  const raw = { vacancyRows: [
    { post: "Food Safety Officer", count: 41, quote: "Unreserved (UR) 41", categories: [{ category: "Unreserved (UR)", count: 41, quote: "Unreserved (UR) 41" }] },
    { post: "Food Safety Officer", count: 17, quote: "Scheduled Caste (SC) 17", categories: [{ category: "Scheduled Caste (SC)", count: 17, quote: "Scheduled Caste (SC) 17" }] },
  ] };
  const r = judgeArticle(raw, text);
  const rows = r.values.find((v) => v.fieldPath === "vacancies.breakdown")?.value as Array<{ count: number; breakdown: Record<string, number> }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 58);
  assert.deepEqual(rows[0].breakdown, { ur: 41, sc: 17 });
});
test("IA13 a long notice is sent whole: an annexure past 60,000 characters reaches the model", () => {
  const annexure = "ANNEXURE I VACANCIES UNDER CRP RRBs XV Grand Total 13217";
  const text = "Main notice text. ".repeat(10_000) + annexure;
  assert.ok(text.length > 150_000);
  assert.ok(buildArticlePrompt(text, "IBPS RRB CRP-XV").includes(annexure));
  assert.ok(!buildArticlePrompt("x".repeat(250_000), "s").includes("x".repeat(200_001)), "still capped at Smart intake's own limit");
});

test("IA14 a quote shortened with \"...\" or \"…\" is not the notice's own words: the value is not taken", () => {
  const text = "Selection Process: Written Examination followed by Interview of shortlisted candidates.\nLast date for online registration 21.09.2026.";
  const stage = (quote: string) => judgeArticle({ selectionStages: [{ name: "Written Examination", type: "WRITTEN", quote }] }, text).values.some((v) => v.fieldPath === "selection");
  assert.equal(stage("Selection Process: Written Examination followed by Interview"), true);
  assert.equal(stage("Selection Process: Written Examination followed..."), false);
  assert.equal(stage("Selection Process: Written Examination followed…"), false);
  assert.equal(stage("Written Examination ... Interview of shortlisted candidates"), false);
  const date = judgeArticle({ dates: { applicationCloseDate: { value: "2026-09-21", quote: "Last date for online registration 21.09.2026..." } } }, text);
  assert.equal(date.values.some((v) => v.fieldPath === "dates.applicationCloseDate"), false);
});
