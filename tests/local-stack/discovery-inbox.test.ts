// ═══════════════════════════════════════════════════════════
// New Jobs Found inbox (N3): the leads, the admin's review, the hand-off
//
// Through the real routes, repository, collector and inbox components on the
// in-memory test database. Leads come from the N2 collector reading the
// constructed portal fixtures (no live fetching: every fetch is a stand-in),
// plus two seeded leads: one with hostile text and a javascript: link, one
// seen on five portals.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/discovery-inbox.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";

const FIX = (n: string) => readFileSync(join(process.cwd(), "tests/fixtures/discovery", n));
const PAGES: Record<string, { type: string; body: Buffer }> = {
  "https://www.freejobalert.com/feed/": { type: "application/rss+xml", body: FIX("freejobalert-feed.xml") },
  "https://www.sarkariresult.com/latestjob.php": { type: "text/html", body: FIX("sarkariresult-latest.html") },
  "https://www.govtjobguru.in/": { type: "text/html", body: FIX("govtjobguru-home.html") },
  "https://www.ibps.in/": { type: "text/html", body: FIX("ibps-home.html") },
};

const S = { A: "A: listing and display", B: "B: review actions", C: "C: persistence", D: "D: access", E: "E: untrusted text and links", F: "F: Smart intake hand-off", G: "G: nothing else changes", H: "H: empty and error states" };
expectChecks(S.A, [
  "A1 one lead seen on two portals shows both sources",
  "A2 a lead whose organisation is not recognised is shown, and said",
  "A3 new, duplicate, strong match, possible match and update leads are each labelled",
  "A4 a confirmed duplicate links its CMS job; a possible match lists its candidate jobs separately and merges nothing",
  "A5 filters by status and type, and both orders",
  "A6 a bad filter is refused",
]);
expectChecks(S.B, [
  "B1 ready for review, needs source and needs correction are recorded",
  "B2 dismiss needs a reason",
  "B3 a duplicate must name a CMS job the lead was matched to",
  "B4 only a dismissed or duplicate lead is reopened",
  "B5 the earlier status and reason are kept in the notes, with the admin's note",
]);
expectChecks(S.C, [
  "C1 a status read again (as after a reload) is the one saved",
  "C2 two more collector runs leave dismissed, duplicate and reviewed leads as the admin left them",
]);
expectChecks(S.D, [
  "D1 without a session, listing and reviewing are refused",
  "D2 a review from another origin is refused",
]);
expectChecks(S.E, [
  "E1 a lead's hostile title is shown as text, never as markup",
  "E2 a javascript: link is not made a link; only http(s) addresses are",
]);
expectChecks(S.F, [
  "F1 Smart intake opens with the lead (and a CMS job only when one is chosen)",
  "F2 its sources are the lead's own http(s) links, at most four, the rest said",
  "F3 Smart intake takes those links as research, never official",
  "F4 opening Smart intake records nothing on the lead: no import is claimed",
  "F5 the notice number goes to Smart intake without its label",
]);
expectChecks(S.G, [
  "G1 no recruitment, field revision, published copy, import or audit event is created or changed",
]);
expectChecks(S.H, [
  "H1 an empty inbox answers with no leads",
  "H2 a lead that does not exist answers 404; a malformed id too",
  "H3 before the tables exist, the inbox says the migration has not run",
]);

