// ═══════════════════════════════════════════════════════════
// G1 + G2 on the in-memory test database: the listing-page Grab against the
// CMS's own jobs, a preview holding only vacancy figures saved as a draft,
// and checks started from stored or found official evidence, through the
// real import, decisions, field and publish routes. Stand-in fetches; no AI;
// no network; no Telegram.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/g1g2-grab-verify.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";
import { makePdf } from "./pdf-fixture";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; defaultTicked: boolean; value: unknown };

const S = { A: "A: the Grab against the CMS's jobs", B: "B: held vacancy figures alone", C: "C: checks from official evidence", D: "D: publishing and the public page" };
expectChecks(S.A, [
  "A1 a listing link with the notice number of a CMS job of the same organisation: already in the CMS (duplicate), named with why",
  "A2 the collector matches the same lead to the same job, for the same reason",
  "A3 an eligibility exam on the same page is kept, marked, and matched to no job",
]);
expectChecks(S.B, [
  "B1 a preview whose only reading is a held vacancy table: nothing to tick, the held table counted by the server",
  "B2 saved with nothing ticked: the job is created and keeps its source and the held figures for its vacancy editor",
  "B3 nothing ticked and nothing held: still refused (Tick at least one item)",
  "B4 the held figures were not added or verified by the save",
]);
expectChecks(S.C, [
  "C1 a code-read date: no stored words, so nothing prefilled; its line in the official PDF suggested with its page",
  "C2 the suggested line confirmed through the decisions route: VERIFIED",
  "C3 the research paste offered as the document: refused",
  "C4 words not in the document: refused",
  "C5 a PDF decision without its page: refused",
  "C6 a stored official passage (the notification number's line) is prefilled, and confirming exactly it is accepted",
  "C7 the field changed afterwards: its check no longer stands, the passage now states another value and is not prefilled",
]);
expectChecks(S.D, [
  "D1 without the owner's approval publishing is refused, and the review warns the key details are not confirmed",
  "D2 with every key detail decided: published; the snapshot carries the day of the checks, not a build time",
  "D3 the public page data: key details checked on that day, the official notice link as its standing, no Apply Online from a website",
]);

