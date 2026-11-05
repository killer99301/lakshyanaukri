// ═══════════════════════════════════════════════════════════
// New Jobs Found foundation (N1 + N2): portal listings → CMS discovery leads
//
// Through the real collector, matcher, repository and database functions on
// the in-memory test database. The four enabled sources (FreeJobAlert RSS,
// SarkariResult, GovtJobGuru, IBPS) are answered from constructed fixtures in
// tests/fixtures/discovery/ — in each portal's format, not saved live pages.
// No live fetching: every fetch is an injected stand-in, except the safe-fetch
// checks, which use the real fetch against addresses it must refuse.
//
//   A  each portal contributes leads; filters as before
//   B  grouping across portals; possible matches between leads never merged
//   C  matching against CMS jobs (not the retired static dataset)
//   D  update leads
//   E  reruns: no duplicate leads, sources kept, the admin's decisions kept
//   F  nothing in the CMS is created, changed, verified or published
//   G  safe fetching
//   H  the migration on an isolated database
//   I  the starting implementation (negative checks)
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/discovery-leads.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boot, check, expectChecks, section, summary } from "./boot";
import { createDb } from "./emulator";

const FIX = (n: string) => readFileSync(join(process.cwd(), "tests/fixtures/discovery", n));
const PAGES: Record<string, { type: string; body: Buffer }> = {
  "https://www.freejobalert.com/feed/": { type: "application/rss+xml; charset=UTF-8", body: FIX("freejobalert-feed.xml") },
  "https://www.sarkariresult.com/latestjob.php": { type: "text/html", body: FIX("sarkariresult-latest.html") },
  "https://www.govtjobguru.in/": { type: "text/html", body: FIX("govtjobguru-home.html") },
  "https://www.ibps.in/": { type: "text/html", body: FIX("ibps-home.html") },
};

const S = {
  A: "A: each portal contributes leads", B: "B: grouping across portals", C: "C: matching against CMS jobs", D: "D: update leads",
  E: "E: reruns", F: "F: nothing in the CMS changes", G: "G: safe fetching", H: "H: the migration", I: "I: the starting implementation",
};
expectChecks(S.A, [
  "A1 FreeJobAlert (RSS), SarkariResult, GovtJobGuru and IBPS are each read and each contributes leads",
  "A2 a course or test-series link is not a lead",
  "A3 a link on the recruiting body's own site is marked official",
  "A4 a lead whose organisation is not recognised is kept, organisation left empty, marked unresolved",
]);
expectChecks(S.B, [
  "B1 the same recruitment on two portals (same notice number) is one lead with both sources",
  "B2 two leads whose titles only look alike stay two leads, each naming the other for review",
]);
expectChecks(S.C, [
  "C1 a lead with a CMS job's notice number and organisation is a duplicate of it, and starts as Duplicate",
  "C2 the same organisation and year with agreeing titles is a strong match to that job",
  "C3 agreeing titles without the organisation confirming them are a possible match, left for review",
  "C4 a lead like no CMS job is a new lead",
]);
expectChecks(S.D, [
  "D1 admit cards and results are kept as update leads",
  "D2 an update of a CMS job is linked to it with its reason",
]);
expectChecks(S.E, [
  "E1 a second run makes no new lead and no new source; each lead and source is counted as seen again",
  "E2 the admin's status, reason and notes survive a rerun",
  "E3 a new portal's copy of a known lead adds a source to it, not a new lead",
  "E4 a known link seen again with a notice number joins its lead, not a new one",
]);
expectChecks(S.F, [
  "F1 no recruitment, field revision, published copy or audit event is created or changed",
]);
expectChecks(S.G, [
  "G1 a page its robots.txt disallows is not fetched",
  "G2 an address that is not http(s) is refused without a fetch",
  "G3 private and metadata addresses are refused by the safe fetch itself",
  "G4 an answer that is not a listing page is not read",
  "G5 no request left this machine during the suite",
]);
expectChecks(S.H, [
  "H1 on a database without them, the migration's statements add both tables and every index",
  "H2 run a second time, it changes nothing and still passes its check",
]);
expectChecks(S.I, [
  "I1 the old runner's duplicate set (the retired static dataset) holds no government job, so it cannot find the CMS duplicate",
  "I2 the old adapters, unchanged, drop leads with an unrecognised organisation and update notices",
]);

