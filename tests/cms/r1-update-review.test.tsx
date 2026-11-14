// CMS 2.0 R1 (U4): the grouped Update review, rendered from synthetic items. Nothing is saved.
//   npx tsx --tsconfig tsconfig.json tests/cms/r1-update-review.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { UpdateReview, groupOf, type UpdateSummary } from "@/app/admin/cms/import/UpdateReview";

const R = "11111111-1111-4111-8111-111111111111";
type It = Parameters<typeof UpdateReview>[0]["items"][number];
const it = (over: Partial<It>): It => ({ id: "x", kind: "FIELD", fieldPath: "syllabus", label: "Syllabus", value: [], claims: [{ retrievalId: R, quote: "Subject: Reasoning: Coding-decoding" }],
  action: "REPLACE", conflict: false, defaultTicked: true, flags: [], ...over });
const ITEMS: It[] = [
  it({ id: "syl", changes: [{ kind: "ADDED", element: "Tier-I · Reasoning", detail: "Coding-decoding" }], current: [{ subject: "Reasoning", topics: ["Analogy"] }], value: [{ subject: "Reasoning", topics: ["Analogy", "Coding-decoding"] }] }),
  it({ id: "stg", fieldPath: "examStages", label: "Exam stages", changes: [{ kind: "CHANGED", element: "Tier-I", detail: "Scheduled → Admit card out" }] }),
  it({ id: "fee", fieldPath: "financial.feeGeneral", label: "Fee (General)", current: 400, value: 500, claims: [{ retrievalId: R, quote: "Application Fee: General Rs. 500" }] }),
  it({ id: "rm", fieldPath: "links", label: "Links: remove", attention: true, defaultTicked: false, flags: ["held: a removal is never ticked for you"] }),
  it({ id: "same", fieldPath: "dates.applicationCloseDate", label: "Application closes", action: "MATCHES", value: "2097-01-31", defaultTicked: false }),
  it({ id: "ann", kind: "ANNOUNCEMENT", fieldPath: "updates#new", label: "New announcement", action: "FILL", value: { op: "ADD", entry: { date: "2097-03-01", title: "Tier-I admit card released", description: "Out." } } }),
];
const SUMMARY: UpdateSummary = { notRead: ["Not read from the text (line 14): “Tier-II probably in May”: no date certainty"], attention: ["LN Update (line 9): two values for one field"], kept: ["Vacancies", "Eligibility"],
  header: { updateType: "ADMIT_CARD", source: "Test notice", sourceDate: "2097-03-01", identity: "MATCH" } };
const html = renderToStaticMarkup(<UpdateReview title="TEST R1 Exam 2097" existing items={ITEMS} sources={[]} summary={SUMMARY} ticked={new Set(["syl", "stg", "fee", "ann"])}
  onToggle={() => {}} duplicates={[]} overrideReason="" setOverrideReason={() => {}} needsVerifiedConfirm={false} confirmVerified={false} setConfirmVerified={() => {}}
  busy={false} err={null} onSave={() => {}} onBack={() => {}} onClassic={() => {}} />);
const text = html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

suite("R1: the grouped Update review");

test("V01 the groups, in order: Needs attention, Changed, New, Unchanged, Not read", () => {
  const order = [...html.matchAll(/data-update-section="([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["ATTENTION", "CHANGED", "NEW", "UNCHANGED", "NOT_READ"]);
});

test("V02 each item lands in the right group", () => {
  assert.deepEqual(ITEMS.map((i) => [i.id, groupOf(i)]), [["syl", "NEW"], ["stg", "CHANGED"], ["fee", "CHANGED"], ["rm", "ATTENTION"], ["same", "UNCHANGED"], ["ann", "NEW"]]);
});

test("V03 a change shows now and after, the element changes, and the line of the text it came from", () => {
  assert.ok(text.includes("NOW 400") && text.includes("AFTER 500"), "a simple value: now and after side by side");
  assert.ok(text.includes("＋ New · Tier-I · Reasoning : Coding-decoding") || text.includes("＋ New · Tier-I · Reasoning: Coding-decoding"), text.slice(0, 600));
  assert.ok(text.includes("✎ Changed · Tier-I"));
  assert.ok(text.includes("From the text: “Application Fee: General Rs. 500”"));
});

test("V04 the review says what the text left out, what it could not read, and what needs the owner", () => {
  assert.ok(text.includes("kept exactly as they are: Vacancies, Eligibility"));
  assert.ok(text.includes("(line 14): “Tier-II probably in May”"));
  assert.ok(text.includes("two values for one field"));
  assert.ok(text.includes("This text is about this job"));
});

test("V05 only real changes have a tick; the save bar counts them and says nothing is published or sent", () => {
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 5, "the unchanged item has no tick");
  assert.ok(text.includes("4 of 5 ticked") && text.includes("nothing is published or sent to Telegram from here"));
  assert.ok(text.includes("Classic view"), "the classic review stays one click away");
});
