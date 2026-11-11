// Search quality (owner-approved, 11 Nov 2026): typos, short forms, body initials, related terms, any word order,
// notice numbers, qualifications, ranking, open/closed filters and spelling suggestions, on known fixture jobs.
// Pure: no database, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/search-quality.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { textSearch, searchOpportunities, getDefaultFilterState, spellingSuggestion, nameInitials, searchScore, jobsUrlState } from "@/lib/filters";
import type { Opportunity } from "@/types";

const NOW = new Date("2026-11-11T12:00:00");
const job = (o: Record<string, unknown>): Opportunity => ({
  type: "government", shortDescription: "", category: "government", state: "All India", qualification: "",
  application: { openDate: "2026-11-01", closeDate: "2099-12-31" }, ...o,
} as unknown as Opportunity);

const NTPC_GRAD = job({ slug: "rrb-ntpc-graduate", title: "RRB NTPC Graduate Level Recruitment 2026 (CEN 06/2026)", organizationId: "rrb", organizationName: "Railway Recruitment Boards", category: "railway", qualification: "Graduate", notificationNumber: "CEN 06/2026", addedAt: "2026-10-01" });
const NTPC_UG = job({ slug: "rrb-ntpc-ug", title: "RRB NTPC Undergraduate Level Recruitment 2026 (CEN 07/2026)", organizationId: "rrb", organizationName: "Railway Recruitment Boards", category: "railway", qualification: "12th Pass", notificationNumber: "CEN 07/2026", addedAt: "2026-10-02" });
const CANARA = job({ slug: "canara-apprentice", title: "Canara Bank Graduate Apprentice Recruitment 2026", organizationId: "canara-bank", organizationName: "Canara Bank", category: "banking", qualification: "Graduate", addedAt: "2026-09-01" });
const SAIL = job({ slug: "sail-apprentice", title: "SAIL Bhilai Steel Plant Apprentice Recruitment 2026", organizationId: "sail-bhilai-steel-plant", organizationName: "SAIL Bhilai Steel Plant", category: "psu", qualification: "ITI", addedAt: "2026-11-05" });
const SBI_FIRE = job({ slug: "sbi-fire", title: "SBI Assistant Manager Engineer (Fire) Recruitment 2026", organizationId: "sbi", organizationName: "State Bank of India", category: "banking", qualification: "Graduate", notificationNumber: "CRPD/SCO/2026-27/29", addedAt: "2026-11-09" });
const FIRE_MENTION = job({ slug: "power-utility-trainee", title: "Power Utility Engineering Executive Trainee 2026", organizationId: "power-utility", organizationName: "Power Utility Limited", category: "psu", qualification: "Graduate", eligibility: ["B.E. in any branch; fire safety training preferred"], addedAt: "2026-11-10" });
const BIHAR_SI = job({ slug: "bihar-police-si", title: "Bihar Police Sub Inspector Recruitment 2026", organizationId: "bpssc", organizationName: "Bihar Police Subordinate Services Commission", category: "defence", state: "Bihar", qualification: "Graduate", addedAt: "2026-10-20" });
const UP_CONSTABLE = job({ slug: "up-police-constable", title: "UP Police Constable Recruitment 2026", organizationId: "uppbpb", organizationName: "Uttar Pradesh Police Recruitment and Promotion Board", category: "defence", state: "Uttar Pradesh", qualification: "12th Pass", application: { openDate: "2026-08-01", closeDate: "2026-09-01" }, addedAt: "2026-08-01" });
const SIKKIM = job({ slug: "sikkim-assistant", title: "Sikkim PSC Assistant Recruitment 2026", organizationId: "sikkim-psc", organizationName: "Sikkim Public Service Commission", category: "state-psc", state: "Sikkim", qualification: "Graduate", addedAt: "2026-10-25" });
const GUARD = job({ slug: "forest-guard", title: "Forest Guard Recruitment 2026", organizationId: "forest-board", organizationName: "Forest Board", addedAt: "2026-09-01" });
const GAURD = job({ slug: "forest-gaurd-notice", title: "Forest Gaurd Exam Notice 2026", organizationId: "other-board", organizationName: "Other Board", addedAt: "2026-11-01" });

const ALL = [NTPC_GRAD, NTPC_UG, CANARA, SAIL, SBI_FIRE, FIRE_MENTION, BIHAR_SI, UP_CONSTABLE, SIKKIM, GUARD, GAURD];
const found = (q: string, list = ALL) => textSearch(list, q).map((o) => o.slug).sort();
const ranked = (q: string, list = ALL) => searchOpportunities(list, q, "All India", getDefaultFilterState(), "latest", NOW).map((o) => o.slug);

