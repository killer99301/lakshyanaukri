// O4 and O5: the words that say where a vacancy figure comes from, and why a
// total waits. Presentation only: the server's classes, reasons and actions are
// unchanged. Pure: the badge rule, and the vacancy editor and import review
// rendered; no database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/o4-o5-labels.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { badgeWords, type TableTotalView } from "@/app/admin/cms/[id]/check-actions";
import { VacancyTableEditor } from "@/app/admin/cms/[id]/VacancyTableEditor";
import { VacancyTableReview } from "@/app/admin/cms/import/VacancyTableReview";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

suite("O5: the badge of Total Vacancies worked out from the table");

const CALC: TableTotalView = { incomplete: true, route: "TABLE_CHECK", evidence: null, why: ["the total is incomplete", "the total is calculated from the rows"], pages: [46] };
const total = { fieldPath: "vacancies.total", cls: "UNSUPPORTED" };
const OFFICIAL = { official: [{ retrievalId: "pdf" }], rowsToMap: [] };

test("B1 an official PDF's table, not checked yet (the IBPS case): not 'No official source'", () => {
  assert.deepEqual(badgeWords(total, CALC, OFFICIAL), { words: "Official table — not checked yet", tone: "SUPPORTED" });
});
test("B2 an official table with research or prepared rows still to compare: said as partly research", () => {
  assert.deepEqual(badgeWords(total, CALC, { official: [{}], rowsToMap: [{}] }), { words: "Partly research — not checked yet", tone: "RESEARCH_ONLY" });
});
test("B3 no official document behind the table (the BTSC case): the class's own words stand, 'No official source'", () => {
  assert.equal(badgeWords(total, CALC, { official: [], rowsToMap: [{}] }), null);
});
test("B4 the class's own words stand everywhere else", () => {
  assert.equal(badgeWords({ fieldPath: "vacancies.total", cls: "VERIFIED" }, CALC, OFFICIAL), null, "a checked total");
  assert.equal(badgeWords({ fieldPath: "vacancies.total", cls: "CONFLICTING" }, CALC, OFFICIAL), null, "sources disagree");
  assert.equal(badgeWords({ fieldPath: "identity.notificationNumber", cls: "UNSUPPORTED" }, CALC, OFFICIAL), null, "another field");
  assert.equal(badgeWords(total, null, OFFICIAL), null, "a total entered on its own, not from a table");
  assert.equal(badgeWords(total, CALC, null), null, "the table cannot be checked here (its needs not known)");
});
test("B5 the words follow the state: once the table's rows are all official, the badge changes with it", () => {
  const before = badgeWords(total, CALC, { official: [{}], rowsToMap: [{}] })!.words;
  const after = badgeWords(total, CALC, { official: [{}], rowsToMap: [] })!.words;
  assert.deepEqual([before, after], ["Partly research — not checked yet", "Official table — not checked yet"]);
});

suite("O4: a figure written in research is never 'Printed in the notice'");

const row = (id: string, retrievalId: string | null, total: number, extra: Partial<VacancyTableRow["source"]> = {}): VacancyTableRow =>
  ({ id, at: { post: "Food Safety Officer" }, status: "STATED", total, cells: { ur: 41, sc: 17 }, source: { retrievalId, page: null, line: `UR 41 SC 17 Total ${total}`, ...extra } });
const tableOf = (rows: VacancyTableRow[]): VacancyTable => ({ dimensions: [{ key: "post", label: "Post" }],
  categories: [{ key: "ur", label: "UR", kind: "VERTICAL" }, { key: "sc", label: "SC", kind: "VERTICAL" }], rows, statedTotals: [] });
const editor = (t: VacancyTable, researchSources?: string[]) => text(renderToStaticMarkup(
  <VacancyTableEditor record={{ id: "j", draftState: "DRAFT", recordRevision: "r1", vacancies: { table: { value: t } } } as never} onSaved={() => {}} researchSources={researchSources} />));

/** The words of the figure badges (the grand total's and each post's). */
const badges = (t: VacancyTable, researchSources?: string[]) => [...renderToStaticMarkup(
  <VacancyTableEditor record={{ id: "j", draftState: "DRAFT", recordRevision: "r1", vacancies: { table: { value: t } } } as never} onSaved={() => {}} researchSources={researchSources} />,
).matchAll(/data-figure-basis[^>]*>([^<]*)</g)].map((m) => m[1]);

test("E1 a total stated in a research document (the BTSC case): 'From research, to check', said as written in the research", () => {
  const t = editor(tableOf([row("r1", "res1", 58)]), ["res1"]);
  assert.deepEqual(badges(tableOf([row("r1", "res1", 58)]), ["res1"]), ["From research, to check", "From research, to check"]);
  assert.match(t, /Total vacancies 58 From research, to check as written in the research, not the notice/);
});
test("E2 the same total from the official notice: 'Printed in the notice', as before", () => {
  const t = editor(tableOf([row("r1", "pdf", 58, { page: 3 })]), ["res1"]);
  assert.match(t, /Printed in the notice/);
  assert.ok(!/From research/.test(t));
});
test("E3 the label follows the state: the same row reads as research only while its document is research", () => {
  const t = tableOf([row("r1", "doc", 58)]);
  assert.match(editor(t, ["doc"]), /From research, to check/);
  assert.match(editor(t, []), /Printed in the notice/);
  assert.match(editor(t), /Printed in the notice/, "no checks known yet (a job never imported): as before");
});
test("E4 rows prepared outside and entered by hand keep their own words", () => {
  assert.deepEqual(badges(tableOf([row("r1", null, 58, { readBy: "PREPARED", page: 2 })]), ["res1"]), ["Prepared outside, to check", "Prepared outside, to check"]);
  assert.match(editor(tableOf([{ ...row("r1", null, 58), source: { retrievalId: null, page: null, line: "entered by hand" } }]), []), /Entered by hand/);
});
test("E5 a total added up from several rows stays 'Calculated', research or not", () => {
  const two = tableOf([row("r1", "res1", 30), { ...row("r2", "res1", 28), at: { post: "Analyst" } }]);
  const t = editor(two, ["res1"]);
  assert.match(t, /Total vacancies 58 Calculated/);
});

suite("O4: the import review of a research document");

test("R1 a research document's total: 'as written in the research', and the note says it is not the notice's", () => {
  const t = text(renderToStaticMarkup(<VacancyTableReview table={tableOf([row("r1", "res1", 58)])} note={null} research />));
  assert.match(t, /58 vacancies \(as written in the research\)/);
  assert.match(t, /58 \(in the research\)/);
  assert.match(t, /a figure marked “in the research” is the research's own figure, not the notice's/);
  assert.ok(!/as printed|\(printed\)/.test(t), t);
});
test("R2 an official document's total: 'as printed', as before", () => {
  const t = text(renderToStaticMarkup(<VacancyTableReview table={tableOf([row("r1", "pdf", 58, { page: 2 })])} note={null} />));
  assert.match(t, /58 vacancies \(as printed\)/);
  assert.match(t, /58 \(printed\)/);
});
