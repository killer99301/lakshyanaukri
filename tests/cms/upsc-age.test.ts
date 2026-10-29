// UPSC CSE 2026 (B2.6): its own notice number over a file number, the date
// its age is counted on ("the 1st of August, 2026"), and its relaxations,
// printed as a lettered list, read by code with their clauses as quotes.
// Then the public age checker on the result. Real text of the notice
// (pages 1 and 12, with the file-number line); no AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/upsc-age.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { combineReading, skippedSection } from "@/lib/cms/importer/extract";
import { labelledNoticeNumber, parseDatesInText } from "@/lib/cms/ai-assist";
import { dateInQuote } from "@/lib/cms/importer/article";
import { statedRelaxations } from "@/lib/cms/importer/age-relaxations";
import { checkAge } from "@/lib/eligibility";
import type { AgeCriteria } from "@/types/recruitment-record";
import type { AgeLimit } from "@/types";

const UPSC = readFileSync("tests/fixtures/notice-text/upsc-cse-2026-age-excerpt.txt", "utf8");
const AGE_QUOTE = "A candidate must have attained the age of 21 years and must not have attained the age of 32\nyears on the 1st of August, 2026";

/** The reading as it came back in the two real runs: run 1 took the file number and no relaxation; run 2 only PwBD. */
function read(opts: { aiNumber: string; aiNumberQuote: string; relaxations: AgeCriteria["relaxations"]; asOf?: string }) {
  const ai = { ...skippedSection("ai", "test"), notificationNumber: { status: "accepted", value: opts.aiNumber, quote: opts.aiNumberQuote } } as never;
  const age: AgeCriteria = { min: 21, max: 32, relaxations: opts.relaxations, ...(opts.asOf ? { asOf: opts.asOf } : {}) };
  return combineReading({
    content: UPSC, kind: "pdf", url: "https://upsc.gov.in/notice.pdf", organizationId: "upsc",
    ai, details: skippedSection("details", "test"), pattern: { examPattern: { status: "not_stated" }, syllabus: { status: "not_stated" } } as never,
    article: { values: [{ fieldPath: "age", value: age, quote: AGE_QUOTE, page: 12 }], refused: [] },
  });
}
const run1 = () => read({ aiNumber: "F.No. 1/2/2025-E.I(B)", aiNumberQuote: "F.No. 1/2/2025-E.I(B): Preliminary Examination of the Civil Services Examination for recruitment to the", relaxations: [] });
const run2 = () => read({ aiNumber: "05/2026-CSE", aiNumberQuote: "EXAMINATION NOTICE NO 05/2026-CSE DATE: 04.02.2026", relaxations: [{ category: "Persons with Benchmark Disabilities (PwBD)", years: 10 }] });
const value = (r: ReturnType<typeof read>, path: string) => r.values.find((v) => v.fieldPath === path);

suite("UPSC CSE 2026: the notice's own number");

test("UN01 the labelled number is read by code: “EXAMINATION NOTICE NO 05/2026-CSE”", () => {
  assert.equal(labelledNoticeNumber(UPSC), "05/2026-CSE");
  assert.equal(labelledNoticeNumber("Public notice regarding the examination centres"), null, "a notice with no number is no number");
});
test("UN02 the AI took the file number (run 1): the labelled notice number stands, quoted from its own line on page 1", () => {
  const v = value(run1(), "identity.notificationNumber")!;
  assert.deepEqual([v.value, v.quote, v.page], ["05/2026-CSE", "EXAMINATION NOTICE NO 05/2026-CSE DATE: 04.02.2026", 1]);
  assert.ok(!run1().refused.some((r) => /Notification Number/.test(r.fieldPath)), "nothing to resolve by hand");
});
test("UN03 the AI read the notice number (run 2): the same, with its own quote", () => {
  assert.equal(value(run2(), "identity.notificationNumber")!.value, "05/2026-CSE");
});
test("UN04 a notice whose only number is a file number (SSC): the file number is kept", async () => {
  const { mergeAiNotificationNumber } = await import("@/lib/cms/ai-assist");
  const r = mergeAiNotificationNumber({ candidates: [{ fieldPath: "identity.notificationNumber", label: "Notification Number", value: null }], flagged: [] },
    { status: "accepted", value: "F. No. HQ-C11018/1/2026-C-1", quote: "F. No. HQ-C11018/1/2026-C-1" } as never);
  assert.equal(r.candidates.find((c) => c.fieldPath === "identity.notificationNumber")!.value, "F. No. HQ-C11018/1/2026-C-1");
});

suite("The date the age is counted on");

