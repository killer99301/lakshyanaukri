// ═══════════════════════════════════════════════════════════
// Discovery title matching: the same organisation and year is not the same exam
//
// Found in N4: "IBPS RRB XV 2026 Corrigendum" was a strong match to
// "IBPS PO/MT XV 2026" — same organisation and year, and "IBPS" and "XV" in
// both titles. A strong title match now needs the titles to name the same exam.
// Through the real matcher, collector, repository and Updates needed on the
// in-memory test database; leads come from constructed pages answered by
// stand-in fetches. Any request leaving the machine is counted: none expected.
//
// Only matchLead and the collector are used, so this suite also runs against
// the code before the fix, where the wrong-job checks fail.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/title-matching.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

const S = { A: "A: the matcher", B: "B: through the collector", C: "C: Updates needed" };
expectChecks(S.A, [
  "A1 IBPS RRB XV corrigendum against IBPS PO/MT XV: not a strong match, said why, kept for review",
  "A2 the same corrigendum against the IBPS RRB XV recruitment: a strong match to it",
  "A3 same organisation and year, different exams: SSC CHSL's admit card ties to CHSL, not CGL",
  "A4 same organisation and year, ambiguous title: never strong",
  "A5 the same exam with result, admit card, extension or corrigendum wording stays strong",
  "A6 the same exam in a different cycle (BPSC 70th against 71st) is not tied to the other cycle",
  "A7 a valid notice number still makes a duplicate",
  "A8 a year-like notice number (“XV 2026”) cannot tie the corrigendum to the wrong job",
  "A9 strong, possible and unmatched classifications are each given",
]);
expectChecks(S.B, [
  "B1 cross-portal grouping does not merge two IBPS exams, and keeps every source",
  "B2 collected, the RRB corrigendum ties to the RRB job and not to PO/MT",
  "B3 reruns keep every lead, every source and the admin's decisions",
]);
expectChecks(S.C, [
  "C1 with only the PO/MT job in the CMS, Updates needed does not show the RRB corrigendum as that job's",
  "C2 no job is created, changed, verified or published; no request left the machine",
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
  const { matchLead } = await import("@/lib/cms/discovery/match");
  const { collectLeads } = await import("@/lib/cms/discovery/collector");
  const { listLeads, reviewLead } = await import("@/lib/cms/discovery/repository");
  const { updatesForJob, updatesOverview } = await import("@/lib/cms/discovery/updates");

  // ── A: the matcher alone ──
  section(S.A);
  type Job = { id: string; organizationId: string; organizationName?: string; title: string; notificationNumber: string | null; year: number | null };
  const J = (id: string, org: string, name: string, title: string, n: string | null = null): Job => ({ id, organizationId: org, organizationName: name, title, notificationNumber: n, year: 2026 });
  const IBPS = "Institute of Banking Personnel Selection", SSC = "Staff Selection Commission", BPSC = "Bihar Public Service Commission";
  const rrbJob = J("ibps-rrb", "ibps", IBPS, "IBPS RRB XV Officers and Office Assistants 2026");
  const poJob = J("ibps-po", "ibps", IBPS, "IBPS PO/MT XV 2026");
  const cglJob = J("ssc-cgl", "ssc", SSC, "SSC CGL 2026 Notification", "05/2026");
  const chslJob = J("ssc-chsl", "ssc", SSC, "SSC CHSL 2026 Notification");
  const bpsc71 = J("bpsc-71", "bpsc", BPSC, "BPSC 71st Combined Competitive Exam 2026", "22/2026");
  const bpsc70 = J("bpsc-70", "bpsc", BPSC, "BPSC 70th Combined Competitive Exam 2026");
  const L = (org: string | null, name: string | null, title: string, n: string | null = null) => ({ organizationId: org, organizationName: name, title, notificationNumber: n });
  const CORR = L("ibps", IBPS, "IBPS RRB XV 2026 Corrigendum Notice");

  const a1 = matchLead(CORR, [poJob]);
  check("A1 IBPS RRB XV corrigendum against IBPS PO/MT XV: not a strong match, said why, kept for review",
    a1.kind === "POSSIBLE" && a1.candidates.length === 1 && a1.candidates[0].kind === "POSSIBLE" && /different exams/.test(a1.reason ?? ""), a1);
  const a2 = matchLead(CORR, [rrbJob, poJob]);
  check("A2 the same corrigendum against the IBPS RRB XV recruitment: a strong match to it",
    a2.kind === "STRONG" && a2.recruitmentId === "ibps-rrb" && a2.candidates.find((c) => c.id === "ibps-po")?.kind !== "STRONG", a2);
  const a3 = matchLead(L("ssc", SSC, "SSC CHSL 2026 Admit Card Out"), [cglJob, chslJob]);
  check("A3 same organisation and year, different exams: SSC CHSL's admit card ties to CHSL, not CGL",
    a3.kind === "STRONG" && a3.recruitmentId === "ssc-chsl" && !a3.candidates.some((c) => c.id === "ssc-cgl" && c.kind === "STRONG"), a3);
  const amb = [matchLead(L("ibps", IBPS, "IBPS XV 2026 Result Declared"), [rrbJob, poJob]), matchLead(L("ibps", IBPS, "IBPS 2026 Notification Out"), [rrbJob, poJob]), matchLead(L("ssc", SSC, "SSC 2026 Result Declared"), [cglJob, chslJob])];
  check("A4 same organisation and year, ambiguous title: never strong",
    amb.every((m) => m.kind !== "STRONG" && m.kind !== "DUPLICATE" && m.candidates.every((c) => c.kind !== "STRONG")), amb.map((m) => [m.kind, m.reason]));
  const same = [
    [matchLead(L("ibps", IBPS, "IBPS RRB XV Officers Office Assistant Recruitment 2026 Apply Online"), [rrbJob, poJob]), "ibps-rrb"],
    [matchLead(L("ssc", SSC, "SSC CGL 2026 Last Date Extended"), [cglJob, chslJob]), "ssc-cgl"],
    [matchLead(L("bpsc", BPSC, "BPSC 71st CCE Result 2026 Declared"), [bpsc71, bpsc70]), "bpsc-71"],
    [matchLead(L("bpsc", BPSC, "BPSC 71st Combined Competitive Exam Admit Card 2026"), [bpsc71, bpsc70]), "bpsc-71"],
    [matchLead(L("ibps", IBPS, "IBPS RRB XV 2026 Result Declared"), [rrbJob, poJob]), "ibps-rrb"],
  ] as const;
  check("A5 the same exam with result, admit card, extension or corrigendum wording stays strong",
    same.every(([m, id]) => m.kind === "STRONG" && m.recruitmentId === id), same.map(([m]) => [m.kind, m.recruitmentId, m.reason]));
  const a6 = matchLead(L("bpsc", BPSC, "BPSC 70th CCE Result 2026 Declared"), [bpsc71]);
  check("A6 the same exam in a different cycle (BPSC 70th against 71st) is not tied to the other cycle",
    a6.kind !== "STRONG" && a6.kind !== "DUPLICATE" && /different cycles/.test(a6.reason ?? ""), a6);
  const a7 = matchLead(L("ssc", SSC, "SSC CGL 2026 Notification Out – Advt No. 05/2026", "Advt No. 05/2026"), [cglJob, chslJob]);
  check("A7 a valid notice number still makes a duplicate", a7.kind === "DUPLICATE" && a7.recruitmentId === "ssc-cgl", a7);
  const a8 = matchLead(L("ibps", IBPS, "IBPS RRB XV 2026 Corrigendum Notice", "XV 2026"), [{ ...poJob, notificationNumber: "XV 2026" }]);
  check("A8 a year-like notice number (“XV 2026”) cannot tie the corrigendum to the wrong job", a8.kind !== "DUPLICATE" && a8.kind !== "STRONG", a8);
  const kinds = new Set([a2.kind, a1.kind, matchLead(L("upsc", "Union Public Service Commission", "UPSC CSE 2026 Notification"), [rrbJob]).kind, matchLead(L(null, null, "Rajasthan Patwari Result 2026"), [rrbJob]).kind]);
  check("A9 strong, possible and unmatched classifications are each given", ["STRONG", "POSSIBLE", "NONE", "UNRESOLVED"].every((k) => kinds.has(k as never)), [...kinds]);

  // ── B: through the collector ──
  section(S.B);
  const job = async (slug: string, org: string, name: string, title: string, notice: string | null) => (await pg.query<{ id: string }>(
    "INSERT INTO recruitments (slug, organization_id, organization_name, title_text, identity) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [slug, org, name, title, JSON.stringify({ title: { value: title }, notificationNumber: { value: notice }, recruitmentYear: 2026 })])).rows[0].id;
  const poId = await job("ibps-po-mt-xv-2026", "ibps", IBPS, "IBPS PO/MT XV 2026", null);
  const fingerprintBefore = async () => JSON.stringify((await pg.query("SELECT id, record_revision, updated_at, draft_state, identity FROM recruitments ORDER BY id")).rows)
    + JSON.stringify((await pg.query("SELECT (SELECT count(*) FROM field_revisions) AS f, (SELECT count(*) FROM published_recruitments) AS p, (SELECT count(*) FROM recruitment_audit_events) AS a")).rows);

  const PAGES: Record<string, string> = {
    "https://portal-a.example/updates": `<html><body>
      <a href="https://portal-a.example/ibps-rrb-xv-corrigendum/">IBPS RRB XV 2026 Corrigendum Notice</a>
      <a href="https://portal-a.example/ibps-po-mt-xv-result/">IBPS PO/MT XV 2026 Result Declared</a></body></html>`,
    "https://portal-b.example/latest": `<html><body>
      <a href="https://portal-b.example/ibps-rrb-xv-2026-corrigendum/">IBPS RRB XV 2026 Corrigendum Out</a>
      <a href="https://portal-b.example/ibps-po-mt-xv-admit-card/">IBPS PO/MT XV 2026 Admit Card</a></body></html>`,
  };
  const sources = [
    { id: "portal-a", name: "Portal A (test)", type: "HTML_LINKS" as const, url: "https://portal-a.example/updates", tier: 5 as const, enabled: true },
    { id: "portal-b", name: "Portal B (test)", type: "HTML_LINKS" as const, url: "https://portal-b.example/latest", tier: 5 as const, enabled: true },
  ];
  const collect = () => collectLeads({ sources, sleep: async () => {}, fetchSourceFn: async (u) => PAGES[u] ? { ok: true, finalUrl: u, contentType: "text/html", bytes: Buffer.from(PAGES[u]) } : { ok: false, error: "404" } });
  const before = await fingerprintBefore();
  await collect();
  const leads = await listLeads();
  const corr = leads.filter((l) => /RRB XV 2026 Corrigendum/.test(l.title));
  const po = leads.filter((l) => /PO\/MT XV 2026/.test(l.title));
  const exams = (l: (typeof leads)[number]) => new Set(l.sources.map((s) => (/rrb/i.test(s.titleSeen) ? "RRB" : /po\/mt/i.test(s.titleSeen) ? "PO" : "?")));
  check("B1 cross-portal grouping does not merge two IBPS exams, and keeps every source",
    leads.length === 4 && corr.length === 2 && po.length === 2 && leads.every((l) => exams(l).size === 1)
    && leads.reduce((n, l) => n + l.sources.length, 0) === 4, leads.map((l) => [l.title, l.sources.length]));
  check("B2 collected, the RRB corrigendum ties to the RRB job and not to PO/MT",
    corr.every((l) => l.match.kind === "POSSIBLE" && /different exams/.test(l.match.reason ?? ""))
    && po.every((l) => l.match.kind === "STRONG" && l.match.recruitmentId === poId), { corr: corr.map((l) => l.match), po: po.map((l) => l.match.kind) });
  await reviewLead({ id: corr[0].id, adminId, action: "NEEDS_SOURCE", reason: "find the IBPS RRB XV notice" });
  await collect();
  await collect();
  const again = await listLeads();
  const corr2 = again.find((l) => l.id === corr[0].id)!;
  check("B3 reruns keep every lead, every source and the admin's decisions",
    again.length === 4 && again.reduce((n, l) => n + l.sources.length, 0) === 4 && corr2.status === "NEEDS_SOURCE" && corr2.statusReason === "find the IBPS RRB XV notice" && corr2.seenRuns === 3, again.map((l) => [l.title, l.status, l.seenRuns]));

  // ── C ──
  section(S.C);
  const view = (await updatesForJob(poId))!;
  const all = await updatesOverview();
  const corrInAll = all.leads.find((l) => l.id === corr[0].id)!;
  check("C1 with only the PO/MT job in the CMS, Updates needed does not show the RRB corrigendum as that job's",
    corr.every((c) => !view.matched.some((l) => l.id === c.id) && view.possible.some((l) => l.id === c.id)) && view.matched.length === 2
    && corrInAll.match.kind === "POSSIBLE", { matched: view.matched.map((l) => l.title), possible: view.possible.map((l) => l.title) });
  check("C2 no job is created, changed, verified or published; no request left the machine", (await fingerprintBefore()) === before && outside === 0, outside);

  globalThis.fetch = realFetch;
  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