(async () => {
  // Any request that leaves the machine is counted; the suite expects none.
  let outside = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) { outside++; throw new Error(`blocked: ${u}`); }
    return realFetch(input, init);
  }) as typeof fetch;

  const { pg, adminId } = await boot();
  const { collectLeads } = await import("@/lib/cms/discovery/collector");
  const { listLeads, setLeadStatus } = await import("@/lib/cms/discovery/repository");
  const { getEnabledSources } = await import("@/intelligence/multi-source/source-config");
  const { parseHtmlLinks } = await import("@/intelligence/multi-source/adapters/html-link-adapter");
  const { parseRssFeed } = await import("@/intelligence/multi-source/adapters/rss-adapter");

  const job = async (slug: string, org: string, title: string, notice: string | null) => (await pg.query<{ id: string }>(
    "INSERT INTO recruitments (slug, organization_id, organization_name, title_text, identity) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [slug, org, org.toUpperCase(), title, JSON.stringify({ title: { value: title }, notificationNumber: { value: notice }, recruitmentYear: 2026 })])).rows[0].id;
  const sscCgl = await job("ssc-cgl-2026", "ssc", "SSC CGL 2026 Notification", "05/2026");
  const ibpsRrb = await job("ibps-rrb-xv-2026", "ibps", "IBPS RRB XV Officers and Office Assistants 2026", null);
  const bpsc71 = await job("bpsc-71-cce-2026", "bpsc", "BPSC 71st Combined Competitive Exam 2026", "22/2026");

  const requested: string[] = [];
  const stand = (pages: Record<string, { type: string; body: Buffer }>) => async (u: string) => {
    requested.push(u);
    const p = pages[u];
    return p ? { ok: true as const, finalUrl: u, contentType: p.type, bytes: p.body } : { ok: false as const, error: "The site answered HTTP 404" };
  };
  const sources = getEnabledSources();
  const fingerprint = async () => JSON.stringify((await pg.query("SELECT id, record_revision, updated_at, draft_state, identity FROM recruitments ORDER BY id")).rows)
    + JSON.stringify((await pg.query("SELECT (SELECT count(*) FROM field_revisions) AS f, (SELECT count(*) FROM published_recruitments) AS p, (SELECT count(*) FROM recruitment_audit_events) AS a, (SELECT count(*) FROM recruitment_imports) AS i")).rows);
  const before = await fingerprint();

  const run1 = await collectLeads({ sources, fetchSourceFn: stand(PAGES), sleep: async () => {} });
  const leads = await listLeads();
  const byTitle = (t: RegExp) => leads.filter((l) => t.test(l.title));
  const one = (t: RegExp) => byTitle(t)[0];

  // ── A ──
  section(S.A);
  const perSource = Object.fromEntries(run1.sources.map((s) => [s.id, s]));
  check("A1 FreeJobAlert (RSS), SarkariResult, GovtJobGuru and IBPS are each read and each contributes leads",
    sources.length === 4 && sources.every((s) => perSource[s.id]?.status === "OK" && perSource[s.id].items > 0)
    && sources.every((s) => leads.some((l) => l.sources.some((x) => x.sourceId === s.id))), run1.sources);
  check("A2 a course or test-series link is not a lead", byTitle(/mahapack|test series/i).length === 0 && perSource["govtjobguru-latest"].items === 3, perSource["govtjobguru-latest"]);
  const crp = one(/CRP-RRBs-XV/);
  check("A3 a link on the recruiting body's own site is marked official",
    !!crp && crp.sources[0].official && crp.organizationId === "ibps" && leads.filter((l) => l !== crp).every((l) => l.sources.every((s) => !s.official)), crp?.sources);
  const hssc = one(/HSSC Constable/), rsmssb = one(/RSMSSB Patwari/);
  check("A4 a lead whose organisation is not recognised is kept, organisation left empty, marked unresolved",
    !!hssc && !!rsmssb && [hssc, rsmssb].every((l) => l.organizationId === null && l.match.kind === "UNRESOLVED" && l.status === "NEW"), [hssc, rsmssb]);

  // ── B ──
  section(S.B);
  const cgl = byTitle(/SSC CGL 2026/);
  check("B1 the same recruitment on two portals (same notice number) is one lead with both sources",
    cgl.length === 1 && cgl[0].sources.length === 2 && new Set(cgl[0].sources.map((s) => s.sourceId)).size === 2
    && cgl[0].sources.some((s) => s.itemUrl === "https://www.sarkariresult.com/ssc/ssc-cgl-2026/") && cgl[0].sources.some((s) => s.itemUrl === "https://www.freejobalert.com/ssc-cgl-2026/"), cgl);
  const upsc = byTitle(/UPSC Civil Services Prelims/);
  check("B2 two leads whose titles only look alike stay two leads, each naming the other for review",
    upsc.length === 2 && upsc[0].relatedLeads.some((r) => r.leadId === upsc[1].id) && upsc[1].relatedLeads.some((r) => r.leadId === upsc[0].id)
    && upsc.every((l) => /not merged/.test(l.relatedLeads[0].reason)), upsc.map((l) => ({ title: l.title, related: l.relatedLeads })));

  // ── C ──
  section(S.C);
  check("C1 a lead with a CMS job's notice number and organisation is a duplicate of it, and starts as Duplicate",
    cgl[0]?.match.kind === "DUPLICATE" && cgl[0].match.recruitmentId === sscCgl && cgl[0].status === "DUPLICATE" && /notice number/.test(cgl[0].statusReason ?? ""), cgl[0]?.match);
  const rrb = one(/IBPS RRB XV/);
  check("C2 the same organisation and year with agreeing titles is a strong match to that job",
    rrb?.match.kind === "STRONG" && rrb.match.recruitmentId === ibpsRrb && rrb.status === "NEW", rrb?.match);
  const bihar = one(/Bihar Combined Competitive/);
  check("C3 agreeing titles without the organisation confirming them are a possible match, left for review",
    bihar?.match.kind === "POSSIBLE" && bihar.status === "NEW" && bihar.match.candidates.some((c) => c.id === bpsc71) && bihar.organizationId === null, bihar?.match);
  check("C4 a lead like no CMS job is a new lead", upsc.every((l) => l.match.kind === "NONE" && l.status === "NEW" && l.match.recruitmentId === null), upsc.map((l) => l.match));

  // ── D ──
  section(S.D);
  const admit = one(/SBI Clerk Admit Card/), result = one(/BPSC 71st CCE Result/);
  check("D1 admit cards and results are kept as update leads", admit?.kind === "UPDATE" && result?.kind === "UPDATE" && admit.status === "NEW", [admit, result]);
  check("D2 an update of a CMS job is linked to it with its reason",
    result?.match.kind === "STRONG" && result.match.recruitmentId === bpsc71 && /same organisation and year/.test(result.match.reason ?? "") && result.status === "NEW", result?.match);

  // ── E ──
  section(S.E);
  await setLeadStatus({ id: rrb!.id, adminId, status: "READY_FOR_REVIEW", reason: "checked against ibps.in", notes: "import next week" });
  await setLeadStatus({ id: hssc!.id, adminId, status: "DISMISSED", reason: "not a central job" });
  const count = async () => (await pg.query<{ l: number; s: number }>("SELECT (SELECT count(*)::int FROM discovery_leads) AS l, (SELECT count(*)::int FROM discovery_lead_sources) AS s")).rows[0];
  const c1 = await count();
  const run2 = await collectLeads({ sources, fetchSourceFn: stand(PAGES), sleep: async () => {} });
  const c2 = await count();
  const after2 = await listLeads();
  check("E1 a second run makes no new lead and no new source; each lead and source is counted as seen again",
    run2.created === 0 && run2.sourcesAdded === 0 && c2.l === c1.l && c2.s === c1.s && after2.every((l) => l.seenRuns === 2 && l.sources.every((s) => s.seenRuns === 2)), { c1, c2, run2: { created: run2.created, added: run2.sourcesAdded } });
  const rrb2 = after2.find((l) => l.id === rrb!.id)!, hssc2 = after2.find((l) => l.id === hssc!.id)!, cgl2 = after2.find((l) => l.id === cgl[0].id)!;
  check("E2 the admin's status, reason and notes survive a rerun",
    rrb2.status === "READY_FOR_REVIEW" && rrb2.statusReason === "checked against ibps.in" && rrb2.notes === "import next week" && hssc2.status === "DISMISSED" && cgl2.status === "DUPLICATE", [rrb2, hssc2].map((l) => [l.status, l.statusReason, l.notes]));

  const GJG2 = Buffer.from(`${FIX("govtjobguru-home.html").toString("utf8").replace("</main>", `<a href="https://www.govtjobguru.in/ssc-cgl-2026-notification/">SSC CGL 2026 Recruitment Apply Online Advt No. 05/2026</a></main>`)}`);
  const IBPS2 = Buffer.from(FIX("ibps-home.html").toString("utf8").replace("Notification for CRP-RRBs-XV", "Notification for CRP-RRBs-XV Advt No. CRP/RRB/XV/2026"));
  const run3 = await collectLeads({ sources, fetchSourceFn: stand({ ...PAGES, "https://www.govtjobguru.in/": { type: "text/html", body: GJG2 }, "https://www.ibps.in/": { type: "text/html", body: IBPS2 } }), sleep: async () => {} });
  const c3 = await count();
  const after3 = await listLeads();
  const cgl3 = after3.filter((l) => /SSC CGL 2026/.test(l.title));
  check("E3 a new portal's copy of a known lead adds a source to it, not a new lead",
    c3.l === c1.l && cgl3.length === 1 && cgl3[0].sources.length === 3 && cgl3[0].status === "DUPLICATE" && run3.created === 0, { leads: c3.l, sources: cgl3[0]?.sources.map((s) => s.sourceId) });
  const crp3 = after3.filter((l) => /CRP-RRBs-XV/.test(l.title));
  check("E4 a known link seen again with a notice number joins its lead, not a new one",
    crp3.length === 1 && crp3[0].id === crp!.id && crp3[0].seenRuns === 3 && crp3[0].notificationNumber !== null, crp3.map((l) => ({ id: l.id, n: l.notificationNumber, runs: l.seenRuns })));

  // ── F ──
  section(S.F);
  check("F1 no recruitment, field revision, published copy or audit event is created or changed", (await fingerprint()) === before);

  // ── G ──
  section(S.G);
  requested.length = 0;
  const ROBOTS = { "https://robots.example/robots.txt": { type: "text/plain", body: Buffer.from("User-agent: *\nDisallow: /jobs") }, "https://robots.example/jobs": { type: "text/html", body: FIX("sarkariresult-latest.html") } };
  const g1 = await collectLeads({ sources: [{ id: "robots", name: "Robots test", type: "HTML_LINKS", url: "https://robots.example/jobs", tier: 5, enabled: true }], fetchSourceFn: stand(ROBOTS), sleep: async () => {} });
  check("G1 a page its robots.txt disallows is not fetched",
    g1.sources[0].status === "REFUSED" && /robots\.txt/.test(g1.sources[0].error ?? "") && !requested.includes("https://robots.example/jobs") && g1.leads.length === 0, { g1: g1.sources, requested });
  requested.length = 0;
  const g2 = await collectLeads({ sources: ["javascript:alert(1)", "ftp://files.example/jobs", "file:///etc/passwd"].map((url, i) => ({ id: `bad-${i}`, name: "bad", type: "HTML_LINKS" as const, url, tier: 5 as const, enabled: true })), fetchSourceFn: stand({}), sleep: async () => {} });
  check("G2 an address that is not http(s) is refused without a fetch", g2.sources.every((s) => s.status === "REFUSED") && requested.length === 0, g2.sources);
  const g3 = await collectLeads({ sources: ["http://127.0.0.1:9/feed", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/jobs"].map((url, i) => ({ id: `private-${i}`, name: "private", type: "HTML_LINKS" as const, url, tier: 5 as const, enabled: true })), sleep: async () => {} });
  check("G3 private and metadata addresses are refused by the safe fetch itself",
    g3.sources.every((s) => s.status === "REFUSED" && /private network/.test(s.error ?? "")), g3.sources);
  const g4 = await collectLeads({ sources: [{ id: "pdf", name: "pdf", type: "HTML_LINKS", url: "https://pdf.example/notice", tier: 5, enabled: true }], fetchSourceFn: stand({ "https://pdf.example/notice": { type: "application/pdf", body: Buffer.from("%PDF-1.4") } }), sleep: async () => {} });
  check("G4 an answer that is not a listing page is not read", g4.sources[0].status === "UNAVAILABLE" && g4.leads.length === 0, g4.sources);
  check("G5 no request left this machine during the suite", outside === 0, outside);

  // ── H ──
  section(S.H);
  const { splitSqlStatements } = await import("@/lib/cms/importer/sql-split");
  const { DISCOVERY_OBJECTS, discoveryProblems } = await import("@/lib/cms/discovery/schema-manifest");
  const iso = await createDb({ discovery: false });
  const problemsOf = async () => discoveryProblems(
    (await iso.query<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)", [Object.keys(DISCOVERY_OBJECTS.tables)])).rows,
    (await iso.query<{ name: string }>("SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)", [DISCOVERY_OBJECTS.indexes])).rows.map((r) => r.name));
  const missing = await problemsOf();
  const statements = splitSqlStatements(readFileSync(join(process.cwd(), "src/lib/cms/discovery/schema.sql"), "utf8"));
  await iso.transaction(async (tx) => { for (const s of statements) await tx.query(s); });
  const afterOnce = await problemsOf();
  check("H1 on a database without them, the migration's statements add both tables and every index", missing.length > 0 && afterOnce.length === 0, { missing, afterOnce });
  await iso.transaction(async (tx) => { for (const s of statements) await tx.query(s); });
  check("H2 run a second time, it changes nothing and still passes its check", (await problemsOf()).length === 0);
  await iso.close();

  // ── I ──
  section(S.I);
  const { getAllOpportunities } = await import("@/lib/repository");
  const { isDuplicateOfCanonical, buildCandidateId } = await import("@/intelligence/dedup");
  const canonical = getAllOpportunities().filter((o) => o.type === "government");
  const fja = sources.find((s) => s.id === "freejobalert-rss")!;
  const legacyCgl = parseRssFeed(fja, FIX("freejobalert-feed.xml").toString("utf8")).discoveries.find((d) => /SSC CGL/.test(d.title))!;
  const legacyDup = isDuplicateOfCanonical({ ...legacyCgl, candidateId: buildCandidateId(legacyCgl.organizationId, legacyCgl.normalizedNotifNumber) }, canonical as never);
  check("I1 the old runner's duplicate set (the retired static dataset) holds no government job, so it cannot find the CMS duplicate",
    canonical.length === 0 && legacyDup.isDuplicate === false && cgl[0]?.match.kind === "DUPLICATE", { canonical: canonical.length, legacyDup });
  const legacyFeed = parseRssFeed(fja, FIX("freejobalert-feed.xml").toString("utf8")).discoveries.map((d) => d.title);
  const legacyHtml = parseHtmlLinks(sources.find((s) => s.id === "sarkariresult-latest")!, FIX("sarkariresult-latest.html").toString("utf8")).map((d) => d.title);
  check("I2 the old adapters, unchanged, drop leads with an unrecognised organisation and update notices",
    !legacyFeed.some((t) => /HSSC|Admit Card|Result/.test(t)) && !legacyHtml.some((t) => /RSMSSB/.test(t)) && legacyFeed.some((t) => /SSC CGL/.test(t)), { legacyFeed, legacyHtml });

  globalThis.fetch = realFetch;
  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
