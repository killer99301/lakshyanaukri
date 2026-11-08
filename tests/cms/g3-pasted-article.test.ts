// G3: a pasted recruitment article read by code, no AI. The two real articles the owner pasted (Adda247 South
// Indian Bank Junior Officer, GovtJobGuru SBI Assistant Manager Engineer (Fire)), and made-up texts for the shapes
// and traps around them: copied tables, values under their labels, repeated headings, dates where counts should be,
// FAQs and "related jobs" boxes. Pure: no database, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/g3-pasted-article.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { readLabelledLines } from "@/lib/cms/importer/prepared-fields";
import { pairsOf, dateKind } from "@/lib/cms/importer/pasted-article";
import { selectionStageType } from "@/lib/cms/importer/extract";
import type { AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, ExamPatternPaper } from "@/types/recruitment-record";

const ADDA = readFileSync("tests/fixtures/articles/adda247-south-indian-bank-jo-2026.txt", "utf8");
const GJG = readFileSync("tests/fixtures/articles/govtjobguru-sbi-am-fire-2026.txt", "utf8");
const read = (t: string) => readLabelledLines(t, { stageType: selectionStageType });
const all = (r: ReturnType<typeof read>, path: string) => r.values.filter((v) => v.fieldPath === path);
const one = (r: ReturnType<typeof read>, path: string) => { const v = all(r, path); assert.ok(v.length >= 1, `no ${path}`); return v[0]; };
const distinct = (r: ReturnType<typeof read>, path: string) => [...new Set(all(r, path).map((v) => JSON.stringify(v.value)))];
const refusedFor = (r: ReturnType<typeof read>, path: string) => r.refused.filter((x) => x.fieldPath === path).map((x) => x.reason);
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

suite("G3: Adda247 — South Indian Bank Junior Officer");
const adda = read(ADDA);
test("G301 dates: applications 6 to 13 November 2026, from the highlights and the dates table, each quoted", () => {
  assert.deepEqual(distinct(adda, "dates.applicationOpenDate"), ['"2026-11-06"']);
  assert.deepEqual(distinct(adda, "dates.applicationCloseDate"), ['"2026-11-13"']);
  assert.ok(all(adda, "dates.applicationOpenDate").some((v) => v.quote === "Online Application Starts 6 November 2026"));
});
test("G302 age: maximum 30 as on 31 October 2026, SC/ST relaxation 5 years; the born-on-or-after date that does not fit is said", () => {
  const a = one(adda, "age");
  const v = a.value as AgeCriteria;
  assert.equal(v.max, 30);
  assert.equal(v.asOf, "2026-10-31");
  assert.deepEqual(v.relaxations, [{ category: "SC/ST", years: 5 }]);
  assert.equal(v.bornFrom, "1996-08-01");
  assert.ok(/born on or after 1996-08-01.*1995-11-01/.test(a.doubt ?? ""), a.doubt);
});
test("G303 qualification and experience under the one post the text names", () => {
  assert.deepEqual(one(adda, "eligibility").value, [{ post: "Junior Officer/Business Promotion Officer", qualification: ["Graduation in any stream"], experience: ["Minimum 2 years"] }] satisfies CmsRecruitmentPost[]);
});
test("G304 fees: no fee for all candidates, from the fee table; the category-less “Nil” lines stay in Left out", () => {
  assert.deepEqual(distinct(adda, "financial.feeGeneral"), ["0"]);
  assert.deepEqual(distinct(adda, "financial.feeSCST"), ["0"]);
  assert.equal(one(adda, "financial.feeGeneral").quote, "All Candidates Nil");
  assert.ok(refusedFor(adda, "financial.feeGeneral").length > 0);
});
test("G305 the CTC: 7.85 lakh in the highlights, 7.83 lakh in the salary table — not chosen, both shown", () => {
  assert.deepEqual(all(adda, "financial.payScale"), []);
  const why = refusedFor(adda, "financial.payScale").join(" ");
  assert.ok(why.includes("7.85 lakh") && why.includes("7.83 lakh"), why);
});
test("G306 “Total Vacancy: Not Specified” gives no number, and says so", () => {
  assert.deepEqual(all(adda, "vacancies.total"), []);
  assert.ok(/Not Specified/.test(refusedFor(adda, "vacancies.total").join(" ")));
});
test("G307 selection: the section's four stages (the summary “GD and/or PI” agrees by initials, so no second value)", () => {
  assert.deepEqual(distinct(adda, "selection").length, 1);
  assert.deepEqual(((one(adda, "selection").value as CmsSelectionInformation).stages ?? []).map((s) => s.name), ["Shortlisting", "Group Discussion", "Personal Interview", "Psychometric Assessment"]);
});
test("G308 contract, role, posting and allowances kept as the job's notes; the ten steps to apply as written", () => {
  const notes = one(adda, "conditions").value as string[];
  for (const want of ["Initial Contract Period: 3 years", "Job Role: Target-based sales role"]) assert.ok(notes.includes(want), want);
  assert.ok(notes.some((n) => n.startsWith("Posting: ") && n.includes("Delhi, Mumbai, Pune and Ahmedabad")));
  assert.ok(notes.some((n) => n.includes("contract basis for three years")));
  assert.ok(notes.some((n) => n.startsWith("Allowance: ") && n.includes("₹7,000 per month")));
  assert.ok(notes.some((n) => n.startsWith("Pay components: ") && n.includes("Rs. 4.49 lakh")));
  const steps = one(adda, "howToApply").value as string[];
  assert.equal(steps.length, 10);
  assert.equal(steps[0], "Visit the South Indian Bank official website");
});
test("G309 every value's quote is words of the article (tabs and line breaks as spaces)", () => {
  for (const v of adda.values) assert.ok(squash(ADDA).includes(squash(v.quote)), `${v.fieldPath}: ${v.quote}`);
});

