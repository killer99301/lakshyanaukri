// ═══════════════════════════════════════════════════════════
// End-to-end safety corrections (8 Nov 2026), on the local test database
// ═══════════════════════════════════════════════════════════
//
//   A. A quote cited against page N of a PDF is checked on page N: the words of page 2 cited with page 1 are
//      refused (and nothing is recorded); with page 2 accepted; a page the PDF does not have, or no page, refused.
//   B. Web text keeps its page-free rule: an attested pasted notice is checked with no page.
//   C. An empty upload row is named by its number; the documents brought in are listed with their names
//      (the editor's Sources section reads them).
//
// No AI, no network, nothing published.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/safety-corrections.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";

type J = Record<string, unknown>;
const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-SAFETY-notification.pdf";
const FEE = "Application Fee: Rs. 175 for SC/ST/PwBD candidates";
const CLOSE = "Last date for online registration: 21.12.2099";
const PDF = makePdf([
  "Institute of Banking Personnel Selection\nCommon Recruitment Process TEST SAFETY\nImportant dates are given on the next page",
  `Important dates\n${CLOSE}\n${FEE}`,
]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const previewRoute = await import("@/app/api/admin/cms/import/preview/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const decisions = async () => (await pg.query("SELECT count(*)::int AS n FROM recruitment_field_claims WHERE kind IN ('ADMIN_VERIFIED','ADMIN_NOT_APPLICABLE','ADMIN_NOT_STATED')")).rows[0].n as number;
  const importNew = async (title: string, year: number, sources: unknown[]) => {
    const p = await service.previewImport({ adminId, mode: "NEW", apiKey: undefined, sources,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title, govType: "PSU" } } as never);
    const ticked = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: ticked, confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const setClose = async (id: string) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath: "dates.applicationCloseDate",
      field: { value: "2099-12-21", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "safety test" }), { params: Promise.resolve({ id }) });
    return r.status;
  };
  const tryVerify = async (id: string, page: number | null, quote: string) => {
    const c = await service.checksFor((await getRecruitmentById(id))!);
    const row = c.rows.find((r) => r.fieldPath === "dates.applicationCloseDate")!;
    try {
      await service.decide({ recruitmentId: id, adminId, fieldPath: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", retrievalId: c.retrievals[0].id, page, quote,
        tableCell: null, reviewScope: null, justification: null, publicNote: null, seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null } });
      return "accepted";
    } catch (e) { return `refused: ${(e as Error).message}`; }
  };

  // ── A ──
  section("A. a PDF quote is checked on the page it cites");
  const pdfJob = await importNew("TEST RECORD IBPS SAFETY PDF", 2099, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} on 8 Nov 2026 (test)` }]);
  check("A0 the PDF imported and the last date set", (await setClose(pdfJob)) === 200);
  const before = await decisions();
  const wrong = await tryVerify(pdfJob, 1, CLOSE);
  check("A1 the words of page 2 cited with page 1: refused, saying they are on page 2; nothing recorded",
    /on page 2 of this PDF, not page 1/.test(wrong) && (await decisions()) === before, wrong);
  const noSuch = await tryVerify(pdfJob, 7, CLOSE);
  check("A2 a page the PDF does not have: refused", /has no page 7/.test(noSuch) && (await decisions()) === before, noSuch);
  const noPage = await tryVerify(pdfJob, null, CLOSE);
  check("A3 no page for a PDF: refused with a clear reason", /Give the page of the PDF/.test(noPage) && (await decisions()) === before, noPage);
  const notThere = await tryVerify(pdfJob, 2, "Last date for online registration: 22.12.2099");
  check("A4 words not in the document: refused as before", /not in the document/.test(notThere), notThere);
  const right = await tryVerify(pdfJob, 2, CLOSE);
  const c = await service.checksFor((await getRecruitmentById(pdfJob))!);
  check("A5 the same words with page 2: accepted, and the field is verified", right === "accepted" && c.rows.find((r) => r.fieldPath === "dates.applicationCloseDate")?.cls === "VERIFIED", right);
  const claim = (await pg.query("SELECT page, quote FROM recruitment_field_claims WHERE kind = 'ADMIN_VERIFIED' AND recruitment_id = $1", [pdfJob])).rows[0];
  check("A6 the decision keeps page 2 and the quote", claim?.page === 2 && claim?.quote === CLOSE, claim);

  // ── B ──
  section("B. web text: no pages, unchanged");
  const webJob = await importNew("TEST RECORD IBPS SAFETY TEXT", 2098, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", url: "https://www.ibps.in/safety-test-notice.pdf",
    attestation: "Copied from the notice (safety test)", text: `Institute of Banking Personnel Selection\nCommon Recruitment Process TEST SAFETY TEXT\n${CLOSE}` }]);
  check("B0 the pasted notice imported and the last date set", (await setClose(webJob)) === 200);
  const web = await tryVerify(webJob, null, CLOSE);
  check("B1 the words cited with no page: accepted", web === "accepted", web);

  // ── C ──
  section("C. empty sources and the documents kept");
  const form = new FormData();
  form.set("mode", "NEW");
  form.set("newJob", JSON.stringify({ organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2097, title: "TEST RECORD SAFETY EMPTY", govType: "PSU" }));
  form.set("sources", JSON.stringify([
    { declaredKind: "RESEARCH", method: "paste", text: "A research note about the test recruitment, long enough to be read." },
    { declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", file: "file1" },
  ]));
  const r = await previewRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/preview`, { method: "POST", headers: { origin: ORIGIN, cookie: `admin_sid=${token}` }, body: form }));
  const d = (await r.json()) as J;
  check("C1 an upload sent without its file: refused, naming source 2", r.status === 400 && /^Source 2: its file is missing/.test(String(d.error)), d);
  const docs = c.retrievals as Array<{ name?: string; declaredKind: string; authenticity: string; originUrl: string | null }>;
  check("C2 the job's documents are listed with their names, kinds and standing (what the Sources section shows)",
    docs.length === 1 && /ibps\.in — notification, PDF \(CRP-TEST-SAFETY-notification\.pdf\)/.test(docs[0].name ?? "") && docs[0].declaredKind === "OFFICIAL_NOTIFICATION" && docs[0].authenticity === "ATTESTED",
    docs);
  let badGov = "";
  try {
    await service.previewImport({ adminId, mode: "NEW", apiKey: undefined, sources: [{ declaredKind: "RESEARCH", method: "paste", text: "A research note." }],
      newJob: { organizationId: "ibps", organizationName: "IBPS", recruitmentYear: 2096, title: "TEST RECORD SAFETY GOV", govType: "" } } as never);
    badGov = "accepted";
  } catch (e) { badGov = (e as Error).message; }
  check("C3 a new job without a government type: refused", /Choose the government type/.test(badGov), badGov);
  const published = (await pg.query("SELECT count(*)::int AS n FROM published_recruitments")).rows[0].n;
  check("C4 nothing published", published === 0, published);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
