// I1: labelled lines of pasted text read by code — fees, pay, age,
// eligibility, selection, how to apply — and what is kept for the editor
// instead of being widened, guessed or dropped. Pure: the reader, and
// combineReading with the AI's parts given as stand-ins (no request at all).
//
//   npx tsx --tsconfig tsconfig.json tests/cms/i1-labelled-lines.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { readLabelledLines, type LabelledReading } from "@/lib/cms/importer/prepared-fields";
import { combineReading, selectionStageType, skippedSection } from "@/lib/cms/importer/extract";
import { AI_NOT_USED } from "@/lib/cms/ai-assist";

const read = (t: string) => readLabelledLines(t, { stageType: selectionStageType });
const val = (r: LabelledReading, f: string) => r.values.find((v) => v.fieldPath === f);
const why = (r: LabelledReading, f: string) => r.refused.filter((x) => x.fieldPath === f).map((x) => x.reason).join(" | ");

const PREPARED = `TEST RECORD Prepared 2097 — summary prepared by ChatGPT
Selection: Written examination and interview
Pay Scale: ₹35,400–₹1,12,400
Age Limit: 18–35 years
Application Fee: General/OBC ₹600, SC/ST/PwBD ₹100
How to apply: Register on the website, fill in the form, pay the fee online`;

suite("I1 A: labelled lines read by code");

