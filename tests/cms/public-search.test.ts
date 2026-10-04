// ═══════════════════════════════════════════════════════════
// Public job search (the box on the home page and /jobs)
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  PS01  words match in any order and across fields
//  PS02  punctuation in titles and queries does not block a match
//  PS03  filler words ("jobs", "recruitment", "apply online") are ignored
//  PS04  a word that appears nowhere still excludes the job
//  PS05  post names from eligibility, organisation id and slug are searchable
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { Opportunity } from "@/types";
import { textSearch, searchWords, closestMatches, sortOpportunities, type SortOption } from "@/lib/filters";

const job = (o: Record<string, unknown>): Opportunity =>
  ({ type: "government", shortDescription: "", category: "government", state: "All India", qualification: "", ...o }) as unknown as Opportunity;

const CHSL = job({
  slug: "ssc-chsl-combined-higher-secondary-level-examination-2026",
  title: "SSC CHSL (Combined Higher Secondary Level) Examination 2026",
  organizationId: "ssc",
  organizationName: "Staff Selection Commission",
  category: "ssc",
  qualification: "12th Pass",
  govType: "Central Govt",
  notificationNumber: "F. No. HQ-C1102/5/2026-C-1",
  eligibility: ["Lower Divisional Clerk (LDC)/Junior Secretariat Assistant (JSA)", "Passed Class 12 (10+2) or equivalent"],
});
const IBPS = job({
  slug: "ibps-po-mt-crp-xvi-2026",
  title: "IBPS PO/MT CRP-XVI 2026",
  organizationId: "ibps",
  organizationName: "Institute of Banking Personnel Selection",
  category: "banking",
  qualification: "Graduate",
});
const ALL = [CHSL, IBPS];
const found = (q: string) => textSearch(ALL, q).map((o) => o.slug);

suite("Public job search");

test("PS01 words match in any order and across fields", () => {
  assert.deepEqual(found("SSC CHSL"), [CHSL.slug]);
  assert.deepEqual(found("chsl 2026"), [CHSL.slug]);
  assert.deepEqual(found("2026 chsl ssc"), [CHSL.slug]);
  assert.deepEqual(found("staff selection 12th"), [CHSL.slug]);
  assert.deepEqual(found("2026"), [CHSL.slug, IBPS.slug]);
  assert.deepEqual(found("   "), [CHSL.slug, IBPS.slug]);
});

test("PS02 punctuation does not block a match", () => {
  assert.deepEqual(found("ibps po mt"), [IBPS.slug]);
  assert.deepEqual(found("crp xvi"), [IBPS.slug]);
  assert.deepEqual(found("CRP-XVI"), [IBPS.slug]);
  assert.deepEqual(found("10+2"), [CHSL.slug]);
  assert.deepEqual(found("(chsl)"), [CHSL.slug]);
});

test("PS03 filler words are ignored unless they are all there is", () => {
  assert.deepEqual(found("ssc chsl recruitment 2026 apply online"), [CHSL.slug]);
  assert.deepEqual(found("12th pass govt jobs"), [CHSL.slug]);
  assert.deepEqual(found("latest banking jobs"), [IBPS.slug]);
  assert.deepEqual(searchWords("SSC CHSL jobs"), ["ssc", "chsl"]);
  // Only filler: matched literally, so "examination" still finds the title that has it.
  assert.deepEqual(searchWords("jobs"), ["jobs"]);
  assert.deepEqual(found("examination"), [CHSL.slug]);
});

test("PS04 a word that appears nowhere excludes the job", () => {
  assert.deepEqual(found("ssc cgl"), []);
  assert.deepEqual(found("chsl 2025"), []);
  assert.deepEqual(found("railway"), []);
});

test("PS06 plurals, common synonyms and single typos still find the job", () => {
  assert.deepEqual(found("clerks"), [CHSL.slug]);
  assert.deepEqual(found("bank jobs"), [IBPS.slug]);
  assert.deepEqual(found("inter pass"), [CHSL.slug]);
  assert.deepEqual(found("intermediate"), [CHSL.slug]);
  assert.deepEqual(found("graduation"), [IBPS.slug]);
  assert.deepEqual(found("secratariat"), [CHSL.slug]);   // one letter wrong
  assert.deepEqual(found("bankng"), [IBPS.slug]);        // one letter missing
  assert.deepEqual(found("selcetion"), [CHSL.slug, IBPS.slug]); // two letters swapped
  // Short words and numbers are never fuzzy-matched.
  assert.deepEqual(found("chsk"), []);
  assert.deepEqual(found("2027"), []);
});

test("PS07 questions about a job still find it", () => {
  assert.deepEqual(found("ssc chsl 2026 last date"), [CHSL.slug]);
  assert.deepEqual(found("chsl admit card"), [CHSL.slug]);
  assert.deepEqual(found("ibps po salary"), [IBPS.slug]);
  assert.deepEqual(found("how to apply for ssc chsl"), [CHSL.slug]);
});

test("PS08 closest matches: offered only when nothing matches fully, never on a year alone", () => {
  const closest = (q: string) => closestMatches(ALL, q).map((o) => o.slug);
  assert.deepEqual(found("ssc chsl 2025"), []);
  assert.deepEqual(closest("ssc chsl 2025"), [CHSL.slug]);
  assert.deepEqual(closest("ibps clerk"), [CHSL.slug, IBPS.slug]); // one word each
  assert.deepEqual(closest("railway 2026"), []);                  // only the year matches
  assert.deepEqual(closest("railway"), []);                       // single word: no fallback
  assert.deepEqual(closest("tcs infosys"), []);
});

test("PS05 post names, organisation id and slug are searchable", () => {
  assert.deepEqual(found("ldc"), [CHSL.slug]);
  assert.deepEqual(found("junior secretariat assistant"), [CHSL.slug]);
  assert.deepEqual(found("central govt clerk"), [CHSL.slug]);
  assert.deepEqual(found("higher secondary"), [CHSL.slug]);
});

suite("Sorting (the options the Sort by dropdown sends)");

test("PS09 deadline puts open jobs first by urgency; vacancies sorts high to low", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const a = job({ slug: "a", title: "A", totalVacancies: 100, application: { closeDate: "2026-10-20" } });
  const b = job({ slug: "b", title: "B", totalVacancies: 5000, application: { closeDate: "2026-10-07" } });
  const c = job({ slug: "c", title: "C", totalVacancies: 900, application: { closeDate: "2026-09-01" } });
  const order = (sort: SortOption) => sortOpportunities([a, b, c], sort, now).map((o) => o.slug);
  assert.deepEqual(order("deadline"), ["b", "a", "c"]);
  assert.deepEqual(order("vacancies"), ["b", "c", "a"]);
});
