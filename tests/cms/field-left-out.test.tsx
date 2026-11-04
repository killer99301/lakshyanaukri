// FR-D1: what a source left out is said beside its field in the Smart intake
// review — under the field's item, or in a row of its own when nothing is
// offered for the field — with the source's name and the reason (which
// quotes the line). The source list keeps its "left out" line; "not read"
// messages stay there only. Presentation only: no tick box is added, no
// default changes. Pure: the left-out entries are I1's own, from
// combineReading with the AI off; the review is rendered to markup.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/field-left-out.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { ReviewPanel, type ReviewItem, type ReviewSource } from "@/app/admin/cms/import/ReviewPanel";
import { leftOutByField, leftOutField } from "@/app/admin/cms/import/left-out";
import { combineReading, skippedSection } from "@/lib/cms/importer/extract";
import { AI_NOT_USED } from "@/lib/cms/ai-assist";

const reading = (text: string) => combineReading({ content: text, kind: "html", url: "", organizationId: "x", labelledLines: true,
  ai: skippedSection("ai", AI_NOT_USED), details: skippedSection("details", AI_NOT_USED), pattern: skippedSection("pattern", AI_NOT_USED),
  article: { values: [], refused: [], links: [] } as never });
const source = (id: string, label: string, text: string, kind = "RESEARCH"): ReviewSource => {
  const r = reading(text);
  return { id, label, declaredKind: kind, authenticity: kind === "RESEARCH" ? "NOT_APPLICABLE" : "ATTESTED", notFound: r.notFound, refused: r.refused };
};
const item = (id: string, fieldPath: string, label: string, value: unknown, retrievalId: string, defaultTicked = true): ReviewItem =>
  ({ id, kind: "FIELD", fieldPath, label, value, claims: [{ retrievalId, quote: "q" }], action: "FILL", conflict: false, defaultTicked, flags: [] });
