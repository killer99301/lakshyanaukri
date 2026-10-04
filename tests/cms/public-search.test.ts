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
import { textSearch, searchWords } from "@/lib/filters";

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

test("PS05 post names, organisation id and slug are searchable", () => {
  assert.deepEqual(found("ldc"), [CHSL.slug]);
  assert.deepEqual(found("junior secretariat assistant"), [CHSL.slug]);
  assert.deepEqual(found("central govt clerk"), [CHSL.slug]);
  assert.deepEqual(found("higher secondary"), [CHSL.slug]);
});
