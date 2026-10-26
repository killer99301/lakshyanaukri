// ═══════════════════════════════════════════════════════════
// The importer end to end, through the real service, routes and database
// functions, against the in-memory test database. The AI is replaced by
// canned answers that quote the source; addresses are "fetched" by a stub.
// Never touches production or the internet.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-flow.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";

type J = Record<string, unknown>;

const NOTICE = makePdf([
  "LICHFL Apprenticeship Program-010 Advertisement Notification\nNumber of Apprentices required by LIC Housing Finance Ltd: 232\nAge as on 01-Oct-2026: 20 to 25 years\nEducational Qualification: graduation in any stream",
  "Application fee\nGeneral, EWS and OBC Male candidates Rs.800/- plus GST\nSC/ST candidates Rs.200/- plus GST\nRegister on the NATS portal https://nats.education.gov.in/",
  "Important dates\nOnline applications open on 20.10.2026\nLast date to apply online: 01.11.2026\nEntrance Examination on 07.11.2026",
]);
const CORRIGENDUM = makePdf(["Corrigendum 1 to LICHFL Apprenticeship Program-010\nThe last date to apply online is extended to 08.11.2026\nAll other terms remain unchanged."]);
const RESEARCH = `ChatGPT research notes on LIC HFL Apprentice Recruitment 2026 (Program-010).
LIC Housing Finance invites 232 apprentices. Last date to apply online: 03.11.2026 according to some portals.
Official source: https://bfsissc.com/blog2/post.php?slug=lic-hfl-apprenticeship-2026&utm_source=chatgpt.com
Syllabus topics: Banking Awareness, Puzzles, Reading Comprehension. This research is not the official notice and may contain mistakes.`;

