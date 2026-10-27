// ═══════════════════════════════════════════════════════════
// Smart intake with the REAL Gemini model (acceptance, by hand)
// ═══════════════════════════════════════════════════════════
//
// Not part of any automatic suite: it needs a dedicated test key and the
// network to Google, and the model's answers vary from run to run. It runs
// the real service against the in-memory test database (never Neon) on real
// sources, checks what the model proposed against facts read off those
// sources by a person, and checks independently that every quote is in its
// source. Every proposed item is written to OUT/<case>.json for review.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json tests/local-stack/importer-gemini.acceptance.ts <sources dir> <out dir>
//
// <sources dir> holds: btsc-fso-article.txt (Adda247 article text), lic.pdf
// (LIC HFL batch 10 notice), lic-scan.pdf (its pages 1-5 as images only),
// source-btsc-dates-screenshot.png, ibps-crp-rrb-xv.pdf (IBPS CRP RRBs-XV).
// The key is never printed: it is removed from anything this script writes.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, check, note, section, summary } from "./boot";

const [SRC, OUT] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY ?? "";
if (!SRC || !OUT) { console.error("usage: … <sources dir> <out dir>"); process.exit(2); }
if (KEY.length < 20) { console.error("GEMINI_API_KEY is not set (expected in .env.local)"); process.exit(2); }
// Everything here is local: ./boot sets DATABASE_URL to the in-memory test
// database as it loads and boot() aborts if a query would go anywhere else.
// Still refuse an env file that carries a real database, so it is noticed.
if (!/@localhost\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not the local test database. Keep only the Gemini key in the env file.");
  process.exit(2);
}
const scrub = (s: string) => (KEY ? s.split(KEY).join("<key>") : s);
mkdirSync(OUT, { recursive: true });

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; action: string; conflict: boolean; defaultTicked: boolean; flags: string[]; claims: Array<{ quote?: string; page?: number | null; retrievalId: string }> };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const short = (v: unknown, n = 140) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + "…" : s; };

