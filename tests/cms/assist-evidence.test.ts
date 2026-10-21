// The quotes kept for one AI Assist run
//   npx tsx --tsconfig tsconfig.json tests/cms/assist-evidence.test.ts
import { suite, test, assert } from "../intelligence/suite";
import { assistExcerpts } from "@/lib/cms/assist-excerpts";

suite("Evidence kept for an AI Assist run");

test("AE01 one excerpt per quote of each filled or suggested field; others are not kept", () => {
  const quotes = new Map([
    ["age", ["Minimum 18 years and maximum 33 years.", "  OBC: 3 years  ", "Minimum 18 years and maximum 33 years."]],
    ["financial.payScale", ["Pay Level 2"]],
    ["syllabus", ["General Studies"]],
  ]);
  const out = assistExcerpts(quotes, [{ fieldPath: "age", outcome: "filled" }, { fieldPath: "financial.payScale", outcome: "suggested" }, { fieldPath: "eligibility", outcome: "filled" }], "2026-10-21T00:00:00Z");
  assert.deepEqual(out.map((e) => [e.fieldPath, e.quote, e.outcome]), [
    ["age", "Minimum 18 years and maximum 33 years.", "filled"],
    ["age", "OBC: 3 years", "filled"],
    ["financial.payScale", "Pay Level 2", "suggested"],
  ]);
  assert.ok(out.every((e) => e.extractionMethod === "LLM" && e.extractedAt === "2026-10-21T00:00:00Z" && e.id.length > 10));
});

test("AE02 long quotes are cut, and a field keeps at most twelve", () => {
  const many = Array.from({ length: 20 }, (_, i) => `quote number ${i} ${"x".repeat(400)}`);
  const out = assistExcerpts(new Map([["eligibility", many]]), [{ fieldPath: "eligibility", outcome: "filled" }], "2026-10-21T00:00:00Z");
  assert.equal(out.length, 12);
  assert.ok(out.every((e) => e.quote.length <= 300));
});
