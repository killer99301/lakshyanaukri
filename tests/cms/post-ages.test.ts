// Post-wise age limits (after B2.5): read post by post from the real IBPS
// CRP RRBs-XV text, each value with its own quote and page; saved with the
// new optional fields; the public check uses the chosen post's own rules and
// never the widest range; category maximums used exactly as printed; older
// age records unchanged. Pure: no DB, no AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/post-ages.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import type { AgeLimit, PostAgeRange } from "@/types";
import type { AgeCriteria } from "@/types/recruitment-record";
import { judgeArticle } from "@/lib/cms/importer/article";
import { buildProposal } from "@/lib/cms/importer/proposal";
import { cleanAge } from "@/lib/cms/record-ops";
import { checkAge, findCategoryMax, limitForPost } from "@/lib/eligibility";
import { ageFor } from "@/lib/eligibility-finder";

const IBPS = readFileSync("tests/fixtures/notice-text/ibps-crp-rrb-xv-pages-6-8-20-25.txt", "utf8");

/** What the model is asked for, filled with the notice's own lines (as a correct answer would be). */
const ANSWER = {
  age: {
    quote: "II. Age (As on 01.09. 2026)", asOf: "2026-09-01",
    postWise: [
      { post: "Office Assistants (Multipurpose)", min: 18, max: 28, bornFrom: "1998-09-02", bornTo: "2008-09-01",
        quote: "Office Assistants\n(Multipurpose)\nBetween 18 years\nand 28 years\nCandidates should not have been born\nearlier than 02.09.1998 and later than\n01.09.2008 (both dates inclusive)" },
      { post: "Officer Scale- I (Assistant Manager)", min: 18, max: 30, bornFrom: "1996-09-02", bornTo: "2008-09-01",
        quote: "Officer Scale- I\n(Assistant\nManager)\nAbove 18 years -\nBelow 30 years Candidates should not have been born\nearlier than 02.09.1996 and later than\n01.09.2008 (both dates inclusive)" },
      { post: "Officer Scale- II (Manager)", min: 21, max: 32, bornFrom: "1994-09-02", bornTo: "2005-09-01",
        quote: "Officer Scale- II\n(Manager)\nAbove 21 years -\nBelow 32 years Candidates should not have been born\nearlier than 02.09.1994 and later than\n01.09.2005 (both dates inclusive)" },
      { post: "Officer Scale- III (Senior Manager)", min: 21, max: 40, bornFrom: "1986-09-02", bornTo: "2005-09-01",
        quote: "Officer Scale- III\n(Senior Manager)\nAbove 21 years -\nBelow 40 years Candidates should not have been born\nearlier than 02.09.1986 and later than\n01.09.2005 (both dates inclusive)" },
    ],
  },
};
type Read = AgeCriteria & { postWise: PostAgeRange[] };
const ageOf = (answer: unknown) => judgeArticle(answer as never, IBPS);

suite("Read post by post, each value with its own words");

