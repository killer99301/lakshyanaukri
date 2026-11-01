// The whole-table check's own rules (Stage C, C1), by code: one decision for
// the whole table, naming every page it comes from. No database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/table-check.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { tableCheckScope, tablePages } from "@/lib/cms/importer/table-check";
import type { VacancyTable } from "@/lib/vacancy-table";

const row = (id: string, page: number | null) => ({ id, at: { post: "Officer", bank: id }, status: "STATED" as const, total: 1, cells: {}, source: { retrievalId: null, page, line: `${id} 1` } });
const TABLE: VacancyTable = {
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }], categories: [],
  rows: [row("a", 47), row("b", 48), row("c", null)],
  statedTotals: [{ at: {}, total: 3, source: { retrievalId: null, page: 49, line: "Total 3" } }],
};
const ok = (pages: unknown, extra: Partial<Parameters<typeof tableCheckScope>[0]> = {}) =>
  tableCheckScope({ kind: "ADMIN_VERIFIED", table: TABLE, quote: "Name of the Bank", page: 47, reviewScope: { pages }, ...extra });
const error = (r: ReturnType<typeof tableCheckScope>) => ("error" in r ? r.error : null);

suite("The whole-table check: one decision, every page the table comes from");

test("TC01 the table's pages are its rows' and printed totals' pages, once each, in order; a row with no page adds none", () => {
  assert.deepEqual(tablePages(TABLE), [47, 48, 49]);
});
test("TC02 every page named: accepted, stored sorted, once each, as covering the whole table", () => {
  assert.deepEqual(ok([49, 47, 48, 47]), { scope: { pages: [47, 48, 49], sections: ["the whole vacancy table"] } });
});
test("TC03 a page compared beyond the table's own is allowed (a person may compare more)", () => {
  assert.deepEqual("scope" in ok([46, 47, 48, 49]) && ok([46, 47, 48, 49]), { scope: { pages: [46, 47, 48, 49], sections: ["the whole vacancy table"] } });
});
test("TC04 a page of the table left out: refused, naming it", () => {
  assert.equal(error(ok([47, 49])), "The table comes from page 48 too: compare it as well, or the check does not cover the whole table");
  assert.equal(error(ok([47])), "The table comes from pages 48, 49 too: compare them as well, or the check does not cover the whole table");
});
test("TC05 no pages, or pages that are not page numbers: refused", () => {
  assert.equal(error(ok(undefined)), "Name the pages of the notice you compared the table with");
  assert.equal(error(ok([])), "Name the pages of the notice you compared the table with");
  assert.equal(error(ok([47, 48, "49"])), "Each page compared must be a page number");
  assert.equal(error(ok([47, 48, 0])), "Each page compared must be a page number");
});
test("TC06 \"not applicable\" and \"not stated\" are not recorded on a table", () => {
  for (const kind of ["ADMIN_NOT_APPLICABLE", "ADMIN_NOT_STATED"] as const) assert.match(error(ok([47, 48, 49], { kind })) ?? "", /checked against the notice as a whole/);
});
test("TC07 the words cited are required, and must be on a page compared", () => {
  assert.equal(error(ok([47, 48, 49], { quote: null })), "Copy the table's heading, or a line of it, exactly as printed");
  assert.equal(error(ok([47, 48, 49], { page: 12 })), "The words cited must be on one of the pages compared");
  assert.ok("scope" in ok([47, 48, 49], { page: null }), "no page given for the words: accepted, the pages compared stand");
});
test("TC08 no table, or a table with no rows: refused", () => {
  assert.equal(error(ok([47], { table: null })), "There is no vacancy table to check");
  assert.equal(error(ok([47], { table: { ...TABLE, rows: [] } })), "There is no vacancy table to check");
});
