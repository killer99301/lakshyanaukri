// Bringing a document's vacancy table into the job's own: a table split
// differently from the job's changes nothing and is held; a table not read in
// full (updateOnly) removes nothing; one read in full still removes what it no
// longer lists. Pure: mergeTables and the import review rendered; no database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/split-removal-merge.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { mergeTables } from "@/lib/cms/importer/vacancy-tables";
import { VacancyTableReview } from "@/app/admin/cms/import/VacancyTableReview";
import type { VacancyTable, VacancyTableRow } from "@/lib/vacancy-table";

const row = (at: Record<string, string>, total: number): VacancyTableRow =>
  ({ id: Object.values(at).join("-"), at, status: "STATED", total, cells: { ur: total }, source: { retrievalId: "d", page: 2, line: `${Object.values(at).join(" ")} ${total}` } });
const BANK = [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }];
const POST = [{ key: "post", label: "Post" }];
const table = (dimensions: VacancyTable["dimensions"], rows: VacancyTableRow[]): VacancyTable => ({ dimensions, categories: [{ key: "ur", label: "UR", kind: "VERTICAL" }], rows, statedTotals: [] });
const bankWise = table(BANK, [row({ post: "Clerk", bank: "A Bank" }, 5), row({ post: "Clerk", bank: "B Bank" }, 6), row({ post: "PO", bank: "A Bank" }, 2)]);

suite("A table split differently from the job's");

test("U5 a post-wise table onto a bank-wise job: nothing removed, the job's table as it is, the document's row held, the split named", () => {
  const m = mergeTables(bankWise, table(POST, [row({ post: "Clerk" }, 11)]), false);
  assert.deepEqual([m.diff.removed.length, m.diff.added.length, m.diff.changed.length, m.diff.held.length], [0, 0, 0, 1]);
  assert.equal(m.table, bankWise, "the job's table, unchanged");
  assert.match(m.problems[0], /split by Post › Bank; this document by Post\. The job's rows are kept as they are; this document's row is not brought in — check it by hand/);
});
test("U5b every post of the job named, and a post new to the job: still nothing removed or added, all held", () => {
  const m = mergeTables(bankWise, table(POST, [row({ post: "Clerk" }, 11), row({ post: "PO" }, 2), row({ post: "Officer" }, 4)]), false);
  assert.deepEqual([m.diff.removed.length, m.diff.added.length, m.diff.held.map((r) => r.at.post)], [0, 0, ["Clerk", "PO", "Officer"]]);
  assert.match(m.problems[0], /3 rows are not brought in — check them by hand/);
});
test("U5c a finer table onto a coarser job (bank-wise onto post-wise): the job's rows kept, the document's held", () => {
  const job = table(POST, [row({ post: "Clerk" }, 11)]);
  const m = mergeTables(job, bankWise, false);
  assert.equal(m.table, job);
  assert.deepEqual([m.diff.removed.length, m.diff.held.length], [0, 3]);
});

suite("The same split: removals only from a table read in full");

test("U6 a row left out by a table not read in full (updateOnly) is kept, and the change it gives is still offered", () => {
  const m = mergeTables(bankWise, table(BANK, [row({ post: "Clerk", bank: "A Bank" }, 7)]), true);
  assert.deepEqual([m.diff.changed.length, m.diff.removed.length, m.diff.held.length], [1, 0, 0]);
  assert.ok(m.table.rows.some((r) => r.at.bank === "B Bank"), "B Bank kept");
});
test("L1 a table read in full still removes the row it no longer lists, and adds a new one", () => {
  const m = mergeTables(bankWise, table(BANK, [row({ post: "Clerk", bank: "A Bank" }, 5), row({ post: "Clerk", bank: "C Bank" }, 1)]), false);
  assert.deepEqual([m.diff.removed.map((r) => r.at.bank), m.diff.added.map((r) => r.at.bank), m.diff.untouchedPosts, m.diff.held.length], [["B Bank"], ["C Bank"], ["PO"], 0]);
});

suite("The import review says why rows are kept");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const review = (from: "split" | "tables") => text(renderToStaticMarkup(<VacancyTableReview table={bankWise} note={{ from, removalsHeld: 1,
  diff: { added: 0, changed: 1, removed: 0, same: 1, untouchedPosts: [], addedRows: [], changedRows: [], removedRows: [] } }} />));

test("W1 from the AI's split: kept because the figures are the AI's reading, not a table read in full", () => {
  assert.match(review("split"), /1 row the document does not list are kept, because its figures come from the AI's reading of the categories, not from a table read in full/);
});
test("W2 from a table with lines not read: the words as before", () => {
  assert.match(review("tables"), /kept, because some of its table lines could not be read/);
});