test("PA01 IBPS: four posts, each with its own range and dates of birth from its own line on page 7; no overall range made up", () => {
  const r = ageOf(ANSWER);
  const age = r.values.find((v) => v.fieldPath === "age")!.value as Read;
  assert.deepEqual(age.postWise.map((p) => [p.post, p.min, p.max, p.bornFrom, p.bornTo]), [
    ["Office Assistants (Multipurpose)", 18, 28, "1998-09-02", "2008-09-01"],
    ["Officer Scale- I (Assistant Manager)", 18, 30, "1996-09-02", "2008-09-01"],
    ["Officer Scale- II (Manager)", 21, 32, "1994-09-02", "2005-09-01"],
    ["Officer Scale- III (Senior Manager)", 21, 40, "1986-09-02", "2005-09-01"],
  ]);
  assert.equal(age.min, undefined, "no overall minimum worked out from the posts");
  assert.equal(age.max, undefined, "no widest range made up");
  assert.ok(age.postWise.every((p) => p.evidence!.every((e) => e.page === 7)), "every value from page 7");
  assert.deepEqual(age.postWise[1].evidence!.map((e) => `${e.about}=${e.value}`), ["post=Officer Scale- I (Assistant Manager)", "min=18", "max=30", "bornFrom=1996-09-02", "bornTo=2008-09-01"]);
  assert.deepEqual(r.refused, []);
});
test("PA02 a figure not in the post's own quote is left out, and said; the post keeps what its quote does say", () => {
  const wrong = structuredClone(ANSWER);
  wrong.age.postWise[2].max = 35;
  const r = ageOf(wrong);
  const p = (r.values.find((v) => v.fieldPath === "age")!.value as Read).postWise[2];
  assert.equal(p.max, undefined);
  assert.equal(p.min, 21);
  assert.ok(r.refused.some((x) => /post "Officer Scale- II \(Manager\)": the maximum age 35 is not in its quote/.test(x.reason)), JSON.stringify(r.refused));
});
test("PA03 a quote that names another post, or is not the notice's words, gives that post no ages; the rest are read", () => {
  const wrong = structuredClone(ANSWER);
  wrong.age.postWise[3].quote = wrong.age.postWise[2].quote; // Scale-III given Scale-II's line
  wrong.age.postWise[0].quote = "Office Assistants (Multipurpose) between 18 and 28 years";
  const r = ageOf(wrong);
  const posts = (r.values.find((v) => v.fieldPath === "age")!.value as Read).postWise.map((p) => p.post);
  assert.deepEqual(posts, ["Officer Scale- I (Assistant Manager)", "Officer Scale- II (Manager)"]);
  assert.equal(r.refused.filter((x) => /does not name the post; its ages are not read/.test(x.reason)).length, 2);
});
test("PA04 a post's own cut-off date, relaxation and printed upper age are kept, each with its own quote", () => {
  const text = `${IBPS}\nOffice Assistants: age is counted as on 01.10.2026.\nEx-Servicemen applying for Office Assistants: 3 years over their service.\nFor Office Assistants the upper age for widows is 35 years.`;
  const answer = structuredClone(ANSWER) as unknown as { age: { postWise: Array<Record<string, unknown>> } };
  Object.assign(answer.age.postWise[0], {
    asOf: { value: "2026-10-01", quote: "Office Assistants: age is counted as on 01.10.2026." },
    relaxations: [{ category: "Ex-Servicemen", years: 3, quote: "Ex-Servicemen applying for Office Assistants: 3 years over their service." }],
    categoryMax: [{ category: "Widows", max: 35, quote: "For Office Assistants the upper age for widows is 35 years." }],
  });
  const age = judgeArticle(answer as never, text).values.find((v) => v.fieldPath === "age")!.value as Read;
  const oa = age.postWise[0];
  assert.deepEqual([oa.asOf, oa.relaxations, oa.categoryMax], ["2026-10-01", [{ category: "Ex-Servicemen", years: 3 }], [{ category: "Widows", max: 35 }]]);
  assert.deepEqual(oa.evidence!.slice(-3).map((e) => [e.about, e.value]), [["asOf", "2026-10-01"], ["relaxation: Ex-Servicemen", "3"], ["categoryMax: Widows", "35"]]);
});
test("PA05 a post named in the eligibility with no age read is flagged on the age item, not given another post's range", () => {
  const r = ageOf(ANSWER);
  // As the real model named IBPS's posts: the Scale-II row covers its specialist posts; a post code cannot tie to a row is flagged.
  const values = [...r.values, { fieldPath: "eligibility", value: [
    { post: "Officer Scale-II General Banking Officer (Manager)", qualification: ["x"] },
    { post: "Officer Scale-II Specialist Officers (Manager) Law Officer", qualification: ["x"] },
    { post: "Law Officer", qualification: ["x"] },
  ], quote: "Officer Scale- II", page: 7 }];
  const p = buildProposal({ extractions: [{ retrieval: { id: "r1", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "ATTESTED", originRole: "NONE", originPurposes: [], label: "notice" }, values, links: [] }], current: () => undefined });
  const flags = p.items.find((i) => i.fieldPath === "age")!.flags;
  assert.ok(flags.some((f) => /^no age was read for “Law Officer” —/.test(f)), flags);
  assert.ok(!flags.some((f) => /General Banking|Specialist Officers/.test(f)), flags);
});

