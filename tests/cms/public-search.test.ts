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
import { lifecycleLinksFrom } from "@/lib/cms/lifecycle-links";
import { textSearch, searchWords, closestMatches, sortOpportunities, isNewlyAdded, jobsLinkCount, type SortOption } from "@/lib/filters";

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

suite("Latest first, and the New badge");

test("PS10 latest sorts by when a job went live here; unknown dates go last", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const old = job({ slug: "old", title: "Old", addedAt: "2026-08-01T10:00:00Z", application: { closeDate: "2026-12-01" } });
  const fresh = job({ slug: "fresh", title: "Fresh", addedAt: "2026-10-04T09:00:00Z", application: { closeDate: "2026-10-07" } });
  const notified = job({ slug: "notified", title: "Notified", postDate: "2026-09-15", application: { closeDate: "2026-12-01" } });
  const undated = job({ slug: "undated", title: "Undated", application: { closeDate: "2026-12-01" } });
  assert.deepEqual(
    sortOpportunities([undated, old, notified, fresh], "latest", now).map((o) => o.slug),
    ["fresh", "notified", "old", "undated"],
  );
});

test("PS11 New badge: added within 7 days and still open; never for closed or undated jobs", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const open = { closeDate: "2026-10-20" };
  assert.equal(isNewlyAdded(job({ addedAt: "2026-10-04T09:00:00Z", application: open }), now), true);
  assert.equal(isNewlyAdded(job({ addedAt: "2026-09-28T09:00:00Z", application: open }), now), true);
  assert.equal(isNewlyAdded(job({ addedAt: "2026-09-20T09:00:00Z", application: open }), now), false);
  assert.equal(isNewlyAdded(job({ addedAt: "2026-10-04T09:00:00Z", application: { closeDate: "2026-10-01" } }), now), false);
  assert.equal(isNewlyAdded(job({ postDate: "2026-10-03", application: open }), now), false);
  assert.equal(isNewlyAdded(job({ addedAt: "not-a-date", application: open }), now), false);
});

suite("Links into /jobs");

test("PS12 a link's job count follows the same rules as the page it opens", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const open = { closeDate: "2026-12-01" };
  const jobs = [
    job({ slug: "c1", title: "SSC CHSL 2026", category: "ssc", qualification: "12th Pass", govType: "Central Govt", application: open }),
    job({ slug: "s1", title: "BPSC 72nd CCE", category: "state-psc", qualification: "Graduate", govType: "State Govt", state: "Bihar", application: open }),
    job({ slug: "p1", title: "IBPS PO 2026", category: "banking", qualification: "Graduate", govType: "PSU Bank", application: open }),
  ];
  const n = (href: string) => jobsLinkCount(jobs, href, now);
  assert.equal(n("/jobs?govType=central"), 1);
  assert.equal(n("/jobs?govType=state"), 1);
  assert.equal(n("/jobs?govType=psu"), 1);
  assert.equal(n("/jobs?govType=nonsense"), 3);
  assert.equal(n("/jobs?category=banking"), 1);
  assert.equal(n("/jobs?qualification=graduate"), 2);
  assert.equal(n("/jobs?qualification=be-btech"), 2);
  assert.equal(n("/jobs?qualification=12th-pass"), 1);
  assert.equal(n("/jobs?q=Teacher"), 0);
  // "State" in a title or a state name is not a State Govt job.
  assert.equal(n("/jobs?govType=state&q=bpsc"), 1);
  // Not /jobs query links: no count.
  assert.equal(n("/jobs"), null);
  assert.equal(n("/exams"), null);
});

suite("Results, admit cards and answer keys come from published records");

test("PS13 only official RESULT / ADMIT_CARD / ANSWER_KEY links are listed, newest first", () => {
  const snap = (id: string, projectedAt: string, links: Array<{ type: string; label: string; url: string; official: boolean }>) =>
    ({ id, slug: `job-${id}`, title: `Job ${id}`, organizationName: "SSC", projectedAt, links }) as never;
  const out = lifecycleLinksFrom([
    snap("a", "2026-09-01T00:00:00Z", [
      { type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://ssc.gov.in/n.pdf", official: true },
      { type: "ADMIT_CARD", label: "Tier-I Admit Card", url: "https://ssc.gov.in/admit", official: true },
      { type: "RESULT", label: "Unofficial result page", url: "https://example.com/r", official: false },
    ]),
    snap("b", "2026-10-01T00:00:00Z", [
      { type: "RESULT", label: "Tier-I Result", url: "https://ssc.gov.in/result.pdf", official: true },
      { type: "ANSWER_KEY", label: "Tier-I Answer Key", url: "https://ssc.gov.in/key", official: true },
      { type: "ADMIT_CARD", label: "Tier-II Admit Card", url: "https://ssc.gov.in/admit2", official: true },
      { type: "RESULT", label: "Bad link", url: "javascript:alert(1)", official: true },
    ]),
  ]);
  assert.deepEqual(out.results.map((l) => l.label), ["Tier-I Result"]);
  assert.deepEqual(out.answerKeys.map((l) => l.label), ["Tier-I Answer Key"]);
  assert.deepEqual(out.admitCards.map((l) => l.label), ["Tier-II Admit Card", "Tier-I Admit Card"]);
  assert.equal(out.admitCards[0].jobSlug, "job-b");
  assert.deepEqual(lifecycleLinksFrom([]), { results: [], admitCards: [], answerKeys: [] });
});
