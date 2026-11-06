// ═══════════════════════════════════════════════════════════
// Discovery: Stage 1 real-source reader corrections
//
// Found on the real FreeJobAlert, SarkariResult, GovtJobGuru and IBPS pages:
// SarkariResult's "… Online Form 2026 | Last Date …" jobs were skipped; "Food
// Safety Extension Officer" was taken for a date extension; menu links were
// kept as leads; GovtJobGuru titles ran on into the table row and kept
// "&#038;"; the same OPSC ASO job on two portals was not suggested as related;
// an AIIMS Patna job was a possible match for the IBPS PO/MT job.
// The titles below copy the shapes of the real ones. Through the real readers,
// collector, matcher and repository on the in-memory test database; pages
// are answered by stand-in fetches. Any request leaving the machine is counted:
// none expected.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/reader-corrections.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

const S = { A: "A: what a portal link is", B: "B: the matcher", C: "C: through the collector" };
expectChecks(S.A, [
  "A1 SarkariResult “Online Form 2026 | Last Date”, offline form and walk-in with a year or post count are new jobs",
  "A2 “Online Form” alone, with no year, post count or last date, is not a lead",
  "A3 “Extension Officer” is a post, not an update; a last-date or application extension is an update",
  "A4 TNPSC “(Last Date Extended)” is an update and keeps the whole title",
  "A5 correction forms, document uploads, re-opened forms, score cards and cancellations are updates",
  "A6 menu and section links are not leads",
  "A7 short titles that name one recruitment (IBPS RRB XV, CRP-SPL-XVI) are not taken for menu links",
  "A8 entities are decoded and a table row's trailing cells are cut, never what names the job",
]);
expectChecks(S.B, [
  "B1 the same OPSC ASO job on two portals, organisation not recognised: suggested as related, not merged",
  "B2 different posts, years or post counts of one body are not suggested as related",
  "B3 an AIIMS Patna job is not a possible match for the IBPS PO/MT job",
  "B4 an unrecognised-organisation lead naming the job's exam is still a possible match",
  "B5 SSC CHSL/CGL, IBPS RRB/PO and BPSC 70th/71st are still told apart",
]);
expectChecks(S.C, [
  "C1 the readers keep the SarkariResult jobs and updates and drop the menu links",
  "C2 GovtJobGuru titles are cleaned before they are stored",
  "C3 the OPSC ASO leads from two portals are related, and the AIIMS lead matches no job",
  "C4 reruns keep every lead, every source, its portal and link, and the admin's decisions",
  "C5 no job is created, changed, verified or published; no request left the machine",
]);

