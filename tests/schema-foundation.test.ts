// ═══════════════════════════════════════════════════════════
// Schema Foundation Tests — vacancy breakdown + age relaxation
// ═══════════════════════════════════════════════════════════
//
// Verifies the two schema changes introduced in the schema-foundation commit:
//
//   1. VacancyRow.breakdown?: VacancyCategoryBreakdown (vacancy matrix)
//   2. AgeLimit.relaxation?: AgeRelaxation[] (typed relaxation table)
//
// Run: npx tsx --tsconfig tsconfig.json tests/schema-foundation.test.ts

import { suite, test, assert } from "./intelligence/suite";
import type {
  VacancyRow,
  VacancyCategoryBreakdown,
  AgeRelaxation,
} from "@/types";
import type { VacancyBreakdownItem } from "@/intelligence/extraction-provider";

// ─── Mirrored formatting logic ────────────────────────────────────────────
//
// This function mirrors the JSX expression in JobDetailSections.tsx exactly:
//
//   {r.category}
//   {r.years != null ? `: +${r.years} years` : ""}
//   {r.text ? ` ${r.text}` : ""}
//
// If the component logic ever changes, this function and the component must
// be updated together.

function formatRelaxation(r: AgeRelaxation): string {
  return (
    r.category +
    (r.years != null ? `: +${r.years} years` : "") +
    (r.text ? ` ${r.text}` : "")
  );
}

// ─── SF01-SF02: Vacancy breakdown matrix ──────────────────────────────────

suite("SF01–SF02: VacancyCategoryBreakdown");

test("SF01: full UIIC Generalists breakdown compiles and holds correct values", () => {
  const breakdown: VacancyCategoryBreakdown = {
    ur: 68,
    ews: 22,
    obc: 62,
    sc: 30,
    st: 18,
    pwbd: { vi: 2, hi: 2, oc: 4, md: 3 },
    exsm: 0,
  };

  const row: VacancyRow = {
    post: "Administrative Officer (Scale I) – Generalists",
    count: 200,
    payScale: "JMG Scale I",
    breakdown,
  };

  assert.equal(row.count, 200, "total vacancies preserved in count");
  assert.equal(row.breakdown!.ur, 68);
  assert.equal(row.breakdown!.ews, 22);
  assert.equal(row.breakdown!.obc, 62);
  assert.equal(row.breakdown!.sc, 30);
  assert.equal(row.breakdown!.st, 18);

  // UR + EWS + OBC + SC + ST should sum to total (no horizontal reservations in this post)
  const catSum =
    (breakdown.ur ?? 0) +
    (breakdown.ews ?? 0) +
    (breakdown.obc ?? 0) +
    (breakdown.sc ?? 0) +
    (breakdown.st ?? 0);
  assert.equal(catSum, 200, "category columns must sum to post total");
});

test("SF02: PwBD sub-object accessible and structurally correct", () => {
  const row: VacancyRow = {
    post: "Administrative Officer (Scale I) – Generalists",
    count: 200,
    breakdown: {
      ur: 68, ews: 22, obc: 62, sc: 30, st: 18,
      pwbd: { vi: 2, hi: 2, oc: 4, md: 3 },
    },
  };

  const pwbd = row.breakdown!.pwbd!;
  assert.equal(pwbd.vi, 2, "VI sub-category");
  assert.equal(pwbd.hi, 2, "HI sub-category");
  assert.equal(pwbd.oc, 4, "OC sub-category");
  assert.equal(pwbd.md, 3, "MD sub-category");

  const pwbdSum = (pwbd.vi ?? 0) + (pwbd.hi ?? 0) + (pwbd.oc ?? 0) + (pwbd.md ?? 0);
  assert.equal(pwbdSum, 11, "PwBD sub-categories sum to 11 (UIIC Generalists)");
});

// ─── SF03-SF05: AgeRelaxation rendering ───────────────────────────────────

suite("SF03–SF05: AgeRelaxation formatting");

test("SF03: years-only relaxation renders correctly", () => {
  const r: AgeRelaxation = { category: "SC/ST", years: 5 };
  assert.equal(formatRelaxation(r), "SC/ST: +5 years");
});

test("SF04: years + text renders category, years, then text", () => {
  const r1: AgeRelaxation = { category: "OBC", years: 3, text: "(9 attempts)" };
  assert.equal(formatRelaxation(r1), "OBC: +3 years (9 attempts)");

  const r2: AgeRelaxation = { category: "SC/ST", years: 5, text: "(Unlimited)" };
  assert.equal(formatRelaxation(r2), "SC/ST: +5 years (Unlimited)");
});