test("A1 the owner's example, in any order: fees, age, selection, pay — each quoted from its own line", () => {
  const r = read(PREPARED);
  assert.deepEqual([val(r, "financial.feeGeneral")?.value, val(r, "financial.feeSCST")?.value], [600, 100]);
  assert.deepEqual(val(r, "age")?.value, { relaxations: [], min: 18, max: 35 });
  assert.equal(val(r, "financial.payScale")?.value, "₹35,400–₹1,12,400");
  assert.deepEqual((val(r, "selection")?.value as { stages: Array<{ name: string; type: string }> }).stages.map((s) => [s.name, s.type]),
    [["Written examination", "WRITTEN"], ["interview", "INTERVIEW"]]);
  assert.deepEqual(val(r, "howToApply")?.value, ["Register on the website", "fill in the form", "pay the fee online"]);
  for (const v of r.values) assert.ok(PREPARED.includes(v.quote), `${v.fieldPath}: its quote is a line of the text`);
  assert.ok(r.values.every((v) => !v.doubt), "every group of each fee field is named");
});
test("A2 fees: a bulleted block, one line per group, and amounts written several ways", () => {
  const r = read("Application Fee:\n- General/OBC: Rs 600\n- SC/ST/PwBD: Rs. 100/-\nAge Limit: 18–35 years");
  assert.deepEqual([val(r, "financial.feeGeneral")?.value, val(r, "financial.feeSCST")?.value], [600, 100]);
  const lic = read("Application fee: General, EWS and OBC candidates Rs.800/- plus GST\nSC/ST candidates Rs.200/- plus GST\nPerson with Benchmark Disability (PwBD) candidates Rs.200/- plus GST");
  assert.deepEqual([val(lic, "financial.feeGeneral")?.value, val(lic, "financial.feeSCST")?.value, val(lic, "financial.feeSCST")?.doubt], [800, 200, undefined]);
  assert.match(val(lic, "financial.feeGeneral")?.notes?.join(" ") ?? "", /before the tax/);
  assert.deepEqual([val(read("Application Fee: Rs 500 for General, OBC and EWS; Rs 250 for SC/ST/PwBD"), "financial.feeGeneral")?.value], [500]);
});
test("A3 an explicit exemption is a fee of 0, for the groups it names only", () => {
  const r = read("Fee: Rs 500 for all candidates; SC/ST/PwBD exempted");
  assert.deepEqual([val(r, "financial.feeGeneral")?.value, val(r, "financial.feeSCST")?.value], [500, 0]);
  const s = read("Fee payable: Rs 100\nWomen candidates and candidates belonging to SC, ST, PwBD and ESM are exempted from payment of fee.");
  assert.equal(val(s, "financial.feeSCST")?.value, 0, "SC, ST and PwBD are named: their exemption stands");
  assert.match(why(s, "financial.feeSCST"), /a fee for a group the job's fee fields do not hold/, "women and ex-servicemen are kept, not dropped");
});
test("A4 age: a range with its date; a maximum alone; the date only when the line states one", () => {
  assert.deepEqual(val(read("Age limit (as on 01.08.2097): 18-32 years"), "age")?.value, { relaxations: [], min: 18, max: 32, asOf: "2097-08-01" });
  assert.deepEqual(val(read("Age: maximum 40 years"), "age")?.value, { relaxations: [], max: 40 });
  assert.match(val(read("Age Limit: 18–35 years"), "age")?.notes?.join(" ") ?? "", /no date the age is counted on/);
});
test("A5 eligibility under the one post the text names", () => {
  const r = read("Post: Assistant Engineer\nEducational Qualification: B.E. in Civil Engineering from a recognised university");
  assert.deepEqual(val(r, "eligibility")?.value, [{ post: "Assistant Engineer", qualification: ["B.E. in Civil Engineering from a recognised university"] }]);
});
test("A6 how to apply as a list under its label", () => {
  assert.deepEqual(val(read("How to Apply:\n1. Visit the website\n2. Register with a mobile number\n3. Pay the fee"), "howToApply")?.value,
    ["Visit the website", "Register with a mobile number", "Pay the fee"]);
});

suite("I1 B: what is not widened, guessed or dropped");

test("B1 an amount that names no group is given to none, and said", () => {
  const r = read("Application fee: Rs 100");
  assert.deepEqual([val(r, "financial.feeGeneral"), val(r, "financial.feeSCST")], [undefined, undefined]);
  assert.match(why(r, "financial.feeGeneral"), /names no category: not given to any group/);
});
test("B2 an SC/ST fee is not presented as PwBD's, nor General's as OBC's: offered with the doubt (unticked)", () => {
  const r = read("Application fee: General Rs 600 (SC/ST exempted)");
  assert.deepEqual([val(r, "financial.feeGeneral")?.value, val(r, "financial.feeSCST")?.value], [600, 0]);
  assert.match(val(r, "financial.feeSCST")?.doubt ?? "", /PwBD is not stated, and the field is for SC \/ ST \/ PwBD/);
  assert.match(val(r, "financial.feeGeneral")?.doubt ?? "", /OBC is not stated/);
});
test("B3 groups one field holds, priced differently: nothing offered for it, both said", () => {
  const r = read("Fee: General Rs 600, OBC Rs 400, SC/ST Rs 100, PwBD exempted");
  assert.deepEqual([val(r, "financial.feeGeneral"), val(r, "financial.feeSCST")], [undefined, undefined]);
  assert.match(why(r, "financial.feeGeneral"), /“General Rs 600” and “OBC Rs 400” differ/);
  assert.match(why(r, "financial.feeSCST"), /“SC\/ST Rs 100” and “PwBD exempted” differ/);
});
test("B4 age: no relaxation invented from “as per rules”, no date invented, no category maximum read", () => {
  const r = val(read("Age Limit: 21–37 years, relaxation as per government rules; SC/ST up to 42 years"), "age")!;
  assert.deepEqual(r.value, { relaxations: [], min: 21, max: 37 });
  assert.match(r.notes!.join(" "), /no relaxation is read from it/);
});
test("B5 eligibility naming no post is kept for the editor, not saved under an invented post", () => {
  const r = read("Eligibility: Bachelor's degree in any discipline");
  assert.equal(val(r, "eligibility"), undefined);
  assert.match(why(r, "eligibility"), /names no post, and eligibility is kept post by post/);
  assert.match(why(read("Posts: Clerk, Typist\nEligibility: Graduation"), "eligibility"), /names no single post/);
});
test("B6 two lines that disagree give nothing for the field, and both are said", () => {
  const r = read("Selection: Written test and interview\nSelection process: Interview only\nAge limit: 18-30 years\nAge limit: 21-35 years");
  assert.deepEqual([val(r, "selection"), val(r, "age")], [undefined, undefined]);
  assert.match(why(r, "selection"), /two different selection processes/);
  assert.match(why(r, "age"), /two different age limits/);
});
test("B7 unlabelled prose, other fields' labels and bad values are not read", () => {
  const r = read("The fee is six hundred rupees for most.\nFee payment deadline: 10.02.2097\nPosts: 58\nAge: 18 years\nAge limit: 40-21 years\nPayment mode: online");
  // Since G3 a labelled date is read as its own field (the fee deadline here); it is still never taken as a fee.
  assert.deepEqual(r.values.map((v) => [v.fieldPath, v.value]), [["dates.feePaymentCloseDate", "2097-02-10"]]);
  assert.match(why(r, "age"), /minimum age is above the maximum/);
});

suite("I1 C: in the source's reading");

const none = { values: [], refused: [], links: [] } as never;
const skipped = { ai: skippedSection("ai", AI_NOT_USED), details: skippedSection("details", AI_NOT_USED), pattern: skippedSection("pattern", AI_NOT_USED) };

test("C1 pasted text with the AI off: the labelled values, said as read by code; their fields leave the not-read list", () => {
  const r = combineReading({ content: PREPARED, kind: "html", url: "", organizationId: "x", ...skipped, article: none, labelledLines: true });
  assert.deepEqual(["age", "financial.feeGeneral", "financial.feeSCST", "financial.payScale", "howToApply", "selection"].filter((f) => r.values.some((v) => v.fieldPath === f)).length, 6);
  assert.ok(r.values.filter((v) => ["age", "financial.payScale"].includes(v.fieldPath)).every((v) => v.notes?.includes("read by code from a labelled line")));
  assert.ok(!r.notFound.some((n) => /^(Application fee|Age Limit|Pay Scale|Selection Process|How to Apply)/.test(n)), r.notFound.join(" | "));
});
test("C2 any other source (an uploaded PDF): no labelled reading, as before", () => {
  const r = combineReading({ content: PREPARED, kind: "pdf", url: "", organizationId: "x", ...skipped, article: none });
  assert.ok(!r.values.some((v) => v.fieldPath === "financial.feeGeneral" || v.fieldPath === "financial.payScale"));
});
test("C3 the AI read another fee: both values stand, so the review shows the conflict (neither ticked)", () => {
  const article = { values: [{ fieldPath: "financial.feeGeneral", value: 750, quote: "General/OBC ₹600" }], refused: [], links: [] } as never;
  const r = combineReading({ content: PREPARED, kind: "html", url: "", organizationId: "x", ...skipped, article, labelledLines: true });
  assert.deepEqual(r.values.filter((v) => v.fieldPath === "financial.feeGeneral").map((v) => v.value).sort(), [600, 750]);
});