suite("G3: GovtJobGuru — SBI Assistant Manager Engineer (Fire)");
const gjg = read(GJG);
test("G310 notice number CRPD/SCO/2026-27/29, without the label or the sentence's bracket", () => {
  assert.deepEqual(distinct(gjg, "identity.notificationNumber"), ['"CRPD/SCO/2026-27/29"']);
});
test("G311 17 vacancies, and the split SC 2, ST 2, OBC 1, EWS 1, UR 11 under its post, the backlog said", () => {
  assert.deepEqual(distinct(gjg, "vacancies.total"), ["17"]);
  const b = one(gjg, "vacancies.breakdown");
  assert.deepEqual(b.value, [{ post: "Assistant Manager - Engineer (Fire)", count: 17, breakdown: { sc: 2, st: 2, obc: 1, ews: 1, ur: 11 } }]);
  assert.ok((b.notes ?? []).some((n) => n.includes("[including 1 backlog]")));
});
test("G312 dates: registration 4 to 25 November 2026, fee by 25 November", () => {
  assert.deepEqual(distinct(gjg, "dates.applicationOpenDate"), ['"2026-11-04"']);
  assert.deepEqual(distinct(gjg, "dates.applicationCloseDate"), ['"2026-11-25"']);
  assert.deepEqual(distinct(gjg, "dates.feePaymentCloseDate"), ['"2026-11-25"']);
});
test("G313 age 21 to 40 as on 31 October 2026; the relaxation in words only is said, not guessed", () => {
  const v = one(gjg, "age").value as AgeCriteria;
  assert.deepEqual([v.min, v.max, v.asOf, v.relaxations.length], [21, 40, "2026-10-31", 0]);
  assert.ok(/in words only/.test(refusedFor(gjg, "age").join(" ")));
});
test("G314 qualification (the overview's and the post's are the same, NFSC spelt out or not) and experience, under the post", () => {
  const e = one(gjg, "eligibility");
  const [post] = e.value as CmsRecruitmentPost[];
  assert.equal(post.post, "Assistant Manager - Engineer (Fire)");
  assert.ok(post.qualification![0].startsWith("B.E. (Fire) from National Fire Service College (NFSC) Nagpur OR"));
  assert.ok(!/experience/i.test(post.qualification![0]));
  assert.ok(post.experience![0].startsWith("minimum 2 years composite experience in fire safety"));
  assert.ok(post.experience![0].includes("minimum 3 years experience as Station Officer"));
});
test("G315 fees: General/EWS/OBC Rs 750; SC/ST no fee, with PwBD not stated said", () => {
  assert.deepEqual(distinct(gjg, "financial.feeGeneral"), ["750"]);
  const sc = one(gjg, "financial.feeSCST");
  assert.equal(sc.value, 0);
  assert.ok(/PwBD is not stated/.test(sc.doubt ?? ""));
});
test("G316 pay scale; selection: online written test and interview (merit list is no stage); the exam pattern", () => {
  assert.deepEqual(distinct(gjg, "financial.payScale"), ['"Rs. 48480-2000/7-62480-2340/2-67160-2680/7-85920 (JMGS-I)"']);
  const sel = one(gjg, "selection").value as CmsSelectionInformation;
  assert.deepEqual(sel.stages!.map((s) => [s.name, s.type]), [["Online Written Test (Objective Type)", "CBT"], ["Interview", "INTERVIEW"]]);
  assert.ok(sel.finalMeritFormula!.includes("Normalized to 70 marks"));
  assert.deepEqual(distinct(gjg, "selection").length, 1, "the repeated “Selection Procedure” heading is not a second value");
  const [paper] = one(gjg, "examPattern").value as ExamPatternPaper[];
  assert.deepEqual(paper.sections, [{ subject: "English Language", questions: 50, marks: 50 }, { subject: "Professional Knowledge", questions: 75, marks: 75 }]);
  assert.deepEqual([paper.totalQuestions, paper.totalMarks, paper.durationMinutes, paper.negativeMarking], [125, 125, 120, "No penalty for wrong answers"]);
});
test("G317 the steps to apply, with the careers address as written; “Click Here” links are said, never made up", () => {
  const steps = one(gjg, "howToApply").value as string[];
  assert.equal(steps[0], "Visit SBI’s official website: https://sbi.bank.in/web/careers/current-openings");
  assert.ok(steps.length >= 7 && !steps.some((s) => /^Here is|^The application procedure/.test(s)));
  assert.ok(/“Apply Online”.*no address/.test(refusedFor(gjg, "links#APPLY_ONLINE").join(" ")));
  assert.ok(!gjg.values.some((v) => v.fieldPath.startsWith("links#")));
});
test("G318 the FAQ, the related-jobs box and the tags give no field", () => {
  const text = JSON.stringify(gjg.values.map((v) => v.value));
  for (const unrelated of ["Chief AI Officer", "Security Recruitment", "Engineers Govt Jobs", "Tags", "Q1.", "Q4."]) assert.ok(!text.includes(unrelated), unrelated);
  for (const v of gjg.values) assert.ok(squash(GJG).includes(squash(v.quote)), `${v.fieldPath}: ${v.quote}`);
});
test("G319 the probation, posting, grade, perquisites and documents are kept as notes", () => {
  const notes = one(gjg, "conditions").value as string[];
  for (const want of ["Probation Period: 06 Months", "Job Location: Anywhere in India"]) assert.ok(notes.includes(want), want);
  assert.ok(notes.some((n) => n.startsWith("Documents Required: Resume")));
  assert.ok(notes.some((n) => n.startsWith("Grade/Scale: JMGS-I")));
  // Every note the article gives is kept: none dropped at a count, none cut short.
  assert.ok(notes.some((n) => n.startsWith("Legal Jurisdiction: ")) && notes.some((n) => n.startsWith("Bank’s Right: ")), notes.join(" | "));
  assert.ok(notes.every((n) => n.length <= 500));
  const adda = read(ADDA).values.find((v) => v.fieldPath === "conditions")!.value as string[];
  assert.ok(adda.join(" ").includes("Assistant Manager (Scale I) after completion of the initial contract period"), "the job profile's last sentence is kept");
});
test("G328 a note longer than the editor holds is split at its sentences, never cut", () => {
  const long = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} of the job profile says something the job's fields have no place for.`).join(" ");
  const r = read(`Job Profile\n${long}\nImportant Dates`);
  const notes = (r.values.find((v) => v.fieldPath === "conditions")?.value as string[] | undefined) ?? [];
  assert.ok(notes.length >= 2 && notes.every((n) => n.length <= 500), JSON.stringify(notes));
  assert.ok(notes.join(" ").includes("Sentence 8 of") && notes.slice(1).every((n) => n.startsWith("(continued) ")));
});

