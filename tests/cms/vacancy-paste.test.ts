// Pasting a vacancy table (stage A2): text from Excel / Google Sheets (tabs),
// a web page (tabs or pipes), a CSV, and a PDF viewer (words then figures),
// the suggested column roles, the rows built, and the merge with a saved
// table that never replaces a row unasked. The PDF lines are the real ones
// from IBPS CRP RRBs-XV page 47 and LIC HFL Table E.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/vacancy-paste.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { buildRows, mergePasted, readPasted, suggestColumns, type ColumnRole } from "@/lib/vacancy-paste";
import { analyseVacancyTable } from "@/lib/vacancy-table";
import { IBPS_OFFICER_I_ROWS, LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

const roleNames = (roles: ColumnRole[]) => roles.map((r) => r.role === "dimension" || r.role === "category" ? `${r.role}:${r.key}` : r.role);

suite("Reading pasted text");
test("VP01 Excel / Google Sheets (tabs), BTSC-style: headings found, columns suggested", () => {
  const text = "Post\tUR\tEWS\tSC\tST\tEBC\tBC\tBC Women\tTotal\nFood Safety Officer\t41\t11\t17\t2\t18\t12\t4\t105\n";
  const g = readPasted(text);
  assert.equal(g.format, "tabs");
  assert.equal(g.headerLines, 1);
  assert.deepEqual(roleNames(suggestColumns(g)), ["dimension:post", "category:ur", "category:ews", "category:sc", "category:st", "category:ebc", "category:bc", "category:bc women", "total"]);
  const roles = suggestColumns(g);
  const kinds = roles.filter((r): r is Extract<ColumnRole, { role: "category" }> => r.role === "category").map((r) => `${r.key}:${r.kind}`);
  assert.deepEqual(kinds, ["ur:VERTICAL", "ews:VERTICAL", "sc:VERTICAL", "st:VERTICAL", "ebc:UNDETERMINED", "bc:UNDETERMINED", "bc women:UNDETERMINED"], "only the standard reservations are assumed vertical");
  const b = buildRows(g, roles, { idPrefix: "p", page: 3 });
  assert.deepEqual(b.errors, []);
  const a = analyseVacancyTable({ dimensions: b.dimensions, categories: b.categories, rows: b.rows, statedTotals: [] });
  assert.equal(a.groups[0].total!.value, 105);
  assert.ok(a.categories.filter((c) => ["ebc", "bc", "bc women"].includes(c.key)).every((c) => c.kind === "VERTICAL"), "the printed total settles them");
});
test("VP02 a sheet of state, city and one figure column (LIC Table E): the figure column is the total", () => {
  const text = ["State\tCity\tNumber of Vacancies", ...LIC_TABLE_E_ROWS.slice(0, 12).map((r) => `${r.state}\t${r.city}\t${r.n ?? ""}`)].join("\n");
  const g = readPasted(text);
  const roles = suggestColumns(g);
  assert.deepEqual(roleNames(roles), ["dimension:state", "dimension:city", "total"]);
  const b = buildRows(g, roles, { idPrefix: "lic", constants: [{ key: "post", label: "Post", value: "Apprentice" }], page: 6 });
  assert.equal(b.rows.length, 12);
  assert.deepEqual(b.dimensions.map((d) => d.key), ["post", "state", "city"]);
  const ananthapur = b.rows.find((r) => r.at.city === "Ananthapur")!;
  assert.equal(ananthapur.status, "NO_FIGURE", "a blank stays a blank");
  assert.equal(ananthapur.source.page, 6);
});
test("VP03 NR, blanks, dashes, zeros and Indian thousands separators", () => {
  const text = "Bank\tSC\tST\tTotal\nA Bank\tNR\tNR\tNR\nB Bank\t-\t–\t\nC Bank\t0\t0\t0\nD Bank\t1,200\t300\t1,500\nE Bank\t12a\t3\t15";
  const g = readPasted(text);
  const b = buildRows(g, suggestColumns(g), { idPrefix: "x", constants: [{ key: "post", label: "Post", value: "Clerk" }] });
  assert.deepEqual(b.rows.map((r) => r.status), ["NOT_REPORTED", "NO_FIGURE", "NIL", "STATED"]);
  assert.equal(b.rows[3].total, 1500);
  assert.equal(b.rows[3].cells.sc, 1200);
  assert.deepEqual(b.errors, ['Line 6, SC: "12a" is not a whole number.'], "never read as 12");
});
test("VP04 pipes (a web page or markdown) and CSV with quoted figures", () => {
  const pipes = readPasted("| Post | SC | Total |\n|---|---|---|\n| Clerk | 5 | 20 |".replace("|---|---|---|\n", ""));
  assert.equal(pipes.format, "pipes");
  assert.deepEqual(roleNames(suggestColumns(pipes)), ["dimension:post", "category:sc", "total"]);
  const csv = readPasted('Post,SC,Total\nClerk,"1,000","4,000"\nPeon,2,9');
  assert.equal(csv.format, "commas");
  const b = buildRows(csv, suggestColumns(csv), { idPrefix: "c" });
  assert.equal(b.rows[0].total, 4000);
});

suite("A PDF copy: IBPS CRP RRBs-XV, page 47");
const IBPS_ROLES: ColumnRole[] = [
  { role: "serial" }, { role: "dimension", key: "bank", label: "State and bank" },
  { role: "category", key: "sc", label: "SC", kind: "VERTICAL" }, { role: "category", key: "st", label: "ST", kind: "VERTICAL" },
  { role: "category", key: "obc", label: "OBC (NCL)", kind: "VERTICAL" }, { role: "category", key: "ews", label: "EWS", kind: "VERTICAL" },
  { role: "category", key: "ur", label: "General", kind: "VERTICAL" }, { role: "total" },
  ...(["hi", "oc", "vi", "id"].map((k) => ({ role: "category", key: `pwbd_${k}`, label: `PwBD ${k.toUpperCase()}`, kind: "HORIZONTAL", partOf: "pwbd", note: "PwBD (Out of Which), page 47" }) as ColumnRole)),
];
test("VP05 28 printed lines, Tripura NR: every bank becomes a row with its line and page", () => {
  const g = readPasted(IBPS_OFFICER_I_ROWS.map((r) => r.line).join("\n"));
  assert.equal(g.format, "pdf");
  assert.equal(g.headerLines, 0);
  assert.ok(g.lines.every((l) => l.length === 12), "serial, words, ten figures on every line");
  const b = buildRows(g, IBPS_ROLES, { idPrefix: "o1-", constants: [{ key: "post", label: "Post", value: "Officer Scale I" }], page: 47 });
  assert.deepEqual(b.errors, []);
  assert.equal(b.rows.length, 28);
  assert.equal(b.rows.find((r) => /TRIPURA/.test(r.at.bank))!.status, "NOT_REPORTED");
  const a = analyseVacancyTable({ dimensions: b.dimensions, categories: b.categories, rows: b.rows, statedTotals: [] });
  const printed = IBPS_OFFICER_I_ROWS.filter((r) => r.figures[5] !== "NR").reduce((s, r) => s + Number(r.figures[5]), 0);
  assert.equal(a.groups[0].total!.value, printed);
  assert.equal(a.groups[0].total!.complete, false);
  assert.deepEqual(a.issues.map((i) => i.code), ["NOT_REPORTED"], "every pasted bank adds up");
  assert.ok(b.rows.every((r) => r.source.page === 47 && r.source.line.length > 10));
});
test("VP06 a long bank name wrapped onto its own line is joined to the row above, and said so", () => {
  const g = readPasted("9 JAMMU AND KASHMIR GRAMEEN 2 3 11 6 10 32 1 1 0 0\nBANK\n10 JHARKHAND GRAMIN BANK 12 5 21 7 35 80 1 1 1 0");
  const b = buildRows(g, IBPS_ROLES, { idPrefix: "w", constants: [{ key: "post", label: "Post", value: "Officer Scale I" }] });
  assert.equal(b.rows.length, 2);
  assert.equal(b.rows[0].at.bank, "JAMMU AND KASHMIR GRAMEEN BANK");
  assert.match(b.notes[0], /Line 2 has words but no figures: joined to the row above/);
});
test("VP07 no column naming the post and no fixed value → refused with a reason", () => {
  const g = readPasted("5\t20\n6\t30");
  const b = buildRows(g, [{ role: "category", key: "sc", label: "SC", kind: "VERTICAL" }, { role: "total" }], { idPrefix: "z" });
  assert.match(b.errors[0], /names the post/);
  assert.equal(b.rows.length, 0);
});

suite("Merging with the saved table");
test("VP08 new rows are added, same rows kept, different rows listed and replaced only when asked", () => {
  const g = readPasted("Post\tSC\tTotal\nClerk\t5\t20\nPeon\t1\t4");
  const first = buildRows(g, suggestColumns(g), { idPrefix: "a" });
  const saved = mergePasted(null, first, false).table;
  const again = buildRows(readPasted("Post\tSC\tTotal\nClerk\t5\t20\nPeon\t2\t5\nDriver\t0\t3"), suggestColumns(g), { idPrefix: "b" });
  const plan = mergePasted(saved, again, false);
  assert.deepEqual(plan.added.map((r) => r.at.post), ["Driver"]);
  assert.deepEqual(plan.same.map((r) => r.at.post), ["Clerk"]);
  assert.deepEqual(plan.differ.map((d) => [d.before.total, d.after.total]), [[4, 5]]);
  assert.equal(plan.table.rows.find((r) => r.at.post === "Peon")!.total, 4, "not replaced without asking");
  const replaced = mergePasted(saved, again, true);
  assert.equal(replaced.table.rows.find((r) => r.at.post === "Peon")!.total, 5);
  assert.equal(replaced.table.rows.find((r) => r.at.post === "Peon")!.id, saved.rows.find((r) => r.at.post === "Peon")!.id, "keeps the row's id");
});
test("VP09 rows split by different dimensions are not mixed into the table", () => {
  const saved = mergePasted(null, buildRows(readPasted("Post\tTotal\nClerk\t20"), [{ role: "dimension", key: "post", label: "Post" }, { role: "total" }], { idPrefix: "a" }), false).table;
  const other = buildRows(readPasted("Bank\tTotal\nA\t2"), [{ role: "dimension", key: "bank", label: "Bank" }, { role: "total" }], { idPrefix: "b" });
  const plan = mergePasted(saved, other, false);
  assert.match(plan.problems[0], /split by Post; the pasted rows by Bank/);
  assert.equal(plan.table, saved);
});