suite("Saved with the new fields; older records unchanged");

test("PA06 the new per-post fields and evidence are kept; bad ones are refused with why", () => {
  const value = ageOf(ANSWER).values.find((v) => v.fieldPath === "age")!.value as Read;
  const saved = cleanAge({ ...value, postWise: [{ ...value.postWise[0], asOf: "2026-10-01", relaxations: [{ category: "ESM", years: 3 }], categoryMax: [{ category: "Widows", max: 35 }] }, ...value.postWise.slice(1)] });
  assert.deepEqual([saved.postWise![0].asOf, saved.postWise![0].relaxations, saved.postWise![0].categoryMax], ["2026-10-01", [{ category: "ESM", years: 3 }], [{ category: "Widows", max: 35 }]]);
  assert.equal(saved.postWise![1].evidence!.length, 5);
  assert.throws(() => cleanAge({ relaxations: [], postWise: [{ post: "A", max: 30, asOf: "01-09-2026" }] }), /"A" cut-off date must be a real date/);
  assert.throws(() => cleanAge({ relaxations: [], categoryMax: [{ category: "OBC", max: 3.5 }] }), /maximum age for "OBC" must be a whole number/);
});
test("PA07 an age stored before these fields existed saves back exactly as it was", () => {
  const legacy = { min: 18, max: 27, asOf: "2026-08-01", relaxations: [{ category: "SC/ST", years: 5 }, { category: "OBC", years: 3 }], postWise: [{ post: "LDC", min: 18, max: 27 }, { post: "JSA", bornFrom: "1999-08-02", bornTo: "2008-08-01" }] };
  assert.deepEqual(cleanAge(structuredClone(legacy)), legacy);
});

suite("The public check: the chosen post's own rules, never the widest range");

const limitFrom = (age: AgeCriteria): AgeLimit => ({ min: age.min, max: age.max, asOf: age.asOf, relaxation: age.relaxations, postWise: age.postWise, categoryMax: age.categoryMax });
const ibps = limitFrom(ageOf(ANSWER).values.find((v) => v.fieldPath === "age")!.value as AgeCriteria);
const post = (name: RegExp) => ibps.postWise!.find((p) => name.test(p.post))!;

