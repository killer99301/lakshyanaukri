// SSC CGL 2026 (B2.6): each post's age from the notice's own table of posts
// (pages 1-4), never one range for every post; posts 10 and 11 of Pay
// Level-7, whose cells are merged with post 12's, said and not guessed; the
// coded relaxation table (page 7) read row by row, "PwBD (OBC)" kept apart
// from "PwBD". Then the public age checker post by post. Real text of the
// notice's pages 1-8; no AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/ssc-post-ages.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { readPostAgeTable } from "@/lib/cms/importer/post-age-table";
import { statedRelaxations } from "@/lib/cms/importer/age-relaxations";
import { combineReading, skippedSection } from "@/lib/cms/importer/extract";
import { checkAge, limitForPost } from "@/lib/eligibility";
import type { AgeCriteria } from "@/types/recruitment-record";
import type { AgeLimit } from "@/types";

const SSC = readFileSync("tests/fixtures/notice-text/ssc-cgl-2026-pages-1-8.txt", "utf8");
const AGE_QUOTE = "5. Age limit (As on 01-08-2026):";

/** The reading as the two real runs gave it: run 1 four age groups as "posts" and no relaxation; run 2 one range, 18-32, for every post. */
function read(age: AgeCriteria) {
  return combineReading({
    content: SSC, kind: "pdf", url: "https://ssc.gov.in/notice.pdf", organizationId: "ssc",
    ai: skippedSection("ai", "test"), details: skippedSection("details", "test"),
    pattern: { examPattern: { status: "not_stated" }, syllabus: { status: "not_stated" } } as never,
    article: { values: [{ fieldPath: "age", value: age, quote: AGE_QUOTE, page: 6 }], refused: [] },
  });
}
const run1 = () => read({ asOf: "2026-08-01", relaxations: [], postWise: ["18-27", "20-30", "18-30", "18-32"].map((r) => ({ post: `For the posts for which age limit is ${r} years`, min: Number(r.slice(0, 2)), max: Number(r.slice(3)) })) });
const run2 = () => read({ min: 18, max: 32, asOf: "2026-08-01", relaxations: [{ category: "SC/ST", years: 5 }, { category: "OBC", years: 3 }, { category: "PwBD", years: 10 }, { category: "PwBD (OBC)", years: 13 }, { category: "PwBD (SC/ST)", years: 15 }] });
const ageOf = (r: ReturnType<typeof read>) => r.values.find((v) => v.fieldPath === "age")!.value as AgeCriteria;

suite("SSC CGL 2026: the table of posts, read by code");

