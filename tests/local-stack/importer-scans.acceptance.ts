// ═══════════════════════════════════════════════════════════
// Scanned pages with the REAL Gemini model (stage B2.4 acceptance, by hand)
// ═══════════════════════════════════════════════════════════
//
// Not part of any automatic suite: it needs the test key and the network,
// and the model's reading varies from run to run. Runs the whole reading
// pipeline on the in-memory test database (never Neon): each PDF split with
// pdf-lib as the browser splits it, scanned pages sent as their own pages,
// steps until the preview is built. Then compares with readings a person
// made: LIC HFL Table E (181 cities, Ananthapur 1, 232) and the Telangana
// page 23 (posts 14, 15, 16: 1, 26, 2).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json tests/local-stack/importer-scans.acceptance.ts <sources dir> <out dir>
//
// <sources dir> holds lic-tableE-scan.pdf (LIC pages 5-9 as images only),
// lic-mixed.pdf (LIC pages 1-4 and 10 as text, 5-9 as images) and
// tg-page23-scan.pdf (the Telangana page as an image), and for B2.5
// lic-text-then-scan.pdf (pages 8-9 as images) and lic-scan-then-text.pdf
// (pages 6-7 as images). ONLY_CROSS=1 runs those two only. The key is never printed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { blocked, boot, check, expectChecks, note, section, summary } from "./boot";

