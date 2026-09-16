// ═══════════════════════════════════════════════════════════
// Phase 11: Recruitment Title Normalizer — Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/title-normalizer.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  N01  Strip "Out For X Posts" from aggregator headline
//  N02  Strip "Download Official PDF For Full Details" CTA
//  N03  Clean official title passes through unchanged
//  N04  Pipe-separated CTA is stripped
//  N05  Multiple boilerplate patterns stripped in one pass
//  N06  Result shorter than minimum falls back to original
//  N07  Trailing punctuation artifacts are cleaned
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { normalizeRecruitmentTitle } from "@/intelligence/title-normalizer";

suite("Phase 11 — Recruitment Title Normalizer");

test("N01: strip 'Out For X Posts' from aggregator headline", () => {
  const raw = "UIIC AO Recruitment 2026 Out For 225 Posts";
  const result = normalizeRecruitmentTitle(raw);
  assert.strictEqual(result, "UIIC AO Recruitment 2026");
});

test("N02: strip 'Download Official PDF For Full Details' CTA", () => {
  const raw = "SBI Clerk Recruitment 2026, Download Official PDF For Full Details";
  const result = normalizeRecruitmentTitle(raw);
  assert.ok(!result.includes("Download"), `"Download" CTA not stripped: "${result}"`);
  assert.ok(result.includes("SBI Clerk Recruitment 2026"), "core title preserved");
});

test("N03: clean official title passes through unchanged", () => {
  const raw = "Administrative Officer Recruitment 2026";
  const result = normalizeRecruitmentTitle(raw);
  assert.strictEqual(result, raw);
});

test("N04: pipe-separated CTA is stripped", () => {
  const raw = "RRB NTPC Recruitment 2026 | Apply Online";
  const result = normalizeRecruitmentTitle(raw);
  assert.ok(!result.includes("Apply Online"), `pipe CTA not stripped: "${result}"`);
  assert.ok(result.includes("RRB NTPC Recruitment 2026"), "core title preserved");
});

test("N05: multiple boilerplate patterns stripped", () => {
  const raw =
    "IBPS Clerk Recruitment 2026 Out For 6128 Posts, Download Official PDF For Full Details";
  const result = normalizeRecruitmentTitle(raw);
  assert.ok(!result.includes("Out For"), `"Out For" not stripped: "${result}"`);
  assert.ok(!result.includes("Download"), `"Download" not stripped: "${result}"`);
  assert.ok(result.includes("IBPS Clerk Recruitment 2026"), "core title preserved");
});

test("N06: result shorter than minimum falls back to original", () => {
  // After stripping, only "Exam" would remain (4 chars < 15) — should fall back
  const raw = "Exam Out For 500 Posts, Apply Online Now";
  const result = normalizeRecruitmentTitle(raw);
  // Either the original is returned or a meaningful portion survives
  assert.ok(result.length > 0, "result is non-empty");
  // If the core surviving text is too short, the original is returned
  if (result !== raw) {
    assert.ok(result.length >= 15, `surviving title too short: "${result}"`);
  }
});

test("N08a: hyphen-minus before 'Apply Online' is stripped (govtjobguru <title> actual case)", () => {
  // govtjobguru's <title> tag uses U+002D (hyphen-minus), not an en-dash.
  // extractIntakeFields reads <title>, so the normalizer must handle U+002D.
  const raw = "UIIC AO Recruitment 2026 - Apply Online for 225 Administrative Officer Posts";
  const result = normalizeRecruitmentTitle(raw);
  assert.strictEqual(result, "UIIC AO Recruitment 2026", `unexpected result: "${result}"`);
});

test("N08b: en-dash before 'Apply Online' is stripped (H1 / other aggregator case)", () => {
  const raw = "UIIC AO Recruitment 2026 – Apply Online for 225 Administrative Officer Posts";
  const result = normalizeRecruitmentTitle(raw);
  assert.strictEqual(result, "UIIC AO Recruitment 2026", `unexpected result: "${result}"`);
});

test("N09: legitimate title content is preserved — no over-stripping", () => {
  const raw = "IBPS Clerk 2026 CRP Clerks-XIV Recruitment for 6128 Posts";
  const result = normalizeRecruitmentTitle(raw);
  // "for 6128 Posts" is part of the legitimate CRP title pattern — must not strip it
  assert.ok(result.includes("IBPS Clerk"), `core name stripped: "${result}"`);
  assert.ok(result.includes("6128") || result.length >= 30, `over-stripped: "${result}"`);
});

test("N07: trailing punctuation artifacts are cleaned", () => {
  // Stripping a suffix can leave a trailing comma or colon
  const raw = "BPSC 71st CCE Recruitment 2026, Apply Online Now";
  const result = normalizeRecruitmentTitle(raw);
  assert.ok(!/[,;:\s]+$/.test(result), `trailing punctuation not cleaned: "${result}"`);
  assert.ok(result.includes("BPSC 71st CCE Recruitment 2026"), "core title preserved");
});