(async () => {
  let outside = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) { outside++; throw new Error(`blocked: ${u}`); }
    return realFetch(input, init);
  }) as typeof fetch;

  const { pg, adminId } = await boot();
  delete process.env.GEMINI_API_KEY;
  const { classifyLink, cleanTitle } = await import("@/lib/cms/discovery/link-rules");
  const { matchLead, relatedLeadTitles } = await import("@/lib/cms/discovery/match");
  const { collectLeads } = await import("@/lib/cms/discovery/collector");
  const { listLeads, reviewLead } = await import("@/lib/cms/discovery/repository");

  const kind = (t: string, href?: string) => { const v = classifyLink(t, href); return "skip" in v ? "skip" : v.kind; };

  // ── A ──
  section(S.A);
  const forms = [
    "Hindustan Copper Limited HCL Apprentice Online Form 2026 | Last Date : 24/11/2026",
    "Railway RRB NTPC Graduate Level CEN 06/2026 Online Form | Last Date 06/11/2026",
    "UPSSSC Sports Directorate Online Form 2026 for 108 Post | Last Date : 15/11/2026",
    "Patna High Court Stenographer Offline Form 2026",
    "SBC Exports Recruitment 2026 – Walkin for 3 Scientific Assistant, Technician Posts",
  ];
  check("A1 SarkariResult “Online Form 2026 | Last Date”, offline form and walk-in with a year or post count are new jobs",
    forms.every((t) => kind(t) === "NEW"), forms.map((t) => [t, kind(t)]));
  const bare = ["Online Form", "Apply Online Form Here", "Offline Form Download"];
  check("A2 “Online Form” alone, with no year, post count or last date, is not a lead", bare.every((t) => kind(t) === "skip"), bare.map((t) => [t, kind(t)]));
  const officers = ["Bihar BPSC Food Safety Extension Officer Online Form 2026 | Last Date : 20/11/2026", "Agriculture Extension Officer Recruitment 2026 – Apply Online for 120 Posts"];
  const ext = ["SSC GD Constable 2026 Last Date Extended", "UPSSSC PET 2026 Application Date Extension", "NHM Staff Nurse 2026 Extension of Application Deadline", "RRB Group D Registration Extension Notice 2026"];
  check("A3 “Extension Officer” is a post, not an update; a last-date or application extension is an update",
    officers.every((t) => kind(t) === "NEW") && ext.every((t) => kind(t) === "UPDATE"), [...officers, ...ext].map((t) => [t, kind(t)]));
  const tn = "TNPSC Group 4 Recruitment 2026 – 6574 Junior Assistant & Other Posts (Last Date Extended)";
  const tnV = classifyLink(tn);
  check("A4 TNPSC “(Last Date Extended)” is an update and keeps the whole title", !("skip" in tnV) && tnV.kind === "UPDATE" && tnV.title === tn, tnV);
  const upd = [
    "IBPS Clerk 16th Correction Form 2026", "UPESSC UP Primary Teacher (Super TET) Correction / Edit Form 2026 | Last Date : 07/11/2026",
    "UPSSSC Stenographer 2024 Documents Upload", "UPSSSC Stenographer 2023 Document Uploads | Last Date : 11/11/2026",
    "JSSC JILCCE Inter Level Online Form 2026 Re Open | Last Date : 20/11/2026", "RBI Office Attendant Score Card 2026", "HPSC Lecturer Recruitment 2026 Cancelled",
  ];
  check("A5 correction forms, document uploads, re-opened forms, score cards and cancellations are updates", upd.every((t) => kind(t) === "UPDATE"), upd.map((t) => [t, kind(t)]));
  const menus: Array<[string, string?]> = [
    ["Admit Card", "https://www.sarkariresult.com/admitcard/"], ["Answer Keys", "https://govtjobguru.in/answer-key/"], ["SARKARI RESULT®", "https://www.sarkariresult.com/"],
    ["HOME RECRUITMENT EXAMS"], ["IBPS Advertisement", "https://www.ibps.in/advertisement/"], ["Latest Jobs Online Form", "https://www.sarkariresult.com/latestjob/"], ["View More"],
  ];
  check("A6 menu and section links are not leads", menus.every(([t, h]) => kind(t, h) === "skip"), menus.map(([t, h]) => [t, classifyLink(t, h)]));
  const ids: Array<[string, string]> = [
    ["IBPS RRB XV Notification", "https://www.ibps.in/crp-rrb-xv/"], ["CRP-SPL-XVI Notification", "https://www.ibps.in/crp-spl-xvi/"], ["BPSC 71st Result", "https://www.bpsc.bih.nic.in/results/"],
  ];
  check("A7 short titles that name one recruitment (IBPS RRB XV, CRP-SPL-XVI) are not taken for menu links",
    ids.every(([t, h]) => kind(t, h) !== "skip"), ids.map(([t, h]) => [t, classifyLink(t, h)]));
  const cleaned = [
    [cleanTitle("SDSC SHAR Apprentice Recruitment 2026 – Apply Online for 400 Posts 400 SDSC SHAR B.E./B.Tech, Diploma 25/11/2026"), "SDSC SHAR Apprentice Recruitment 2026 – Apply Online for 400 Posts"],
    [cleanTitle("OSSSC JHT &#038; Other Recruitment 2026 &#8211; Apply Online for 50 Posts"), "OSSSC JHT & Other Recruitment 2026 – Apply Online for 50 Posts"],
    [cleanTitle("AP DSC Teacher Recruitment 2026 – Apply Online for 2721 SA SGT Principal PGT TGT PET Posts"), "AP DSC Teacher Recruitment 2026 – Apply Online for 2721 SA SGT Principal PGT TGT PET Posts"],
    [cleanTitle(tn), tn],
  ];
  check("A8 entities are decoded and a table row's trailing cells are cut, never what names the job", cleaned.every(([a, b]) => a === b), cleaned);

  // ── B ──
  section(S.B);
  const OPSC_A = "OPSC ASO Recruitment 2026 – Apply Online for 340 Assistant Section Officer Posts";
  const OPSC_B = "OPSC Assistant Section Officer Recruitment 2026 – Apply Online for 340 Posts";
  const b1 = relatedLeadTitles({ title: OPSC_A, organizationId: null }, { title: OPSC_B, organizationId: null });
  check("B1 the same OPSC ASO job on two portals, organisation not recognised: suggested as related, not merged", !!b1 && /not merged/.test(b1), b1);
  const unrelated = [
    relatedLeadTitles({ title: OPSC_B, organizationId: null }, { title: "OPSC Assistant Section Officer Recruitment 2025 – Apply Online for 340 Posts", organizationId: null }),
    relatedLeadTitles({ title: OPSC_B, organizationId: null }, { title: "OPSC Assistant Section Officer Recruitment 2026 – Apply Online for 120 Posts", organizationId: null }),
    relatedLeadTitles({ title: OPSC_B, organizationId: null }, { title: "OPSC Lecturer Recruitment 2026 – Apply Online for 340 Posts", organizationId: null }),
    relatedLeadTitles({ title: OPSC_B, organizationId: null }, { title: "OSSC Assistant Section Officer Recruitment 2026 – Apply Online for 340 Posts", organizationId: null }),
    relatedLeadTitles({ title: "AIIMS Patna Recruitment 2026 – Apply Offline for 11 Superintendent Posts", organizationId: null }, { title: "AIIMS Patna Recruitment 2026 – Apply Offline for Manifold Technician Posts", organizationId: null }),
  ];
  check("B2 different posts, years or post counts of one body are not suggested as related", unrelated.every((r) => r === null), unrelated);
  const IBPS = "Institute of Banking Personnel Selection";
  const poJob = { id: "ibps-po", organizationId: "ibps", organizationName: IBPS, title: "IBPS PO/MT XVI 2026", notificationNumber: null, year: 2026 };
  const spl = { id: "ibps-spl", organizationId: "ibps", organizationName: IBPS, title: "IBPS SO Specialist Officer CRP-SPL-XVI 2026", notificationNumber: null, year: 2026 };
  const L = (title: string) => ({ organizationId: null, organizationName: null, title, notificationNumber: null });
  const b3 = matchLead(L("AIIMS Patna Recruitment 2026 – Apply Offline for Manifold Technician, Store Keeper Posts"), [poJob, spl]);
  check("B3 an AIIMS Patna job is not a possible match for the IBPS PO/MT job", b3.candidates.length === 0 && b3.kind !== "POSSIBLE", b3);
  const b4 = matchLead(L("Result Status of Online Preliminary Examination for CRP-SPL-XVI"), [poJob, spl]);
  check("B4 an unrecognised-organisation lead naming the job's exam is still a possible match", b4.kind === "POSSIBLE" && b4.candidates[0]?.id === "ibps-spl", b4);
  const J = (id: string, org: string, title: string) => ({ id, organizationId: org, organizationName: org.toUpperCase(), title, notificationNumber: null, year: 2026 });
  const KL = (org: string, title: string) => ({ organizationId: org, organizationName: org.toUpperCase(), title, notificationNumber: null });
  const five = [
    [matchLead(KL("ssc", "SSC CHSL 2026 Admit Card Out"), [J("cgl", "ssc", "SSC CGL 2026 Notification"), J("chsl", "ssc", "SSC CHSL 2026 Notification")]), "chsl"],
    [matchLead(KL("ibps", "IBPS RRB XV 2026 Corrigendum Notice"), [J("po", "ibps", "IBPS PO/MT XV 2026"), J("rrb", "ibps", "IBPS RRB XV Officers and Office Assistants 2026")]), "rrb"],
    [matchLead(KL("bpsc", "BPSC 71st CCE Result 2026 Declared"), [J("b70", "bpsc", "BPSC 70th Combined Competitive Exam 2026"), J("b71", "bpsc", "BPSC 71st Combined Competitive Exam 2026")]), "b71"],
  ] as const;
  const wrong = [
    matchLead(KL("ibps", "IBPS RRB XV 2026 Corrigendum Notice"), [J("po", "ibps", "IBPS PO/MT XV 2026")]),
    matchLead(KL("bpsc", "BPSC 70th CCE Result 2026 Declared"), [J("b71", "bpsc", "BPSC 71st Combined Competitive Exam 2026")]),
  ];
  check("B5 SSC CHSL/CGL, IBPS RRB/PO and BPSC 70th/71st are still told apart",
    five.every(([m, id]) => m.kind === "STRONG" && m.recruitmentId === id) && wrong.every((m) => m.kind !== "STRONG" && m.kind !== "DUPLICATE"),
    [...five.map(([m]) => [m.kind, m.recruitmentId]), ...wrong.map((m) => [m.kind, m.reason])]);

  // ── C ──
  section(S.C);
  await pg.query("INSERT INTO recruitments (slug, organization_id, organization_name, title_text, identity) VALUES ($1,$2,$3,$4,$5)",
    ["ibps-po-mt-xvi-2026", "ibps", IBPS, "IBPS PO/MT XVI 2026", JSON.stringify({ title: { value: "IBPS PO/MT XVI 2026" }, notificationNumber: { value: null }, recruitmentYear: 2026 })]);
  const fingerprint = async () => JSON.stringify((await pg.query("SELECT id, record_revision, updated_at, draft_state, identity FROM recruitments ORDER BY id")).rows)
    + JSON.stringify((await pg.query("SELECT (SELECT count(*) FROM field_revisions) AS f, (SELECT count(*) FROM published_recruitments) AS p, (SELECT count(*) FROM recruitment_audit_events) AS a")).rows);
  const SR = "https://sr.example/latestjob/", GJG = "https://gjg.example/", FEED = "https://fja.example/feed/";
  const PAGES: Record<string, { type: string; body: string }> = {
    [SR]: { type: "text/html", body: `<html><body>
      <a href="https://sr.example/">SARKARI RESULT®</a> <a href="https://sr.example/admitcard/">Admit Card</a> <a href="https://sr.example/latestjob/">Latest Jobs</a>
      <ul><li><a href="https://sr.example/2026/hcl-apprentice-nov26/">Hindustan Copper Limited HCL Apprentice Online Form 2026 | Last Date : 24/11/2026</a></li>
      <li><a href="https://sr.example/2026/bpsc-fso-oct26/">Bihar BPSC Food Safety Extension Officer Online Form 2026 | Last Date : 20/11/2026</a></li>
      <li><a href="https://sr.example/2026/upessc-primary-teacher/">UPESSC UP Primary Teacher (Super TET) Correction / Edit Form 2026 | Last Date : 07/11/2026</a></li>
      <li><a href="https://sr.example/2026/tnpsc-group4/">TNPSC Group 4 Recruitment 2026 – 6574 Junior Assistant &amp; Other Posts (Last Date Extended)</a></li></ul></body></html>` },
    [GJG]: { type: "text/html", body: `<html><body><a href="https://gjg.example/answer-key/">Answer Keys</a> <a href="https://gjg.example/more/">View More</a>
      <table><tr><td><a href="https://gjg.example/opsc-aso-recruitment-2026/">OPSC ASO Recruitment 2026 &#8211; Apply Online for 340 Assistant Section Officer Posts 340 OPSC Graduate 30/11/2026</a></td></tr>
      <tr><td><a href="https://gjg.example/osssc-jht-recruitment-2026/">OSSSC JHT &#038; Other Recruitment 2026 &#8211; Apply Online for 50 Posts</a></td></tr></table></body></html>` },
    [FEED]: { type: "application/rss+xml", body: `<?xml version="1.0"?><rss version="2.0"><channel><title>FJA</title>
      <item><title>OPSC Assistant Section Officer Recruitment 2026 – Apply Online for 340 Posts</title><link>https://fja.example/opsc-aso-2026/</link><description>Odisha Public Service Commission ASO posts.</description></item>
      <item><title>AIIMS Patna Recruitment 2026 – Apply Offline for Manifold Technician, Store Keeper Posts</title><link>https://fja.example/aiims-patna-2026/</link><description>AIIMS Patna recruitment.</description></item>
      </channel></rss>` },
  };
  const sources = [
    { id: "sr-test", name: "SR (test)", type: "HTML_LINKS" as const, url: SR, tier: 5 as const, enabled: true },
    { id: "gjg-test", name: "GJG (test)", type: "HTML_LINKS" as const, url: GJG, tier: 5 as const, enabled: true },
    { id: "fja-test", name: "FJA (test)", type: "RSS" as const, url: FEED, tier: 5 as const, enabled: true },
  ];
  const collect = () => collectLeads({ sources, sleep: async () => {}, fetchSourceFn: async (u) => PAGES[u] ? { ok: true, finalUrl: u, contentType: PAGES[u].type, bytes: Buffer.from(PAGES[u].body) } : { ok: false, error: "404" } });
  const before = await fingerprint();
  await collect();
  const leads = await listLeads();
  const t = (re: RegExp) => leads.filter((l) => re.test(l.title));
  check("C1 the readers keep the SarkariResult jobs and updates and drop the menu links",
    t(/HCL Apprentice/)[0]?.kind === "NEW" && t(/Extension Officer/)[0]?.kind === "NEW" && t(/Correction \/ Edit/)[0]?.kind === "UPDATE" && t(/TNPSC Group 4/)[0]?.kind === "UPDATE"
    && !leads.some((l) => /^(SARKARI RESULT|Admit Card|Latest Jobs|Answer Keys|View More)/i.test(l.title)) && leads.length === 8,
    leads.map((l) => [l.kind, l.title]));
  check("C2 GovtJobGuru titles are cleaned before they are stored",
    t(/OPSC ASO/)[0]?.title === "OPSC ASO Recruitment 2026 – Apply Online for 340 Assistant Section Officer Posts" && t(/OSSSC JHT/)[0]?.title === "OSSSC JHT & Other Recruitment 2026 – Apply Online for 50 Posts",
    leads.filter((l) => l.sources.some((s) => s.sourceId === "gjg-test")).map((l) => l.title));
  const [oa, ob] = [t(/OPSC ASO/)[0], t(/OPSC Assistant Section Officer/)[0]];
  const aiims = t(/AIIMS Patna/)[0];
  check("C3 the OPSC ASO leads from two portals are related, and the AIIMS lead matches no job",
    !!oa && !!ob && oa.id !== ob.id && oa.relatedLeads.some((r) => r.leadId === ob.id) && ob.relatedLeads.some((r) => r.leadId === oa.id)
    && !!aiims && aiims.match.candidates.length === 0 && aiims.relatedLeads.length === 0,
    { oa: oa?.relatedLeads, ob: ob?.relatedLeads, aiims: aiims?.match });
  await reviewLead({ id: oa.id, adminId, action: "NEEDS_SOURCE", reason: "find the OPSC notice" });
  await collect();
  await collect();
  const again = await listLeads();
  const oa2 = again.find((l) => l.id === oa.id)!;
  const srcRows = (await pg.query<{ n: number; bad: number }>("SELECT count(*)::int AS n, count(*) FILTER (WHERE source_id = '' OR item_url = '' OR listing_url = '')::int AS bad FROM discovery_lead_sources")).rows[0];
  check("C4 reruns keep every lead, every source, its portal and link, and the admin's decisions",
    again.length === 8 && srcRows.n === 8 && srcRows.bad === 0 && oa2.status === "NEEDS_SOURCE" && oa2.statusReason === "find the OPSC notice" && oa2.seenRuns === 3
    && oa2.relatedLeads.length === 1, { leads: again.length, srcRows, oa2: [oa2.status, oa2.seenRuns, oa2.relatedLeads] });
  check("C5 no job is created, changed, verified or published; no request left the machine", (await fingerprint()) === before && outside === 0, outside);

  globalThis.fetch = realFetch;
  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
