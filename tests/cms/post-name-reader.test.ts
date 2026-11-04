// Post names in vacancy tables read by code: each row of a post-wise table
// keeps its own post (before, the post column was always dropped and every
// row took the table's title or the job's title, so three posts became one
// and the total counted one row). Post-heading tables (bank-wise, state-wise)
// are read as before; a post that cannot be read holds the table, never the
// title instead. Pure: no database.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/post-name-reader.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { buildVacancyTable, namesPostColumn, readVacancyTables, splitPostState, type FoundTable } from "@/lib/cms/importer/vacancy-tables";
import { htmlToText } from "@/lib/cms/importer/extract";
import { analyseVacancyTable, type VacancyTable } from "@/lib/vacancy-table";

const FRONT = "Test Public Service Commission\nRecruitment of Engineers 2098\nLast date to apply online: 30.06.2098";
const page = (...p: string[]) => p.map((x, i) => `${x}\n\n-- ${i + 1} of ${p.length} --\n`).join("\n");
const AE = "Assistant Engineer 10 2 5 3 1 21", JE = "Junior Engineer 20 4 10 6 2 42", ST = "Stenographer 3 1 2 1 0 7";
const POSTS = ["Assistant Engineer", "Junior Engineer", "Stenographer"];
const read = (text: string) => readVacancyTables(text, { retrievalId: "src", fallbackPost: "FALLBACK POST", apiKey: undefined });
const names = (t: VacancyTable | null) => (t?.rows ?? []).map((r) => t!.dimensions.map((d) => r.at[d.key]).filter(Boolean).join(" › "));
const duplicates = (t: VacancyTable) => analyseVacancyTable(t).issues.filter((i) => i.code === "DUPLICATE_ROW").length;

suite("Post-wise tables: each row keeps its post");

for (const [name, text, expected] of [
  ["PN1 PDF lines under “Name of Post”, three posts", page(FRONT, `Details of vacancies\nName of Post UR EWS OBC SC ST Total\n${AE}\n${JE}\n${ST}`), POSTS],
  ["PN2 a short two-row table (O2)", page(FRONT, `Details of vacancies\nName of Post UR EWS OBC SC ST Total\n${AE}\n${JE}`), POSTS.slice(0, 2)],
  ["PN3 wide gaps", page(FRONT, "Details of vacancies\nName of Post          UR   EWS   OBC   SC   ST   Total\nAssistant Engineer    10     2     5    3    1      21\nJunior Engineer       20     4    10    6    2      42\nStenographer           3     1     2    1    0       7"), POSTS],
  ["PN4 a bare “Post” heading", page(FRONT, `Vacancies\nPost UR EWS OBC SC ST Total\n${AE}\n${JE}\n${ST}`), POSTS],
  ["PN5 “Designation”, with serial numbers", page(FRONT, `Vacancies\nSr. No. Designation UR EWS OBC SC ST Total\n1 ${AE}\n2 ${JE}\n3 ${ST}`), POSTS],
] as Array<[string, string, string[]]>) {
  test(`${name}: the posts as printed, their figures and total, no duplicate rows`, async () => {
    const { table } = await read(text);
    assert.deepEqual(names(table), expected);
    assert.equal(duplicates(table!), 0);
    assert.deepEqual(table!.rows.map((r) => r.total), [21, 42, 7].slice(0, expected.length));
    assert.deepEqual(table!.rows[0].cells, { ur: 10, ews: 2, obc: 5, sc: 3, st: 1 });
  });
}
test("PN6 a web page's HTML table", async () => {
  const html = `<html><body><p>${FRONT}</p><h2>Vacancies</h2><table><tr><th>Name of Post</th><th>UR</th><th>SC</th><th>ST</th><th>Total</th></tr><tr><td>Lower Division Clerk</td><td>20</td><td>6</td><td>4</td><td>30</td></tr><tr><td>Typist</td><td>5</td><td>2</td><td>1</td><td>8</td></tr><tr><td>Driver</td><td>2</td><td>1</td><td>0</td><td>3</td></tr></table></body></html>`;
  const { table } = await read(htmlToText(html));
  assert.deepEqual(names(table), ["Lower Division Clerk", "Typist", "Driver"]);
});
test("PN7 post and state in each row: told apart when the state is recognised", async () => {
  const { table } = await read(page(FRONT, "Vacancies\nName of Post State UR SC ST Total\nClerk Bihar 10 3 1 14\nClerk Assam 4 1 1 6\nTypist Bihar 2 1 0 3"));
  assert.deepEqual(names(table), ["Clerk › Bihar", "Clerk › Assam", "Typist › Bihar"]);
  assert.deepEqual([splitPostState("Clerk Tamil Nadu", true), splitPostState("Bihar Clerk", false), splitPostState("Bihar", true)],
    [{ post: "Clerk", state: "Tamil Nadu" }, { post: "Clerk", state: "Bihar" }, null]);
});
test("PN8 the total of three posts is 70, not one row's 21", async () => {
  const { table } = await read(page(FRONT, `Details of vacancies\nName of Post UR EWS OBC SC ST Total\n${AE}\n${JE}\n${ST}`));
  const total = analyseVacancyTable(table!).grandTotal!;
  assert.deepEqual([total.value, total.complete], [70, true]);
});

suite("Tables read as before, and what is held");