(async () => {
  const { pg, adminId, token } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { discoverFromPage } = await import("@/lib/cms/importer/discover");
  const { cmsJobs } = await import("@/lib/cms/discovery/collector");
  const { matchLead } = await import("@/lib/cms/discovery/match");
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const decisions = await import("@/app/api/admin/cms/records/[id]/decisions/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  await setImporterEnabled(true);
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;

  const PDF_URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-G2.pdf";
  const PDF = makePdf([
    "Institute of Banking Personnel Selection\nCommon Recruitment Process TEST G2\nAdvertisement No. CRP-G2/2099-27\nOnline registration: 01.07.2099 to 21.07.2099",
    "Application Fee: Rs. 850 for General candidates",
  ]);
  const fetchSourceFn = async (url: string) => url === PDF_URL
    ? { ok: true as const, finalUrl: url, contentType: "application/pdf", bytes: PDF }
    : { ok: false as const, error: "blocked (403)" };
  const preview = (args: J, sources: J[]) => service.previewImport({ adminId, apiKey: undefined, fetchSourceFn, ...args, sources } as never);
  const items = (p: { proposal: unknown }) => (p.proposal as { items: Item[] }).items;
  const apply = async (p: { importId: string }, selected: string[]) => service.applyImportFlow({ importId: p.importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const ibpsJob = (year: number, title: string) => ({ mode: "NEW", newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title, govType: "PSU" } });
  const checks = async (id: string) => service.checksFor((await getRecruitmentById(id))!);
  const decide = async (id: string, body: J) => {
    const r = await decisions.POST(req(`/api/admin/cms/records/${id}/decisions`, "POST", { action: "decide", ...body }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const rowOf = async (id: string, path: string) => (await checks(id)).rows.find((r) => r.fieldPath === path)!;
  const seen = (r: { latestRevisionId: string | null; decisionId?: string }) => ({ revisionId: r.latestRevisionId, decisionId: r.decisionId ?? null });

  // ── A ──
  section(S.A);
  const cgl = await preview({ mode: "NEW", newJob: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2096, title: "SSC Combined Graduate Level Examination 2096", govType: "Central Govt" } },
    [{ declaredKind: "RESEARCH", method: "paste", text: "SSC CGL 2096 summary from a coaching site, for the G1 test of the listing-page Grab.\nAdvt No. 05/2096\nLast date to apply: 30.11.2096" }]);
  const cglNumber = items(cgl).find((i) => i.fieldPath === "identity.notificationNumber");
  const cglId = String((await apply(cgl, items(cgl).filter((i) => i.defaultTicked || i === cglNumber).map((i) => i.id))).recruitmentId);
  const listing = `<ul><li><a href="https://portal.example/ssc-cgl-2096/">SSC CGL 2096 Online Form (Advt No. 05/2096)</a></li>
    <li><a href="https://portal.example/ugc-net-2096/">UGC NET December 2096 Notification Out, Apply Online</a></li></ul>`;
  const jobs = await cmsJobs();
  const g = await discoverFromPage({ url: "https://portal.example/latest/", jobs, fetchSourceFn: async (u) => u.endsWith("robots.txt") ? { ok: false as const, error: "none" } : { ok: true as const, finalUrl: "https://portal.example/latest/", contentType: "text/html", bytes: Buffer.from(listing) } });
  const found = g.ok ? g.found : [];
  const lead = found.find((f) => f.url.includes("ssc-cgl"));
  check("A1 a listing link with the notice number of a CMS job of the same organisation: already in the CMS (duplicate), named with why",
    !!lead && lead.match === "DUPLICATE" && lead.maybe[0]?.id === cglId && /same notice number/.test(lead.matchReason ?? ""), { lead, numberOnJob: jobs.find((j) => j.id === cglId) });
  const viaCollector = matchLead({ organizationId: "ssc", organizationName: "Staff Selection Commission", title: lead?.title ?? "", notificationNumber: lead?.notificationNumber ?? null }, jobs);
  check("A2 the collector matches the same lead to the same job, for the same reason", viaCollector.kind === lead?.match && viaCollector.recruitmentId === cglId && viaCollector.reason === lead?.matchReason, viaCollector);
  const net = found.find((f) => f.url.includes("ugc-net"));
  check("A3 an eligibility exam on the same page is kept, marked, and matched to no job", !!net && net.eligibilityExam === true && net.kind === "NEW" && net.maybe.length === 0, net);

  // ── B ──
  section(S.B);
  const HELD_ONLY = "Vacancy position of the participating banks (G1 test notice)\nName of Post Name of the Bank UR SC Total\nClerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3\nOfficer Delta Gramin Bank 1 1 2\n\n-- 1 of 1 --\n";
  const hp = await preview(ibpsJob(2097, "TEST RECORD G1 held only"), [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: HELD_ONLY, attestation: "Copied from the notice (G1 test)" }]);
  const heldCount = (hp.proposal as { meta: { heldTables?: number } }).meta.heldTables ?? 0;
  check("B1 a preview whose only reading is a held vacancy table: nothing to tick, the held table counted by the server",
    items(hp).filter((i) => i.defaultTicked).length === 0 && heldCount >= 1, { items: items(hp).map((i) => [i.fieldPath, i.defaultTicked]), heldCount });
  let heldJob: string | null = null;
  try { heldJob = String((await apply(hp, [])).recruitmentId); } catch (e) { console.log("B2", e); }
  const heldList = heldJob ? await service.heldTablesForJob((await getRecruitmentById(heldJob))!) : [];
  const heldSources = heldJob ? (await pg.query("SELECT count(*)::int AS n FROM recruitment_source_retrievals r JOIN recruitment_imports i ON i.import_id = r.import_id WHERE i.recruitment_id = $1", [heldJob])).rows[0].n : 0;
  check("B2 saved with nothing ticked: the job is created and keeps its source and the held figures for its vacancy editor",
    !!heldJob && heldList.length >= 1 && heldList.every((h) => h.status === "NOT_ADDED") && heldSources === 1, { heldJob, held: heldList.map((h) => [h.kind, h.status]), heldSources });
  const empty = await preview(ibpsJob(2098, "TEST RECORD G1 nothing"), [{ declaredKind: "RESEARCH", method: "paste", text: "A short note from a coaching site about a bank exam, with nothing dated or counted in it at all. It only says that candidates should read the notice." }]);
  let refusedEmpty = "";
  try { await apply(empty, []); } catch (e) { refusedEmpty = String((e as Error).message); }
  check("B3 nothing ticked and nothing held: still refused (Tick at least one item)", /Tick at least one item/.test(refusedEmpty), refusedEmpty);
  const heldRec = heldJob ? await getRecruitmentById(heldJob) : null;
  const heldChecks = heldJob ? await checks(heldJob) : null;
  check("B4 the held figures were not added or verified by the save",
    !!heldRec && !heldRec.vacancies.table?.value && !heldChecks!.rows.some((r) => r.cls === "VERIFIED"), heldRec?.vacancies);

  // ── C ──
  section(S.C);
  const vp = await preview(ibpsJob(2099, "TEST RECORD IBPS G2"), [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: PDF_URL },
    { declaredKind: "RESEARCH", method: "paste", text: "IBPS CRP TEST G2 from a coaching site, summarised for candidates; check the official notice.\nOnline registration from 01.07.2099\nLast date to apply: 25.07.2099" }]);
  const number = items(vp).find((i) => i.fieldPath === "identity.notificationNumber");
  const job = String((await apply(vp, items(vp).filter((i) => i.defaultTicked || i === number).map((i) => i.id))).recruitmentId);
  const c0 = await checks(job);
  const pdfDoc = c0.retrievals.find((r) => r.contentKind === "PDF")!, researchDoc = c0.retrievals.find((r) => r.declaredKind === "RESEARCH")!;
  let open = c0.rows.find((r) => r.fieldPath === "dates.applicationOpenDate")!;
  const sug = open.evidence.suggestions[0];
  check("C1 a code-read date: no stored words, so nothing prefilled; its line in the official PDF suggested with its page",
    open.value === "2099-07-01" && open.evidence.prefill === null && !!sug && sug.retrievalId === pdfDoc.id && sug.page === 1 && sug.quote === "Online registration: 01.07.2099 to 21.07.2099"
    && open.evidence.suggestions.every((s) => s.retrievalId !== researchDoc.id), open.evidence);
  const research = await decide(job, { fieldPath: "dates.applicationOpenDate", kind: "ADMIN_VERIFIED", retrievalId: researchDoc.id, page: null, quote: "Online registration from 01.07.2099", seen: seen(open) });
  check("C3 the research paste offered as the document: refused", research.status >= 400 && research.status < 500, research);
  const wrong = await decide(job, { fieldPath: "dates.applicationOpenDate", kind: "ADMIN_VERIFIED", retrievalId: pdfDoc.id, page: 1, quote: "Online registration: 02.07.2099", seen: seen(open) });
  check("C4 words not in the document: refused", wrong.status >= 400 && /not in the document/.test(String(wrong.data.error)), wrong);
  const noPage = await decide(job, { fieldPath: "dates.applicationOpenDate", kind: "ADMIN_VERIFIED", retrievalId: pdfDoc.id, page: null, quote: sug?.quote, seen: seen(open) });
  check("C5 a PDF decision without its page: refused", noPage.status >= 400, noPage);
  const ok = await decide(job, { fieldPath: "dates.applicationOpenDate", kind: "ADMIN_VERIFIED", retrievalId: sug?.retrievalId, page: sug?.page, quote: sug?.quote, seen: seen(open) });
  open = await rowOf(job, "dates.applicationOpenDate");
  check("C2 the suggested line confirmed through the decisions route: VERIFIED", ok.status === 201 && open.cls === "VERIFIED", [ok, open.cls]);

  // The notice number's line is kept with it by the code reader: a stored passage (identity fields are not on the
  // publish gate, so the check list does not list it; its evidence is read the same way).
  const { fieldStates } = await import("@/lib/cms/importer/repository");
  const { fieldEvidence } = await import("@/lib/cms/importer/field-evidence");
  const docs = c0.retrievals.map((r) => ({ ...r, name: r.originHost ?? "pasted" }));
  const texts = new Map((await pg.query("SELECT r.id, s.text FROM recruitment_source_retrievals r JOIN recruitment_sources s ON s.id = r.source_id")).rows.map((r) => [String(r.id), String(r.text)]));
  const nnState = async () => (await fieldStates((await getRecruitmentById(job))!, ["identity.notificationNumber"]))[0];
  const nnEv = fieldEvidence(await nnState(), "general", docs, texts);
  const nnDecide = nnEv.prefill ? await decide(job, { fieldPath: "identity.notificationNumber", kind: "ADMIN_VERIFIED", retrievalId: nnEv.prefill.retrievalId, page: nnEv.prefill.page, quote: nnEv.prefill.quote, seen: { revisionId: (await nnState()).latestRevisionId, decisionId: null } }) : null;
  check("C6 a stored official passage (the notification number's line) is prefilled, and confirming exactly it is accepted",
    !!nnEv.prefill && nnEv.prefill.retrievalId === pdfDoc.id && nnEv.prefill.page === 1 && nnEv.prefill.quote.includes("CRP-G2/2099-27") && nnDecide?.status === 201, { prefill: nnEv.prefill, items: nnEv.items, nnDecide });
  const changed = await fields.PATCH(req(`/api/admin/cms/records/${job}/fields`, "PATCH", { fieldPath: "identity.notificationNumber",
    field: { value: "CRP-G2/2099-28", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(job), reason: "G2 test: corrected" }), ctx(job));
  const after = await nnState();
  const afterEv = fieldEvidence(after, "general", docs, texts);
  const { classifyField } = await import("@/lib/cms/importer/classify");
  check("C7 the field changed afterwards: its check no longer stands, the passage now states another value and is not prefilled",
    changed.status === 200 && classifyField(after, null).cls !== "VERIFIED" && afterEv.prefill === null && afterEv.items.every((i) => !i.matchesCurrent), [changed.status, classifyField(after, null).cls, afterEv.items.map((i) => i.matchesCurrent)]);

  // ── D ──
  section(S.D);
  const tryPublish = async () => { const r = await publish.POST(req(`/api/admin/cms/records/${job}/publish`, "POST", await approved(job, { approveFirst: true, announce: false })), ctx(job)); return { status: r.status, data: (await r.json()) as J }; };
  // Owner-controlled publication (Stage 1): unchecked key details no longer block by themselves; they are warnings
  // in the owner's review, and nothing is published without the owner's explicit approval.
  const noApproval = await publish.POST(req(`/api/admin/cms/records/${job}/publish`, "POST", { approveFirst: true, announce: false }), ctx(job));
  const refused = { status: noApproval.status, data: (await noApproval.json()) as J };
  const warned = ((refused.data.review as { warnings?: Array<{ code: string }> } | undefined)?.warnings ?? []).map((w) => w.code);
  check("D1 without the owner's approval publishing is refused, and the review warns the key details are not confirmed",
    refused.status === 422 && refused.data.code === "OWNER_REVIEW_REQUIRED" && warned.includes("NOT_CONFIRMED"), refused);
  // Every remaining key detail decided against the official PDF, the way a person would.
  for (const r of (await checks(job)).rows) {
    if (r.cls === "VERIFIED" || r.cls === "NOT_APPLICABLE" || (r.cls === "NOT_STATED" && r.tier === "B")) continue;
    const s = r.evidence.prefill ?? r.evidence.suggestions[0];
    let d;
    if (r.fieldPath === "links#OFFICIAL_NOTIFICATION") d = await decide(job, { fieldPath: r.fieldPath, kind: "ADMIN_VERIFIED", retrievalId: pdfDoc.id, page: 1, quote: "Common Recruitment Process TEST G2", seen: seen(r) });
    else if (s && r.value !== null) d = await decide(job, { fieldPath: r.fieldPath, kind: "ADMIN_VERIFIED", retrievalId: s.retrievalId, page: s.page, quote: s.quote, seen: seen(r) });
    else if (r.tier === "B") d = await decide(job, { fieldPath: r.fieldPath, kind: "ADMIN_NOT_STATED", retrievalId: pdfDoc.id, page: null, quote: null, reviewScope: { whole_document: true }, justification: "Read the whole notice (G2 test)", seen: seen(r) });
    else d = await decide(job, { fieldPath: r.fieldPath, kind: "ADMIN_NOT_APPLICABLE", retrievalId: pdfDoc.id, page: 1, quote: "Common Recruitment Process TEST G2", justification: "Not part of this test notice", seen: seen(r) });
    if (d.status !== 201) console.log("D decide", r.fieldPath, r.cls, d);
  }
  const published = await tryPublish();
  const snap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1", [job])).rows[0]?.snapshot as J | undefined;
  const today = new Date().toISOString().slice(0, 10);
  check("D2 with every key detail decided: published; the snapshot carries the day of the checks, not a build time",
    published.status === 200 && snap?.keyDetailsChecked === true && snap?.keyDetailsCheckedOn === today && typeof snap?.projectedAt === "string" && (snap.projectedAt as string).length > 10,
    [published.status, published.data.error ?? "", snap && { keyDetailsChecked: snap.keyDetailsChecked, keyDetailsCheckedOn: snap.keyDetailsCheckedOn, projectedAt: snap.projectedAt }]);
  const pub = snap ? snapshotToGovernmentRecruitment(snap as never) : null;
  check("D3 the public page data: key details checked on that day, the official notice link as its standing, no Apply Online from a website",
    !!pub && pub.provenance.lastVerifiedAt === today && pub.provenance.keyDetailsChecked === true && pub.provenance.primarySourceType === "OFFICIAL_NOTIFICATION"
    && pub.provenance.pageUpdatedAt === snap!.projectedAt && pub.links.apply === "", pub?.provenance);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