const render = (items: ReviewItem[], sources: ReviewSource[], ticked = new Set(items.filter((i) => i.defaultTicked).map((i) => i.id))) =>
  renderToStaticMarkup(<ReviewPanel title="TEST RECORD" organization="Test" existing={false} items={items} sources={sources} warnings={[]} replaced={[]}
    ticked={ticked} onToggle={() => {}} duplicates={[]} overrideReason="" setOverrideReason={() => {}} needsVerifiedConfirm={false}
    confirmVerified={false} setConfirmVerified={() => {}} busy={false} err={null} onSave={() => {}} onBack={() => {}} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The text of the field block (one row of a section) for a field path. */
const block = (html: string, path: string) => {
  const at = html.indexOf(`data-left-out-field="${path}"`) >= 0 ? html.indexOf(`data-left-out-field="${path}"`) : html.indexOf(`data-left-out-notes="${path}"`);
  return at < 0 ? "" : text(html.slice(at, html.indexOf("</section>", at)));
};

const PREPARED = `TEST RECORD 2099
Fee: General Rs 600, OBC Rs 400, SC/ST Rs 100, PwBD exempted
Application fee: Rs 250
Women candidates are exempted from payment of fee.
Eligibility: Bachelor's degree in any discipline
Selection: Written test and interview
Selection process: Interview only
Age limit: 40-21 years
Pay Scale: Level 7`;

suite("FR-D1: left-out information beside its field");

test("F1 I1's six cases each land under their own field, with the source's name and the quoted reason", () => {
  const s = source("r1", "pasted text — research, prepared by AI/person", PREPARED);
  const html = render([item("pay", "financial.payScale", "Pay scale", "Level 7", "r1")], [s]);
  const fee = text(html.slice(html.indexOf('data-review-section="Fees and pay"'), html.indexOf("</section>", html.indexOf('data-review-section="Fees and pay"'))));
  assert.match(fee, /Not offered from pasted text — research, prepared by AI\/person: labelled line: General \/ OBC: “General Rs 600” and “OBC Rs 400” differ/, "different fees in one field");
  assert.match(fee, /“SC\/ST Rs 100” and “PwBD exempted” differ/, "an exemption the field cannot hold");
  assert.match(fee, /“Rs 250” gives a fee \(₹250\) but names no category/, "a fee naming no group");
  assert.match(fee, /Women candidates are exempted .*a fee for a group the job's fee fields do not hold/, "a fee for a group with no field");
  assert.match(block(html, "eligibility"), /Eligibility Nothing offered for this field\. Not offered from .*names no post, and eligibility is kept post by post/, "eligibility with no post");
  assert.match(block(html, "selection"), /two different selection processes: “Selection: Written test and interview”; “Selection process: Interview only”/, "lines that disagree");
  assert.match(block(html, "age"), /minimum age is above the maximum/, "an impossible age");
});
test("F2 a field with an item: its notes under it, once; a field with none: a row of its own, with no tick box", () => {
  const s = source("r1", "Research", "Fee: General Rs 600, OBC Rs 400\nApplication Fee: SC/ST/PwBD Rs 100");
  const html = render([item("sc", "financial.feeSCST", "Fee (SC / ST / PwBD)", 100, "r1")], [s]);
  const notesOf = (p: string) => { const at = html.indexOf(`data-left-out-notes="${p}"`); return at < 0 ? [] : [...html.slice(at, html.indexOf("</div></div></div>", at)).matchAll(/data-left-out-note="true"[^>]*>([^<]*)/g)].map((m) => m[1]); };
  assert.deepEqual([notesOf("financial.feeGeneral").length, notesOf("financial.feeSCST").length], [1, 0], JSON.stringify([notesOf("financial.feeGeneral"), notesOf("financial.feeSCST")]));
  assert.ok(html.includes('data-left-out-notes="financial.feeGeneral"') && html.includes('data-left-out-field="financial.feeGeneral"'));
  const own = html.slice(html.indexOf('data-left-out-field="financial.feeGeneral"'), html.indexOf('data-left-out-notes="financial.feeGeneral"'));
  assert.ok(!/type="checkbox"/.test(own), "the field's own row has no tick box");
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1, "only the offered item can be ticked");
});
test("F3 entries kept under a check's label go under that field (DATE_FLAG_PATHS), and the title check under the title", () => {
  assert.deepEqual(["Notification Number", "Application Opens", "Application Closes", "Fee Payment Deadline", "Correction Window End", "Title", "financial.feeGeneral", "links#APPLY_ONLINE"].map(leftOutField),
    ["identity.notificationNumber", "dates.applicationOpenDate", "dates.applicationCloseDate", "dates.feePaymentCloseDate", "dates.correctionWindowEnd", "identity.title", "financial.feeGeneral", "links#APPLY_ONLINE"]);
  const html = render([], [{ id: "r1", label: "Notice", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "ATTESTED", notFound: [],
    refused: [{ fieldPath: "Notification Number", reason: "CLK/01/2097 or TSB/CLK/01/2097: two extraction methods disagree — check the notification and enter manually" }] }]);
  assert.match(block(html, "identity.notificationNumber"), /Notification number Nothing offered for this field\. Not offered from Notice: CLK\/01\/2097 or TSB\/CLK\/01\/2097: two extraction methods disagree/);
});
test("F4 an entry whose field cannot be told is placed under no field; it stays in the source list", () => {
  assert.equal(leftOutField("Something else"), null);
  const html = render([], [{ id: "r1", label: "Notice", declaredKind: "RESEARCH", authenticity: "NOT_APPLICABLE", notFound: [], refused: [{ fieldPath: "Something else", reason: "a reason" }] }]);
  assert.ok(!html.includes("data-left-out-note="), "no field note");
  assert.match(text(html), /Left out \(did not pass the checks\): Something else — a reason/);
});
test("F5 two sources keep their own names; the same note from the same source is said once", () => {
  const a = source("r1", "Research A", "Fee: General Rs 600, OBC Rs 400");
  const b = source("r2", "Research B", "Fee: General Rs 600, OBC Rs 400");
  const notes = leftOutByField([a, b, { ...a, refused: [...a.refused, ...a.refused] }]).get("financial.feeGeneral")!;
  assert.deepEqual(notes.map((n) => n.source), ["Research A", "Research B"]);
  const html = render([], [a, b]);
  assert.match(block(html, "financial.feeGeneral"), /Not offered from Research A: .*Not offered from Research B:/);
});
test("F6 “not read” messages are not repeated beside fields; the source list is as before", () => {
  const s = source("r1", "Research", PREPARED);
  assert.ok(s.notFound.some((n) => /not read: the AI was not used/.test(n)), "the source has not-read messages");
  const html = render([], [s]);
  const fields = [...html.matchAll(/data-left-out-note="true"[^>]*>([^<]*)/g)].map((m) => m[1]).join(" ");
  assert.ok(!/not read:/.test(fields), fields);
  assert.match(text(html), /Not read from it \(it may still be there\): .*Left out \(did not pass the checks\): .*financial\.feeGeneral — labelled line:/);
});
test("F7 tick boxes and defaults are as before: an offered item unticked stays unticked; a note makes nothing selectable", () => {
  const s = source("r1", "Research", PREPARED);
  const items = [item("pay", "financial.payScale", "Pay scale", "Level 7", "r1", false)];
  const html = render(items, [s], new Set());
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
  assert.ok(!/checked=""/.test(html), "nothing ticked");
});
