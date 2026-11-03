// ═══════════════════════════════════════════════════════════
// I3: a source by address that cannot be fetched or read does not stop the
// import. Through the real preview, apply and database functions on the
// in-memory test database, and the real fetcher against a local web server
// (the only addresses it reaches; nothing on the internet). No AI.
//
// The other sources are read and offered as before; the one that failed is
// named with its reason, nothing of it is kept, and it gains no standing.
// When no source can be read the import stops with each reason and what to
// do instead. An address that is not allowed at all still stops the import.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/i3-unavailable-source.test.ts
// ═══════════════════════════════════════════════════════════

import http from "node:http";
import type { AddressInfo } from "node:net";
import { boot, check, expectChecks, section, summary } from "./boot";
import { makePdf } from "./pdf-fixture";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; defaultTicked: boolean };
type Proposal = { items: Item[]; warnings: string[]; meta: { sources: Array<J>; duplicates: unknown[]; unavailable?: Array<{ url: string; declaredKind: string; reason: string }> } };

const PAGE = `<html><body><h1>Test State Board — Clerk Recruitment 2098</h1><p>Advertisement No. TSB/CLK/01/2098</p>
<p>Online applications from 01.03.2098 to 31.03.2098.</p><p>Educational qualification: graduation in any stream.</p>
<h2>Vacancies</h2><table><tr><th>Name of Post</th><th>UR</th><th>SC</th><th>ST</th><th>Total</th></tr>
<tr><td>Lower Division Clerk</td><td>20</td><td>6</td><td>4</td><td>30</td></tr><tr><td>Typist</td><td>5</td><td>2</td><td>1</td><td>8</td></tr></table></body></html>`;
const SCRIPT_PAGE = `<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>`;
const PASTED = `Test State Board — Clerk Recruitment 2098\nAdvertisement No. TSB/CLK/01/2098\nLast date to apply online: 31.03.2098\n`
  + "Applications are invited from graduates for the posts of Lower Division Clerk and Typist in the offices of the Board.";

const server = http.createServer((req, res) => {
  const send = (status: number, type: string, body: string | Buffer) => { res.writeHead(status, { "content-type": type }); res.end(body); };
  if (req.url === "/page") return send(200, "text/html; charset=utf-8", PAGE);
  if (req.url === "/forbidden") return send(403, "text/html", "Forbidden");
  if (req.url === "/missing") return send(404, "text/html", "Not found");
  if (req.url === "/script-page") return send(200, "text/html; charset=utf-8", SCRIPT_PAGE);
  if (req.url === "/scan.pdf") return send(200, "application/pdf", makePdf([""]));
  if (req.url === "/hang") return; // never answers: the fetcher's own time limit ends it
  send(500, "text/plain", "?");
});

const S = { A: "A: some sources read, some not", B: "B: no source can be read", C: "C: what does not change" };
expectChecks(S.A, [
  "A1 one address that answers: read as before, nothing said as unavailable",
  "A1 …a fetched official page keeps its standing (confirmed by the server's fetch) and its table",
  "A2 a refused address beside one that answers: the page's values and table are offered",
  "A2 …the refused one is named with its reason, first among the warnings",
  "A2 …and it is no source of the import: no retrieval, no standing",
  "A3 a refused address beside pasted text: the pasted values are offered",
  "A3 …saved and reopened: the pasted values are on the job",
  "A4 several failures at once: each named with its own reason (403, 404, no text, a scan PDF)",
  "A4 …a site that never answers: named as taking too long",
]);
expectChecks(S.B, [
  "B1 every address refused: the import stops, naming each with its reason",
  "B1 …and says what to do instead (upload or paste)",
  "B1 …no import or source is stored",
]);
expectChecks(S.C, [
  "C1 an address that is not allowed (a private network) still stops the import, even beside one that answers",
  "C2 an address that is not http(s) still stops the import",
  "C3 a re-import with an address that cannot be read changes nothing of the job's table",
  "C4 duplicates are still found when a source cannot be read",
]);

