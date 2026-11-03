// ═══════════════════════════════════════════════════════════
// O2: the vacancy-table reader through the real import, apply route and
// import transaction, on the in-memory test database. No AI, no network
// (the web page is a saved copy).
//
// New jobs: a two-row table under category fee lines, as pasted official
// text, an uploaded PDF and an official web page, is proposed with its pages
// and lines; a notice with only fee, age and marks tables proposes none and
// warns of nothing.
//
// A re-import into an existing job: when part of a post's table cannot be
// read, no row is offered for removal on its account, and the change and the
// new row the document does give still are. When the document was read in
// full, a row it no longer lists is offered for removal as before, a fee
// table beside it changing nothing.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/o2-table-reader.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable } from "@/lib/vacancy-table";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean };
type Note = { coverage: { tables: Array<{ title: string; pages: number[]; rows: number; read: boolean; why?: string }>; unreadLines: Array<{ page: number | null; text: string }> };
  removalsHeld?: number; diff?: { added: number; changed: number; removed: number; same: number; removedRows: Array<{ at: J }> } };

const FRONT = "Institute of Banking Personnel Selection\nCommon Recruitment Process O2 for Office Assistants\nAdvertisement No. CRP-O2/2091\nEducational Qualification: graduation in any stream\nLast date to apply online: 26.10.2091";
const FEE = "Application fee: General, EWS and OBC candidates Rs.850/-\nSC/ST/PwBD candidates Rs.175/-";
const TABLE = (rows: string[]) => `OFFICE ASSISTANTS\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n${rows.join("\n")}`;
const DELTA = "1 Delta Gramin Bank 2 1 3 1 4 11", EPSILON = "2 Epsilon Gramin Bank 1 1 2 1 3 8", THETA = "3 Theta Gramin Bank 1 0 2 1 2 6";
const page = (...pages: string[]) => pages.map((p, i) => `${p}\n\n-- ${i + 1} of ${pages.length} --\n`).join("\n");
const WEB_URL = "https://www.ibps.in/notices/o2-web.html";
const WEB = `<html><body><h1>Institute of Banking Personnel Selection</h1><p>Common Recruitment Process O2 web</p><p>Application fee: General, EWS and OBC candidates Rs.850/-</p><p>SC/ST/PwBD candidates Rs.175/-</p>
<h2>OFFICE ASSISTANTS</h2><table><tr><th>Sr. No.</th><th>Name of the Bank</th><th>SC</th><th>ST</th><th>OBC</th><th>EWS</th><th>UR</th><th>Total</th></tr>
<tr><td>1</td><td>Delta Gramin Bank</td><td>2</td><td>1</td><td>3</td><td>1</td><td>4</td><td>11</td></tr><tr><td>2</td><td>Epsilon Gramin Bank</td><td>1</td><td>1</td><td>2</td><td>1</td><td>3</td><td>8</td></tr></table></body></html>`;
const fetchSourceFn = async (url: string) => url === WEB_URL
  ? { ok: true as const, finalUrl: url, contentType: "text/html; charset=utf-8", bytes: Buffer.from(WEB, "utf8") }
  : { ok: false as const, error: "blocked (403)" };

const S = { N: "N: new jobs", R: "R: a re-import into an existing job" };
expectChecks(S.N, [
  "N1 pasted official text: the two-row table under category fee lines is proposed, rows with their page and line",
  "N1 no table is reported as not read",
  "N2 an uploaded official PDF: the same table, page 2, and saved as proposed",
  "N2 Total Vacancies worked out from the two rows: 19",
  "N3 an official web page: the same two rows, with no page",
  "N4 a notice with only fee, age and marks tables: no vacancy table proposed",
  "N4 …and no warning of a table not read",
]);
expectChecks(S.R, [
  "R1 the job's table: three banks of Office Assistants",
  "R2 the supplementary table that cannot be read is said: not read, why, its page",
  "R2 no row is offered for removal on its account; the hold is said",
  "R2 the change and the new row the document does give are still offered",
  "R2 applied: Delta changed, Kappa added, Theta kept",
  "R3 read in full (a fee table beside it): the bank it no longer lists is offered for removal, as before",
  "R3 …and the fee table raises no warning",
]);