test("SG01 38 posts in five pay levels, each with its own range and its printed row as the quote", () => {
  const t = readPostAgeTable(SSC)!;
  assert.equal(t.rows.length, 38);
  assert.deepEqual([...new Set(t.rows.map((r) => r.group!.replace(/\s*\(.*$/, "")))], ["Pay Level-8", "Pay Level-7", "Pay Level-6", "Pay Level-5", "Pay Level-4"]);
  const range = (group: string, serial: string) => { const r = t.rows.find((x) => x.group!.startsWith(group) && x.serial === serial)!; return `${r.min}-${r.max}`; };
  assert.deepEqual([range("Pay Level-8", "1"), range("Pay Level-7", "1"), range("Pay Level-7", "2"), range("Pay Level-7", "13"), range("Pay Level-6", "7"), range("Pay Level-5", "1"), range("Pay Level-4", "6")],
    ["18-30", "20-30", "18-30", "20-30", "18-32", "18-27", "18-27"]);
  assert.ok(t.rows.every((r) => SSC.includes(r.quote)), "each quote word for word");
  assert.equal(t.rows.find((x) => x.group!.startsWith("Pay Level-6") && x.serial === "7")!.post, "Junior Statistical Officer Ministry of Statistics & Programme Implementation.");
});
test("SG02 posts 10 and 11 of Pay Level-7 print no age in their own rows (merged with post 12's): not read, and not given 12's range", () => {
  const t = readPostAgeTable(SSC)!;
  assert.deepEqual(t.unread.map((u) => [u.serial, u.text]), [["10", "Inspector (Preventive Officer)"], ["11", "Inspector (Examiner)"]]);
  assert.ok(!t.rows.some((r) => /Preventive|Examiner/.test(r.post)));
});

suite("In the reading: post by post, never one range for all");

test("SG03 run 2 (18-32 for every post): the table's 38 posts replace it; the overall range is dropped, and said", () => {
  const r = run2();
  const age = ageOf(r);
  assert.equal(age.postWise?.length, 38);
  assert.deepEqual([age.min, age.max, age.asOf], [undefined, undefined, "2026-08-01"]);
  assert.ok(r.refused.some((x) => x.fieldPath === "age" && /one range \(18-32\) is not applied to every post: the notice prints each post's own age \(18-27, 18-30, 18-32, 20-30 years\)/.test(x.reason)), JSON.stringify(r.refused));
  assert.ok(r.refused.some((x) => /post 10 \(Pay Level-7.*“Inspector \(Preventive Officer\)”: no age in its own row/.test(x.reason)));
});
test("SG04 run 1 (four age groups as posts): set aside for the 38 posts, and said; each post's evidence has its page", () => {
  const r = run1();
  const age = ageOf(r);
  assert.equal(age.postWise?.length, 38);
  assert.ok(!age.postWise!.some((p) => /for which age limit/.test(p.post)));
  assert.ok(r.refused.some((x) => /the reading's 4 post-wise age rows are set aside/.test(x.reason)));
  const jso = age.postWise!.find((p) => p.post.startsWith("Junior Statistical Officer"))!;
  assert.deepEqual([jso.min, jso.max, jso.evidence?.[0].page], [18, 32, 3]);
});
test("SG05 a name printed twice (Assistant / ASO, Other Ministries, in Pay Level-7 and 6) is told apart by its pay level", () => {
  const posts = ageOf(run2()).postWise!.map((p) => p.post).filter((p) => p.startsWith("Assistant / Assistant Section Officer"));
  assert.deepEqual(posts, ["Assistant / Assistant Section Officer Other Ministries/ Departments/ Organizations — Pay Level-7", "Assistant / Assistant Section Officer Other Ministries/ Departments/ Organizations — Pay Level-6"]);
});

suite("The coded relaxation table");

test("SG06 eight rows read, each as printed; “Up to 40 years of age” rows are upper ages, not relaxations, and are not read here", () => {
  const r = statedRelaxations(SSC);
  assert.deepEqual(r.map((x) => [x.category.slice(0, 40), x.years]), [
    ["SC/ST", 5], ["OBC", 3], ["PwBD", 10], ["PwBD (OBC)", 13], ["PwBD (SC/ST)", 15], ["Ex-Servicemen (ESM)", 3],
    ["Defence Personnel disabled in operation ", 3], ["Defence Personnel disabled in operation ", 8]]);
  assert.equal(r[5].text, "3 years after deduction of the military service rendered from the actual age as on 01.08.2026");
  assert.ok(r.every((x) => SSC.includes(x.quote)));
});
test("SG07 run 1 had none: all eight are added with their rows as evidence; run 2's five agree and stay, the other three are added", () => {
  assert.equal(ageOf(run1()).relaxations.length, 8);
  const two = ageOf(run2());
  assert.deepEqual(two.relaxations.map((x) => [x.category.slice(0, 22), x.years]), [
    ["SC/ST", 5], ["OBC", 3], ["PwBD", 10], ["PwBD (OBC)", 13], ["PwBD (SC/ST)", 15], ["Ex-Servicemen (ESM)", 3], ["Defence Personnel disa", 3], ["Defence Personnel disa", 8]]);
  assert.ok(!run2().refused.some((x) => /the reading gave/.test(x.reason)), "nothing to correct");
});

suite("The public age checker, post by post");

const limit = (): AgeLimit => { const a = ageOf(run2()); return { asOf: a.asOf, relaxation: a.relaxations, postWise: a.postWise }; };
const post = (start: string) => limitForPost(limit(), limit().postWise!.find((p) => p.post.startsWith(start))!);
test("SG08 born 15 Jan 1998 (28 on 1 Aug 2026): too old for an Auditor (18-27) unless OBC (30); within for Junior Statistical Officer (18-32)", () => {
  assert.equal(checkAge(post("Auditor Offices under C&AG"), "1998-01-15", "GEN", false).verdict, "TOO_OLD");
  assert.equal(checkAge(post("Auditor Offices under C&AG"), "1998-01-15", "OBC", false).verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(post("Junior Statistical Officer"), "1998-01-15", "GEN", false).verdict, "WITHIN");
});
test("SG09 an OBC candidate with a benchmark disability gets 13 years, not PwBD's 10: for an Auditor (27 + 13 = 40), born 1985 (41) is too old, born 1987 (39) within", () => {
  assert.equal(checkAge(post("Auditor Offices under C&AG"), "1985-01-15", "OBC", true).verdict, "TOO_OLD");
  const r = checkAge(post("Auditor Offices under C&AG"), "1987-01-15", "OBC", true);
  assert.deepEqual([r.verdict, (r as { relaxation?: { category: string } }).relaxation?.category], ["WITHIN_RELAXED", "PwBD (OBC)"]);
});