const [SRC, OUT] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY ?? "";
// REPLAY=<dir of a run's saved previews>: the same assertions on that run's saved readings, with no AI request.
const REPLAY = process.env.REPLAY ?? "";
if (!SRC || !OUT) { console.error("usage: … <sources dir> <out dir>"); process.exit(2); }
if (!REPLAY && KEY.length < 20) { console.error("GEMINI_API_KEY is not set (expected in .env.local)"); process.exit(2); }
if (!/@localhost\//.test(process.env.DATABASE_URL ?? "")) { console.error("Refusing to run: DATABASE_URL is not the local test database."); process.exit(2); }
const scrub = (s: string) => (KEY ? s.split(KEY).join("<key>") : s);
mkdirSync(OUT, { recursive: true });

// Every check that must run, by section, declared before anything runs (B2.6): one that did not run makes the
// suite INCOMPLETE, never "ALL PASS".
//
// The scan criterion as the owner revised it (B2.6 decision 1): the model may misread or split a cell on a page
// image — a documented limitation, with the prepared-outside paste route for difficult tables. What must hold is
// that such an error is caught wherever the page offers a check, a row not read is said and never filled in, a
// reading with anything unread is never complete, and AI-read rows keep the table from being marked ready until a
// person checks it. Whether every cell was read as a person read it is still reported, as a note, never hidden.
const LIC_CHECKS = (name: string, scanned: number[]) => [
  `${name}: every city read has its figure and page as a person read them`, `${name}: a city not read is listed as not read, never filled in`,
  `${name}: Ananthapur 1`, `${name}: Total Vacancies 232, complete`,
  `${name}: Table E rows on scanned pages (${scanned.join(", ")}) marked as read from the image by AI, and only those`,
  `${name}: the page images of Table E's scanned pages are there to compare`, `${name}: the reading is complete only when nothing in the table is left unread`,
  `${name}: AI-read rows keep the table from being marked ready until a person checks it`,
];
const CROSS_ONLY = process.env.ONLY_CROSS === "1";
if (!CROSS_ONLY) expectChecks("lic-scan", LIC_CHECKS("lic-scan", [5, 6, 7, 8, 9]));
expectChecks("lic-text-then-scan", LIC_CHECKS("lic-text-then-scan", [8, 9]));
expectChecks("lic-scan-then-text", LIC_CHECKS("lic-scan-then-text", [6, 7]));
if (!CROSS_ONLY) {
  expectChecks("lic-mixed", [...LIC_CHECKS("lic-mixed", [5, 6, 7, 8, 9]), "lic-mixed: values from the text pages are not marked as AI-read from an image"]);
  expectChecks("tg-page23", ["tg-page23: posts 14, 15, 16 with totals 1, 26, 2", "tg-page23: every cell read differently from the page is caught by a printed subtotal (its post is flagged)",
    "tg-page23: every row marked as read from the image by AI", "tg-page23: AI-read rows keep the table from being marked ready until a person checks it"]);
}

type Row = { at: Record<string, string>; status: string; total?: number; cells: Record<string, number>; unclear?: string[]; source: { page: number | null; readBy?: string } };

(async () => {
  const { adminId } = await boot();
  const jobs = await import("@/lib/cms/importer/jobs");
  const { openPdf, splitPdf, onePage, sha256Hex } = await import("@/lib/cms/importer/pdf-split");
  const { getImport } = await import("@/lib/cms/importer/repository");
  const { analyseVacancyTable, calculatedTotalReady } = await import("@/lib/vacancy-table");
  /** AI-read rows: the table is not ready to publish as checked until a person has compared it with the pages. */
  const heldForChecking = (t: unknown) => { const r = calculatedTotalReady(t as never, { tableChecked: false }); return !r.ready && r.reasons.some((x) => /read from scanned page images by AI/.test(x)); };
  const { LIC_TABLE_E_ROWS } = await import("../fixtures/vacancy-tables");
  note(`model: ${process.env.GEMINI_MODEL}`);

  /** The whole reading, as the browser and the step route do it; returns the preview. */
  async function read(name: string, file: string, title: string, org: string) {
    section(name);
    if (REPLAY) {
      const saved = JSON.parse(readFileSync(join(REPLAY, `${name}.json`), "utf8")) as { progress: Awaited<ReturnType<typeof jobs.jobProgress>>; proposal: Parameters<typeof replayed>[0] };
      note(`replayed from ${REPLAY}/${name}.json: no AI request`);
      return replayed(saved.proposal, saved.progress);
    }
    const bytes = new Uint8Array(readFileSync(join(SRC, file)));
    const { doc, pages } = await openPdf(bytes);
    const { jobId } = await jobs.createReadingJob({ adminId, mode: "NEW", newJob: { organizationId: org, organizationName: org.toUpperCase(), recruitmentYear: 2026, title, govType: "PSU" } as never,
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", fileName: file, pages, byteSize: bytes.byteLength, sha256: await sha256Hex(bytes) }] });
    for await (const piece of splitPdf(doc, { maxBytes: 3.9 * 1024 * 1024, maxPages: 40 })) {
      if ("oversized" in piece) { await jobs.recordFailedPart({ adminId, jobId, sourceNo: 1, first: piece.first, last: piece.last, reason: piece.reason }); continue; }
      const r = await jobs.uploadJobPart({ adminId, jobId, sourceNo: 1, first: piece.first, last: piece.last, bytes: Buffer.from(piece.bytes) });
      for (const n of r.noTextPages) await jobs.uploadScanPage({ adminId, jobId, sourceNo: 1, page: n, bytes: Buffer.from(await onePage(doc, n)) });
    }
    const est = await jobs.startJob({ adminId, jobId, confirm: true });
    note(`${pages} pages, ${est.scanPages} scanned; about ${est.estimate} requests`);
    const t0 = Date.now();
    let p = await jobs.jobProgress({ adminId, jobId });
    for (let i = 0; i < 80 && (p.state === "READING" || p.state === "FINISHING"); i++) p = await jobs.stepJob({ adminId, jobId, apiKey: KEY });
    note(`${p.state}${p.complete ? ", complete" : ""} in ${Math.round((Date.now() - t0) / 1000)} s; ${p.ai.sent} requests (${p.ai.retried} resent); failed: ${p.failedTasks.map((f) => `${f.kind} ${f.first}: ${scrub(f.reason)}`).join("; ") || "none"}`);
    if (!p.importId) { check(`${name}: preview built`, false, p.stateNote); blocked(`no preview was built: ${p.stateNote ?? p.state}`); return null; }
    const imp = await getImport(p.importId);
    const proposal = imp!.proposal as unknown as { items: Array<{ fieldPath: string; value: unknown; flags: string[]; claims: Array<{ page: number | null; fromImage?: boolean }> }>; warnings: string[];
      meta: { sources: Array<{ vacancyTables: { problems?: string[] }; pageImages?: { pages: number[] } }> } };
    writeFileSync(join(OUT, `${name}.json`), scrub(JSON.stringify({ progress: p, proposal }, null, 1)));
    return replayed(proposal, p);
  }
  function replayed(proposal: { items: Array<{ fieldPath: string; value: unknown; flags: string[]; claims: Array<{ page: number | null; fromImage?: boolean }> }>; warnings: string[];
    meta: { sources: Array<{ vacancyTables: { problems?: string[]; coverage?: { unreadLines: Array<{ page: number | null; text: string }> } }; pageImages?: { pages: number[] } }> } }, p: Awaited<ReturnType<typeof jobs.jobProgress>>) {
    const table = proposal.items.find((i) => i.fieldPath === "vacancies.table")?.value as { rows: Row[] } | undefined;
    const problems = proposal.meta.sources[0].vacancyTables?.problems ?? [];
    const unreadLines = proposal.meta.sources[0].vacancyTables?.coverage?.unreadLines ?? [];
    if (problems.length) note(`problems: ${problems.join(" | ")}`);
    return { p, proposal, table, problems, unreadLines };
  }

  /** `offset`: the file's page number is the notice's page minus this (the scan-only file starts at the notice's page 5). */
  /** `scanned`: the notice's pages that are images in this file (Table E's rows there are AI-read; elsewhere read from the text). */
  const licCheck = (name: string, r: Awaited<ReturnType<typeof read>>, offset: number, scanned = [5, 6, 7, 8, 9]) => {
    if (!r?.table) { check(`${name}: a vacancy table`, false); blocked(r ? "the reading proposed no vacancy table" : "no preview was built", name); return; }
    const an = analyseVacancyTable(r.table as never);
    let ok = 0; const bad: string[] = [];
    for (const want of LIC_TABLE_E_ROWS) {
      const got = r.table.rows.find((x) => (x.at.city ?? "").toLowerCase() === want.city.toLowerCase());
      if (got && got.total === want.n && got.source.page === want.page - offset) ok++; else bad.push(`${want.city} p${want.page - offset}: want ${want.n}, got ${got?.total ?? got?.status} p${got?.source.page}`);
    }
    note(`against the person-checked rows: ${ok}/181${bad.length ? ` — ${bad.slice(0, 6).join("; ")}` : ""}`);
    // Cities the reading has, against a person's reading; cities it does not have must be said as not read.
    const missing = LIC_TABLE_E_ROWS.filter((want) => !r.table!.rows.some((x) => (x.at.city ?? "").toLowerCase() === want.city.toLowerCase()));
    const wrong = bad.filter((b) => !missing.some((m) => b.startsWith(`${m.city} `)));
    if (missing.length) note(`KNOWN SCAN LIMITATION: ${missing.length} of 181 cities not read: ${missing.map((m) => m.city).join(", ")}`);
    check(`${name}: every city read has its figure and page as a person read them`, wrong.length === 0, wrong.slice(0, 10));
    check(`${name}: a city not read is listed as not read, never filled in`, missing.every((m) => r.unreadLines.some((l) => l.text.toLowerCase().includes(m.city.toLowerCase()))),
      missing.map((m) => m.city));
    check(`${name}: Ananthapur 1`, r.table.rows.find((x) => x.at.city === "Ananthapur")?.total === 1);
    check(`${name}: Total Vacancies 232, complete`, an.grandTotal?.value === 232 && an.grandTotal.complete, an.grandTotal);
    const wrongMark = r.table.rows.filter((x) => x.at.city && (x.source.readBy === "AI_IMAGE") !== scanned.includes((x.source.page ?? 0) + offset));
    check(`${name}: Table E rows on scanned pages (${scanned.join(", ")}) marked as read from the image by AI, and only those`, wrongMark.length === 0, wrongMark.slice(0, 5).map((x) => `${x.at.city} p${x.source.page} ${x.source.readBy ?? "text"}`));
    const images = r.proposal.meta.sources[0].pageImages?.pages ?? [];
    note(`page images kept for the review: ${images.join(", ")}`);
    check(`${name}: the page images of Table E's scanned pages are there to compare`, scanned.every((n) => images.includes(n - offset)), images);
    const nothingUnread = missing.length === 0 && r.unreadLines.length === 0;
    check(`${name}: the reading is complete only when nothing in the table is left unread`, (r.p.complete && !r.p.stateNote) === nothingUnread, [r.p.complete, r.p.stateNote, r.unreadLines.length]);
    check(`${name}: AI-read rows keep the table from being marked ready until a person checks it`, heldForChecking(r.table));
  };

  // B2.5: one table running from text pages onto scanned ones, and from scanned pages onto text ones.
  if (process.env.ONLY_CROSS !== "1") licCheck("lic-scan", await read("lic-scan", "lic-tableE-scan.pdf", "TEST RECORD LIC scan", "lic-scan"), 4);
  licCheck("lic-text-then-scan", await read("lic-text-then-scan", "lic-text-then-scan.pdf", "TEST RECORD LIC text then scan", "lic-tts"), 0, [8, 9]);
  licCheck("lic-scan-then-text", await read("lic-scan-then-text", "lic-scan-then-text.pdf", "TEST RECORD LIC scan then text", "lic-stt"), 0, [6, 7]);
  if (process.env.ONLY_CROSS === "1") { summary(); return; }
  const mixed = await read("lic-mixed", "lic-mixed.pdf", "TEST RECORD LIC mixed", "lic-mixed");
  licCheck("lic-mixed", mixed, 0);
  if (mixed) {
    const dates = mixed.proposal.items.filter((i) => i.fieldPath.startsWith("dates."));
    check("lic-mixed: values from the text pages are not marked as AI-read from an image", dates.length > 0 && dates.some((d) => d.claims.some((c) => !c.fromImage)), dates.map((d) => [d.fieldPath, d.claims.map((c) => [c.page, c.fromImage])]));
  }

  const tg = await read("tg-page23", "tg-page23-scan.pdf", "TEST RECORD Telangana junior assistants", "tg-ja");
  if (tg && !tg.table) blocked("the reading proposed no vacancy table", "tg-page23");
  if (tg?.table) {
    const an = analyseVacancyTable(tg.table as never);
    const want: Array<[string, number]> = [["14", 1], ["15", 26], ["16", 2]];
    const got = an.groups.map((g) => [/POST CODE:?\s*(\d+)/i.exec(g.name)?.[1] ?? g.name, g.total?.value] as [string, number | undefined]);
    note(`posts: ${got.map(([c, v]) => `${c}=${v}`).join(", ")}; total ${an.grandTotal?.value} ${an.grandTotal?.complete ? "complete" : "incomplete"}`);
    check("tg-page23: posts 14, 15, 16 with totals 1, 26, 2", JSON.stringify(got) === JSON.stringify(want), got);
    const truth = JSON.parse(readFileSync("tests/fixtures/scans/tg-page23-transcription.json", "utf8")) as { tables: Array<{ rows: string[][]; columns: string[] }> };
    const cellsWrong: string[] = [];
    truth.tables.forEach((t, ti) => {
      const row = tg.table!.rows.find((r) => new RegExp(`POST CODE:?\\s*${14 + ti}\\b`, "i").test(r.at.post));
      t.columns.forEach((c, ci) => {
        if (ci === 0 || /total/i.test(c)) return;
        const printed = t.rows[0][ci];
        const key = c.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const v = row?.cells[key];
        const expected = /^\d/.test(printed) ? Number(printed.replace(/\D.*$/, "")) : undefined;
        if (v !== expected) cellsWrong.push(`post ${14 + ti} ${c}: printed ${printed}, read ${v ?? "-"}`);
      });
    });
    note(`cells read differently from the page: ${cellsWrong.length ? `${cellsWrong.join("; ")} — KNOWN SCAN LIMITATION` : "none"}`);
    // Each post with a cell read differently must have a printed subtotal that disagrees with it, flagged for checking.
    const flagged = (post: number) => tg.problems.some((p) => new RegExp(`POST CODE:?\\s*${post}\\b[\\s\\S]*Check the figures against the page`, "i").test(p));
    const wrongPosts = [...new Set(cellsWrong.map((c) => Number(/^post (\d+)/.exec(c)![1])))];
    check("tg-page23: every cell read differently from the page is caught by a printed subtotal (its post is flagged)", wrongPosts.every(flagged), wrongPosts.filter((p) => !flagged(p)));
    check("tg-page23: AI-read rows keep the table from being marked ready until a person checks it", heldForChecking(tg.table));
    check("tg-page23: every row marked as read from the image by AI", tg.table.rows.every((r) => r.source.readBy === "AI_IMAGE"));
  }
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", scrub(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
