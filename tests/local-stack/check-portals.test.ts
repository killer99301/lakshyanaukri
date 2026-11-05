// ═══════════════════════════════════════════════════════════
// Check portals now (N4): the admin-started collector run
//
// Through the real run route, collector, repository and views on the
// in-memory test database. Runs read the saved test pages in
// tests/fixtures/discovery (DISCOVERY_FIXTURES_DIR, test mode), or copies of
// them changed for one case, in a temporary folder. Any request leaving the
// machine is counted: none is expected, and the live path is never taken.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/check-portals.test.ts
// ═══════════════════════════════════════════════════════════

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";

const FIXTURES = join(process.cwd(), "tests/fixtures/discovery");
const S = { A: "A: the switch", B: "B: a run", C: "C: reruns", D: "D: faults", E: "E: safety", F: "F: notice numbers", G: "G: nothing else happens" };
expectChecks(S.A, [
  "A1 by default scans are off: the view says so, a run is refused, nothing is fetched or saved",
  "A2 test pages are used only when a folder of them is named, never on Vercel, and never mistaken for live",
]);
expectChecks(S.B, [
  "B1 an admin's run reads the four enabled portals (and the test update page) and reports each",
  "B2 its leads appear in New Jobs Found, unknown organisations included",
  "B3 its update leads appear in Updates needed",
  "B4 duplicates and possible matches keep their distinction",
  "B5 the summary counts new leads, and labels the run a test run, not a portal scan",
]);
expectChecks(S.C, [
  "C1 a second run finds nothing new: every lead is already known, nothing is added",
  "C2 a known lead seen on another portal gains that source and is counted so, not as new",
  "C3 the admin's decisions survive the reruns",
]);
expectChecks(S.D, [
  "D1 one source failing is reported, the others are read, and the run is marked incomplete",
  "D2 a page its robots.txt disallows is not read, and said",
  "D3 an address that is not http(s) is refused; private and metadata addresses are refused by the safe fetch",
]);
expectChecks(S.E, [
  "E1 two runs at once: the second is refused while the first goes on",
  "E2 without a session the switch and the run are refused; a run from another origin is refused",
  "E3 a run reads at most ten sources and a hundred links from each",
]);
expectChecks(S.F, [
  "F1 a notice number that is only a word and a year (“XV 2026”) is not used to match; real ones still are",
  "F2 such a number no longer makes a duplicate of the wrong CMS job",
  "F3 two different updates of one exam with such a number stay two leads",
  "F4 the inbox says when a lead's notice number is not used",
]);
expectChecks(S.G, [
  "G1 no job is created, changed, verified or published by any run",
  "G2 no request left the machine: no AI, no live portal",
]);