(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const { pg, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { fetchSource } = await import("@/lib/cms/importer/fetch-source");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as J[];

  // The real fetcher; ".test" hosts lead to the local server. Every other address is checked as in production.
  const at = (path: string) => `http://tsb-board.test:${port}${path}`;
  const local = { resolve: async (host: string) => (host.endsWith(".test") ? ["127.0.0.1"] : ["93.184.216.34"]), isBlocked: (ip: string) => ip !== "127.0.0.1" && ip !== "93.184.216.34" };
  const fetchSourceFn = (url: string) => fetchSource(url, new URL(url).hostname.endsWith(".test") ? local : {});
  const noAi = (async () => { throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  let year = 2500;
  const newJob = () => ({ mode: "NEW", newJob: { organizationId: `i3-${year}`, organizationName: "Test State Board", recruitmentYear: year++, title: "TEST RECORD I3 Clerk", govType: "State Govt" } });
  const preview = async (args: J) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchFn: noAi, fetchSourceFn, ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const failure = async (args: J) => { try { await preview(args); return null; } catch (e) { return e as Error & { status?: number }; } };
  const url = (path: string, declaredKind = "OFFICIAL_PAGE") => ({ declaredKind, method: "url", url: at(path) });
  const pasted = { declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: PASTED, url: "https://tsb-board.example.gov.in/clerk-2098.pdf", attestation: "Copied from the Board's notice on 3 Nov 2026 (test)" };
  const paths = (p: Proposal) => p.items.map((i) => i.fieldPath).sort();
  const retrievalsOf = (importId: string) => q("SELECT origin_url, authenticity, authenticity_method FROM recruitment_source_retrievals WHERE import_id = $1", [importId]);

  section(S.A);
  const one = await preview({ ...newJob(), sources: [url("/page")] });
  check("A1 one address that answers: read as before, nothing said as unavailable",
    paths(one.proposal).includes("vacancies.table") && paths(one.proposal).includes("dates.applicationCloseDate") && !one.proposal.meta.unavailable && !one.proposal.warnings.some((w) => /could not be read:/.test(w)), [paths(one.proposal), one.proposal.warnings]);
  const r1 = await retrievalsOf(one.importId);
  check("A1 …a fetched official page keeps its standing (confirmed by the server's fetch) and its table",
    r1.length === 1 && r1[0].authenticity === "CONFIRMED" && r1[0].authenticity_method === "FETCHED_BY_SERVER"
    && (one.proposal.items.find((i) => i.fieldPath === "vacancies.table")!.value as { rows: unknown[] }).rows.length === 2, r1);

  const two = await preview({ ...newJob(), sources: [url("/forbidden", "OFFICIAL_NOTIFICATION"), url("/page")] });
  check("A2 a refused address beside one that answers: the page's values and table are offered",
    JSON.stringify(paths(two.proposal)) === JSON.stringify(paths(one.proposal)), [paths(two.proposal), paths(one.proposal)]);
  check("A2 …the refused one is named with its reason, first among the warnings",
    new RegExp(`^${at("/forbidden").replace(/[.?]/g, "\\$&")} \\(notification\\) could not be read: The site refused the server \\(HTTP 403\\)`).test(two.proposal.warnings[0] ?? "")
    && /Nothing from it is in this preview, and it is not kept as a source/.test(two.proposal.warnings[0]) && two.proposal.meta.unavailable?.length === 1, two.proposal.warnings);
  const r2 = await retrievalsOf(two.importId);
  check("A2 …and it is no source of the import: no retrieval, no standing",
    r2.length === 1 && r2[0].origin_url === at("/page") && two.proposal.meta.sources.length === 1, r2);

  const three = await preview({ ...newJob(), sources: [url("/forbidden", "OFFICIAL_NOTIFICATION"), pasted] });
  const want = ["dates.applicationCloseDate", "identity.notificationNumber"];
  check("A3 a refused address beside pasted text: the pasted values are offered",
    want.every((p) => paths(three.proposal).includes(p)) && /could not be read/.test(three.proposal.warnings[0] ?? ""), [paths(three.proposal), three.proposal.warnings]);
  const applied = await service.applyImportFlow({ importId: three.importId, adminId, selected: three.proposal.items.filter((i) => want.includes(i.fieldPath)).map((i) => i.id), confirmReplaceVerified: false, override: null });
  const job3 = (await getRecruitmentById(applied.recruitmentId))!;
  check("A3 …saved and reopened: the pasted values are on the job",
    job3.dates.applicationCloseDate?.value === "2098-03-31" && !!job3.identity.notificationNumber?.value && job3.identity.notificationNumber.status === "PENDING", [job3.dates.applicationCloseDate, job3.identity.notificationNumber]);

  // At most four sources in one import: three failures beside the pasted text, then two more.
  const many = await preview({ ...newJob(), sources: [url("/forbidden"), url("/missing"), url("/script-page"), pasted] });
  const more = await preview({ ...newJob(), sources: [url("/scan.pdf", "OFFICIAL_NOTIFICATION"), url("/hang"), pasted] });
  const reasons = Object.fromEntries([...many.proposal.meta.unavailable ?? [], ...more.proposal.meta.unavailable ?? []].map((u) => [new URL(u.url).pathname, u.reason]));
  check("A4 several failures at once: each named with its own reason (403, 404, no text, a scan PDF)",
    /HTTP 403/.test(reasons["/forbidden"] ?? "") && /HTTP 404/.test(reasons["/missing"] ?? "") && /no text to read/.test(reasons["/script-page"] ?? "")
    && /no text layer/.test(reasons["/scan.pdf"] ?? "") && many.proposal.warnings.filter((w) => /could not be read:/.test(w)).length === 3 && many.proposal.meta.sources.length === 1, reasons);
  check("A4 …a site that never answers: named as taking too long",
    /took too long to answer/.test(reasons["/hang"] ?? "") && more.proposal.meta.sources.length === 1 && more.proposal.meta.unavailable?.length === 2, [reasons["/hang"], reasons["/scan.pdf"], more.proposal.meta.sources.length]);

  section(S.B);
  const imports = async () => Number((await q("SELECT count(*)::int AS n FROM recruitment_imports"))[0].n);
  const before = await imports();
  const none = await failure({ ...newJob(), sources: [url("/forbidden"), url("/missing")] });
  check("B1 every address refused: the import stops, naming each with its reason",
    none?.name === "ImportInputError" && none.status === 400 && /^No source could be read, so there is nothing to import/.test(none.message)
    && none.message.includes(`${at("/forbidden")} (The site refused the server (HTTP 403)`) && none.message.includes(`${at("/missing")} (The site answered HTTP 404)`), none?.message);
  check("B1 …and says what to do instead (upload or paste)", /Download the notice and upload it, or copy its text and paste it\.$/.test(none?.message ?? ""), none?.message);
  check("B1 …no import or source is stored", await imports() === before, [before, await imports()]);

  section(S.C);
  const priv = await failure({ ...newJob(), sources: [{ declaredKind: "OFFICIAL_PAGE", method: "url", url: "http://127.0.0.1/" }, url("/page")] });
  check("C1 an address that is not allowed (a private network) still stops the import, even beside one that answers",
    priv?.name === "ImportInputError" && /private network/.test(priv.message), priv?.message);
  const ftp = await failure({ ...newJob(), sources: [{ declaredKind: "OFFICIAL_PAGE", method: "url", url: "ftp://tsb-board.test/notice.pdf" }, pasted] });
  check("C2 an address that is not http(s) still stops the import", ftp?.name === "ImportInputError" && /Only http and https/.test(ftp.message), ftp?.message);

  // The page and the pasted notice (A3, saved above) are the same Board notice, "Advertisement No. TSB/CLK/01/2098".
  // Before I4 the page's number was read as "CLK/01/2098", so this second job was not seen as a duplicate; it is
  // now, rightly. The job is made here only to re-import into, so it is saved with an override reason.
  const made = await service.applyImportFlow({ importId: one.importId, adminId, selected: one.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false,
    override: { reason: "A second copy of the test job, to re-import into (I3 test)" } });
  const rows = async () => JSON.stringify(((await getRecruitmentById(made.recruitmentId))!.vacancies.table?.value?.rows ?? []).map((r) => [r.at, r.total]));
  const tableBefore = await rows();
  const re = await preview({ mode: "EXISTING", recruitmentId: made.recruitmentId, sources: [url("/forbidden"), { declaredKind: "RESEARCH", method: "paste", text: `${PASTED}\nNo vacancy figures are given in this summary.` }] });
  const reNone = await failure({ mode: "EXISTING", recruitmentId: made.recruitmentId, sources: [url("/missing")] });
  check("C3 a re-import with an address that cannot be read changes nothing of the job's table",
    !re.proposal.items.some((i) => i.fieldPath === "vacancies.table") && /could not be read/.test(re.proposal.warnings[0] ?? "") && /No source could be read/.test(reNone?.message ?? "")
    && await rows() === tableBefore && JSON.parse(tableBefore).length === 2, [paths(re.proposal), reNone?.message]);

  const dup = await preview({ mode: "NEW", newJob: { organizationId: `i3-${year++}`, organizationName: "Test State Board", recruitmentYear: 2098, title: "TEST RECORD I3 Clerk again", govType: "State Govt", notificationNumber: job3.identity.notificationNumber!.value! }, sources: [url("/forbidden"), pasted] });
  check("C4 duplicates are still found when a source cannot be read", dup.proposal.meta.duplicates.length > 0 && /could not be read/.test(dup.proposal.warnings[0] ?? ""), dup.proposal.meta.duplicates);

  server.close();
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
