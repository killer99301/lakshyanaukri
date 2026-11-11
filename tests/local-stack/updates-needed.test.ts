// ═══════════════════════════════════════════════════════════
// Updates needed (U1–U3): update leads and date reminders, per job and overall
//
// Through the real routes, collector, repository, Smart intake service and
// components on the in-memory test database. Update leads come from the
// constructed fixtures (stand-in fetches only); a live job is created and
// published through the CMS's own routes so its date reminders exist. Any
// request leaving the machine is counted (Gemini included): none is expected.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/updates-needed.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

const FIX = (n: string) => readFileSync(join(process.cwd(), "tests/fixtures/discovery", n));
const PAGES: Record<string, { type: string; body: Buffer }> = {
  "https://www.freejobalert.com/feed/": { type: "application/rss+xml", body: FIX("freejobalert-feed.xml") },
  "https://www.sarkariresult.com/latestjob.php": { type: "text/html", body: FIX("sarkariresult-latest.html") },
  "https://www.govtjobguru.in/": { type: "text/html", body: FIX("govtjobguru-home.html") },
  "https://www.ibps.in/": { type: "text/html", body: FIX("ibps-home.html") },
  "https://updates.example/latest": { type: "text/html", body: FIX("updates-listing.html") },
};

const S = { A: "A: update leads", B: "B: the overall view", C: "C: one job's view", D: "D: hand-off", E: "E: review state", F: "F: a checked value", G: "G: nothing else happens", H: "H: access, input, empty and error states" };
expectChecks(S.A, [
  "A1 result, admit card, extension and corrigendum leads are each named for what they announce",
  "A2 an update with the job's notice number, or its organisation, year and title, is tied to that job, with the reason",
  "A3 an update whose job is uncertain is a possible match with its candidate job, not tied",
  "A4 an update like no job is kept, untied, and said",
]);
expectChecks(S.B, [
  "B1 the overall view lists every update lead and no new-job lead",
  "B2 it lists the live jobs' date reminders, each with its reason, and no draft job",
  "B3 a portal update is labelled research, not confirmed; a reminder as the job's own dates, not an update",
]);
expectChecks(S.C, [
  "C1 a job's view lists the updates tied to it, and only those",
  "C2 an update that may be about the job is kept apart, needs the admin's choice, and is not counted as the job's",
  "C3 a live job's view lists its date reminders",
  "C4 each update line shows why it is tied to the job, and its source as research",
]);
expectChecks(S.D, [
  "D1 an update tied to a job opens Smart intake into that job, never as a new job",
  "D2 a possible update opens into the job only through the admin's explicit choice",
  "D3 Check for updates is a link to the job's own panel; nothing runs from here",
  "D4 the lead's address is carried into Check for updates for the admin to see, never run, marked official or dismissed",
]);
expectChecks(S.E, [
  "E1 the New Jobs Found review actions work on update leads and survive two more collector runs",
]);
expectChecks(S.F, [
  "F1 an update brought into a job whose value was checked offers a replacement, not ticked",
  "F2 saved with the default ticks, the checked value and its check stay",
  "F3 ticked without the separate confirmation, the replacement is refused",
]);
expectChecks(S.G, [
  "G1 the views, links and reruns create, change, verify or publish no job",
  "G2 no request left the machine: no AI, no fetching",
]);
expectChecks(S.H, [
  "H1 without a session the views are refused",
  "H2 a malformed job id is refused; an unknown one is not found",
  "H3 with nothing collected and no live job, both views are empty",
  "H4 before the tables exist, the view says the migration has not run",
]);