(async () => {
  let outside = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) { outside++; throw new Error(`blocked: ${u}`); }
    return realFetch(input, init);
  }) as typeof fetch;
  delete process.env.DISCOVERY_FIXTURES_DIR;
  delete process.env.DISCOVERY_LIVE_SCAN;
  delete process.env.VERCEL;

  const { pg, token } = await boot();
  delete process.env.GEMINI_API_KEY;
  const runRoute = await import("@/app/api/admin/cms/discovery/run/route");
  const leadRoute = await import("@/app/api/admin/cms/discovery/leads/[id]/route");
  const { listLeads } = await import("@/lib/cms/discovery/repository");
  const { updatesOverview } = await import("@/lib/cms/discovery/updates");
  const { runMode } = await import("@/lib/cms/discovery/run");
  const { MAX_ITEMS_PER_SOURCE, collectLeads } = await import("@/lib/cms/discovery/collector");
  const { noticeKey } = await import("@/lib/cms/discovery/notice");
  const { matchLead } = await import("@/lib/cms/discovery/match");
  const { attention } = await import("@/app/admin/cms/discovery/lead-view");
  type Lead = import("@/lib/cms/discovery/repository").Lead;

  const req = (method: string, opts: { cookie?: boolean; origin?: string } = {}) => new NextRequest(`${ORIGIN}/api/admin/cms/discovery/run`, {
    method, headers: { origin: opts.origin ?? ORIGIN, ...(opts.cookie === false ? {} : { cookie: `admin_sid=${token}` }) } });
  const info = async (opts = {}) => { const r = await runRoute.GET(req("GET", opts)); return { status: r.status, d: await r.json() }; };
  const run = async (opts = {}) => { const r = await runRoute.POST(req("POST", opts)); return { status: r.status, d: await r.json() }; };
  const count = async () => (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM discovery_leads")).rows[0].n;

  const job = async (slug: string, org: string, title: string, notice: string | null) => (await pg.query<{ id: string }>(
    "INSERT INTO recruitments (slug, organization_id, organization_name, title_text, identity) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [slug, org, org.toUpperCase(), title, JSON.stringify({ title: { value: title }, notificationNumber: { value: notice }, recruitmentYear: 2026 })])).rows[0].id;
  const sscCgl = await job("ssc-cgl-2026", "ssc", "SSC CGL 2026 Notification", "05/2026");
  await job("ibps-rrb-xv-2026", "ibps", "IBPS RRB XV Officers and Office Assistants 2026", null);
  const bpsc71 = await job("bpsc-71-cce-2026", "bpsc", "BPSC 71st Combined Competitive Exam 2026", "22/2026");
  const fingerprint = async () => JSON.stringify((await pg.query("SELECT id, record_revision, updated_at, draft_state, identity FROM recruitments ORDER BY id")).rows)
    + JSON.stringify((await pg.query("SELECT (SELECT count(*) FROM field_revisions) AS f, (SELECT count(*) FROM published_recruitments) AS p, (SELECT count(*) FROM recruitment_audit_events) AS a, (SELECT count(*) FROM recruitment_imports) AS i")).rows);
  const before = await fingerprint();

  // ── A ──
  section(S.A);
  const offInfo = await info();
  const offRun = await run();
  check("A1 by default scans are off: the view says so, a run is refused, nothing is fetched or saved",
    offInfo.d.mode === "off" && offRun.status === 409 && /not enabled/.test(offRun.d.error) && (await count()) === 0 && outside === 0, { offInfo: offInfo.d.mode, offRun });
  check("A2 test pages are used only when a folder of them is named, never on Vercel, and never mistaken for live",
    runMode({ DISCOVERY_FIXTURES_DIR: FIXTURES } as never) === "fixtures" && runMode({ DISCOVERY_FIXTURES_DIR: FIXTURES, VERCEL: "1" } as never) === "off"
    && runMode({ DISCOVERY_FIXTURES_DIR: FIXTURES, DISCOVERY_LIVE_SCAN: "on" } as never) === "fixtures" && runMode({} as never) === "off" && runMode({ DISCOVERY_LIVE_SCAN: "yes" } as never) === "off");

  // ── B ──
  section(S.B);
  process.env.DISCOVERY_FIXTURES_DIR = FIXTURES;
  const testInfo = await info();
  const first = await run();
  const leads = await listLeads();
  const ids = ["freejobalert-rss", "sarkariresult-latest", "govtjobguru-latest", "ibps-notifications-html", "updates-portal"];
  check("B1 an admin's run reads the four enabled portals (and the test update page) and reports each",
    testInfo.d.mode === "fixtures" && first.status === 200 && first.d.complete === true && ids.every((id) => first.d.sources.some((s: { id: string; status: string; items: number }) => s.id === id && s.status === "OK" && s.items > 0)), first.d.sources);
  check("B2 its leads appear in New Jobs Found, unknown organisations included",
    leads.length === 14 && leads.some((l) => l.organizationId === null && /HSSC/.test(l.title)) && leads.some((l) => l.organizationId === null && /Rajasthan Patwari Result/.test(l.title)), leads.length);
  const ov = await updatesOverview();
  check("B3 its update leads appear in Updates needed", ov.leads.length === 6 && ov.leads.every((l) => l.kind === "UPDATE"), ov.leads.map((l) => l.title));
  const cgl = leads.find((l) => l.kind === "NEW" && /SSC CGL 2026/.test(l.title))!, bihar = leads.find((l) => /Bihar Combined Competitive Exam 71st Recruitment/.test(l.title))!;
  check("B4 duplicates and possible matches keep their distinction",
    cgl.match.kind === "DUPLICATE" && cgl.match.recruitmentId === sscCgl && cgl.status === "DUPLICATE" && bihar.match.kind === "POSSIBLE" && bihar.status === "NEW" && bihar.match.candidates.some((c) => c.id === bpsc71));
  check("B5 the summary counts new leads, and labels the run a test run, not a portal scan",
    first.d.mode === "fixtures" && first.d.counts.newLeads === 14 && first.d.counts.alreadyKnown === 0 && first.d.counts.moreSources === 0 && first.d.counts.failedSources === 0 && first.d.counts.sourcesRead === 5
    && /Test run on saved pages \(not a portal scan\)/.test(readFileSync(join(process.cwd(), "src/app/admin/cms/discovery/CheckPortals.tsx"), "utf8")), first.d.counts);

  // ── C ──
  section(S.C);
  const hssc = leads.find((l) => /HSSC/.test(l.title))!;
  const post = async (id: string, body: unknown) => (await leadRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/discovery/leads/${id}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })).status;
  const p1 = await post(hssc.id, { action: "DISMISS", reason: "a state job, not covered" });
  const p2 = await post(bihar.id, { action: "READY_FOR_REVIEW", reason: "check against BPSC" });
  const second = await run();
  check("C1 a second run finds nothing new: every lead is already known, nothing is added",
    second.status === 200 && second.d.counts.newLeads === 0 && second.d.counts.alreadyKnown === 14 && second.d.counts.moreSources === 0 && (await count()) === 14, second.d.counts);
  const tmp = mkdtempSync(join(tmpdir(), "n4-"));
  cpSync(FIXTURES, tmp, { recursive: true });
  writeFileSync(join(tmp, "govtjobguru-home.html"), readFileSync(join(FIXTURES, "govtjobguru-home.html"), "utf8").replace("</main>",
    `<a href="https://www.govtjobguru.in/ssc-cgl-2026-apply/">SSC CGL 2026 Recruitment Apply Online (Advt No. 05/2026)</a></main>`));
  process.env.DISCOVERY_FIXTURES_DIR = tmp;
  const third = await run();
  const cglNow = (await listLeads()).filter((l) => l.kind === "NEW" && /SSC CGL 2026/.test(l.title));
  check("C2 a known lead seen on another portal gains that source and is counted so, not as new",
    third.d.counts.newLeads === 0 && third.d.counts.moreSources === 1 && third.d.counts.alreadyKnown === 13 && cglNow.length === 1 && cglNow[0].sources.length === 3, third.d.counts);
  const after = await listLeads();
  check("C3 the admin's decisions survive the reruns",
    p1 === 200 && p2 === 200 && after.find((l) => l.id === hssc.id)!.status === "DISMISSED" && after.find((l) => l.id === bihar.id)!.status === "READY_FOR_REVIEW" && after.find((l) => l.id === cgl.id)!.status === "DUPLICATE");

  // ── D ──
  section(S.D);
  const manifest = JSON.parse(readFileSync(join(tmp, "manifest.json"), "utf8"));
  manifest.extraSources.push({ id: "broken-portal", name: "Broken portal (test)", type: "HTML_LINKS", url: "https://broken.example/jobs", tier: 5, enabled: true });
  manifest.extraSources.push({ id: "robots-portal", name: "Robots portal (test)", type: "HTML_LINKS", url: "https://robots.example/jobs", tier: 5, enabled: true });
  manifest.extraSources.push({ id: "bad-scheme", name: "Bad address (test)", type: "HTML_LINKS", url: "javascript:alert(1)", tier: 5, enabled: true });
  manifest.pages["https://robots.example/robots.txt"] = { file: "robots.txt", type: "text/plain" };
  manifest.pages["https://robots.example/jobs"] = { file: "sarkariresult-latest.html", type: "text/html" };
  writeFileSync(join(tmp, "robots.txt"), "User-agent: *\nDisallow: /jobs\n");
  writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest));
  const fourth = await run();
  const st = (id: string) => fourth.d.sources.find((s: { id: string }) => s.id === id) as { status: string; error?: string } | undefined;
  check("D1 one source failing is reported, the others are read, and the run is marked incomplete",
    fourth.status === 200 && fourth.d.complete === false && st("broken-portal")?.status === "UNAVAILABLE" && ids.every((id) => st(id)?.status === "OK") && fourth.d.counts.failedSources === 3 && fourth.d.counts.sourcesRead === 5, fourth.d.sources);
  check("D2 a page its robots.txt disallows is not read, and said", st("robots-portal")?.status === "REFUSED" && /robots\.txt/.test(st("robots-portal")?.error ?? ""), st("robots-portal"));
  const priv = await collectLeads({ sleep: async () => {}, sources: ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/jobs"].map((url, i) => ({ id: `private-${i}`, name: "private", type: "HTML_LINKS" as const, url, tier: 5 as const, enabled: true })) });
  check("D3 an address that is not http(s) is refused; private and metadata addresses are refused by the safe fetch",
    st("bad-scheme")?.status === "REFUSED" && priv.sources.every((s) => s.status === "REFUSED" && /private network/.test(s.error ?? "")), { bad: st("bad-scheme"), priv: priv.sources });

  // ── E ──
  section(S.E);
  process.env.DISCOVERY_FIXTURES_DIR = FIXTURES;
  const [r1, r2] = await Promise.all([run(), run()]);
  check("E1 two runs at once: the second is refused while the first goes on",
    [r1.status, r2.status].sort().join(",") === "200,409" && /already running/.test((r1.status === 409 ? r1 : r2).d.error) && (await run()).status === 200, [r1.status, r2.status]);
  const anonInfo = await info({ cookie: false }), anonRun = await run({ cookie: false }), foreign = await run({ origin: "https://evil.example" });
  check("E2 without a session the switch and the run are refused; a run from another origin is refused",
    anonInfo.status === 401 && anonRun.status === 401 && foreign.status === 403, [anonInfo.status, anonRun.status, foreign.status]);
  const collectorSrc = readFileSync(join(process.cwd(), "src/lib/cms/discovery/collector.ts"), "utf8");
  check("E3 a run reads at most ten sources and a hundred links from each",
    MAX_ITEMS_PER_SOURCE === 100 && /const MAX_SOURCES = 10;/.test(collectorSrc) && /\.slice\(0, MAX_SOURCES\)/.test(collectorSrc));

  // ── F ──
  section(S.F);
  const oldRule = (n: string) => { const k = n.replace(/^(?:advt\.?\s*)?no\.?\s*/i, "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return k.length >= 4 && /\d/.test(k) ? k : null; };
  check("F1 a notice number that is only a word and a year (“XV 2026”) is not used to match; real ones still are",
    ["XV 2026", "CGL 2026", "XV/2026", "CRP/RRB/XV/2026", "2026"].every((n) => noticeKey(n) === null) && oldRule("XV 2026") === "XV2026"
    && noticeKey("Advt No. 05/2026") === "052026" && noticeKey("CEN 05/2026") === "CEN052026" && noticeKey("HO:HRM:REC:AO:1:2026") !== null && noticeKey("22/2026") === "222026");
  const wrongJob = [{ id: "ibps-po-xv", organizationId: "ibps", title: "IBPS PO/MT XV 2026", notificationNumber: "XV 2026", year: 2026 }];
  const m = matchLead({ organizationId: "ibps", title: "IBPS RRB XV 2026 Corrigendum Notice", notificationNumber: "XV 2026" }, wrongJob);
  check("F2 such a number no longer makes a duplicate of the wrong CMS job", m.kind !== "DUPLICATE" && !/notice number/.test(m.reason ?? ""), m);
  const two = mkdtempSync(join(tmpdir(), "n4xv-"));
  writeFileSync(join(two, "xv.html"), `<html><body><a href="https://xv.example/corrigendum/">IBPS RRB XV 2026 Corrigendum Notice</a><a href="https://xv.example/result/">IBPS RRB XV 2026 Result Declared</a></body></html>`);
  writeFileSync(join(two, "manifest.json"), JSON.stringify({ pages: { "https://xv.example/updates": { file: "xv.html", type: "text/html" } } }));
  const xvRun = await collectLeads({ sleep: async () => {}, sources: [{ id: "xv-portal", name: "XV portal (test)", type: "HTML_LINKS", url: "https://xv.example/updates", tier: 5, enabled: true }],
    fetchSourceFn: async (u) => u === "https://xv.example/updates" ? { ok: true, finalUrl: u, contentType: "text/html", bytes: readFileSync(join(two, "xv.html")) } : { ok: false, error: "404" } });
  const xvLeads = (await listLeads()).filter((l) => l.sources.some((s) => s.itemUrl.startsWith("https://xv.example/")));
  check("F3 two different updates of one exam with such a number stay two leads",
    xvRun.leads.length === 2 && xvLeads.length === 2 && xvLeads.every((l) => l.sources.length === 1 && l.notificationNumber === "XV 2026"), xvLeads.map((l) => [l.title, l.notificationNumber]));
  const xvLead = xvLeads[0] as Lead;
  check("F4 the inbox says when a lead's notice number is not used",
    attention(xvLead).some((a) => /“XV 2026” looks like part of the title/.test(a)) && !attention(cgl).some((a) => /looks like part of the title/.test(a)));

  // ── G ──
  section(S.G);
  check("G1 no job is created, changed, verified or published by any run", (await fingerprint()) === before);
  check("G2 no request left the machine: no AI, no live portal", outside === 0, outside);

  rmSync(tmp, { recursive: true, force: true });
  rmSync(two, { recursive: true, force: true });
  delete process.env.DISCOVERY_FIXTURES_DIR;
  globalThis.fetch = realFetch;
  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