(async () => {
  const { token, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const applyRoute = await import("@/app/api/admin/cms/import/[importId]/apply/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const preview = (args: J) => service.previewImport({ adminId, apiKey: undefined, fetchSourceFn, ...args } as never);
  const itemsOf = (p: { proposal: unknown }) => (p.proposal as { items: Item[] }).items;
  const tableItem = (p: { proposal: unknown }) => itemsOf(p).find((i) => i.fieldPath === "vacancies.table");
  const noteOf = (p: { proposal: unknown }) => (p.proposal as { meta: { sources: Array<{ vacancyTables: Note | null }> } }).meta.sources[0].vacancyTables;
  const warnings = (p: { proposal: unknown }) => (p.proposal as { warnings: string[] }).warnings;
  const apply = async (importId: string, selected: string[]) => {
    const r = await applyRoute.POST(req(`/api/admin/cms/import/${importId}/apply`, "POST", { selected }), { params: Promise.resolve({ importId }) });
    return { status: r.status, data: (await r.json()) as J };
  };
  const job = (year: number, title: string) => ({ organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title, govType: "PSU" });
  const banks = (t: VacancyTable | undefined) => (t?.rows ?? []).map((r) => `${r.at.bank}:${r.total}`);

  // ── N ──
  section(S.N);
  const twoRows = page(`${FRONT}\n${FEE}`, TABLE([DELTA, EPSILON]));
  const n1 = await preview({ mode: "NEW", newJob: job(2091, "TEST RECORD O2 pasted"), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: twoRows }] });
  const t1 = tableItem(n1)?.value as VacancyTable | undefined;
  check("N1 pasted official text: the two-row table under category fee lines is proposed, rows with their page and line",
    JSON.stringify(banks(t1)) === JSON.stringify(["Delta Gramin Bank:11", "Epsilon Gramin Bank:8"]) && t1!.rows.every((r) => r.source.page === 2 && /Gramin Bank/.test(r.source.line)), t1?.rows);
  check("N1 no table is reported as not read", (noteOf(n1)?.coverage.tables ?? []).every((t) => t.read) && !warnings(n1).some((w) => /was not read/.test(w)), noteOf(n1)?.coverage);

  const url = "https://www.ibps.in/wp-content/uploads/CRP-O2-2092.pdf";
  const pdf = makePdf([`${FRONT}\n${FEE}`, TABLE([DELTA, EPSILON])]);
  const n2 = await preview({ mode: "NEW", newJob: job(2092, "TEST RECORD O2 pdf"), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: pdf, url, attestation: `Downloaded from ${url} on 3 Nov 2026` }] });
  const i2 = tableItem(n2);
  const a2 = i2 ? await apply(n2.importId, [i2.id]) : { status: 0, data: {} };
  const saved2 = a2.status === 200 ? (await getRecruitmentById(String(a2.data.recruitmentId)))! : null;
  check("N2 an uploaded official PDF: the same table, page 2, and saved as proposed",
    JSON.stringify(banks(saved2?.vacancies.table?.value ?? undefined)) === JSON.stringify(["Delta Gramin Bank:11", "Epsilon Gramin Bank:8"])
    && saved2!.vacancies.table!.value!.rows.every((r) => r.source.page === 2), [a2.status, saved2?.vacancies.table?.value?.rows]);
  check("N2 Total Vacancies worked out from the two rows: 19", saved2?.vacancies.total?.value === 19, saved2?.vacancies.total);

  const n3 = await preview({ mode: "NEW", newJob: job(2093, "TEST RECORD O2 web"), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: WEB_URL }] });
  const t3 = tableItem(n3)?.value as VacancyTable | undefined;
  check("N3 an official web page: the same two rows, with no page",
    JSON.stringify(banks(t3)) === JSON.stringify(["Delta Gramin Bank:11", "Epsilon Gramin Bank:8"]) && t3!.rows.every((r) => r.source.page === null), t3?.rows ?? warnings(n3));

  const others = page(FRONT, ["Application Fee", "Category General OBC EWS SC ST", "Fee (Rs.) 850 850 850 175 175",
    "Age limit as on 01.08.2091", "Sr. No. Category UR SC ST OBC", "1 Maximum age 32 37 37 35", "2 Minimum age 21 21 21 21", "3 Relaxation 0 5 5 3",
    "Minimum qualifying marks", "Category UR EWS OBC SC ST", "Qualifying marks (%) 40 40 35 35 35"].join("\n"));
  const n4 = await preview({ mode: "NEW", newJob: job(2094, "TEST RECORD O2 other tables"), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: others }] });
  check("N4 a notice with only fee, age and marks tables: no vacancy table proposed", !tableItem(n4), itemsOf(n4).map((i) => i.fieldPath));
  check("N4 …and no warning of a table not read", !warnings(n4).some((w) => /vacancy table.*not read|could not be read as rows/.test(w)), warnings(n4));

  // ── R ──
  section(S.R);
  const r1 = await preview({ mode: "NEW", newJob: job(2095, "TEST RECORD O2 re-import"), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: page(FRONT, TABLE([DELTA, EPSILON, THETA])) }] });
  const ar1 = await apply(r1.importId, [tableItem(r1)!.id]);
  const jobId = String(ar1.data.recruitmentId);
  const before = (await getRecruitmentById(jobId))!.vacancies.table?.value ?? undefined;
  check("R1 the job's table: three banks of Office Assistants",
    JSON.stringify(banks(before)) === JSON.stringify(["Delta Gramin Bank:11", "Epsilon Gramin Bank:8", "Theta Gramin Bank:6"]) && before!.rows.every((r) => r.at.post === "Office Assistants"), before?.rows);

  // The revision: Delta's figures changed, Kappa added, and Theta moved to a supplementary table whose heading
  // has a column the reader does not know (seven figures, six column words): that table cannot be read.
  const revised = page(FRONT, TABLE(["1 Delta Gramin Bank 3 1 3 1 4 12", EPSILON, "3 Kappa Gramin Bank 1 1 1 1 1 5"]),
    "Supplementary vacancies\nSr. No. Name of the Bank SC ST OBC EWS Others UR Total\n4 Theta Gramin Bank 1 0 2 1 0 2 6\n5 Iota Gramin Bank 0 1 1 0 1 2 5");
  const r2 = await preview({ mode: "EXISTING", recruitmentId: jobId, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: revised }] });
  const note2 = noteOf(r2)!;
  const notRead = note2.coverage.tables.filter((t) => !t.read);
  check("R2 the supplementary table that cannot be read is said: not read, why, its page",
    notRead.length === 1 && notRead[0].title === "Supplementary vacancies" && JSON.stringify(notRead[0].pages) === "[3]" && /could not be matched/.test(notRead[0].why ?? "")
    && warnings(r2).some((w) => /“Supplementary vacancies”\) on page 3 was not read/.test(w)), [note2.coverage.tables, warnings(r2)]);
  check("R2 no row is offered for removal on its account; the hold is said", note2.diff?.removed === 0 && note2.removalsHeld === 1, note2);
  check("R2 the change and the new row the document does give are still offered", note2.diff?.changed === 1 && note2.diff?.added === 1, note2.diff);
  const ar2 = await apply(r2.importId, [tableItem(r2)!.id]);
  const after = (await getRecruitmentById(jobId))!.vacancies.table?.value ?? undefined;
  check("R2 applied: Delta changed, Kappa added, Theta kept", ar2.status === 200
    && JSON.stringify(banks(after).sort()) === JSON.stringify(["Delta Gramin Bank:12", "Epsilon Gramin Bank:8", "Kappa Gramin Bank:5", "Theta Gramin Bank:6"]), [ar2.status, banks(after)]);

  // Read in full: the document lists Delta, Epsilon and Kappa only, with a fee table beside them.
  const full = page(FRONT, TABLE(["1 Delta Gramin Bank 3 1 3 1 4 12", EPSILON, "3 Kappa Gramin Bank 1 1 1 1 1 5"]),
    "Application Fee\nCategory General OBC EWS SC ST\nFee (Rs.) 850 850 850 175 175");
  const r3 = await preview({ mode: "EXISTING", recruitmentId: jobId, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: full }] });
  const note3 = noteOf(r3)!;
  check("R3 read in full (a fee table beside it): the bank it no longer lists is offered for removal, as before",
    note3.diff?.removed === 1 && note3.diff.removedRows[0].at.bank === "Theta Gramin Bank" && (note3.removalsHeld ?? 0) === 0, note3);
  check("R3 …and the fee table raises no warning", note3.coverage.tables.every((t) => t.read) && note3.coverage.unreadLines.length === 0
    && !warnings(r3).some((w) => /was not read|could not be read as rows/.test(w)), [note3.coverage, warnings(r3)]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