test("UN05 “the 1st of August, 2026” is a date, to both date readers", () => {
  assert.deepEqual(parseDatesInText("must not have attained the age of 32 years on the 1st of August, 2026 i.e."), ["2026-08-01"]);
  assert.ok(dateInQuote("2026-08-01", AGE_QUOTE));
  assert.ok(!dateInQuote("2026-08-02", AGE_QUOTE));
});
test("UN06 the AI gave the date: kept; it left it out: read by code from the age's own quote, with its page", () => {
  const given = value(read({ aiNumber: "05/2026-CSE", aiNumberQuote: "EXAMINATION NOTICE NO 05/2026-CSE DATE: 04.02.2026", relaxations: [], asOf: "2026-08-01" }), "age")!.value as AgeCriteria;
  assert.equal(given.asOf, "2026-08-01");
  const age = value(run1(), "age")!.value as AgeCriteria;
  assert.equal(age.asOf, "2026-08-01");
  assert.ok(age.evidence?.some((e) => e.about === "asOf (read by code)" && e.page === 12));
});

suite("Relaxations printed as a lettered list");

test("UN07 all six clauses are read, each with its clause as the quote", () => {
  const r = statedRelaxations(UPSC);
  assert.deepEqual(r.map((x) => [x.category, x.years]), [
    ["Scheduled Caste / Scheduled Tribe (SC/ST)", 5], ["Other Backward Classes (OBC)", 3], ["Defence Services Personnel", 3],
    ["Ex-Servicemen", 5], ["ECOs/SSCOs", 5], ["Persons with Benchmark Disabilities (PwBD)", 10]]);
  assert.ok(r.every((x) => UPSC.includes(x.quote)), "word for word");
  assert.ok(r[0].quote.startsWith("(a) up to a maximum of five years if a candidate belongs to a Scheduled Caste or a Scheduled"));
});
test("UN08 the AI's PwBD row stays; the five it left out are added, each with its evidence and page", () => {
  const age = value(run2(), "age")!.value as AgeCriteria;
  assert.deepEqual(age.relaxations.map((x) => [x.category, x.years]), [
    ["Persons with Benchmark Disabilities (PwBD)", 10], ["Scheduled Caste / Scheduled Tribe (SC/ST)", 5], ["Other Backward Classes (OBC)", 3],
    ["Defence Services Personnel", 3], ["Ex-Servicemen", 5], ["ECOs/SSCOs", 5]]);
  assert.equal(age.evidence?.filter((e) => /read by code/.test(e.about) && /^relaxation/.test(e.about)).length, 5);
  assert.ok(age.evidence?.filter((e) => /^relaxation/.test(e.about)).every((e) => e.page === 12));
});
test("UN09 an AI figure that differs from the clause is corrected to the clause, and said", () => {
  const r = read({ aiNumber: "05/2026-CSE", aiNumberQuote: "EXAMINATION NOTICE NO 05/2026-CSE DATE: 04.02.2026", relaxations: [{ category: "OBC", years: 5 }] });
  const age = value(r, "age")!.value as AgeCriteria;
  assert.deepEqual(age.relaxations.filter((x) => /OBC/.test(x.category)).map((x) => x.years), [3]);
  assert.ok(r.refused.some((x) => x.fieldPath === "age" && /the reading gave 5 years for OBC; the notice's clause says 3/.test(x.reason)));
});

suite("The public age checker on UPSC's reading");

const limit = (): AgeLimit => {
  const a = value(run1(), "age")!.value as AgeCriteria;
  return { min: a.min, max: a.max, asOf: a.asOf, relaxation: a.relaxations };
};
test("UN10 born 1997: within 21-32 on 1 August 2026", () => {
  assert.equal(checkAge(limit(), "1997-01-15", "GEN", false).verdict, "WITHIN");
});
test("UN11 born 1990 (36 on 1 August 2026): too old for General and OBC (35), within for SC/ST (37) and PwBD (42)", () => {
  assert.equal(checkAge(limit(), "1990-01-15", "GEN", false).verdict, "TOO_OLD");
  assert.equal(checkAge(limit(), "1990-01-15", "OBC", false).verdict, "TOO_OLD");
  assert.equal(checkAge(limit(), "1990-01-15", "SC", false).verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(limit(), "1990-01-15", "ST", false).verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(limit(), "1990-01-15", "GEN", true).verdict, "WITHIN_RELAXED");
});
test("UN12 without the date the checker could only say UNKNOWN: the reason the date matters", () => {
  assert.equal(checkAge({ ...limit(), asOf: undefined }, "1997-01-15", "GEN", false).verdict, "UNKNOWN");
});