suite("G3: shapes and traps");
test("G320 a value under its label, a tab row and a Markdown row are pairs; a three-column table row and an unknown label are not", () => {
  const pairs = pairsOf(["Last Date to Apply", "25/11/2026", "Total Vacancies\t120", "| Application Fee | Rs. 500 for General |", "Post\tUR\tSC\tTotal", "Description\tLink", "Related Department: Bank Jobs 2026"]);
  assert.deepEqual(pairs.map((p) => [p.label, p.value, p.shape]), [["Last Date to Apply", "25/11/2026", "below"], ["Total Vacancies", "120", "tab"], ["Application Fee", "Rs. 500 for General", "table"]]);
});
test("G321 a date where a count should be, and a figure that could be a year, are never read as plain vacancies", () => {
  const r = read("Total Vacancies: 25/11/2026\nNo. of Posts: 2026\nLast Date to Apply: 1500 Posts");
  assert.deepEqual(all(r, "vacancies.total").map((v) => [v.value, !!v.doubt]), [[2026, true]]);
  assert.ok(/a date, not a number/.test(refusedFor(r, "vacancies.total").join(" ")));
  assert.deepEqual(all(r, "dates.applicationCloseDate"), [], "1500 Posts is no date");
});
test("G322 categories that do not add up, or come combined, give no split", () => {
  const r = read("Post Name: Clerk\nTotal Vacancies: 20 (UR-10, SC-3, ST-2, OBC-4)\n");
  assert.deepEqual(all(r, "vacancies.breakdown"), []);
  assert.ok(/add up to 19, not 20/.test(refusedFor(r, "vacancies.breakdown").join(" ")));
  const c = read("Post Name: Clerk\nTotal Vacancies: 20 (UR-10, SC/ST-5, OBC-5)\n");
  assert.deepEqual(all(c, "vacancies.breakdown"), []);
});
test("G323 two different last dates are both given (shown as a conflict), never one chosen", () => {
  const r = read("Last Date to Apply\t25/11/2026\nLast Date to Apply Online: 30/11/2026");
  assert.deepEqual(distinct(r, "dates.applicationCloseDate").sort(), ['"2026-11-25"', '"2026-11-30"']);
});
test("G324 which date a label names: fee deadlines, ranges and exam dates told apart", () => {
  assert.equal(dateKind("Payment of Application Fee End Date"), "fee");
  assert.equal(dateKind("Online Registration End Date"), "close");
  assert.equal(dateKind("Online Application Starts"), "open");
  assert.equal(dateKind("Application Dates"), "range");
  assert.equal(dateKind("Last Date for Correction"), null);
  assert.equal(dateKind("Exam Date"), null);
  assert.equal(dateKind("Date of Birth"), null);
});
test("G325 a “How to apply” heading stops at the next section; an FAQ after it gives no step", () => {
  const r = read("How to Apply\nCandidates can follow these steps:\nVisit the official website\nRegister and fill the form\nFrequently Asked Questions\nQ1. What is the last date?\nThe last date is 30/11/2026.");
  assert.deepEqual(one(r, "howToApply").value, ["Visit the official website", "Register and fill the form"]);
});
test("G326 a qualification line naming two posts is not put under either; nor is a stage list with nothing under a selection heading", () => {
  const r = read("Post Name: Clerk, Typist\nQualification\tGraduate\n");
  assert.deepEqual(all(r, "eligibility"), []);
  assert.ok(/no single post/.test(refusedFor(r, "eligibility").join(" ")));
  const s = read("Selection Process\nThe selection will be made as per rules.\nImportant Dates");
  assert.deepEqual(all(s, "selection"), []);
});
test("G327 a pay line's numbers are not ages; an age line's numbers are not pay", () => {
  const r = read("Salary\tRs. 25,500 - 81,100 (Level 4)\nAge Limit\t18 to 27 years as on 01.01.2027");
  assert.deepEqual(distinct(r, "financial.payScale"), ['"Rs. 25,500 - 81,100 (Level 4)"']);
  const age = one(r, "age").value as AgeCriteria;
  assert.deepEqual([age.min, age.max, age.asOf], [18, 27, "2027-01-01"]);
});