(async () => {
  const { pg, adminId, token } = await boot();
  const { collectLeads } = await import("@/lib/cms/discovery/collector");
  const { getEnabledSources } = await import("@/intelligence/multi-source/source-config");
  const list = await import("@/app/api/admin/cms/discovery/leads/route");
  const one = await import("@/app/api/admin/cms/discovery/leads/[id]/route");
  const { LeadCard } = await import("@/app/admin/cms/discovery/LeadCard");
  const { classify, handoffUrls, intakeHref, safeHref, MAX_HANDOFF_SOURCES } = await import("@/app/admin/cms/discovery/lead-view");
  type Lead = import("@/lib/cms/discovery/repository").Lead;

  const req = (path: string, method = "GET", body?: unknown, opts: { cookie?: boolean; origin?: string } = {}) => new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", origin: opts.origin ?? ORIGIN, ...(opts.cookie === false ? {} : { cookie: `admin_sid=${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const getList = async (q = "", opts = {}) => { const r = await list.GET(req(`/api/admin/cms/discovery/leads${q}`, "GET", undefined, opts)); return { status: r.status, d: await r.json() }; };
  const review = async (id: string, body: Record<string, unknown>, opts = {}) => { const r = await one.POST(req(`/api/admin/cms/discovery/leads/${id}`, "POST", body, opts), { params: Promise.resolve({ id }) }); return { status: r.status, d: await r.json() }; };
  const getOne = async (id: string) => { const r = await one.GET(req(`/api/admin/cms/discovery/leads/${id}`), { params: Promise.resolve({ id }) }); return { status: r.status, d: await r.json() }; };
  const render = (lead: Lead) => renderToStaticMarkup(React.createElement(LeadCard, { lead, onAction: () => {} })).replace(/<!-- -->/g, "");

  // ── H1 first: nothing collected yet ──
  section(S.H);
  const empty = await getList();
  check("H1 an empty inbox answers with no leads", empty.status === 200 && Array.isArray(empty.d.leads) && empty.d.leads.length === 0, empty);

  const job = async (slug: string, org: string, title: string, notice: string | null) => (await pg.query<{ id: string }>(
    "INSERT INTO recruitments (slug, organization_id, organization_name, title_text, identity) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [slug, org, org.toUpperCase(), title, JSON.stringify({ title: { value: title }, notificationNumber: { value: notice }, recruitmentYear: 2026 })])).rows[0].id;
  const sscCgl = await job("ssc-cgl-2026", "ssc", "SSC CGL 2026 Notification", "05/2026");
  const ibpsRrb = await job("ibps-rrb-xv-2026", "ibps", "IBPS RRB XV Officers and Office Assistants 2026", null);
  const bpsc71 = await job("bpsc-71-cce-2026", "bpsc", "BPSC 71st Combined Competitive Exam 2026", "22/2026");
  const stand = async (u: string) => PAGES[u] ? { ok: true as const, finalUrl: u, contentType: PAGES[u].type, bytes: PAGES[u].body } : { ok: false as const, error: "The site answered HTTP 404" };
  const collect = () => collectLeads({ sources: getEnabledSources(), fetchSourceFn: stand, sleep: async () => {} });
  await collect();

  // Two seeded leads: hostile text with a javascript: link; one seen on five portals.
  const seed = async (key: string, title: string, sources: Array<[string, string]>) => {
    const id = (await pg.query<{ id: string }>("INSERT INTO discovery_leads (lead_key, kind, title, match_kind) VALUES ($1, 'NEW', $2, 'UNRESOLVED') RETURNING id", [key, title])).rows[0].id;
    for (const [name, url] of sources) await pg.query("INSERT INTO discovery_lead_sources (lead_id, source_id, source_name, source_tier, listing_url, item_url, item_fingerprint, title_seen) VALUES ($1, $2, $2, 5, 'https://portal.example/', $3, $3, $4)", [id, name, url, title]);
    return id;
  };
  const hostile = await seed("NEW:?:u:hostile", `<script>alert("x")</script><img src=x onerror=alert(1)> Clerk 2026`, [["evil-portal", "javascript:alert(document.cookie)"]]);
  const many = await seed("NEW:?:u:many", "Many-portal Clerk Recruitment 2026", [1, 2, 3, 4, 5].map((n) => [`portal-${n}`, `https://portal${n}.example/clerk-2026`] as [string, string]));

  const fingerprint = async () => JSON.stringify((await pg.query("SELECT id, record_revision, updated_at, draft_state, identity FROM recruitments ORDER BY id")).rows)
    + JSON.stringify((await pg.query("SELECT (SELECT count(*) FROM field_revisions) AS f, (SELECT count(*) FROM published_recruitments) AS p, (SELECT count(*) FROM recruitment_audit_events) AS a, (SELECT count(*) FROM recruitment_imports) AS i")).rows);
  const before = await fingerprint();

  const all = (await getList()).d.leads as Lead[];
  const find = (t: RegExp) => all.find((l) => t.test(l.title))!;
  const cgl = find(/SSC CGL 2026/), rrb = find(/IBPS RRB XV/), bihar = find(/Bihar Combined/), hssc = find(/HSSC Constable/), result = find(/BPSC 71st CCE Result/), upsc = find(/UPSC Civil Services Prelims Recruitment/);

  // ── A ──
  section(S.A);
  const cglHtml = render(cgl);
  check("A1 one lead seen on two portals shows both sources",
    (cglHtml.match(/data-lead-source=/g) ?? []).length === 2 && cglHtml.includes("freejobalert.com/ssc-cgl-2026") && cglHtml.includes("sarkariresult.com/ssc/ssc-cgl-2026") && /Seen on 2 sources/.test(cglHtml));
  check("A2 a lead whose organisation is not recognised is shown, and said",
    !!hssc && /Organisation not recognised/.test(render(hssc)) && /check who is recruiting/.test(render(hssc)));
  const labels = { duplicate: classify(cgl).label, strong: classify(rrb).label, possible: classify(bihar).label, fresh: classify(upsc).label, update: classify(result).label, unknown: classify(hssc).label };
  check("A3 new, duplicate, strong match, possible match and update leads are each labelled",
    labels.duplicate === "Duplicate of a CMS job" && labels.strong === "Strong match to a CMS job" && labels.possible === "Possible match — choose the job"
    && labels.fresh === "New job" && labels.update === "Update of a CMS job" && labels.unknown === "New job · organisation not recognised", labels);
  const biharHtml = render(bihar);
  check("A4 a confirmed duplicate links its CMS job; a possible match lists its candidate jobs separately and merges nothing",
    /data-lead-linked/.test(cglHtml) && cglHtml.includes(`/admin/cms/${sscCgl}`) && /Already in the CMS/.test(cglHtml)
    && !/data-lead-linked/.test(biharHtml) && /data-lead-candidates/.test(biharHtml) && biharHtml.includes(`data-review-against="${bpsc71}"`) && /Nothing is merged/.test(biharHtml)
    && bihar.match.recruitmentId !== null && (await getOne(bihar.id)).d.lead.status === "NEW");
  const dups = (await getList("?status=DUPLICATE")).d.leads as Lead[];
  const updates = (await getList("?kind=UPDATE")).d.leads as Lead[];
  const byFirst = (await getList("?sort=first_seen")).d.leads as Lead[];
  const byLast = (await getList("?sort=last_seen")).d.leads as Lead[];
  const sorted = (ls: Lead[], k: "firstSeenAt" | "lastSeenAt") => ls.every((l, i) => i === 0 || ls[i - 1][k] >= l[k]);
  check("A5 filters by status and type, and both orders",
    dups.length === 1 && dups[0].id === cgl.id && updates.length === 2 && updates.every((l) => l.kind === "UPDATE")
    && byFirst.length === all.length && sorted(byFirst, "firstSeenAt") && sorted(byLast, "lastSeenAt"), { dups: dups.length, updates: updates.length });
  const bad = await Promise.all(["?status=NOPE", "?kind=OLD", "?sort=random"].map((q) => getList(q)));
  check("A6 a bad filter is refused", bad.every((b) => b.status === 400), bad.map((b) => b.status));

  // ── B ──
  section(S.B);
  const r1 = await review(rrb.id, { action: "READY_FOR_REVIEW", reason: "matches the IBPS job" });
  const r2 = await review(upsc.id, { action: "NEEDS_SOURCE", reason: "no official notice yet" });
  const r3 = await review(result.id, { action: "NEEDS_CORRECTION", reason: "title says 2026, result is 2025" });
  check("B1 ready for review, needs source and needs correction are recorded",
    r1.status === 200 && r1.d.lead.status === "READY_FOR_REVIEW" && r2.d.lead.status === "NEEDS_SOURCE" && r3.d.lead.status === "NEEDS_CORRECTION" && r1.d.lead.statusReason === "matches the IBPS job", [r1.status, r2.status, r3.status]);
  const noReason = await review(hssc.id, { action: "DISMISS" });
  const shortReason = await review(hssc.id, { action: "DISMISS", reason: "no" });
  const dismissed = await review(hssc.id, { action: "DISMISS", reason: "a state job, not covered", note: "seen twice" });
  check("B2 dismiss needs a reason", noReason.status === 400 && shortReason.status === 400 && dismissed.status === 200 && dismissed.d.lead.status === "DISMISSED", [noReason.d, shortReason.d]);
  const dupNoJob = await review(bihar.id, { action: "DUPLICATE" });
  const dupWrongJob = await review(bihar.id, { action: "DUPLICATE", recruitmentId: sscCgl });
  const dupNotUuid = await review(bihar.id, { action: "DUPLICATE", recruitmentId: "'; DROP TABLE recruitments; --" });
  const dupRight = await review(bihar.id, { action: "DUPLICATE", recruitmentId: bpsc71, reason: "same exam" });
  check("B3 a duplicate must name a CMS job the lead was matched to",
    dupNoJob.status === 400 && dupWrongJob.status === 400 && dupNotUuid.status === 400 && dupRight.status === 200 && dupRight.d.lead.status === "DUPLICATE"
    && dupRight.d.lead.statusReason.includes(bpsc71) && (await pg.query("SELECT count(*)::int AS n FROM recruitments")).rows[0].n === 3, [dupNoJob.d, dupWrongJob.d, dupNotUuid.d]);
  const reopenNew = await review(cgl.id === bihar.id ? rrb.id : rrb.id, { action: "REOPEN" });
  const reopenBihar = await review(bihar.id, { action: "REOPEN" });
  check("B4 only a dismissed or duplicate lead is reopened", reopenNew.status === 400 && reopenBihar.status === 200 && reopenBihar.d.lead.status === "NEW", [reopenNew.d]);
  const notes = String(reopenBihar.d.lead.notes ?? "");
  const hsscNotes = String(dismissed.d.lead.notes ?? "");
  check("B5 the earlier status and reason are kept in the notes, with the admin's note",
    /was NEW/.test(notes) && /was DUPLICATE — duplicate of “BPSC 71st Combined Competitive Exam 2026”/.test(notes) && /seen twice/.test(hsscNotes) && /was NEW/.test(hsscNotes), { notes, hsscNotes });

  // ── C ──
  section(S.C);
  await review(cgl.id, { action: "READY_FOR_REVIEW" });
  await review(cgl.id, { action: "DUPLICATE", recruitmentId: sscCgl, reason: "the SSC job" });
  const reread = (await getOne(rrb.id)).d.lead as Lead;
  check("C1 a status read again (as after a reload) is the one saved", reread.status === "READY_FOR_REVIEW" && reread.statusReason === "matches the IBPS job");
  const snapshot = async () => Object.fromEntries(((await getList()).d.leads as Lead[]).map((l) => [l.id, `${l.status}|${l.statusReason}|${l.notes}`]).sort(([a], [b]) => a.localeCompare(b)));
  const s1 = await snapshot();
  await collect();
  await collect();
  const s2 = await snapshot();
  check("C2 two more collector runs leave dismissed, duplicate and reviewed leads as the admin left them",
    JSON.stringify(s1) === JSON.stringify(s2) && s2[hssc.id].startsWith("DISMISSED|a state job") && s2[cgl.id].startsWith("DUPLICATE|duplicate of") && s2[rrb.id].startsWith("READY_FOR_REVIEW|"), { hssc: s2[hssc.id], cgl: s2[cgl.id] });

  // ── D ──
  section(S.D);
  const anonList = await getList("", { cookie: false });
  const anonPost = await review(upsc.id, { action: "DISMISS", reason: "anonymous" }, { cookie: false });
  const anonOne = await one.GET(req(`/api/admin/cms/discovery/leads/${upsc.id}`, "GET", undefined, { cookie: false }), { params: Promise.resolve({ id: upsc.id }) });
  check("D1 without a session, listing and reviewing are refused", anonList.status === 401 && anonPost.status === 401 && anonOne.status === 401 && (await getOne(upsc.id)).d.lead.status === "NEEDS_SOURCE", [anonList.status, anonPost.status, anonOne.status]);
  const foreign = await review(upsc.id, { action: "DISMISS", reason: "cross-site" }, { origin: "https://evil.example" });
  check("D2 a review from another origin is refused", foreign.status === 403 && (await getOne(upsc.id)).d.lead.status === "NEEDS_SOURCE", foreign.status);

  // ── E ──
  section(S.E);
  const hostileLead = (await getOne(hostile)).d.lead as Lead;
  const hostileHtml = render(hostileLead);
  check("E1 a lead's hostile title is shown as text, never as markup",
    !hostileHtml.includes("<script>") && !hostileHtml.includes("<img") && hostileHtml.includes("&lt;script&gt;") && hostileHtml.includes("&lt;img src=x onerror=alert(1)&gt;"));
  check("E2 a javascript: link is not made a link; only http(s) addresses are",
    !/href="javascript:/i.test(hostileHtml) && /data-unsafe-link/.test(hostileHtml) && safeHref("javascript:alert(1)") === null && safeHref("data:text/html,x") === null
    && safeHref("https://www.ibps.in/x.pdf") === "https://www.ibps.in/x.pdf" && /rel="noopener noreferrer nofollow"/.test(cglHtml) && handoffUrls(hostileLead).length === 0);

  // ── F ──
  section(S.F);
  check("F1 Smart intake opens with the lead (and a CMS job only when one is chosen)",
    intakeHref(rrb) === `/admin/cms/import?lead=${rrb.id}` && intakeHref(rrb, ibpsRrb) === `/admin/cms/import?lead=${rrb.id}&record=${ibpsRrb}`
    && render(rrb).includes(`href="/admin/cms/import?lead=${rrb.id}&amp;record=${ibpsRrb}"`) && biharHtml.includes(`href="/admin/cms/import?lead=${bihar.id}&amp;record=${bpsc71}"`) && biharHtml.includes(`href="/admin/cms/import?lead=${bihar.id}"`));
  const manyLead = (await getOne(many)).d.lead as Lead;
  const hand = handoffUrls(manyLead);
  const crpLead = find(/CRP-RRBs-XV/);
  check("F2 its sources are the lead's own http(s) links, at most four, the rest said",
    hand.length === 5 && hand.slice(0, MAX_HANDOFF_SOURCES).length === 4 && hand.every((u) => /^https:\/\/portal\d\.example\//.test(u))
    && handoffUrls(cgl).length === 2 && handoffUrls(crpLead)[0] === "https://www.ibps.in/crp-rrb-xv/notification.pdf", hand);
  const page = readFileSync(join(process.cwd(), "src/app/admin/cms/import/page.tsx"), "utf8");
  const at = page.indexOf("const onLead");
  const onLeadCode = page.slice(at, page.indexOf("\n  };", at));
  check("F3 Smart intake takes those links as research, never official",
    /urls\.map\(\(u\) => \(\{ \.\.\.newSource\("RESEARCH", "url"\), url: u \}\)\)/.test(onLeadCode) && !/OFFICIAL_PAGE|OFFICIAL_NOTIFICATION", "url"/.test(onLeadCode)
    && /research/.test(readFileSync(join(process.cwd(), "src/app/admin/cms/import/LeadHandoff.tsx"), "utf8")), onLeadCode);
  const crpBefore = (await getOne(crpLead.id)).d.lead as Lead;
  await getOne(crpLead.id); // what the hand-off panel reads
  const crpAfter = (await getOne(crpLead.id)).d.lead as Lead;
  const handoffSrc = readFileSync(join(process.cwd(), "src/app/admin/cms/import/LeadHandoff.tsx"), "utf8");
  check("F4 opening Smart intake records nothing on the lead: no import is claimed",
    JSON.stringify(crpBefore) === JSON.stringify(crpAfter) && crpAfter.status === "NEW" && !/method: "POST"/.test(handoffSrc) && /does not record an import/.test(handoffSrc)
    && !/[Ii]mported/.test(render(crpAfter)));

  const { bareNotice } = await import("@/app/admin/cms/discovery/lead-view");
  check("F5 the notice number goes to Smart intake without its label",
    bareNotice("Advt No. 05/2026") === "05/2026" && bareNotice("Notification No.: CRP/RRB/XV/2026") === "CRP/RRB/XV/2026" && bareNotice("22/2026") === "22/2026"
    && /handoffJob\(lead\)/.test(page) && /bareNotice\(lead\.notificationNumber\)/.test(readFileSync(join(process.cwd(), "src/app/admin/cms/import/handoff.ts"), "utf8")));

  // ── G ──
  section(S.G);
  check("G1 no recruitment, field revision, published copy, import or audit event is created or changed", (await fingerprint()) === before);

  // ── H2, H3 ──
  section(S.H);
  const missing = await getOne("00000000-0000-4000-8000-000000000000");
  const malformed = await getOne("not-a-uuid");
  const reviewMissing = await review("00000000-0000-4000-8000-000000000000", { action: "READY_FOR_REVIEW" });
  check("H2 a lead that does not exist answers 404; a malformed id too", missing.status === 404 && malformed.status === 404 && reviewMissing.status === 404, [missing.status, malformed.status, reviewMissing.status]);
  await pg.query("DROP TABLE discovery_lead_sources");
  await pg.query("DROP TABLE discovery_leads");
  const noTables = await getList();
  check("H3 before the tables exist, the inbox says the migration has not run", noTables.status === 503 && /cms-add-discovery-leads/.test(noTables.d.error), noTables);

  void adminId;
  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
