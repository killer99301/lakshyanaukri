// I5: held vacancy figures as tables for the vacancy editor's paste box —
// from each held path (H1–H5, and imports made before I5), with their
// original lines, the document they came from kept on every row, and whether
// the job's saved table holds them (worked out, never stored). Pure.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/i5-held-tables.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { heldStatus, heldTablesOf, sourceForHeldRow, type HeldNote, type HeldTable } from "@/lib/cms/importer/held-tables";
import { readVacancyTables } from "@/lib/cms/importer/vacancy-tables";
import { buildRows, mergePasted, readPasted, suggestColumns, type ColumnRole } from "@/lib/vacancy-paste";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";

const RES = { id: "res1", label: "pasted text — research, prepared by AI/person", declaredKind: "RESEARCH", prepared: true };
const OFF = { id: "off1", label: "tpsc.example.gov.in — notification, attested by admin", declaredKind: "OFFICIAL_NOTIFICATION" };
const SPLIT_QUOTE = "There are 25 vacancies for Office Assistants: SC 4 and UR 9; 18 for Officer Scale I: SC 3 and UR 7.";
const splitNote: HeldNote = { from: "split", problems: ["The job's table is split by Post › Bank; this document by Post. The job's rows are kept as they are; this document's 2 rows are not brought in — check them by hand in the vacancy editor."],
  diff: { held: 2, heldDimensions: [{ key: "post", label: "Post" }], heldRows: [
    { at: { post: "Office Assistants" }, status: "STATED", total: 25, page: null, line: SPLIT_QUOTE, cells: { SC: 4, UR: 9 } },
    { at: { post: "Officer Scale I" }, status: "STATED", total: 18, page: null, line: SPLIT_QUOTE, cells: { SC: 3, UR: 7 } }] } };
const FRONT = "Test Public Service Commission\nRecruitment of Clerks 2099\nLast date to apply online: 30.06.2099";
const page = (...p: string[]) => p.map((x, i) => `${x}\n\n-- ${i + 1} of ${p.length} --\n`).join("\n");
const savedRow = (id: string, line: string, retrievalId: string, total: number, cells: Record<string, number> = {}): VacancyTableRow =>
  ({ id, at: { post: id }, status: "STATED", total, cells, source: { retrievalId, page: null, line } });

suite("I5: each held path becomes a table for the paste box");