suite("Typos, short forms and word order");
test("SQ01 rrb ntcp → the RRB NTPC jobs (two swapped letters in a four-letter word)", () => {
  assert.deepEqual(found("rrb ntcp"), ["rrb-ntpc-graduate", "rrb-ntpc-ug"]);
  assert.deepEqual(found("ntcp"), ["rrb-ntpc-graduate", "rrb-ntpc-ug"]);
  assert.deepEqual(found("ntpx"), [], "a replaced letter in a four-letter word is not forgiven");
});
test("SQ02 bank apprentce → bank apprentice jobs only", () => {
  assert.deepEqual(found("bank apprentce"), ["canara-apprentice"], "SAIL's apprentice job is not a bank's");
  assert.deepEqual(found("apprentce"), ["canara-apprentice", "sail-apprentice"]);
});
test("SQ03 sbi fire, fire sbi, state bank fire, assistant engineer fire → the SBI Fire job, first", () => {
  for (const q of ["sbi fire", "fire sbi", "state bank fire", "assistant engineer fire", "SBI Fire 2026"]) {
    assert.equal(ranked(q)[0], "sbi-fire", q);
  }
  assert.deepEqual(found("sbi fire"), ["sbi-fire"]);
  assert.equal(nameInitials("State Bank of India"), "sbi");
  assert.equal(nameInitials("Railway Recruitment Boards"), "rrb");
  assert.equal(nameInitials("Canara Bank"), null, "two words make no initials");
});
test("SQ04 police si → the Sub-Inspector job; si never finds Sikkim", () => {
  assert.deepEqual(found("police si"), ["bihar-police-si"]);
  assert.deepEqual(found("si"), ["bihar-police-si"]);
  assert.ok(!found("si").includes("sikkim-assistant"));
  assert.deepEqual(found("sikkim"), ["sikkim-assistant"]);
  assert.deepEqual(found("police"), ["bihar-police-si", "up-police-constable"]);
});
test("SQ05 12th pass → only jobs whose saved qualification is 12th Pass", () => {
  assert.deepEqual(found("12th pass"), ["rrb-ntpc-ug", "up-police-constable"]);
});
test("SQ06 the exact advertisement number → its job", () => {
  assert.deepEqual(found("CRPD/SCO/2026-27/29"), ["sbi-fire"]);
  assert.deepEqual(found("crpd sco 2026-27/29"), ["sbi-fire"]);
  assert.deepEqual(found("CEN 07/2026"), ["rrb-ntpc-ug"]);
});

suite("Ranking");
test("SQ07 a title match beats a passing mention, even when the mention is newer", () => {
  const r = ranked("fire");
  assert.deepEqual(r.slice(0, 2), ["sbi-fire", "power-utility-trainee"]);
  assert.ok(searchScore(SBI_FIRE, "fire") > searchScore(FIRE_MENTION, "fire"));
});
test("SQ08 correct spelling beats a misspelling: the exact job first, the typo match after", () => {
  assert.deepEqual(ranked("forest guard"), ["forest-guard", "forest-gaurd-notice"], "older exact match first");
  assert.deepEqual(ranked("forest gaurd"), ["forest-gaurd-notice", "forest-guard"], "the typed spelling's own job first");
});
test("SQ09 a chosen sort is kept; equal matches keep latest first", () => {
  const byDeadline = searchOpportunities(ALL, "rrb ntpc", "All India", getDefaultFilterState(), "deadline", NOW).map((o) => o.slug);
  assert.equal(byDeadline.length, 2);
  assert.deepEqual(ranked("rrb ntpc"), ["rrb-ntpc-ug", "rrb-ntpc-graduate"], "equal matches: newer first");
});

suite("Filters with search");
test("SQ10 a closed job is found, but never under Applications Open", () => {
  assert.ok(ranked("police constable").includes("up-police-constable"), "found");
  const open = jobsUrlState(new URLSearchParams("status=open")).filters;
  const openOnly = searchOpportunities(ALL, "police", "All India", open, "latest", NOW).map((o) => o.slug);
  assert.deepEqual(openOnly, ["bihar-police-si"]);
});
test("SQ11 search with a category and a state", () => {
  const defence = { ...getDefaultFilterState(), categories: ["defence"] as never };
  assert.deepEqual(searchOpportunities(ALL, "police", "All India", defence, "latest", NOW).map((o) => o.slug).sort(), ["bihar-police-si", "up-police-constable"]);
  assert.deepEqual(searchOpportunities(ALL, "police", "Bihar", getDefaultFilterState(), "latest", NOW).map((o) => o.slug), ["bihar-police-si"]);
  const railway = { ...getDefaultFilterState(), categories: ["railway"] as never };
  assert.deepEqual(searchOpportunities(ALL, "apprentice", "All India", railway, "latest", NOW), []);
});

suite("When nothing matches");
test("SQ12 a spelling suggestion from the site's own words, only when it finds something", () => {
  assert.deepEqual(found("bank aprentce"), [], "two letters off: not matched on its own");
  assert.equal(spellingSuggestion(ALL, "bank aprentce"), "bank apprentice");
  assert.equal(spellingSuggestion(ALL, "rrb ntpc"), null, "already finds jobs");
  assert.equal(spellingSuggestion(ALL, "tcs infosys"), null, "nothing close: no suggestion");
  assert.equal(spellingSuggestion(ALL, "ssc 2027"), null, "numbers are never respelled");
});
test("SQ13 nothing is invented: unrelated words find nothing", () => {
  assert.deepEqual(found("nursing officer"), []);
  assert.deepEqual(found("rrb fire"), []);
});
