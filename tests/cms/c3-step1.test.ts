// Stage C, C3 step 1, by code: the read-only view of a table total's route
// (tableTotalView), the rows worth a look (rowAttention), and a file's
// fingerprint worked out locally (file-fingerprint). Nothing here decides,
// verifies or blocks anything. No database, no AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/c3-step1.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { tableTotalView } from "@/lib/cms/importer/table-check";
import { rowAttention } from "@/lib/cms/importer/row-attention";
import { readVacancyTables } from "@/lib/cms/importer/vacancy-tables";
import { compareWithImported, fingerprintMessage, sha256Hex } from "@/lib/file-fingerprint";
import { analyseVacancyTable, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";
import { bpscTable } from "../fixtures/paste/bpsc-72";

const row = (id: string, bank: string, line: string, total: number | null, extra: Partial<VacancyTableRow> = {}): VacancyTableRow => ({
  id, at: { post: "Officer", bank }, status: total === null ? "NOT_REPORTED" : "STATED", ...(total === null ? {} : { total }), cells: {},
  source: { retrievalId: null, page: 1, line }, ...extra,
});
const table = (rows: VacancyTableRow[], printed: Array<{ total: number; line: string; page: number }> = [], categories: VacancyTable["categories"] = []): VacancyTable => ({
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories, rows,
  statedTotals: printed.map((p) => ({ at: {}, total: p.total, source: { retrievalId: null, page: p.page, line: p.line } })),
});
const derivedOf = (t: VacancyTable) => { const g = analyseVacancyTable(t).grandTotal!; return { basis: g.basis, complete: g.complete }; };
const THREE = [row("a", "Alpha Gramin Bank", "1 Alpha Gramin Bank 10", 10), row("b", "Beta Gramin Bank", "2 Beta Gramin Bank 12", 12), { ...row("c", "Gamma Gramin Bank", "3 Gamma Gramin Bank 8", 8), source: { retrievalId: null, page: 2, line: "3 Gamma Gramin Bank 8" } }];
const CATS: VacancyTable["categories"] = ["SC", "ST", "OBC", "EWS", "UR"].map((l) => ({ key: l.toLowerCase(), label: l, kind: "VERTICAL" as const }));
const rules = (t: VacancyTable, id: string) => (rowAttention(t).find((a) => a.rowId === id)?.worthALook ?? []).map((w) => w.rule);

suite("C3 step 1: the read-only view of how a table total is checked");

test("S101 a printed total read by code from text: its printed line and page, no reasons, the table's pages", () => {
  const t = table(THREE, [{ total: 30, line: "Total 30", page: 2 }]);
  assert.deepEqual(tableTotalView(t, derivedOf(t), 30), { incomplete: false, route: "PRINTED_LINE", evidence: { line: "Total 30", page: 2 }, why: [], pages: [1, 2] });
});
test("S102 calculated, incomplete, AI-read and prepared: the whole-table check, each with the server's own reason", () => {
  const calc = table(THREE);
  assert.deepEqual(tableTotalView(calc, derivedOf(calc), 30), { incomplete: false, route: "TABLE_CHECK", evidence: null, why: ["the total is calculated from the rows"], pages: [1, 2] });
  const inc = table([THREE[0], THREE[1], row("d", "Delta Gramin Bank", "4 Delta Gramin Bank NR", null)]);
  const vInc = tableTotalView(inc, derivedOf(inc), 22);
  assert.deepEqual([vInc.route, vInc.incomplete, vInc.why[0]], ["TABLE_CHECK", true, "the total is incomplete"]);
  for (const readBy of ["AI_IMAGE", "PREPARED"] as const) {
    const t = table(THREE.map((r) => ({ ...r, source: { ...r.source, readBy } })), [{ total: 30, line: "Total 30", page: 2 }]);
    const v = tableTotalView(t, derivedOf(t), 30);
    assert.deepEqual([v.route, v.evidence], ["TABLE_CHECK", null], readBy);
    assert.match(v.why.join(), readBy === "AI_IMAGE" ? /read by AI from a page image/ : /prepared outside the notice/);
  }
});
test("S103 the view is exactly totalRoute plus tablePages: it adds no rule of its own", () => {
  const t = table(THREE, [{ total: 30, line: "Total 30", page: 2 }, { total: 30, line: "Grand Total 30", page: 2 }]);
  const v = tableTotalView(t, { basis: "STATED", complete: true }, 30);
  assert.deepEqual([v.route, v.why], ["TABLE_CHECK", ["the table holds more than one printed total for the whole table"]]);
});

suite("C3 step 1: rows worth a look (display only, conservative)");

const WRONG = "Annexure I (continued) Sr. No. Name of the Bank SC ST OBC EWS UR Total 3 Gamma Gramin Bank";
test("S111 the B2.5 wrong label: marked by both label rules, each saying what it found, worded “may”", () => {
  const t = table([THREE[0], THREE[1], { ...THREE[2], at: { post: "Officer", bank: WRONG } }], [], CATS);
  const a = rowAttention(t).find((x) => x.rowId === "c")!;
  assert.deepEqual(a.worthALook.map((w) => w.rule), ["LABEL_NOT_IN_LINE", "LABEL_HAS_COLUMN_HEADING"]);
  assert.match(a.worthALook[0].message, /^The label may not match its line: “Annexure I \(continued\).*” is not in “3 Gamma Gramin Bank 8”\.$/);
  assert.equal(a.worthALook[1].message, "The label may include the table's column heading: Sr. No., SC, ST, OBC, EWS, UR, Total.");
  assert.ok(a.worthALook.every((w) => !/\b(wrong|error|invalid|incorrect)\b/i.test(w.message)), "never called wrong");
});
test("S112 the same table as read correctly: no row is marked", () => {
  assert.deepEqual(rowAttention(table(THREE, [], CATS)), []);
});
test("S113 no false marks: a legitimate “Annexure” name, a long name, “continued” alone, two category words in a post name", () => {
  const t = table([
    row("a", "Annexure Gramin Bank", "1 Annexure Gramin Bank 10", 10),
    row("b", "Maharashtra Gramin Bank Limited, Regional Office for the Districts of Aurangabad and Jalna", "2 Maharashtra Gramin Bank Limited, Regional Office for the Districts of Aurangabad and Jalna 12", 12),
    row("c", "Gamma Gramin Bank (continued from 2025)", "3 Gamma Gramin Bank (continued from 2025) 8", 8),
    row("d", "SC/ST Cell Gramin Bank", "4 SC/ST Cell Gramin Bank 5", 5),
  ], [], CATS);
  assert.deepEqual(rowAttention(t), []);
});
test("S114 a label not in its own line, alone: only that rule; a wrapped line still counts as containing its label", () => {
  const t = table([row("a", "Alpha Gramin Bank", "1 Alfa Gramin Bank 10", 10), row("b", "Beta Gramin Bank", "2 Beta Gramin\nBank 12", 12)], [], CATS);
  assert.deepEqual(rules(t, "a"), ["LABEL_NOT_IN_LINE"]);
  assert.deepEqual(rules(t, "b"), []);
});
test("S115 the serial-number heading and one other heading word are enough; three category words alone are too", () => {
  const t = table([row("a", "Sr. No. Alpha Gramin Bank", "Sr. No. Alpha Gramin Bank 10", 10), row("b", "SC ST OBC Beta Bank", "SC ST OBC Beta Bank 12", 12), row("c", "Sr. No. Gamma Bank", "Sr. No. Gamma Bank 8", 8)], [], CATS);
  assert.deepEqual(rules(t, "b"), ["LABEL_HAS_COLUMN_HEADING"]);
  assert.deepEqual(rules(t, "c"), [], "the serial heading with no other heading word is not marked");
  assert.deepEqual(rules(t, "a"), []);
});
test("S116 a page marker inside a row's line: marked; no marker: not (page breaks are not otherwise recorded)", () => {
  const t = table([row("a", "Alpha Gramin Bank", "1 Alpha Gramin\n-- 1 of 2 --\nBank 10", 10), row("b", "Beta Gramin Bank", "2 Beta Gramin Bank 12", 12),
    row("c", "Gamma Bank", "3 Delta Bank\nPage 4 of 9\n8", 8)]);
  assert.deepEqual(rules(t, "a"), ["LINE_HAS_PAGE_BREAK"], "a label split by the marker is said once, by the marker's rule");
  assert.deepEqual(rules(t, "b"), []);
  assert.deepEqual(rules(t, "c"), ["LABEL_NOT_IN_LINE", "LINE_HAS_PAGE_BREAK"], "a wrong label and a marker: both said");
});
test("S117 a value the same on every row (a post the reader added) is not taken as the row's label", () => {
  const t: VacancyTable = { ...table(THREE), rows: THREE.map((r) => ({ ...r, at: { post: "TEST RECORD added by the reader", bank: r.at.bank } })) };
  assert.deepEqual(rowAttention(t), []);
});
test("S118 code-found problems are kept apart from “worth a look”, as the analysis states them", () => {
  const t = table([row("a", "Alpha Gramin Bank", "1 Alpha Gramin Bank 10", 11), row("b", "Beta Gramin Bank", "2 Beta Gramin Bank 12", 12)]);
  const a = rowAttention(t).find((x) => x.rowId === "a")!;
  assert.deepEqual(a.worthALook, []);
  assert.ok(a.problems.some((p) => p.code === "FIGURES_NOT_IN_LINE"), JSON.stringify(a.problems));
});
test("S119 it never changes the table", () => {
  const t = table([THREE[0], THREE[1], { ...THREE[2], at: { post: "Officer", bank: WRONG } }], [], CATS);
  const before = JSON.stringify(t);
  rowAttention(t);
  assert.equal(JSON.stringify(t), before);
});

suite("C3 step 1: no marks on the real notices' tables as read");

const read = async (file: string) => (await readVacancyTables(readFileSync(file, "utf8"), { retrievalId: "d", fallbackPost: "Post", apiKey: undefined })).table!;
const worth = (t: VacancyTable) => rowAttention(t).filter((a) => a.worthALook.length > 0);
test("S121 IBPS CRP RRBs-XV, 280 rows (pages 45-56): none worth a look", async () => {
  const t = await read("tests/fixtures/notice-text/ibps-crp-rrb-xv-pages-45-56.txt");
  assert.equal(t.rows.length, 280);
  assert.deepEqual(worth(t).map((a) => [a.label, a.worthALook.map((w) => w.message)]), []);
});
test("S122 LIC HFL Table E, 181 rows (pages 5-9): none worth a look", async () => {
  const t = await read("tests/fixtures/notice-text/lic-hfl-batch10-pages-5-9.txt");
  assert.equal(t.rows.length, 181);
  assert.deepEqual(worth(t).map((a) => [a.label, a.worthALook.map((w) => w.message)]), []);
});
test("S123 BPSC 72nd, 25 rows prepared outside: none worth a look", () => {
  const t = bpscTable({ prepared: true });
  assert.equal(t.rows.length, 25);
  assert.deepEqual(worth(t).map((a) => [a.label, a.worthALook.map((w) => w.message)]), []);
});
test("S124 LIC scan, the AI's 181 rows from B2.6 round 2: none worth a look", () => {
  const saved = JSON.parse(readFileSync("docs/acceptance-runs/round2-2026-10-31/scans/lic-scan.json", "utf8"));
  const t = saved.proposal.items.find((i: { fieldPath: string }) => i.fieldPath === "vacancies.table").value as VacancyTable;
  assert.equal(t.rows.length, 181);
  assert.deepEqual(worth(t).map((a) => [a.label, a.worthALook.map((w) => w.message)]), []);
});

suite("C3 step 1: a file's fingerprint, worked out locally");

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
test("S131 SHA-256 of a known input, from bytes and from a Blob", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), ABC);
  assert.equal(await sha256Hex(new Blob(["abc"])), ABC);
});
test("S132 the same bytes: SAME_BYTES, whatever the case of the stored fingerprint", async () => {
  assert.deepEqual(await compareWithImported(new Blob(["abc"]), ABC), { status: "SAME_BYTES", actual: ABC });
  assert.equal((await compareWithImported(new Blob(["abc"]), ABC.toUpperCase())).status, "SAME_BYTES");
});
test("S133 a different file: DIFFERENT, with its own fingerprint", async () => {
  const r = await compareWithImported(new Blob(["abd"]), ABC);
  assert.equal(r.status, "DIFFERENT");
  assert.ok(r.status === "DIFFERENT" && r.actual !== ABC && /^[0-9a-f]{64}$/.test(r.actual));
});
test("S134 no fingerprint, or one that is not a SHA-256: NO_FINGERPRINT, and the file is not even read", async () => {
  let read = 0;
  const spy = { arrayBuffer: async () => { read++; return new ArrayBuffer(0); } } as unknown as Blob;
  for (const bad of [null, undefined, "", "abc", ABC.slice(1), `${ABC}0`, "z".repeat(64)]) assert.deepEqual(await compareWithImported(spy, bad), { status: "NO_FINGERPRINT" }, String(bad));
  assert.equal(read, 0);
});
test("S135 no Web Crypto (an old browser): UNAVAILABLE, said, never a match", async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    const r = await compareWithImported(new Blob(["abc"]), ABC);
    assert.equal(r.status, "UNAVAILABLE");
    assert.match(fingerprintMessage(r), /could not be checked here/);
  } finally { Object.defineProperty(globalThis, "crypto", desc); }
  assert.equal(await sha256Hex(new Blob(["abc"])), ABC, "restored");
});
test("S136 a match is worded as the same bytes, never as official or verified (owner's C3-D5 clarification)", async () => {
  const m = fingerprintMessage({ status: "SAME_BYTES", actual: ABC });
  assert.match(m, /same file that was imported: the same bytes/);
  assert.match(m, /does not show that the file is official, or that its contents are correct/);
  assert.ok(!/\bverified\b/i.test(m));
});