test("H1 the AI's split held against a bank-wise job: written out under its own headings, each row keeping its sentence", () => {
  const [h] = heldTablesOf(splitNote, OFF);
  assert.equal(h.kind, "SPLIT");
  assert.equal(h.text, "Post\tSC\tUR\tTotal\nOffice Assistants\t4\t9\t25\nOfficer Scale I\t3\t7\t18");
  assert.deepEqual(h.lines.filter((l) => l.row).map((l) => l.original), [SPLIT_QUOTE, SPLIT_QUOTE]);
  assert.match(h.incomplete ?? "", /written in sentences, not a table/);
  const roles = suggestColumns(readPasted(h.text)).map((r) => r.role === "category" ? r.key : r.role);
  assert.deepEqual(roles, ["dimension", "sc", "ur", "total"], "the paste box reads it by its own rules");
});
test("H2 a bank-wise table held against a post-wise job: its two dimensions as headings", async () => {
  const note: HeldNote = { from: "tables", diff: { held: 1, heldDimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }],
    heldRows: [{ at: { post: "Clerk", bank: "Delta Gramin Bank" }, status: "STATED", total: 13, page: 2, line: "1 Delta Gramin Bank 10 3 13", cells: { UR: 10, SC: 3 } }] } };
  const [h] = heldTablesOf(note, OFF);
  assert.equal(h.text, "Post\tBank\tUR\tSC\tTotal\nClerk\tDelta Gramin Bank\t10\t3\t13");
  assert.deepEqual([h.lines[1].original, h.lines[1].page], ["1 Delta Gramin Bank 10 3 13", 2]);
});
test("H3 a pasted table whose columns need choosing: its own lines, as pasted, with the columns as suggested", () => {
  const note: HeldNote = { coverage: { unreadLines: [], tables: [{ title: "Vacancy table", pages: [], read: false, why: "its columns need choosing: “FF” is not a category the reader knows",
    columns: ["Post → Post", "UR → category UR", "FF → category FF", "Total → total"], heading: "| Post | UR | FF | Total |",
    lines: ["| Post | UR | FF | Total |", "| Clerk | 10 | 1 | 11 |", "| Typist | 4 | 0 | 4 |"].map((text) => ({ page: null, text })) }] } };
  const [h] = heldTablesOf(note, RES);
  assert.deepEqual([h.kind, h.text.split("\n").length, h.lines.filter((l) => l.row).length, h.research, h.prepared], ["PASTED", 3, 2, true, true]);
});
test("H4 posts run together with banks, held by the reader: the heading and rows as printed, the heading kept", async () => {
  const r = await readVacancyTables(page(FRONT, "Vacancies\nName of Post Name of the Bank UR SC Total\nClerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3\nOfficer Delta Gramin Bank 1 1 2"),
    { retrievalId: "off1", fallbackPost: "X", apiKey: undefined });
  const [h] = heldTablesOf({ from: null, coverage: r.coverage }, OFF);
  assert.deepEqual([h.kind, h.lines[0].text, h.lines.filter((l) => l.row).map((l) => l.text)],
    ["NOT_READ", "Name of Post Name of the Bank UR SC Total", ["Clerk Delta Gramin Bank 1 2 3", "Clerk Epsilon Gramin Bank 2 1 3", "Officer Delta Gramin Bank 1 1 2"]]);
  assert.ok(h.lines.every((l) => l.page === 2) && !h.incomplete);
});
test("H5 two tables not read in one source stay two, each with its own rows; the flat list of lines is as before", () => {
  const t = (title: string, rows: string[]) => ({ title, pages: [3], read: false, why: "its 3 columns of figures could not be matched to the heading", heading: `${title} UR SC Total`,
    lines: [`${title} UR SC Total`, ...rows].map((text) => ({ page: 3, text })) });
  const note: HeldNote = { coverage: { unreadLines: [{ page: 3, text: "loose line 1 2" }], tables: [t("Annexure A", ["Clerk 1 2 3"]), t("Annexure B", ["Typist 4 5 9", "Driver 1 1 2"])] } };
  const hs = heldTablesOf(note, OFF);
  assert.deepEqual(hs.map((h) => [h.title, h.lines.filter((l) => l.row).map((l) => l.text)]), [["Annexure A", ["Clerk 1 2 3"]], ["Annexure B", ["Typist 4 5 9", "Driver 1 1 2"]]]);
});
test("H6 an import made before I5: its lines as they are, together, and said: no heading is made up", () => {
  const note: HeldNote = { coverage: { tables: [{ title: "Vacancies", pages: [2], read: false, why: "each row's post and bank run together" }],
    unreadLines: [{ page: 2, text: "Clerk Delta Gramin Bank 1 2 3" }, { page: 2, text: "Clerk Epsilon Gramin Bank 2 1 3" }] } };
  const [h] = heldTablesOf(note, OFF);
  assert.deepEqual([h.kind, h.text], ["LEGACY", "Clerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3"]);
  assert.match(h.incomplete!, /made before held tables kept their own heading and lines: .*column heading was not kept — type it on the first line/);
});
test("H7 a source with nothing held: nothing listed", () => {
  assert.deepEqual(heldTablesOf({ from: "tables", coverage: { tables: [{ title: "T", pages: [1], read: true }], unreadLines: [] }, diff: { held: 0, heldRows: [] } }, OFF), []);
  assert.deepEqual(heldTablesOf(null, OFF), []);
});

suite("I5: rows keep their document; corrections are said as corrections");

test("S1 a line left as it was keeps the document's own line and page; research stays research (its document), prepared stays prepared", () => {
  const [h] = heldTablesOf(splitNote, RES);
  assert.deepEqual(sourceForHeldRow("Office Assistants\t4\t9\t25", h), { retrievalId: "res1", page: null, line: SPLIT_QUOTE, readBy: "PREPARED" });
  const official = heldTablesOf(splitNote, OFF)[0];
  assert.deepEqual(sourceForHeldRow("Office Assistants\t4\t9\t25", official), { retrievalId: "off1", page: null, line: SPLIT_QUOTE });
});
test("S2 a line changed in the paste box is saved as corrected, never as the document's words", () => {
  const [h] = heldTablesOf(splitNote, OFF);
  assert.deepEqual(sourceForHeldRow("Office Assistants\t5\t9\t25", h).line, "(corrected in the editor) Office Assistants\t5\t9\t25");
});