test("PA08 born 1 March 1995: too old for Officer Scale-I, inside for Scale-II, whatever a widest range would say", () => {
  const withWidest: AgeLimit = { ...ibps, min: 18, max: 40 };
  assert.equal(checkAge(limitForPost(withWidest, post(/Scale- I \(/)), "1995-03-01", "GEN", false).verdict, "TOO_OLD");
  assert.equal(checkAge(limitForPost(withWidest, post(/Scale- II \(/)), "1995-03-01", "GEN", false).verdict, "WITHIN");
  const finder = ageFor(withWidest, { dobIso: "1995-03-01", category: "GEN", pwbd: false } as never);
  assert.match(finder.note, /within the limit for 2 of 4 posts/);
});
test("PA09 a post's relaxations are added to the recruitment's, its own row replacing the same category; its cut-off date is used", () => {
  const limit: AgeLimit = { asOf: "2026-09-01", relaxation: [{ category: "SC/ST", years: 5 }, { category: "OBC", years: 3 }], postWise: [{ post: "Clerk", min: 18, max: 28, asOf: "2026-10-01", relaxations: [{ category: "OBC", years: 4 }, { category: "Ex-servicemen", years: 3 }] }] };
  const l = limitForPost(limit, limit.postWise![0]);
  assert.equal(l.asOf, "2026-10-01");
  assert.deepEqual(l.relaxation, [{ category: "SC/ST", years: 5 }, { category: "OBC", years: 4 }, { category: "Ex-servicemen", years: 3 }]);
  // 31 on 1 Oct 2026 (born 2 Sep 1995): over 28, inside 28 + 4 for OBC.
  const c = checkAge(l, "1995-09-02", "OBC", false);
  assert.deepEqual([c.verdict, c.effectiveMax], ["WITHIN_RELAXED", 32]);
});
test("PA10 an upper age printed for the category is used as printed; women's and ex-servicemen's rows are not used for others; disagreeing rows give no answer", () => {
  const btsc: AgeLimit = { min: 21, asOf: "2026-08-01", categoryMax: [{ category: "Unreserved (Male)", max: 37 }, { category: "Unreserved (Female)", max: 40 }, { category: "SC / ST", max: 42 }] };
  const born = (age: number) => `${2026 - age - 1}-12-01`; // `age` years old on 1 Aug 2026
  assert.deepEqual([checkAge(btsc, born(36), "GEN", false).verdict, checkAge(btsc, born(36), "GEN", false).categoryMax?.max], ["WITHIN", 37]);
  assert.equal(checkAge(btsc, born(38), "GEN", false).verdict, "TOO_OLD", "the women's 40 is not used for a general candidate");
  assert.equal(checkAge(btsc, born(41), "SC", false).verdict, "WITHIN");
  assert.equal(checkAge(btsc, born(43), "ST", false).verdict, "TOO_OLD");
  assert.equal(checkAge(btsc, born(30), "OBC", false).verdict, "UNKNOWN", "no row for OBC: not guessed");
  assert.equal(findCategoryMax([{ category: "OBC (NCL)", max: 33 }, { category: "OBC", max: 35 }], "OBC", false), undefined);
  // A recruitment-wide printed maximum is not assumed for a post.
  assert.equal(limitForPost({ ...btsc, postWise: [{ post: "P", min: 21, max: 30 }] }, { post: "P", min: 21, max: 30 }).categoryMax, undefined);
});
test("PA11 relaxation years given as an \"upper age\" (SC/ST: 5) are refused as such; the post's own ages are still read", () => {
  const answer = structuredClone(ANSWER) as unknown as { age: { categoryMax?: unknown[]; postWise: Array<Record<string, unknown>> } };
  answer.age.categoryMax = [{ category: "Scheduled Caste (SC) /Scheduled Tribe (ST)", max: 5, quote: "Scheduled Caste (SC) /Scheduled Tribe (ST) 5 years" }];
  const text = `${IBPS}\n1 Scheduled Caste (SC) /Scheduled Tribe (ST) 5 years`;
  const r = judgeArticle(answer as never, text);
  const age = r.values.find((v) => v.fieldPath === "age")!.value as Read;
  assert.equal(age.categoryMax, undefined);
  assert.equal(age.postWise.length, 4);
  assert.ok(r.refused.some((x) => /is a number of years of relaxation, not an upper age/.test(x.reason)), JSON.stringify(r.refused));
  assert.doesNotThrow(() => cleanAge(age), "the editor accepts what is left");
});
test("PA12 a quote whose curly quote mark the model wrote straight still finds its page", () => {
  const answer = structuredClone(ANSWER);
  answer.age.postWise[0].quote = `Group “B"\n${answer.age.postWise[0].quote}`;
  const age = ageOf(answer).values.find((v) => v.fieldPath === "age")!.value as Read;
  assert.ok(age.postWise[0].evidence!.every((e) => e.page === 7), JSON.stringify(age.postWise[0].evidence!.map((e) => e.page)));
});