test("PH1 bank-wise and state-wise tables under a post heading, and two posts' bank tables: as before", async () => {
  const bank = (await read(page(FRONT, "OFFICE ASSISTANTS\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n1 Delta Gramin Bank 2 1 3 1 4 11\n2 Epsilon Gramin Bank 1 1 2 1 3 8\n3 Theta Gramin Bank 1 0 2 1 2 6"))).table;
  assert.deepEqual(names(bank), ["Office Assistants › Delta Gramin Bank", "Office Assistants › Epsilon Gramin Bank", "Office Assistants › Theta Gramin Bank"]);
  const state = (await read(page(FRONT, "CLERK\nSr. No. State UR SC ST OBC EWS Total\n1 Bihar 10 3 1 5 2 21\n2 Assam 4 1 1 2 1 9\n3 Kerala 6 2 0 3 1 12"))).table;
  assert.deepEqual(names(state), ["Clerk › Bihar", "Clerk › Assam", "Clerk › Kerala"]);
  const two = (await read(page(FRONT, "OFFICE ASSISTANTS\nSr. No. Name of the Bank SC ST OBC\nEWS UR Total\n1 Delta Gramin Bank 2 1 3 1 4 11\n2 Epsilon Gramin Bank 1 1 2 1 3 8",
    "OFFICER SCALE I\nSr. No. Name of the Bank SC ST OBC\nEWS UR Total\n1 Delta Gramin Bank 1 1 1 1 2 6\n2 Epsilon Gramin Bank 1 0 1 1 1 4"))).table;
  assert.deepEqual(names(two), ["Office Assistants › Delta Gramin Bank", "Office Assistants › Epsilon Gramin Bank", "Officer Scale I › Delta Gramin Bank", "Officer Scale I › Epsilon Gramin Bank"]);
});
test("PH2 “No. of Posts” is a count, never a column of names", () => {
  assert.deepEqual(["Name of Post UR SC Total", "Post Name UR SC", "Sr. No. Designation UR SC", "Cadre UR SC Total", "Post UR SC ST Total", "Sr. No. Post UR SC"].map(namesPostColumn), [true, true, true, true, true, true]);
  assert.deepEqual(["Sr. No. Name of the Bank No. of Posts", "Name of the Bank Number of Posts", "State Total Posts", "Category SC ST Posts", "Posts"].map(namesPostColumn), [false, false, false, false, false]);
  assert.equal(namesPostColumn("Name of Post No. of Posts"), true, "a name column beside a count column is still a name column");
});
test("PH3 a table whose rows name no post keeps its post from the title, or the fallback for “Table E”", async () => {
  const titled = (await read(page(FRONT, "OFFICE ASSISTANTS\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n1 Delta Gramin Bank 2 1 3 1 4 11\n2 Epsilon Gramin Bank 1 1 2 1 3 8\n3 Theta Gramin Bank 1 0 2 1 2 6"))).table;
  assert.ok(titled!.rows.every((r) => r.at.post === "Office Assistants"));
  const tableE = (await read(page(FRONT, "Table E:\nState City Number of\nVacancies\nAssam Guwahati 3\nBihar Patna 4\nKerala Kochi 5\nGrand Total 12"))).table;
  assert.ok(tableE!.rows.every((r) => r.at.post === "Fallback Post"), names(tableE).join(" | ")); // title-cased, as always
});
test("PH4 post and bank run together: the table is not read, said why, its rows listed as lines not read; no title put in", async () => {
  const r = await read(page(FRONT, "Vacancies\nName of Post Name of the Bank UR SC Total\nClerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3\nOfficer Delta Gramin Bank 1 1 2"));
  assert.equal(r.table, null);
  assert.equal(r.coverage.tables[0].read, false);
  assert.match(r.coverage.tables[0].why ?? "", /post and bank run together in one name .*cannot be told apart/);
  assert.ok(r.coverage.unreadLines.some((l) => l.text.startsWith("Clerk Delta Gramin Bank")), JSON.stringify(r.coverage.unreadLines));
});
test("PH5 post and a state that is not recognised: held, not guessed", async () => {
  const r = await read(page(FRONT, "Vacancies\nName of Post State UR SC ST Total\nClerk Bihar 10 3 1 14\nClerk Atlantis 4 1 1 6\nTypist Bihar 2 1 0 3"));
  assert.equal(r.table, null);
  assert.match(r.coverage.tables[0].why ?? "", /post and the state cannot be told apart in “Clerk Atlantis”/);
});
test("PH6 a transcribed (scanned) row keeps its own cells, post column or not", () => {
  const t: FoundTable = { title: "", heading: "Name of Post UR Total", headingPage: 1, pages: [1], figureCount: 2,
    columns: [{ role: "category", key: "ur", label: "UR" }, { role: "total", key: "total", label: "Total" }] as never,
    dimensions: [{ key: "post", label: "Post" }], totals: [], unread: [], readBy: "AI_IMAGE",
    rows: [{ serial: 1, words: "", figures: ["5", "5"], page: 1, printed: "1 | Clerk | 5 | 5", dimCells: { post: "Clerk" } },
           { serial: 2, words: "", figures: ["3", "3"], page: 1, printed: "2 | Typist | 3 | 3", dimCells: { post: "Typist" } }] };
  assert.deepEqual(names(buildVacancyTable([t], { retrievalId: "src", fallbackPost: "FALLBACK POST" }).table), ["Clerk", "Typist"]);
});