suite("I5: added, partly added, not added — from the saved table only");

const h4 = (): HeldTable => heldTablesOf({ coverage: { unreadLines: [], tables: [{ title: "Vacancies", pages: [2], read: false, why: "run together", heading: "Name of Post Name of the Bank UR SC Total",
  lines: ["Name of Post Name of the Bank UR SC Total", "Clerk Delta Gramin Bank 1 2 3", "Clerk Epsilon Gramin Bank 2 1 3", "Officer Delta Gramin Bank 1 1 2", "Total 4 4 8"].map((text) => ({ page: 2, text })) }] } }, OFF)[0];
test("T1 nothing saved: not added; the Total line is no row to add", () => {
  assert.deepEqual(heldStatus(h4(), []), { status: "NOT_ADDED", added: 0, of: 3 });
});
test("T2 some rows saved (corrected lines count, as the same line): partly added; all: added", () => {
  const one = [savedRow("a", "(corrected in the editor) Clerk\tDelta Gramin Bank\t1\t2\t3", "off1", 3, { ur: 1, sc: 2 })];
  assert.deepEqual(heldStatus(h4(), one), { status: "PARTIAL", added: 1, of: 3 });
  const all = [...one, savedRow("b", "Clerk Epsilon Gramin Bank 2 1 3", "off1", 3, { ur: 2, sc: 1 }), savedRow("c", "Officer Delta Gramin Bank 1 1 2", "off1", 2, { ur: 1, sc: 1 })];
  assert.deepEqual(heldStatus(h4(), all).status, "ADDED");
});
test("T3 a shared document or a shared line alone is no match; a changed figure is no match; one saved row counts once", () => {
  assert.equal(heldStatus(h4(), [savedRow("x", "Clerk Delta Gramin Bank 1 2 3", "other-doc", 3, { ur: 1, sc: 2 })]).status, "NOT_ADDED", "another document");
  assert.equal(heldStatus(h4(), [savedRow("x", "Clerk Delta Gramin Bank 1 9 3", "off1", 3, { ur: 1, sc: 2 })]).status, "NOT_ADDED", "another line");
  assert.equal(heldStatus(h4(), [savedRow("x", "Clerk Delta Gramin Bank 1 2 3", "off1", 30, { ur: 1, sc: 2 })]).status, "NOT_ADDED", "a figure changed after adding");
  const split = heldTablesOf(splitNote, OFF)[0];
  assert.deepEqual(heldStatus(split, [savedRow("x", SPLIT_QUOTE, "off1", 25, { sc: 4, ur: 9 })]), { status: "PARTIAL", added: 1, of: 2 }, "two rows share a sentence: one saved row counts once");
});
test("T4 rows removed from the saved table: the status goes back", () => {
  const all = [savedRow("a", "Clerk Delta Gramin Bank 1 2 3", "off1", 3), savedRow("b", "Clerk Epsilon Gramin Bank 2 1 3", "off1", 3), savedRow("c", "Officer Delta Gramin Bank 1 1 2", "off1", 2)];
  assert.equal(heldStatus(h4(), all).status, "ADDED");
  assert.equal(heldStatus(h4(), all.slice(1)).status, "PARTIAL");
  assert.equal(heldStatus(h4(), []).status, "NOT_ADDED");
});
test("T5 a held table with no row to tell by: status uncertain", () => {
  const bare = heldTablesOf({ coverage: { unreadLines: [], tables: [{ title: "T", pages: [], read: false, why: "w", heading: "Post UR", lines: [{ page: null, text: "Post UR" }] }] } }, OFF)[0];
  assert.deepEqual(heldStatus(bare, []), { status: "UNCERTAIN", added: 0, of: 0 });
});

suite("I5: through the paste box's own reader and merge");