/** Canned AI: answers each of the three extraction prompts from facts present in the prompt's own text. */
function fakeGemini(prompt: string): J {
  const sections = prompt.split(/^## Section: /m).slice(1).map((s) => ({ heading: s.split("\n")[0], text: s }));
  const at = (quote: string) => sections.find((s) => s.text.includes(quote))?.heading;
  const field = (value: unknown, evidence: string) => (at(evidence) ? { value, evidence, sectionHeading: at(evidence) } : undefined);
  if (prompt.includes('"applicationFeeGeneral"')) {
    const out: J = {};
    const put = (k: string, v: J | undefined) => { if (v) out[k] = v; };
    put("applicationFeeGeneral", field(800, "General, EWS and OBC Male candidates Rs.800/- plus GST"));
    put("applicationFeeSCST", field(200, "SC/ST candidates Rs.200/- plus GST"));
    put("applicationOpenDate", field("2026-10-20", "Online applications open on 20.10.2026"));
    put("applicationCloseDate", field("2026-11-01", "Last date to apply online: 01.11.2026")
      ?? field("2026-11-08", "The last date to apply online is extended to 08.11.2026")
      ?? field("2026-11-03", "Last date to apply online: 03.11.2026"));
    return out;
  }
  if (prompt.includes('"howToApply"')) {
    if (!prompt.includes("Age as on 01-Oct-2026")) return {};
    return {
      age: { min: 20, max: 25, asOf: "2026-10-01", evidence: "Age as on 01-Oct-2026: 20 to 25 years", relaxations: [] },
      eligibility: [{ post: "Apprentice", qualification: "Graduation in any stream", evidence: "Educational Qualification: graduation in any stream" }],
    };
  }
  return {};
}

(async () => {
  const { pg, token, adminId } = await boot();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = body.contents?.[0]?.parts?.map((p: { text?: string }) => p.text ?? "").join("\n") ?? "";
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fakeGemini(prompt)) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const files: Record<string, Buffer> = { "https://cdn.lichousing.com/2026/10/notice.pdf": NOTICE, "https://cdn.lichousing.com/2026/10/corrigendum-1.pdf": CORRIGENDUM };
  const fetchSourceFn = async (url: string) => files[url]
    ? { ok: true as const, finalUrl: url, contentType: "application/pdf", bytes: files[url] }
    : { ok: false as const, error: "not found" };

  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const previewRoute = await import("@/app/api/admin/cms/import/preview/route");
  const applyRoute = await import("@/app/api/admin/cms/import/[importId]/apply/route");
  const decisionsRoute = await import("@/app/api/admin/cms/records/[id]/decisions/route");
  const checksRoute = await import("@/app/api/admin/cms/records/[id]/checks/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const records = await import("@/app/api/admin/cms/records/route");

  const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = <T extends string>(key: T, v: string) => ({ params: Promise.resolve({ [key]: v } as Record<T, string>) });
  const count = async (sqlText: string, params: unknown[] = []) => Number((await pg.query(sqlText, params)).rows[0].n);

  section("The switch: off by default, enforced on the server");
  const form = new FormData();
  form.set("mode", "NEW");
  form.set("sources", JSON.stringify([{ declaredKind: "RESEARCH", method: "paste", text: RESEARCH }]));
  let r = await previewRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/preview`, { method: "POST", headers: { origin: ORIGIN, cookie: `admin_sid=${token}` }, body: form }));
  check("preview while switched off → 404", r.status === 404);
  r = await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true }));
  check("switching on without confirm → 400", r.status === 400);
  r = await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }, { origin: "https://evil.example" }));
  check("switching on from another site → 403", r.status === 403);
  r = await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  check("switching on → on, and audited", r.status === 200 && (await r.json()).on === true && await count("SELECT count(*)::int AS n FROM admin_audit_log WHERE event_type = 'IMPORTER_SWITCHED_ON'") === 1);
  r = await previewRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/preview`, { method: "POST", headers: { origin: ORIGIN }, body: new FormData() }));
  check("preview without a session → 401", r.status === 401);

  section("Preview: an official PDF fetched by the server, plus ChatGPT research");
  const newJob = { organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", recruitmentYear: 2026, title: "LIC HFL Apprentice Recruitment 2026", govType: "PSU" as const };
  const preview = await service.previewImport({
    adminId, mode: "NEW", newJob, apiKey: process.env.GEMINI_API_KEY, fetchSourceFn,
    sources: [
      { declaredKind: "OFFICIAL_NOTIFICATION", method: "url", url: "https://cdn.lichousing.com/2026/10/notice.pdf", versionLabel: "Notification" },
      { declaredKind: "RESEARCH", method: "paste", text: RESEARCH },
    ],
  });
  const items = preview.proposal.items;
  const item = (f: string, v?: unknown) => items.find((i) => i.fieldPath === f && (v === undefined || JSON.stringify(i.value) === JSON.stringify(v)));
  check("nothing changed on any job yet", await count("SELECT count(*)::int AS n FROM recruitments WHERE organization_id = 'lic-hfl'") === 0);
  const fee = item("financial.feeGeneral");
  check("fee 800 proposed, ticked, quoted on page 2 of the PDF", fee?.value === 800 && fee.defaultTicked && fee.claims[0].page === 2, fee);
  const closePdf = item("dates.applicationCloseDate", "2026-11-01");
  const closeRes = item("dates.applicationCloseDate", "2026-11-03");
  check("last date: PDF 1 Nov vs research 3 Nov → a conflict, neither ticked", !!closePdf && !!closeRes && closePdf.conflict && closeRes.conflict && !closePdf.defaultTicked && !closeRes.defaultTicked, items.filter((i) => i.fieldPath === "dates.applicationCloseDate"));
  check("…the research value is flagged as research only", closeRes?.flags.some((f) => /research only/.test(f)) === true, closeRes?.flags);
  check("age and eligibility proposed from the PDF, ticked", item("age")?.defaultTicked === true && item("eligibility")?.defaultTicked === true);
  const nats = items.find((i) => i.kind === "LINK" && (i.value as J).url === "https://nats.education.gov.in/");
  check("NATS link from the PDF: official (listed partner), ticked", (nats?.value as J)?.official === true && nats?.defaultTicked === true, nats);
  const blog = items.find((i) => i.kind === "LINK" && String((i.value as J).url).includes("bfsissc.com/blog2"));
  check("ChatGPT's blog link: tracking removed, flagged, not ticked", !!blog && !String((blog.value as J).url).includes("utm_") && !blog.defaultTicked && blog.flags.some((f) => /blog/.test(f)), blog);
  const sources = (preview.proposal as unknown as { meta: { sources: Array<J> } }).meta.sources;
  check("the PDF is CONFIRMED (fetched by the server) from an AUTHORITY host; the research is NOT_APPLICABLE",
    sources.some((s) => s.authenticity === "CONFIRMED" && s.originRole === "AUTHORITY") && sources.some((s) => s.authenticity === "NOT_APPLICABLE" && s.declaredKind === "RESEARCH"), sources);
  check("stored: one import, two documents, two retrievals", await count("SELECT count(*)::int AS n FROM recruitment_imports") === 1
    && await count("SELECT count(*)::int AS n FROM recruitment_sources") === 2 && await count("SELECT count(*)::int AS n FROM recruitment_source_retrievals") === 2);

  section("Apply: only ticked ids, values from the stored preview");
  const ticked = items.filter((i) => i.defaultTicked).map((i) => i.id);
  r = await applyRoute.POST(req(`/api/admin/cms/import/${preview.importId}/apply`, "POST", { selected: [...ticked, closePdf!.id, closeRes!.id] }), ctx("importId", preview.importId));
  check("both conflicting values ticked → refused, nothing saved", r.status === 400 && /only one of the conflicting/.test((await r.json()).error) && await count("SELECT count(*)::int AS n FROM recruitments WHERE organization_id = 'lic-hfl'") === 0);
  r = await applyRoute.POST(req(`/api/admin/cms/import/${preview.importId}/apply`, "POST", { selected: ["f:financial.feeGeneral:000000000000"] }), ctx("importId", preview.importId));
  check("an id not in the preview → refused", r.status === 400);
  r = await applyRoute.POST(req(`/api/admin/cms/import/${preview.importId}/apply`, "POST", { selected: [...ticked, closePdf!.id] }), ctx("importId", preview.importId));
  let d = await r.json() as J;
  check("apply → the new job", r.status === 200 && typeof d.recruitmentId === "string", d);
  const jobId = d.recruitmentId as string;
  const job = (await pg.query("SELECT * FROM recruitments WHERE id = $1", [jobId])).rows[0] as J;
  check("values saved, every one Pending", (job.financial as J & { feeGeneral: J }).feeGeneral.value === 800 && (job.financial as J & { feeGeneral: J }).feeGeneral.status === "PENDING"
    && (job.dates as J & { applicationCloseDate: J }).applicationCloseDate.value === "2026-11-01");
  check("the blog link was not added; the NATS link was", JSON.stringify(job.links).includes("nats.education.gov.in") && !JSON.stringify(job.links).includes("bfsissc.com/blog2"));
  check("history rows and claims written", await count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1", [jobId]) >= 5
    && await count("SELECT count(*)::int AS n FROM recruitment_field_claims WHERE recruitment_id = $1 AND kind = 'EXTRACTED'", [jobId]) >= 5);
  r = await applyRoute.POST(req(`/api/admin/cms/import/${preview.importId}/apply`, "POST", { selected: ticked }), ctx("importId", preview.importId));
  d = await r.json() as J;
  check("applying again → same job, replayed, nothing duplicated", r.status === 200 && d.recruitmentId === jobId && d.replayed === true
    && await count("SELECT count(*)::int AS n FROM recruitments WHERE organization_id = 'lic-hfl'") === 1);

  section("The gate: an imported job needs a person's check on every critical field");
  r = await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId));
  let checks = await r.json() as { imported: boolean; ok: boolean; rows: Array<J>; retrievals: Array<J> };
  const row = (f: string) => checks.rows.find((x) => x.fieldPath === f)!;
  check("imported, not ok; last date SUPPORTED, vacancies MISSING", checks.imported && !checks.ok && row("dates.applicationCloseDate").cls === "SUPPORTED" && row("vacancies.total").cls === "MISSING", checks.rows.map((x) => `${x.fieldPath}:${x.cls}`));
  const approvals = () => count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'RECORD_APPROVED'", [jobId]);
  const approvalsBefore = await approvals();
  r = await publish.POST(req(`/api/admin/cms/records/${jobId}/publish`, "POST", { announce: false, approveFirst: true }), ctx("id", jobId));
  d = await r.json() as J;
  check("Approve & Publish on the unchecked job → refused with the same list", r.status === 422 && d.code === "IMPORT_CHECKS_PENDING" && (d.blockers as Array<J>).some((b) => b.fieldPath === "dates.applicationCloseDate"), d);
  check("…and the job is still a DRAFT, never approved, nothing published",
    (await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [jobId])).rows[0].draft_state === "DRAFT"
    && await approvals() === approvalsBefore
    && await count("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [jobId]) === 0);
  await approve.POST(req(`/api/admin/cms/records/${jobId}/approve`, "POST"), ctx("id", jobId));
  r = await publish.POST(req(`/api/admin/cms/records/${jobId}/publish`, "POST", { announce: false }), ctx("id", jobId));
  d = await r.json() as J;
  check("publish refused, listing what to check", r.status === 422 && d.code === "IMPORT_CHECKS_PENDING" && (d.blockers as Array<J>).some((b) => b.fieldPath === "dates.applicationCloseDate"), d);
  check("…and nothing was published", await count("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [jobId]) === 0);

  section("Decisions");
  const pdfRetrieval = checks.retrievals.find((x) => x.authenticity === "CONFIRMED")!.id as string;
  const decideReq = (b: J) => decisionsRoute.POST(req(`/api/admin/cms/records/${jobId}/decisions`, "POST", { action: "decide", retrievalId: pdfRetrieval, ...b }), ctx("id", jobId));
  const seenOf = async (f: string) => {
    const c = await (await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId))).json() as typeof checks;
    const x = c.rows.find((y) => y.fieldPath === f)!;
    return { revisionId: x.latestRevisionId ?? null, decisionId: x.decisionId ?? null };
  };
  r = await decideReq({ fieldPath: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", page: 3, quote: "Last date to apply on 1 Nov", seen: await seenOf("dates.applicationCloseDate") });
  check("words not in the document → refused", r.status === 400 && /not in the document/.test((await r.json() as J).error as string));
  r = await decideReq({ fieldPath: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", page: 3, quote: "Last date to apply online: 01.11.2026", seen: { revisionId: "00000000-0000-0000-0000-000000000000", decisionId: null } });
  check("a stale screen → 409, field changed", r.status === 409);
  r = await decideReq({ fieldPath: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", quote: "Last date to apply online: 01.11.2026", seen: await seenOf("dates.applicationCloseDate") });
  check("verifying a PDF value without a page → refused", r.status === 400);
  r = await decideReq({ fieldPath: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", page: 3, quote: "Last date to apply online: 01.11.2026", seen: await seenOf("dates.applicationCloseDate") });
  check("verified with page and exact words → 201", r.status === 201, await r.clone().json());
  checks = await (await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId))).json() as typeof checks;
  check("…last date now VERIFIED", row("dates.applicationCloseDate").cls === "VERIFIED");

  const rev = async () => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [jobId])).rows[0].record_revision as string;
  const pend = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  await pg.query("UPDATE recruitments SET draft_state = 'DRAFT' WHERE id = $1", [jobId]);
  await fields.PATCH(req(`/api/admin/cms/records/${jobId}/fields`, "PATCH", { fieldPath: "dates.applicationCloseDate", field: pend("2026-11-10"), clientRevision: await rev(), reason: "test" }), ctx("id", jobId));
  await fields.PATCH(req(`/api/admin/cms/records/${jobId}/fields`, "PATCH", { fieldPath: "dates.applicationCloseDate", field: pend("2026-11-01"), clientRevision: await rev(), reason: "test restore" }), ctx("id", jobId));
  checks = await (await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId))).json() as typeof checks;
  check("edited to 10 Nov and back to 1 Nov → NOT verified any more", row("dates.applicationCloseDate").cls === "SUPPORTED", row("dates.applicationCloseDate"));

  r = await decideReq({ fieldPath: "age", kind: "ADMIN_NOT_STATED", reviewScope: { whole_document: true }, justification: "Checked the whole notice", seen: await seenOf("age") });
  check("not stated is recorded for age (Tier A field)", r.status === 201);
  r = await decideReq({ fieldPath: "vacancies.total", kind: "ADMIN_NOT_STATED", reviewScope: { whole_document: "true" }, justification: "Vacancies not given in the notice", seen: await seenOf("vacancies.total") });
  check('not stated with "true" as a string → refused', r.status === 400);
  r = await decideReq({ fieldPath: "vacancies.total", kind: "ADMIN_NOT_STATED", reviewScope: { pages: [1, 2, 3] }, justification: "Checked every page of the notice", publicNote: "Vacancies will be notified later", seen: await seenOf("vacancies.total") });
  check("not stated for vacancies (Tier B), with public wording → 201", r.status === 201, await r.clone().json());
  const vac = (await pg.query("SELECT vacancies FROM recruitments WHERE id = $1", [jobId])).rows[0].vacancies as { total?: J };
  check("…the field was saved as not specified, with its own history row", vac.total?.status === "NOT_SPECIFIED" && await count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'vacancies.total' AND reason LIKE 'Recorded as not stated%'", [jobId]) === 1);
  r = await decideReq({ fieldPath: "financial.feeGeneral", kind: "ADMIN_NOT_STATED", reviewScope: { whole_document: true }, justification: "x", seen: await seenOf("financial.feeGeneral") });
  check("not stated without a real justification → refused", r.status === 400);

  for (const f of ["dates.applicationCloseDate", "dates.applicationOpenDate", "eligibility", "financial.feeGeneral", "financial.feeSCST"]) {
    const quote = { "dates.applicationCloseDate": "Last date to apply online: 01.11.2026", "dates.applicationOpenDate": "Online applications open on 20.10.2026",
      eligibility: "Educational Qualification: graduation in any stream", "financial.feeGeneral": "General, EWS and OBC Male candidates Rs.800/- plus GST",
      "financial.feeSCST": "SC/ST candidates Rs.200/- plus GST" }[f]!;
    const page = f.startsWith("dates") ? 3 : f === "eligibility" ? 1 : 2;
    await decideReq({ fieldPath: f, kind: "ADMIN_VERIFIED", page, quote, seen: await seenOf(f) });
  }
  await decideReq({ fieldPath: "dates.feePaymentCloseDate", kind: "ADMIN_NOT_STATED", reviewScope: { whole_document: true }, justification: "No separate fee deadline in the notice", seen: await seenOf("dates.feePaymentCloseDate") });
  await decideReq({ fieldPath: "links#APPLY_ONLINE", kind: "ADMIN_NOT_APPLICABLE", page: 2, quote: "Register on the NATS portal https://nats.education.gov.in/", justification: "Applications go through the NATS portal link", publicNote: "Apply through the NATS portal", seen: await seenOf("links#APPLY_ONLINE") });
  await decideReq({ fieldPath: "links#OFFICIAL_NOTIFICATION", kind: "ADMIN_NOT_APPLICABLE", page: 1, quote: "LICHFL Apprenticeship Program-010 Advertisement Notification", justification: "The notification PDF is the source itself", seen: await seenOf("links#OFFICIAL_NOTIFICATION") });
  checks = await (await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId))).json() as typeof checks;
  check("only age blocks now: Tier A never accepts not stated", JSON.stringify(checks.rows.filter((x) => !["VERIFIED", "NOT_APPLICABLE"].includes(x.cls as string) && !(x.cls === "NOT_STATED" && x.tier === "B")).map((x) => x.fieldPath)) === '["age"]', checks.rows.map((x) => `${x.fieldPath}:${x.cls}`));
  const ageDecision = checks.rows.find((x) => x.fieldPath === "age")!.decisionId as string;
  r = await decisionsRoute.POST(req(`/api/admin/cms/records/${jobId}/decisions`, "POST", { action: "revoke", fieldPath: "age", decisionId: ageDecision }), ctx("id", jobId));
  check("withdrawing the age decision → ok", r.status === 200);
  r = await decisionsRoute.POST(req(`/api/admin/cms/records/${jobId}/decisions`, "POST", { action: "revoke", fieldPath: "age", decisionId: ageDecision }), ctx("id", jobId));
  check("withdrawing it twice → 409", r.status === 409);
  await fields.PATCH(req(`/api/admin/cms/records/${jobId}/fields`, "PATCH", { fieldPath: "age", field: pend({ min: 20, max: 25, asOf: "2026-10-01", relaxations: [] }), clientRevision: await rev(), reason: "re-enter" }), ctx("id", jobId));
  await decideReq({ fieldPath: "age", kind: "ADMIN_VERIFIED", page: 1, quote: "Age as on 01-Oct-2026: 20 to 25 years", seen: await seenOf("age") });

  section("Publish: allowed once every critical field is decided; the snapshot says what is not stated");
  await approve.POST(req(`/api/admin/cms/records/${jobId}/approve`, "POST"), ctx("id", jobId));
  r = await publish.POST(req(`/api/admin/cms/records/${jobId}/publish`, "POST", { announce: false }), ctx("id", jobId));
  d = await r.json() as J;
  check("published", r.status === 200, d);
  const snap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [jobId])).rows[0]?.snapshot as J;
  check("snapshot: vacancies not stated with its wording; apply link not applicable with its wording", (snap?.notStated as J)?.["vacancies.total"] === "Vacancies will be notified later"
    && (snap?.notApplicable as J)?.["links#APPLY_ONLINE"] === "Apply through the NATS portal", { notStated: snap?.notStated, notApplicable: snap?.notApplicable });
  check("snapshot carries no claims, quotes or source text", !JSON.stringify(snap).includes("Rs.800/- plus GST") && !JSON.stringify(snap).includes("retrieval"));
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const { getProvenanceSummary } = await import("@/lib/lifecycle");
  check("public badge: \"Key details checked against official notification\", not a generic Verified",
    snap?.keyDetailsChecked === true && getProvenanceSummary(snapshotToGovernmentRecruitment(snap as never) as never).statusLabel === "Key details checked against official notification");

  section("A job that was never imported publishes exactly as before");
  r = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "ssc", organizationName: "Staff Selection Commission", govType: "Central Govt", title: "TEST RECORD SSC CHSL 2026", recruitmentYear: 2026 }));
  const plainId = ((await r.json()) as { record: { id: string; recordRevision: string } }).record.id;
  await fields.PATCH(req(`/api/admin/cms/records/${plainId}/fields`, "PATCH", { fieldPath: "links", field: pend([{ type: "OFFICIAL_WEBSITE", label: "SSC", url: "https://ssc.gov.in/", official: true }]), clientRevision: (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [plainId])).rows[0].record_revision }), ctx("id", plainId));
  await approve.POST(req(`/api/admin/cms/records/${plainId}/approve`, "POST"), ctx("id", plainId));
  r = await publish.POST(req(`/api/admin/cms/records/${plainId}/publish`, "POST", { announce: false }), ctx("id", plainId));
  check("published with Pending values and no decisions", r.status === 200);
  const plainSnap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [plainId])).rows[0]?.snapshot as J;
  check("…and keeps its usual public badge", plainSnap?.keyDetailsChecked === undefined && getProvenanceSummary(snapshotToGovernmentRecruitment(plainSnap as never) as never).statusLabel !== "Key details checked against official notification");

  section("Approve & Publish in one request, for a job that was never imported");
  const plainNew = async (title: string, links: unknown[]) => {
    const res = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "ibps", organizationName: "IBPS", govType: "Central Govt", title, recruitmentYear: 2026, forceCreate: true }));
    const pid = ((await res.json()) as { record: { id: string } }).record.id;
    if (links.length > 0) await fields.PATCH(req(`/api/admin/cms/records/${pid}/fields`, "PATCH", { fieldPath: "links", field: pend(links), clientRevision: (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [pid])).rows[0].record_revision }), ctx("id", pid));
    return pid;
  };
  const stateOf = async (pid: string) => (await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [pid])).rows[0].draft_state as string;
  const plain2 = await plainNew("TEST RECORD IBPS Clerk 2026", [{ type: "OFFICIAL_WEBSITE", label: "IBPS", url: "https://www.ibps.in/", official: true }]);
  r = await publish.POST(req(`/api/admin/cms/records/${plain2}/publish`, "POST", { announce: false, approveFirst: true }), ctx("id", plain2));
  d = await r.json() as J;
  check("a DRAFT with an official link → approved and published in one request", r.status === 200 && (d.record as J).draftState === "PUBLISHED" && await stateOf(plain2) === "PUBLISHED", d);
  check("…with its approval and publication both in the history",
    await count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type IN ('RECORD_APPROVED', 'RECORD_PUBLISHED')", [plain2]) === 2);
  const plain3 = await plainNew("TEST RECORD IBPS SO 2026", []);
  r = await publish.POST(req(`/api/admin/cms/records/${plain3}/publish`, "POST", { announce: false, approveFirst: true }), ctx("id", plain3));
  d = await r.json() as J;
  check("a DRAFT with no official source → refused before approving, still a DRAFT", r.status === 422 && d.code === "MISSING_OFFICIAL_EVIDENCE" && await stateOf(plain3) === "DRAFT"
    && await count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'RECORD_APPROVED'", [plain3]) === 0, d);
  r = await publish.POST(req(`/api/admin/cms/records/${plain3}/publish`, "POST", { announce: false }), ctx("id", plain3));
  check("without approveFirst a DRAFT is refused as before (409)", r.status === 409);
  const { persistApprovalWithdrawn } = await import("@/lib/cms/repository");
  const adminRow = (await pg.query("SELECT id FROM admins LIMIT 1")).rows[0].id as string;
  await pg.query("UPDATE recruitments SET draft_state = 'APPROVED' WHERE id = $1", [plain3]);
  check("withdrawing an approval → DRAFT with an APPROVAL_WITHDRAWN row", await persistApprovalWithdrawn(plain3, adminRow, "test") && await stateOf(plain3) === "DRAFT"
    && await count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'APPROVAL_WITHDRAWN'", [plain3]) === 1);
  check("withdrawing on a job that is not APPROVED changes nothing", !(await persistApprovalWithdrawn(plain2, adminRow, "test")) && await stateOf(plain2) === "PUBLISHED");

  section("Corrigendum into the existing job: only the last date changes");
  await pg.query("UPDATE recruitments SET draft_state = 'DRAFT' WHERE id = $1", [jobId]);
  const corr = await service.previewImport({
    adminId, mode: "EXISTING", recruitmentId: jobId, apiKey: process.env.GEMINI_API_KEY, fetchSourceFn,
    sources: [{ declaredKind: "OFFICIAL_CORRIGENDUM", method: "url", url: "https://cdn.lichousing.com/2026/10/corrigendum-1.pdf", versionLabel: "Corrigendum 1" }],
  });
  const closeCorr = corr.proposal.items.find((i) => i.fieldPath === "dates.applicationCloseDate")!;
  check("preview: last date 8 Nov replaces a verified value; supersedes the old claim", closeCorr.value === "2026-11-08" && closeCorr.action === "REPLACE_VERIFIED" && closeCorr.supersedes.length >= 1, closeCorr);
  check("…and proposes nothing else", corr.proposal.items.filter((i) => i.kind === "FIELD").length === 1, corr.proposal.items.map((i) => i.fieldPath));
  r = await applyRoute.POST(req(`/api/admin/cms/import/${corr.importId}/apply`, "POST", { selected: [closeCorr.id] }), ctx("importId", corr.importId));
  check("replacing a verified value without the second confirmation → refused", r.status === 400);
  const feeBefore = JSON.stringify((await pg.query("SELECT financial FROM recruitments WHERE id = $1", [jobId])).rows[0].financial);
  r = await applyRoute.POST(req(`/api/admin/cms/import/${corr.importId}/apply`, "POST", { selected: [closeCorr.id], confirmReplaceVerified: true }), ctx("importId", corr.importId));
  check("with the confirmation → applied", r.status === 200, await r.clone().json());
  check("fees untouched", JSON.stringify((await pg.query("SELECT financial FROM recruitments WHERE id = $1", [jobId])).rows[0].financial) === feeBefore);
  check("supersession recorded for the last date only", await count(`SELECT count(*)::int AS n FROM recruitment_claim_supersessions s JOIN recruitment_field_claims c ON c.id = s.superseded_claim_id WHERE c.recruitment_id = $1 AND c.field_path <> 'dates.applicationCloseDate'`, [jobId]) === 0
    && await count(`SELECT count(*)::int AS n FROM recruitment_claim_supersessions s JOIN recruitment_field_claims c ON c.id = s.superseded_claim_id WHERE c.recruitment_id = $1`, [jobId]) >= 1);
  checks = await (await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId))).json() as typeof checks;
  check("the new last date needs checking again; the fee is still verified", row("dates.applicationCloseDate").cls === "SUPPORTED" && row("financial.feeGeneral").cls === "VERIFIED");

  section("The same PDF uploaded later: matched to the server's earlier fetch");
  const again = await service.previewImport({
    adminId, mode: "EXISTING", recruitmentId: jobId, apiKey: process.env.GEMINI_API_KEY, fetchSourceFn,
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: NOTICE, url: "https://cdn.lichousing.com/2026/10/notice.pdf" }],
  });
  const up = (again.proposal as unknown as { meta: { sources: Array<J> } }).meta.sources[0];
  check("upload CONFIRMED by hash match; one document row, not two", up.authenticity === "CONFIRMED" && /same file as the server's fetch/.test(String(up.label))
    && await count("SELECT count(*)::int AS n FROM recruitment_sources WHERE content_kind = 'PDF'") === 2, up);
  const changed = makePdf(["LICHFL Apprenticeship Program-010 Advertisement Notification (edited copy)"]);
  const edited = await service.previewImport({
    adminId, mode: "EXISTING", recruitmentId: jobId, apiKey: process.env.GEMINI_API_KEY, fetchSourceFn,
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: changed, url: "https://cdn.lichousing.com/2026/10/notice.pdf" }],
  });
  check("a different file claiming the same address → UNCONFIRMED", (edited.proposal as unknown as { meta: { sources: Array<J> } }).meta.sources[0].authenticity === "UNCONFIRMED");

  section("Switching off");
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: false, confirm: true }));
  r = await applyRoute.POST(req(`/api/admin/cms/import/${again.importId}/apply`, "POST", { selected: [] }), ctx("importId", again.importId));
  check("apply while switched off → 404", r.status === 404);
  r = await checksRoute.GET(req(`/api/admin/cms/records/${jobId}/checks`, "GET"), ctx("id", jobId));
  check("the check list still works (an imported job stays checkable)", r.status === 200);
  await approve.POST(req(`/api/admin/cms/records/${jobId}/approve`, "POST"), ctx("id", jobId));
  r = await publish.POST(req(`/api/admin/cms/records/${jobId}/publish`, "POST", { announce: false }), ctx("id", jobId));
  check("…and the gate still applies with the importer off", r.status === 422);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