test("SF05: text-only relaxation (no numeric years) renders category + text", () => {
  const r: AgeRelaxation = {
    category: "Existing employees",
    text: "8 years subject to applicable conditions",
  };
  assert.equal(formatRelaxation(r), "Existing employees 8 years subject to applicable conditions");
});

// ─── SF06: government.ts migrated records ─────────────────────────────────

suite("SF06: government.ts AgeRelaxation migration");

// Inline the relaxation data to keep this test self-contained (avoids
// importing the full government.ts module and its transitive deps).
// These values must stay in sync with src/data/government.ts.
const MIGRATED_RELAXATION_FIXTURES: { record: string; relaxation: AgeRelaxation[] }[] = [
  {
    record: "BPSC 72nd CCE",
    relaxation: [
      { category: "BC/EBC", years: 3 },
      { category: "SC/ST", years: 5 },
    ],
  },
  {
    record: "RRB NTPC Graduate",
    relaxation: [
      { category: "OBC (NCL)", years: 3 },
      { category: "SC/ST", years: 5 },
    ],
  },
  {
    record: "RRB NTPC Undergraduate",
    relaxation: [
      { category: "OBC", years: 3 },
      { category: "SC/ST", years: 5 },
    ],
  },
  {
    record: "SSC CGL 2026",
    relaxation: [
      { category: "OBC", years: 3 },
      { category: "SC/ST", years: 5 },
      { category: "PwD", years: 10 },
    ],
  },
  {
    record: "UPSC CSE 2026",
    relaxation: [
      { category: "OBC (NCL)", years: 3 },
      { category: "SC/ST", years: 5 },
    ],
  },
  {
    record: "IBPS PO CRP PO/MT-XVI",
    relaxation: [
      { category: "OBC", years: 3, text: "(9 attempts)" },
      { category: "SC/ST", years: 5, text: "(Unlimited)" },
    ],
  },
];

test("SF06: every migrated record has AgeRelaxation entries with required category field", () => {
  for (const fixture of MIGRATED_RELAXATION_FIXTURES) {
    for (const r of fixture.relaxation) {
      assert.ok(
        typeof r.category === "string" && r.category.length > 0,
        `${fixture.record}: category must be a non-empty string`,
      );
      // Every entry must have at least years or text
      assert.ok(
        r.years != null || (typeof r.text === "string" && r.text.length > 0),
        `${fixture.record} › ${r.category}: must have years and/or text`,
      );
    }
  }
});

test("SF06b: formatted relaxation strings match original string[] values exactly", () => {
  // The original string[] representations are preserved here for comparison,
  // proving the migration is semantically lossless.
  const originals: Record<string, string[]> = {
    "BPSC 72nd CCE":          ["BC/EBC: +3 years", "SC/ST: +5 years"],
    "RRB NTPC Graduate":      ["OBC (NCL): +3 years", "SC/ST: +5 years"],
    "RRB NTPC Undergraduate": ["OBC: +3 years", "SC/ST: +5 years"],
    "SSC CGL 2026":           ["OBC: +3 years", "SC/ST: +5 years", "PwD: +10 years"],
    "UPSC CSE 2026":          ["OBC (NCL): +3 years", "SC/ST: +5 years"],
    "IBPS PO CRP PO/MT-XVI":  ["OBC: +3 years (9 attempts)", "SC/ST: +5 years (Unlimited)"],
  };

  for (const fixture of MIGRATED_RELAXATION_FIXTURES) {
    const expected = originals[fixture.record];
    const formatted = fixture.relaxation.map(formatRelaxation);
    assert.deepEqual(
      formatted,
      expected,
      `${fixture.record}: formatted output must match original strings`,
    );
  }
});

// ─── SF07: Phase 13A VacancyBreakdownItem accepts breakdown ───────────────

suite("SF07: VacancyBreakdownItem (Phase 13A) breakdown field");

test("SF07: VacancyBreakdownItem accepts full breakdown matrix", () => {
  const item: VacancyBreakdownItem = {
    post: "AO Generalists",
    count: 200,
    breakdown: {
      ur: 68, ews: 22, obc: 62, sc: 30, st: 18,
      pwbd: { vi: 2, hi: 2, oc: 4, md: 3 },
    },
  };

  assert.equal(item.post, "AO Generalists");
  assert.equal(item.count, 200);
  assert.equal(item.breakdown!.ur, 68);
  assert.equal(item.breakdown!.pwbd!.vi, 2);
});

test("SF07b: VacancyBreakdownItem without breakdown is still valid (backward compat)", () => {
  const item: VacancyBreakdownItem = {
    post: "AO Hindi Officers",
    count: 25,
  };

  assert.equal(item.count, 25);
  assert.equal(item.breakdown, undefined, "breakdown is optional");
});