test("P1 the pasted FF table: its column chosen by the admin, rows built with their document, merged: added, nothing removed", () => {
  const h = heldTablesOf({ coverage: { unreadLines: [], tables: [{ title: "Vacancy table", pages: [], read: false, why: "FF", heading: "| Post | UR | FF | Total |",
    lines: ["| Post | UR | FF | Total |", "| Clerk | 10 | 1 | 11 |", "| Typist | 4 | 0 | 4 |"].map((text) => ({ page: null, text })) }] } }, RES)[0];
  const grid = readPasted(h.text);
  const roles = suggestColumns(grid).map((r, i): ColumnRole => (grid.headers[i] === "FF" ? { role: "category", key: "ff", label: "FF (freedom fighters)", kind: "UNDETERMINED" } : r));
  const built = buildRows(grid, roles, { idPrefix: "h-", prepared: true });
  const rows = built.rows.map((r) => ({ ...r, source: sourceForHeldRow(r.source.line, h) }));
  assert.ok(rows.every((r) => r.source.retrievalId === "res1" && r.source.readBy === "PREPARED" && !r.source.line.startsWith("(corrected")));
  const job: VacancyTable = { dimensions: [{ key: "post", label: "Post" }], categories: [], statedTotals: [], rows: [savedRow("Steno", "Steno 2", "off1", 2)] };
  const plan = mergePasted(job, { ...built, rows }, false);
  assert.deepEqual([plan.added.length, plan.problems, plan.table.rows.length], [2, [], 3], "added beside the job's row, which stays");
  assert.deepEqual(heldStatus(h, plan.table.rows).status, "ADDED", "worked out from the rows as they would be saved");
});
test("P2 a held table of another split is refused by the merge until the admin makes it match; a differing saved row is not replaced unasked", () => {
  const h = heldTablesOf({ from: "tables", diff: { held: 1, heldDimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }],
    heldRows: [{ at: { post: "Clerk", bank: "Delta" }, status: "STATED", total: 13, page: 2, line: "Delta 10 3 13", cells: { UR: 10, SC: 3 } }] } }, OFF)[0];
  const grid = readPasted(h.text);
  const built = buildRows(grid, suggestColumns(grid), { idPrefix: "h-" });
  const postJob: VacancyTable = { dimensions: [{ key: "post", label: "Post" }], categories: [], statedTotals: [], rows: [savedRow("Clerk", "Clerk 12", "off1", 12)] };
  assert.match(mergePasted(postJob, built, false).problems[0] ?? "", /The table is split by Post; the pasted rows by Post › Bank/);
  const same: VacancyTable = { dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [], statedTotals: [],
    rows: [{ ...savedRow("v", "verified line", "off1", 12), at: { post: "Clerk", bank: "Delta" } }] };
  const plan = mergePasted(same, built, false);
  assert.deepEqual([plan.differ.length, plan.table.rows.find((r) => r.id === "v")!.total], [1, 12], "the saved row stays until “Replace” is ticked");
});

suite("I5: the Smart intake review shows what is held, apart from what is offered");

test("R1 a held table is shown with its source, why, columns and lines, with no tick box; offered items as before", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ReviewPanel } = await import("@/app/admin/cms/import/ReviewPanel");
  const source = { id: "res1", label: "pasted text — research, prepared by AI/person", declaredKind: "RESEARCH", authenticity: "NOT_APPLICABLE", prepared: true, notFound: [], refused: [],
    vacancyTables: { from: null, coverage: { pages: null, unreadLines: [], tables: [{ title: "Vacancy table", pages: [], rows: 2, read: false, why: "its columns need choosing: “FF” is not a category the reader knows",
      columns: ["Post → Post", "UR → category UR", "FF → category FF", "Total → total"], heading: "| Post | UR | FF | Total |",
      lines: ["| Post | UR | FF | Total |", "| Clerk | 10 | 1 | 11 |"].map((text) => ({ page: null, text })) }] } } };
  const html = renderToStaticMarkup(React.createElement(ReviewPanel, { title: "T", organization: "O", existing: false, items: [], sources: [source as never], warnings: [], replaced: [],
    ticked: new Set<string>(), onToggle: () => {}, duplicates: [], overrideReason: "", setOverrideReason: () => {}, needsVerifiedConfirm: false, confirmVerified: false,
    setConfirmVerified: () => {}, busy: false, err: null, onSave: () => {}, onBack: () => {} }));
  const panel = html.slice(html.indexOf("data-held-review"), html.indexOf("</section>", html.indexOf("data-held-review")));
  assert.match(panel, /Held vacancy figures — not offered/);
  assert.match(panel, /Vacancy table.*pasted text — research, prepared by AI\/person.*Held because its columns need choosing: “FF”.*Columns as taken: Post → Post; UR → category UR; FF → category FF; Total → total/s);
  assert.match(panel, /\| Clerk \| 10 \| 1 \| 11 \|/);
  assert.ok(!/type="checkbox"/.test(panel), "nothing to tick: held figures are not saved from the review");
});