(async () => {
  let outside = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) { outside++; throw new Error(`blocked: ${u}`); }
    return realFetch(input, init);
  }) as typeof fetch;

  const { pg, adminId, token } = await boot();
  delete process.env.GEMINI_API_KEY;
  const { collectLeads } = await import("@/lib/cms/discovery/collector");
  const { getEnabledSources } = await import("@/intelligence/multi-source/source-config");
  const updatesRoute = await import("@/app/api/admin/cms/discovery/updates/route");
  const leadRoute = await import("@/app/api/admin/cms/discovery/leads/[id]/route");
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const { LeadCard } = await import("@/app/admin/cms/discovery/LeadCard");
  const { LeadLine } = await import("@/app/admin/cms/[id]/UpdatesNeededPanel");
  const { updateType, tieOf, intakeHref, checkUpdatesHref, handoffUrls } = await import("@/app/admin/cms/discovery/lead-view");
  const { sourceFromSearch } = await import("@/app/admin/cms/[id]/UpdateCheckPanel");
  const { todayInIndia } = await import("@/lib/cms/attention");
  type Lead = import("@/lib/cms/discovery/repository").Lead;

  const req = (path: string, method = "GET", body?: unknown, opts: { cookie?: boolean } = {}) => new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", origin: ORIGIN, ...(opts.cookie === false ? {} : { cookie: `admin_sid=${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const overview = async (opts = {}) => { const r = await updatesRoute.GET(req("/api/admin/cms/discovery/updates", "GET", undefined, opts)); return { status: r.status, d: await r.json() }; };
  const forJob = async (id: string) => { const r = await updatesRoute.GET(req(`/api/admin/cms/discovery/updates?recordId=${encodeURIComponent(id)}`)); return { status: r.status, d: await r.json() }; };
  const render = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");

  // ── H3 first: nothing yet ──
  section(S.H);
  const empty = await overview();
  check("H3 with nothing collected and no live job, both views are empty",
    empty.status === 200 && empty.d.leads.length === 0 && empty.d.attention.length === 0, empty.d);

  // Draft CMS jobs the leads may be about.
  const job = async (slug: string, org: string, title: string, notice: string | null) => (await pg.query<{ id: string }>(
    "INSERT INTO recruitments (slug, organization_id, organization_name, title_text, identity) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [slug, org, org.toUpperCase(), title, JSON.stringify({ title: { value: title }, notificationNumber: { value: notice }, recruitmentYear: 2026 })])).rows[0].id;
  const sscCgl = await job("ssc-cgl-2026", "ssc", "SSC CGL 2026 Notification", "05/2026");
  const ibpsRrb = await job("ibps-rrb-xv-2026", "ibps", "IBPS RRB XV Officers and Office Assistants 2026", null);
  const bpsc71 = await job("bpsc-71-cce-2026", "bpsc", "BPSC 71st Combined Competitive Exam 2026", "22/2026");
  const emptyJob = (await forJob(ibpsRrb)).d;

  // A live job, made and published through the CMS's own routes, closing in two days.
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  let res = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "ssc", organizationName: "Staff Selection Commission", govType: "Central Govt", title: "TEST LIVE SSC CHSL 2027", recruitmentYear: 2027 }));
  const live = (await res.json()).record;
  let revision: string = live.recordRevision;
  const inTwoDays = new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  for (const [fieldPath, value] of [["dates.applicationOpenDate", "2026-01-01"], ["dates.applicationCloseDate", inTwoDays],
    ["links", [{ type: "OFFICIAL_NOTIFICATION", label: "Official Notification", url: "https://ssc.gov.in/chsl.pdf", official: true }, { type: "OFFICIAL_WEBSITE", label: "Official Website", url: "https://ssc.gov.in", official: true }]]] as Array<[string, unknown]>) {
    res = await fields.PATCH(req(`/api/admin/cms/records/${live.id}/fields`, "PATCH", { fieldPath, field: manual(value), clientRevision: revision }), ctx(live.id));
    revision = (await res.json()).record.recordRevision;
  }
  await approve.POST(req(`/api/admin/cms/records/${live.id}/approve`, "POST"), ctx(live.id));
  try { await publish.POST(req(`/api/admin/cms/records/${live.id}/publish`, "POST", await approved(live.id)), ctx(live.id)); } catch { /* page refresh outside Next: the record is published */ }

  const sources = [...getEnabledSources(), { id: "updates-portal", name: "Updates portal (test)", type: "HTML_LINKS" as const, url: "https://updates.example/latest", tier: 5 as const, enabled: true }];
  const stand = async (u: string) => PAGES[u] ? { ok: true as const, finalUrl: u, contentType: PAGES[u].type, bytes: PAGES[u].body } : { ok: false as const, error: "The site answered HTTP 404" };
  const collect = () => collectLeads({ sources, fetchSourceFn: stand, sleep: async () => {} });
  await collect();

  const fingerprint = async () => JSON.stringify((await pg.query("SELECT id, record_revision, updated_at, draft_state, identity, dates FROM recruitments ORDER BY id")).rows)
    + JSON.stringify((await pg.query("SELECT (SELECT count(*) FROM field_revisions) AS f, (SELECT count(*) FROM published_recruitments) AS p, (SELECT count(*) FROM recruitment_audit_events) AS a, (SELECT count(*) FROM recruitment_imports) AS i, (SELECT count(*) FROM recruitment_field_claims) AS c")).rows);
  const before = await fingerprint();

  const all = (await overview()).d as { leads: Lead[]; attention: Array<{ id: string; title: string; items: Array<{ code: string; message: string }> }> };
  const find = (t: RegExp) => all.leads.find((l) => t.test(l.title))!;
  const ext = find(/Last Date Extended/), corr = find(/Corrigendum/), admitPossible = find(/Bihar Combined.*Admit Card/), resultNone = find(/Rajasthan Patwari Result/), bpscResult = find(/BPSC 71st CCE Result/), sbiAdmit = find(/SBI Clerk Admit Card/);

  // ── A ──
  section(S.A);
  const types = { ext: updateType(ext?.title ?? ""), corr: updateType(corr?.title ?? ""), admit: updateType(admitPossible?.title ?? ""), result: updateType(resultNone?.title ?? "") };
  check("A1 result, admit card, extension and corrigendum leads are each named for what they announce",
    types.ext === "Date extended" && types.corr === "Corrigendum" && types.admit === "Admit card" && types.result === "Result" && updateType(sbiAdmit.title) === "Admit card", types);
  check("A2 an update with the job's notice number, or its organisation, year and title, is tied to that job, with the reason",
    tieOf(ext) === "MATCHED" && ext.match.recruitmentId === sscCgl && /notice number/.test(ext.match.reason ?? "")
    && tieOf(corr) === "MATCHED" && corr.match.recruitmentId === ibpsRrb && /same organisation and year/.test(corr.match.reason ?? "")
    && tieOf(bpscResult) === "MATCHED" && bpscResult.match.recruitmentId === bpsc71, [ext.match, corr.match]);
  check("A3 an update whose job is uncertain is a possible match with its candidate job, not tied",
    tieOf(admitPossible) === "POSSIBLE" && admitPossible.match.candidates.some((c) => c.id === bpsc71) && admitPossible.organizationId === null, admitPossible.match);
  check("A4 an update like no job is kept, untied, and said",
    tieOf(resultNone) === "NONE" && tieOf(sbiAdmit) === "NONE" && /No CMS job was matched/.test(render(React.createElement(LeadCard, { lead: resultNone, onAction: () => {} }))));

  // ── B ──
  section(S.B);
  check("B1 the overall view lists every update lead and no new-job lead",
    all.leads.length === 6 && all.leads.every((l) => l.kind === "UPDATE"), all.leads.map((l) => l.title));
  const liveItems = all.attention.find((j) => j.id === live.id);
  check("B2 it lists the live jobs' date reminders, each with its reason, and no draft job",
    !!liveItems && liveItems.items.some((i) => i.code === "CLOSES_SOON" && /2 days|in 2 days/.test(i.message)) && ![sscCgl, ibpsRrb, bpsc71].some((id) => all.attention.some((j) => j.id === id)), all.attention);
  const extCard = render(React.createElement(LeadCard, { lead: ext, onAction: () => {} }));
  const pageSrc = readFileSync(join(process.cwd(), "src/app/admin/cms/updates/page.tsx"), "utf8");
  check("B3 a portal update is labelled research, not confirmed; a reminder as the job's own dates, not an update",
    /Date extended · found on a portal, not confirmed/.test(extCard) && /\(portal: research\)/.test(extCard)
    && /research, not confirmed/.test(pageSrc) && /from each job&apos;s own dates, not an update/.test(pageSrc));

  // ── C ──
  section(S.C);
  const cglView = (await forJob(sscCgl)).d, bpscView = (await forJob(bpsc71)).d, liveView = (await forJob(live.id)).d;
  check("C1 a job's view lists the updates tied to it, and only those",
    cglView.matched.length === 1 && cglView.matched[0].id === ext.id && cglView.possible.length === 0
    && bpscView.matched.length === 1 && bpscView.matched[0].id === bpscResult.id && emptyJob.matched.length === 0, { cgl: cglView.matched.map((l: Lead) => l.title), bpsc: bpscView.matched.map((l: Lead) => l.title) });
  const possibleLine = render(React.createElement(LeadLine, { lead: bpscView.possible[0], recordId: bpsc71, possible: true }));
  check("C2 an update that may be about the job is kept apart, needs the admin's choice, and is not counted as the job's",
    bpscView.possible.length === 1 && bpscView.possible[0].id === admitPossible.id && !bpscView.matched.some((l: Lead) => l.id === admitPossible.id)
    && /not treated as this job&#x27;s until you choose it|not treated as this job's until you choose it/.test(possibleLine) && /This is the job — bring the lead into it/.test(possibleLine)
    && (await pg.query("SELECT match_recruitment_id FROM discovery_leads WHERE id = $1", [admitPossible.id])).rows[0].match_recruitment_id === bpsc71, possibleLine);
  check("C3 a live job's view lists its date reminders", liveView.job.live === true && liveView.attention.some((i: { code: string }) => i.code === "CLOSES_SOON") && liveView.matched.length === 0, liveView.attention);
  const matchedLine = render(React.createElement(LeadLine, { lead: cglView.matched[0], recordId: sscCgl, possible: false }));
  check("C4 each update line shows why it is tied to the job, and its source as research",
    /Why it is tied to this job: same notice number/.test(matchedLine) && /\(portal: research\)/.test(matchedLine) && /Date extended/.test(matchedLine), matchedLine);

  // ── D ──
  section(S.D);
  check("D1 an update tied to a job opens Smart intake into that job, never as a new job",
    extCard.includes(`href="${intakeHref(ext, sscCgl).replace("&", "&amp;")}"`) && /Bring into “SSC CGL 2026 Notification” in Smart intake/.test(extCard)
    && /About the CMS job: /.test(extCard) && !/Already in the CMS/.test(extCard)
    && !/data-open-intake/.test(extCard) && !/data-open-intake/.test(render(React.createElement(LeadCard, { lead: resultNone, onAction: () => {} })))
    && matchedLine.includes(`href="/admin/cms/import?lead=${ext.id}&amp;record=${sscCgl}"`));
  const possibleCard = render(React.createElement(LeadCard, { lead: admitPossible, onAction: () => {} }));
  check("D2 a possible update opens into the job only through the admin's explicit choice",
    possibleCard.includes(`data-review-against="${bpsc71}"`) && /This is the job — review the lead against it/.test(possibleCard) && !/Bring into “/.test(possibleCard) && !/data-open-intake/.test(possibleCard));
  const editor = readFileSync(join(process.cwd(), "src/app/admin/cms/[id]/page.tsx"), "utf8");
  check("D3 Check for updates is a link to the job's own panel; nothing runs from here",
    extCard.includes(`href="${checkUpdatesHref(sscCgl, handoffUrls(ext)[0])}"`) && /only when you press Check/.test(extCard) && /<div id="check-updates">\s*<UpdateCheckPanel/.test(editor)
    && !/check-updates/.test(readFileSync(join(process.cwd(), "src/lib/cms/discovery/updates.ts"), "utf8").replace("Check for updates", "")));
  // Test 10: the lead's address rides along as ?source=…, is shown in the panel's box, and nothing runs by itself.
  const leadUrl = handoffUrls(ext)[0];
  const href = checkUpdatesHref(sscCgl, leadUrl);
  const panelSrc = readFileSync(join(process.cwd(), "src/app/admin/cms/[id]/UpdateCheckPanel.tsx"), "utf8");
  const effects = panelSrc.split("useEffect(").slice(1).map((e) => e.slice(0, 600));
  const leadAfter = (await pg.query("SELECT status FROM discovery_leads WHERE id = $1", [ext.id])).rows[0] as { status?: string } | undefined;
  check("D4 the lead's address is carried into Check for updates for the admin to see, never run, marked official or dismissed",
    Boolean(leadUrl) && href.startsWith(`/admin/cms/${sscCgl}?source=`) && href.endsWith("#check-updates")
    && sourceFromSearch(href.slice(href.indexOf("?"), href.indexOf("#"))) === new URL(leadUrl!).toString()
    && checkUpdatesHref(sscCgl, "javascript:alert(1)") === `/admin/cms/${sscCgl}#check-updates`
    && checkUpdatesHref(sscCgl, null) === `/admin/cms/${sscCgl}#check-updates` && checkUpdatesHref(sscCgl, "not a url") === `/admin/cms/${sscCgl}#check-updates`
    && sourceFromSearch("?source=javascript%3Aalert(1)") === "" && sourceFromSearch("?source=") === "" && sourceFromSearch("") === "" && sourceFromSearch("?source=ftp%3A%2F%2Fx.example") === ""
    && /useState\(initialSource\)/.test(panelSrc) && !effects.some((e) => /check\(|apply\(/.test(e))
    && /initialSource=\{leadSource\}/.test(editor) && !/official/.test(href)
    && leadAfter?.status !== "DISMISSED",
    { href, leadUrl, leadStatus: leadAfter?.status });

  // ── E ──
  section(S.E);
  const post = async (id: string, body: unknown) => { const r = await leadRoute.POST(req(`/api/admin/cms/discovery/leads/${id}`, "POST", body), ctx(id)); return { status: r.status, d: await r.json() }; };
  const e1 = await post(sbiAdmit.id, { action: "DISMISS", reason: "no SBI Clerk job in the CMS" });
  const e2 = await post(ext.id, { action: "READY_FOR_REVIEW", reason: "extension to bring in" });
  await collect();
  await collect();
  const after = (await overview()).d.leads as Lead[];
  check("E1 the New Jobs Found review actions work on update leads and survive two more collector runs",
    e1.status === 200 && e2.status === 200 && after.find((l) => l.id === sbiAdmit.id)!.status === "DISMISSED" && after.find((l) => l.id === ext.id)!.status === "READY_FOR_REVIEW"
    && after.find((l) => l.id === ext.id)!.statusReason === "extension to bring in" && after.length === 6, after.map((l) => [l.title, l.status]));

  // ── G (before the checked-value scenario, which makes its own job) ──
  section(S.G);
  check("G1 the views, links and reruns create, change, verify or publish no job", (await fingerprint()) === before);

  // ── F: a checked value is never replaced quietly ──
  section(S.F);
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  const noAi = (async () => { outside++; throw new Error("no AI"); }) as unknown as typeof fetch;
  const pv = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, items: (p.proposal as unknown as { items: Array<{ id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean }> }).items };
  };
  const NOTICE = "Staff Selection Commission\nCombined Higher Secondary Level Examination 2098\nLast date to apply online: 30.06.2098";
  const first = await pv({ mode: "NEW", newJob: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2098, title: "TEST RECORD SSC CHSL 2098", govType: "Central Govt" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: NOTICE, url: "https://ssc.gov.in/chsl-2098.pdf", attestation: "Copied from the notice (U test)" }] });
  const saved = await service.applyImportFlow({ importId: first.importId, adminId, selected: first.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null });
  const jobId = saved.recruitmentId;
  const checks = await service.checksFor((await getRecruitmentById(jobId))!);
  const row = checks.rows.find((r) => r.fieldPath === "dates.applicationCloseDate")!;
  await service.decide({ recruitmentId: jobId, adminId, fieldPath: "dates.applicationCloseDate", kind: "ADMIN_VERIFIED", retrievalId: checks.retrievals[0].id, page: null,
    quote: "Last date to apply online: 30.06.2098", tableCell: null, reviewScope: null, justification: null, publicNote: null, seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null } });
  const clsOf = async () => (await service.checksFor((await getRecruitmentById(jobId))!)).rows.find((r) => r.fieldPath === "dates.applicationCloseDate")!.cls;
  const verifiedBefore = await clsOf();
  // The update lead's standing in Smart intake: research, brought into the job.
  const EXTENDED = (n: string) => `Staff Selection Commission — Combined Higher Secondary Level Examination 2098\nSSC CHSL 2098 last date extended${n}, as a portal reports it\nLast date to apply online: 15.07.2098`;
  const upd = await pv({ mode: "EXISTING", recruitmentId: jobId, sources: [{ declaredKind: "RESEARCH", method: "paste", text: EXTENDED("") }] });
  const replace = upd.items.find((i) => i.fieldPath === "dates.applicationCloseDate");
  check("F1 an update brought into a job whose value was checked offers a replacement, not ticked",
    verifiedBefore === "VERIFIED" && replace?.action === "REPLACE_VERIFIED" && replace.value === "2098-07-15" && replace.defaultTicked === false, { verifiedBefore, replace });
  await service.applyImportFlow({ importId: upd.importId, adminId, selected: upd.items.filter((i) => i.defaultTicked).map((i) => i.id), confirmReplaceVerified: false, override: null }).catch(() => null);
  const kept = (await getRecruitmentById(jobId))!.dates.applicationCloseDate?.value;
  check("F2 saved with the default ticks, the checked value and its check stay", kept === "2098-06-30" && (await clsOf()) === "VERIFIED", { kept, cls: await clsOf() });
  const upd2 = await pv({ mode: "EXISTING", recruitmentId: jobId, sources: [{ declaredKind: "RESEARCH", method: "paste", text: EXTENDED(" again") }] });
  const tick = upd2.items.find((i) => i.fieldPath === "dates.applicationCloseDate")!;
  let refused = "";
  try { await service.applyImportFlow({ importId: upd2.importId, adminId, selected: [tick.id], confirmReplaceVerified: false, override: null }); } catch (e) { refused = (e as Error).message; }
  check("F3 ticked without the separate confirmation, the replacement is refused",
    /needs the separate confirmation/.test(refused) && (await getRecruitmentById(jobId))!.dates.applicationCloseDate?.value === "2098-06-30", refused);

  section(S.G);
  check("G2 no request left the machine: no AI, no fetching", outside === 0, outside);

  // ── H ──
  section(S.H);
  const anon = await overview({ cookie: false });
  const anonJob = await updatesRoute.GET(req(`/api/admin/cms/discovery/updates?recordId=${sscCgl}`, "GET", undefined, { cookie: false }));
  check("H1 without a session the views are refused", anon.status === 401 && anonJob.status === 401);
  const bad = await forJob("1; DROP TABLE recruitments");
  const unknown = await forJob("00000000-0000-4000-8000-000000000000");
  check("H2 a malformed job id is refused; an unknown one is not found", bad.status === 400 && unknown.status === 404, [bad.status, unknown.status]);
  await pg.query("DROP TABLE discovery_lead_sources");
  await pg.query("DROP TABLE discovery_leads");
  const noTables = await overview();
  check("H4 before the tables exist, the view says the migration has not run", noTables.status === 503 && /cms-add-discovery-leads/.test(noTables.d.error), noTables);

  globalThis.fetch = realFetch;
  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