(async () => {
  const { adminId, pg } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { readScannedNotice } = await import("@/lib/cms/scan-reader");
  const { extractPdfFromBuffer } = await import("@/intelligence/pdf-extractor");
  const model = process.env.GEMINI_MODEL || (await import("@/intelligence/gemini-extraction-provider")).DEFAULT_GEMINI_MODEL;
  note(`model: ${model}`);

  const file = (name: string) => readFileSync(join(SRC, name));
  const results: J = {};

  /** Runs one preview; returns its items, warnings and sources. */
  async function run(name: string, newJob: J, sources: J[]) {
    section(name);
    const t0 = Date.now();
    let out: Awaited<ReturnType<typeof service.previewImport>>;
    try {
      out = await service.previewImport({ adminId, mode: "NEW", newJob: newJob as never, sources: sources as never, apiKey: KEY });
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e));
      check(`${name}: preview made`, false, msg);
      results[name] = { error: msg };
      return null;
    }
    const proposal = out.proposal as unknown as { items: Item[]; warnings: string[]; meta: { sources: Array<J> } };
    const items = proposal.items;
    note(`${items.length} items in ${Math.round((Date.now() - t0) / 1000)} s`);
    for (const i of items) {
      note(`${i.defaultTicked ? "[x]" : "[ ]"} ${i.fieldPath} = ${short(i.value)}${i.conflict ? "  CONFLICT" : ""}${i.flags.length ? `  flags: ${i.flags.join(",")}` : ""}\n         quote: ${short(i.claims[0]?.quote ?? "—", 160)}`);
    }
    for (const s of proposal.meta.sources) {
      for (const r of (s.refused as Array<{ fieldPath: string; reason: string }> | undefined) ?? []) note(`refused ${r.fieldPath}: ${r.reason}`);
      if ((s.notFound as string[] | undefined)?.length) note(`not found: ${(s.notFound as string[]).join(", ")}`);
    }
    for (const w of proposal.warnings) note(`warning: ${w}`);
    // Each schedule entry with the class code gave it, to compare with the notice by hand.
    for (const st of items.filter((i) => i.fieldPath === "examStages")) {
      note(`stages by class: ${(st.value as Array<{ name: string; kind?: string }>).map((s) => `${s.name} [${s.kind ?? "none"}]`).join(" | ")}`);
      check(`${name}: every schedule entry has a class`, (st.value as Array<{ kind?: string }>).every((s) => !!s.kind));
    }
    // Ages: each post's figures with the page of its own quote, to compare with the notice by hand.
    for (const a of items.filter((i) => i.fieldPath === "age")) {
      const v = a.value as { min?: number; max?: number; asOf?: string; categoryMax?: Array<{ category: string; max: number }>; postWise?: Array<{ post: string; min?: number; max?: number; bornFrom?: string; bornTo?: string; asOf?: string; relaxations?: Array<{ category: string; years?: number; text?: string }>; evidence?: Array<{ page?: number | null }> }> };
      note(`age: overall ${v.min ?? "–"}–${v.max ?? "–"} as on ${v.asOf ?? "–"}${v.categoryMax?.length ? `; printed by category ${v.categoryMax.map((c) => `${c.category} ${c.max}`).join(", ")}` : ""}${a.flags.length ? `; flags: ${a.flags.join(" / ")}` : ""}`);
      for (const p of v.postWise ?? []) note(`  ${p.post}: ${p.min ?? "–"}–${p.max ?? "–"}, born ${p.bornFrom ?? "–"} to ${p.bornTo ?? "–"}${p.asOf ? `, as on ${p.asOf}` : ""}${p.relaxations?.length ? `, own relaxations ${p.relaxations.map((r) => `${r.category} ${r.years ?? r.text}`).join("; ")}` : ""} (pages ${[...new Set((p.evidence ?? []).map((e) => e.page))].join(",")})`);
    }
    // Independently of the site's own check: every quote is in the text stored
    // for its source (for an image or scan, the AI's write-up), word for word.
    // A source's own address is recorded with a fixed note, not a quote.
    const stored = await pg.query("SELECT s.text FROM recruitment_source_retrievals r JOIN recruitment_sources s ON s.id = r.source_id WHERE r.import_id = $1", [out.importId]);
    const all = norm((stored.rows as Array<{ text: string }>).map((r) => r.text).join("\n"));
    const OWN = "The address this document came from";
    const missing = items.flatMap((i) => i.claims.filter((c) => c.quote && c.quote !== OWN && !all.includes(norm(c.quote))).map((c) => `${i.fieldPath}: ${short(c.quote, 80)}`));
    check(`${name}: every quote is in its source`, missing.length === 0, missing);
    results[name] = { items, warnings: proposal.warnings, sources: proposal.meta.sources };
    writeFileSync(join(OUT, `${name}.json`), scrub(JSON.stringify(results[name], null, 2)));
    note(`AI requests: ${JSON.stringify((proposal.meta as J).aiRequests ?? null)}`);
    return { items, warnings: proposal.warnings, sources: proposal.meta.sources };
  }
  const val = (items: Item[], path: string) => items.filter((i) => i.fieldPath === path).map((i) => i.value);
  const has = (items: Item[], path: string, want: unknown) => val(items, path).some((v) => JSON.stringify(v) === JSON.stringify(want));
  // Research only: values are ticked to be saved as Pending (the approved design), each one flagged.
  const datesFlaggedResearch = (items: Item[]) => items.filter((i) => i.fieldPath.startsWith("dates.")).every((i) => i.flags.some((f) => /research only/.test(f)));
  // The vacancy table (stage B1): read by code, totals calculated by code.
  type Row = { at: Record<string, string>; status: string; total?: number; cells: Record<string, number>; source: { page: number | null; line: string } };
  const tableOf = (items: Item[]) => val(items, "vacancies.table")[0] as { rows: Row[]; categories: Array<{ key: string; kind: string }> } | undefined;
  const { analyseVacancyTable } = await import("@/lib/vacancy-table");
  const tableReport = (name: string, r: { items: Item[]; sources: J[] }) => {
    const t = tableOf(r.items);
    const n = (r.sources[0]?.vacancyTables ?? null) as { from?: string; coverage?: { tables: Array<{ title: string; read: boolean; columnsBy?: string }>; unreadLines: unknown[] } } | null;
    const g = t ? analyseVacancyTable(t as never).grandTotal : null;
    note(`${name} table: ${t ? `${t.rows.length} rows from ${n?.from}, total ${g ? `${g.complete ? "" : "≥ "}${g.value}` : "—"}` : "none"}; tables ${n?.coverage?.tables.map((x) => `${x.title}:${x.read ? x.columnsBy : "not read"}`).join(" | ") ?? "—"}; unread lines ${n?.coverage?.unreadLines.length ?? 0}`);
    const competing = r.items.filter((i) => (i.fieldPath === "vacancies.total" || i.fieldPath === "vacancies.breakdown") && i.defaultTicked);
    if (t) check(`${name}: no separate total or breakdown is ticked against the table`, competing.length === 0, competing.map((i) => i.fieldPath));
    return { t, g, n };
  };

  // ── 1. BTSC FSO: the complete Adda247 article, pasted as research ──
  const btscText = file("btsc-fso-article.txt").toString("utf8");
  const btsc = await run("btsc-article", { organizationId: "btsc", organizationName: "Bihar Technical Service Commission", recruitmentYear: 2026, title: "BTSC Food Safety Officer Recruitment 2026", govType: "State Govt" },
    [{ declaredKind: "RESEARCH", method: "paste", text: btscText }]);
  if (btsc) {
    const it = btsc.items;
    check("BTSC: Advertisement No. 29/2026", val(it, "identity.notificationNumber").some((v) => String(v).includes("29/2026")), val(it, "identity.notificationNumber"));
    check("BTSC: applications open 25 Sep 2026", has(it, "dates.applicationOpenDate", "2026-09-25"), val(it, "dates.applicationOpenDate"));
    check("BTSC: last date 24 Oct 2026", has(it, "dates.applicationCloseDate", "2026-10-24"), val(it, "dates.applicationCloseDate"));
    check("BTSC: the passed last date is flagged", it.some((i) => i.fieldPath === "dates.applicationCloseDate" && i.flags.some((f) => /past|passed/i.test(f))), it.filter((i) => i.fieldPath === "dates.applicationCloseDate").map((i) => i.flags));
    check("BTSC: research-only dates are flagged as research", datesFlaggedResearch(it));
    check("BTSC: 105 vacancies", has(it, "vacancies.total", 105), val(it, "vacancies.total"));
    const rows = val(it, "vacancies.breakdown")[0] as Array<{ post: string; count: number; breakdown?: Record<string, number> }> | undefined;
    const b = rows?.[0]?.breakdown ?? {};
    const pick = (re: RegExp) => Object.entries(b).find(([k]) => re.test(k))?.[1];
    check("BTSC: category split UR 41, EWS 11, SC 17, ST 2",
      b.ur === 41 && b.ews === 11 && b.sc === 17 && b.st === 2, b);
    check("BTSC: EBC 18, BC 12, Backward Class Women 4 kept under their own names",
      pick(/ebc|extremely/i) === 18 && pick(/^(?!.*(women|extremely|ebc)).*(\bbc\b|backward class)/i) === 12 && pick(/women/i) === 4, b);
    const bt = tableReport("BTSC", btsc);
    check("BTSC table: one row of 105 with the full split, from the quoted split",
      bt.t?.rows.length === 1 && bt.t.rows[0].total === 105 && bt.t.rows[0].cells.ur === 41 && bt.t.rows[0].cells.ews === 11 && bt.t.rows[0].cells.sc === 17 && bt.t.rows[0].cells.st === 2 && bt.n?.from === "split", bt.t?.rows);
    check("BTSC table: every figure is in the row's evidence lines", !!bt.t && bt.t.rows.every((r) => Object.values(r.cells).concat(r.total ?? []).every((f) => new RegExp(`\\b${f}\\b`).test(r.source.line))));
    check("BTSC: fee ₹100", has(it, "financial.feeGeneral", 100), val(it, "financial.feeGeneral"));
    check("BTSC: warned research only / no official notification", btsc.warnings.length > 0, btsc.warnings);
    check("BTSC: exam date 'To be announced' is not turned into a date", val(it, "dates.examDate").length === 0, val(it, "dates.examDate"));
    check("BTSC: the article's posting date (15 Oct) is not used as any date", !it.some((i) => i.fieldPath.startsWith("dates.") && i.value === "2026-10-15"));
    const officialLinks = it.filter((i) => i.fieldPath.startsWith("links#")).map((i) => i.value as { url: string; official?: boolean });
    note(`links: ${JSON.stringify(officialLinks)}`);
    check("BTSC: no portal (adda247) address offered as official", !officialLinks.some((l) => /adda247/i.test(l.url) && l.official));
  }

  // ── 2. LIC HFL: the official PDF, uploaded with an attestation ──
  const licPdf = file("lic.pdf");
  note(`LIC PDF text layer: ${((await extractPdfFromBuffer(licPdf)).text ?? "").length} characters`);
  const LIC_URL = "https://www.lichousing.com/static-assets/pdf/Apprentecis-Advertisement-Notification-Batch-10.pdf";
  const lic = await run("lic-pdf", { organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", recruitmentYear: 2026, title: "LIC HFL Apprentice Recruitment 2026", govType: "PSU" },
    [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: licPdf, url: LIC_URL, attestation: `Downloaded from ${LIC_URL} myself on 26 Oct 2026` }]);
  if (lic) {
    const it = lic.items;
    const lt = tableReport("LIC", lic);
    check("LIC table: 181 cities read by code, Ananthapur 1, total 232 complete", lt.t?.rows.length === 181 && lt.n?.from === "tables"
      && lt.t.rows.find((r) => r.at.city === "Ananthapur")?.total === 1 && lt.g?.value === 232 && lt.g.complete, [lt.t?.rows.length, lt.g]);
    check("LIC: applications open 20 Oct 2026", has(it, "dates.applicationOpenDate", "2026-10-20"), val(it, "dates.applicationOpenDate"));
    check("LIC: last date 1 Nov 2026", has(it, "dates.applicationCloseDate", "2026-11-01"), val(it, "dates.applicationCloseDate"));
    check("LIC: 232 apprentices", has(it, "vacancies.total", 232), val(it, "vacancies.total"));
    check("LIC: fee Rs.800 (General/OBC) and Rs.200 (SC/ST)", has(it, "financial.feeGeneral", 800) && has(it, "financial.feeSCST", 200), [val(it, "financial.feeGeneral"), val(it, "financial.feeSCST")]);
    const age = val(it, "age")[0] as { min?: number; max?: number } | undefined;
    check("LIC: age 20 to 25", age?.min === 20 && age?.max === 25, age);
    check("LIC: the NATS manual is not offered as the notification", !it.some((i) => i.fieldPath === "links#OFFICIAL_NOTIFICATION" && /manual/i.test(JSON.stringify(i.value))));
    check("LIC: entrance exam 7 Nov 2026 found (date or exam stage)", JSON.stringify(it).includes("2026-11-07"));
    check("LIC: an official document's values are not flagged as research", !it.some((i) => i.flags.some((f) => /research only/.test(f))));
  }

  // ── 3. The same notice as a scan (images only, no text layer) ──
  const scan = file("lic-scan.pdf");
  const reading = await readScannedNotice({ data: scan.toString("base64"), subject: "LIC HFL Apprentice Recruitment 2026 — LIC Housing Finance Limited", apiKey: KEY, feature: "import" });
  section("lic-scan: the AI writes the scan out as text");
  check("scan: read", reading.ok, reading.ok ? undefined : scrub(reading.reason));
  if (reading.ok) {
    writeFileSync(join(OUT, "lic-scan-text.txt"), reading.text);
    note(`${reading.text.length} characters read`);
    const sc = await run("lic-scan", { organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", recruitmentYear: 2026, title: "LIC HFL Apprentice Recruitment 2026 (scan)", govType: "PSU" },
      [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: scan, text: reading.text, url: LIC_URL, attestation: `Downloaded from ${LIC_URL} myself on 26 Oct 2026` }]);
    if (sc) {
      const age = val(sc.items, "age")[0] as { min?: number; max?: number } | undefined;
      const st = tableReport("scan", sc);
      // The AI writes the scan out; any table read from that write-up is checked against it, never assumed.
      if (st.t) check("scan table: every row's line is in the AI's write-up", st.t.rows.every((r) => reading.text.includes(r.source.line.split("\n").pop()!)));
      check("scan: age 20 to 25", age?.min === 20 && age?.max === 25, age);
      check("scan: 232 apprentices", has(sc.items, "vacancies.total", 232), val(sc.items, "vacancies.total"));
      check("scan: applications open 20 Oct 2026", has(sc.items, "dates.applicationOpenDate", "2026-10-20"), val(sc.items, "dates.applicationOpenDate"));
      check("scan: last date 1 Nov 2026", has(sc.items, "dates.applicationCloseDate", "2026-11-01"), val(sc.items, "dates.applicationCloseDate"));
      check("scan: fee Rs.800 and Rs.200", has(sc.items, "financial.feeGeneral", 800) && has(sc.items, "financial.feeSCST", 200), [val(sc.items, "financial.feeGeneral"), val(sc.items, "financial.feeSCST")]);
    }
  }

  // ── 4. A screenshot of the article's dates table ──
  const png = file("source-btsc-dates-screenshot.png");
  const shot = await run("btsc-screenshot", { organizationId: "btsc", organizationName: "Bihar Technical Service Commission", recruitmentYear: 2026, title: "BTSC FSO 2026 (screenshot)", govType: "State Govt" },
    [{ declaredKind: "RESEARCH", method: "upload", bytes: png }]);
  if (shot) {
    const imgText = (shot.sources[0]?.summary as string | undefined) ?? "";
    note(`image summary: ${short(imgText, 200)}`);
    check("screenshot: open 25 Sep and last date 24 Oct 2026", has(shot.items, "dates.applicationOpenDate", "2026-09-25") && has(shot.items, "dates.applicationCloseDate", "2026-10-24"),
      [val(shot.items, "dates.applicationOpenDate"), val(shot.items, "dates.applicationCloseDate")]);
    check("screenshot: research only, so its dates are flagged as research", datesFlaggedResearch(shot.items));
  }

  // ── 5. IBPS CRP RRBs-XV: a long official notice with category tables, stages and pattern ──
  const ibpsPdf = file("ibps-crp-rrb-xv.pdf");
  note(`IBPS PDF text layer: ${((await extractPdfFromBuffer(ibpsPdf)).text ?? "").length} characters`);
  const IBPS_URL = "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf";
  const ibps = await run("ibps-pdf", { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, title: "IBPS RRB CRP-XV 2026", govType: "PSU" },
    [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: ibpsPdf, url: IBPS_URL, attestation: `Downloaded from ${IBPS_URL} myself on 26 Oct 2026` }]);
  if (ibps) {
    const paths = new Set(ibps.items.map((i) => i.fieldPath));
    note(`sections found: ${[...paths].sort().join(", ")}`);
    check("IBPS: exam stages found", paths.has("examStages"));
    check("IBPS: exam pattern found", paths.has("examPattern"));
    // The vacancies are bank by bank in Annexure I, past the first 60,000 characters.
    const vac = val(ibps.items, "vacancies.breakdown")[0] as Array<{ post: string; count: number; breakdown?: Record<string, number> }> | undefined;
    note(`IBPS vacancy rows: ${JSON.stringify(vac ?? null).slice(0, 400)}`);
    // Since B1 the annexure is read by code into the vacancy table (checked below); the AI's own breakdown is for reference only.
    check("IBPS: vacancies from the annexure found (the table, or the AI's breakdown)", (Array.isArray(vac) && vac.length > 0) || ibps.items.some((i) => i.fieldPath === "vacancies.table"), vac);
    // Stage B2.2: the long notice is read in page batches; every page with text is read.
    const rd = (ibps.sources[0]?.reading ?? null) as { mode: string; pages: number; batches: Array<{ first: number; last: number; status: string; reason?: string; values: number }>; noTextPages: number[] } | null;
    note(`IBPS reading: ${rd ? `${rd.mode}, ${rd.batches.map((b) => `${b.first}-${b.last}:${b.status}${b.status === "read" ? `(${b.values})` : ` ${b.reason}`}`).join(" ")}; no text: ${rd.noTextPages.join(",") || "none"}` : "none"}`);
    check("IBPS: read in page batches, every batch read", rd?.mode === "batches" && rd.batches.length > 1 && rd.batches.every((b) => b.status === "read"), rd?.batches);
    const it2 = tableReport("IBPS", ibps);
    check("IBPS table: 10 tables on pages 46-55 read by code, 280 rows, at least 13,706 (Tripura not reported)",
      it2.n?.from === "tables" && it2.n.coverage?.tables.length === 10 && it2.n.coverage.tables.every((x) => x.read && x.columnsBy === "CODE")
      && it2.t?.rows.length === 280 && it2.g?.value === 13706 && it2.g.complete === false, [it2.t?.rows.length, it2.g]);
    check("IBPS table: General is UR, PwBD counted within", !!it2.t && it2.t.categories.some((c) => c.key === "ur") && it2.t.categories.filter((c) => c.key.startsWith("pwbd")).every((c) => c.kind === "HORIZONTAL"));
    check("IBPS: dates 1 to 21 Sep 2026 and fees 850 / 175", has(ibps.items, "dates.applicationOpenDate", "2026-09-01") && has(ibps.items, "dates.applicationCloseDate", "2026-09-21")
      && has(ibps.items, "financial.feeGeneral", 850) && has(ibps.items, "financial.feeSCST", 175));
  }

  writeFileSync(join(OUT, "all.json"), scrub(JSON.stringify(results, null, 2)));
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", scrub(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
