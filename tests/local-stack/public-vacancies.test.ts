// ═══════════════════════════════════════════════════════════
// Public vacancy data on the in-memory test database, through the real publish route, the real repository and the
// real page modules. SYNTHETIC data only. Never touches production.
//   A. The stored record and its publication keep every source detail (line, retrieval id, page, how it was read,
//      suggested spellings, reviewer notes).
//   B. The public job data (job page, related jobs, every list) carries none of them; the figures are unchanged.
//   C. What the pages hand to the browser (home, /jobs, exams, eligibility, companies, the job page) carries none.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/public-vacancies.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

const S = { A: "A: the CMS keeps the evidence", B: "B: public job data", C: "C: what pages send to browsers" };
expectChecks(S.A, ["A1 the stored record keeps every source detail", "A2 the published snapshot keeps them too"]);
expectChecks(S.B, ["B1 the job page's data carries no source detail", "B2 every list (all jobs, published jobs, related) carries none",
  "B3 the vacancy section shows exactly what the full table shows", "B4 post-wise rows keep their figures and drop stray fields"]);
expectChecks(S.C, ["C1 home, /jobs, exams, eligibility and companies pass no source detail to the browser", "C2 the job page passes none"]);

const SECRET_ID = "7d1c0a52-5b0e-4c4b-9a77-public-vacancy-test";
const SECRETS = [SECRET_ID, "PV-PASTED-LINE", "PV-IMAGE-LINE", "PV-GRAND-LINE", "PV-REVIEWER-NOTE", "PV-STRAY-FIELD", "Bank Of Indya"];
const INTERNAL_KEYS = /"(readBy|suggested|printedAt|established|evidenceIds|sourceLine)"/;

(async () => {
  const { pg, token } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const repo = await import("@/lib/repository");
  const { VacancyTableSection } = await import("@/components/jobs/VacancyTableSection");

  const req = (path: string, method: string, body?: unknown) => new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const quiet = <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => {}; return f().finally(() => { console.error = e; }); };
  // Serialise what a server component hands on, as React would to the browser (functions dropped, cycles cut).
  const serial = (v: unknown) => { const seen = new WeakSet(); return JSON.stringify(v, (_k, x) => (typeof x === "object" && x !== null ? (seen.has(x) ? undefined : (seen.add(x), x)) : typeof x === "function" ? undefined : x)); };
  const clean = (s: string) => SECRETS.every((x) => !s.includes(x)) && !INTERNAL_KEYS.test(s);

  const table = {
    dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }],
    categories: [
      ...["ur", "ews", "obc", "sc", "st"].map((k) => ({ key: k, label: k.toUpperCase(), kind: "VERTICAL" })),
      { key: "exsm", label: "Ex-Servicemen", kind: "HORIZONTAL", established: { by: "ADMIN", note: "PV-REVIEWER-NOTE checked by phone" } },
    ],
    rows: [
      { id: "p1", at: { post: "Probationary Officer", bank: "Bank of Baroda" }, status: "STATED", total: 100, cells: { ur: 40, ews: 10, obc: 27, sc: 15, st: 8, exsm: 10 },
        source: { retrievalId: SECRET_ID, page: null, line: "PV-PASTED-LINE Bank of Baroda 40 10 27 15 8 100", readBy: "PREPARED" } },
      { id: "p2", at: { post: "Probationary Officer", bank: "Bank of India" }, status: "STATED", total: 50, cells: { ur: 20, ews: 5, obc: 13, sc: 8, st: 4, exsm: 5 },
        source: { retrievalId: SECRET_ID, page: 12, line: "PV-IMAGE-LINE Bank of India 20 5 13 8 4 50", readBy: "AI_IMAGE" }, suggested: { bank: "Bank Of Indya" } },
      { id: "p3", at: { post: "Probationary Officer", bank: "Canara Bank" }, status: "STATED", total: 30, cells: { ur: 12, ews: 3, obc: 8, sc: 5, st: 2, exsm: 3 },
        source: { retrievalId: null, page: null, line: "typed by hand" } },
    ],
    statedTotals: [{ at: {}, total: 180, source: { retrievalId: SECRET_ID, page: 2, line: "PV-GRAND-LINE Total 180" } }],
  };
  const r = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "pv-bank", organizationName: "Test PV Banking Board", govType: "Central Govt", title: "TEST PV Bank PO Recruitment 2097", recruitmentYear: 2097 }));
  const rec = (await r.json()).record as { id: string; slug: string; recordRevision: string };
  let rev = rec.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${rec.id}/fields`, "PATCH", { fieldPath, field: manual(value), clientRevision: rev, reason: "pv test" }), ctx(rec.id));
    const j = await res.json(); if (!j.record) throw new Error(`setup: ${fieldPath} → ${JSON.stringify(j).slice(0, 300)}`); rev = j.record.recordRevision;
  };
  await patch("dates.applicationCloseDate", "2097-01-31");
  await patch("vacancies.total", 180);
  await patch("vacancies.table", table);
  await patch("links", [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://pv.example.gov.in/notice.pdf", official: true }]);
  await approve.POST(req(`/api/admin/cms/records/${rec.id}/approve`, "POST"), ctx(rec.id));
  const pub = await quiet(async () => publish.POST(req(`/api/admin/cms/records/${rec.id}/publish`, "POST", await approved(rec.id)), ctx(rec.id)));
  if (pub.status !== 200) throw new Error(`setup: publish → ${pub.status}`);

  // A second job: post-wise rows with a stray field stored alongside the figures (as old data could have).
  const r2 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "pv-rail", organizationName: "Test PV Railway Board", govType: "Central Govt", title: "TEST PV Railway Technician 2097", recruitmentYear: 2097 }));
  const rec2 = (await r2.json()).record as { id: string; slug: string; recordRevision: string };
  rev = rec2.recordRevision;
  const patch2 = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${rec2.id}/fields`, "PATCH", { fieldPath, field: manual(value), clientRevision: rev, reason: "pv test" }), ctx(rec2.id));
    const j = await res.json(); if (!j.record) throw new Error(`setup: ${fieldPath} → ${JSON.stringify(j).slice(0, 300)}`); rev = j.record.recordRevision;
  };
  const rows = [{ post: "Technician Grade I", count: 120, payScale: "Level 5", breakdown: { ur: 49, ews: 12, obc: 32, sc: 18, st: 9 } }, { post: "Technician Grade III", count: 300 }];
  await patch2("dates.applicationCloseDate", "2097-02-28");
  await patch2("vacancies.total", 420);
  await patch2("vacancies.breakdown", rows);
  await patch2("links", [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://pv-rail.example.gov.in/n.pdf", official: true }]);
  // the stray field written straight into the stored value, as an old import could have left it
  await pg.query(`UPDATE recruitments SET vacancies = jsonb_set(vacancies, '{breakdown,value,0,sourceLine}', '"PV-STRAY-FIELD"') WHERE id = $1`, [rec2.id]);
  await approve.POST(req(`/api/admin/cms/records/${rec2.id}/approve`, "POST"), ctx(rec2.id));
  const pub2 = await quiet(async () => publish.POST(req(`/api/admin/cms/records/${rec2.id}/publish`, "POST", await approved(rec2.id)), ctx(rec2.id)));
  if (pub2.status !== 200) throw new Error(`setup: publish 2 → ${pub2.status}`);

  section(S.A);
  const stored = await getRecruitmentById(rec.id);
  const st = stored?.vacancies?.table?.value as typeof table | undefined;
  check("A1 the stored record keeps every source detail",
    !!st && st.rows[0].source.line.startsWith("PV-PASTED-LINE") && st.rows[0].source.retrievalId === SECRET_ID && st.rows[0].source.readBy === "PREPARED"
      && st.rows[1].source.page === 12 && st.rows[1].suggested?.bank === "Bank Of Indya" && st.categories[5].established?.note.startsWith("PV-REVIEWER-NOTE")
      && st.statedTotals[0].source.line === "PV-GRAND-LINE Total 180");
  const snap = (await pg.query(`SELECT snapshot::text AS s FROM published_recruitments WHERE recruitment_id = $1`, [rec.id]).catch(async () =>
    pg.query(`SELECT row_to_json(p)::text AS s FROM published_recruitments p WHERE p::text LIKE $1`, [`%${rec.id}%`]))).rows as Array<{ s: string }>;
  check("A2 the published snapshot keeps them too", snap.length > 0 && snap.some((x) => x.s.includes("PV-PASTED-LINE") && x.s.includes(SECRET_ID)), snap.length);

  section(S.B);
  const job = await repo.getBySlug(rec.slug) as { vacancyTable?: never; vacancyBreakdown?: unknown } | undefined;
  check("B1 the job page's data carries no source detail", !!job && !!job.vacancyTable && clean(serial(job)));
  const all = serial(await repo.getAllVerifiedOpportunitiesWithCMS()), published = serial(await repo.getPublishedCmsOpportunities());
  const related = serial(await repo.getRelated(job as never, 10));
  check("B2 every list (all jobs, published jobs, related) carries none",
    all.includes("TEST PV Bank PO") && published.includes("TEST PV Bank PO") && clean(all) && clean(published) && clean(related));
  const render = (t: unknown) => renderToStaticMarkup(React.createElement(VacancyTableSection, { table: t as never }));
  const same = render(job!.vacancyTable) === render(st);
  check("B3 the vacancy section shows exactly what the full table shows", same && render(job!.vacancyTable).includes("180"));
  const job2 = await repo.getBySlug(rec2.slug) as { vacancyBreakdown?: unknown } | undefined;
  // The database keeps an object's keys shortest first, so compare regardless of key order.
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
  const storedRows = (await getRecruitmentById(rec2.id))?.vacancies?.breakdown?.value as Array<Record<string, unknown>> | undefined;
  check("B4 post-wise rows keep their figures and drop stray fields",
    storedRows?.[0]?.sourceLine === "PV-STRAY-FIELD" && JSON.stringify(canon(job2?.vacancyBreakdown)) === JSON.stringify(canon(rows)) && clean(serial(job2)),
    { stored: storedRows?.[0]?.sourceLine, public: job2?.vacancyBreakdown });

  section(S.C);
  // Home, /jobs and eligibility hand whole job objects to their client components; exams and companies only counts.
  const pages: Array<[string, boolean, () => Promise<unknown>]> = [
    ["home", true, async () => (await import("@/app/(main)/page")).default()],
    ["/jobs", true, async () => (await import("@/app/(main)/jobs/page")).default({ searchParams: Promise.resolve({}) } as never)],
    ["/eligibility", true, async () => (await import("@/app/(main)/eligibility/page")).default()],
    ["/exams", false, async () => (await import("@/app/(main)/exams/page")).default()],
    ["/companies", false, async () => (await import("@/app/(main)/companies/page")).default()],
  ];
  const outcomes: Record<string, string> = {};
  for (const [name, carriesJobs, load] of pages) {
    try {
      const s = serial(await load());
      outcomes[name] = carriesJobs && !s.includes("TEST PV") ? "job missing" : clean(s) ? "clean" : "LEAK";
    } catch (e) { outcomes[name] = `error: ${String(e).slice(0, 80)}`; }
  }
  check("C1 home, /jobs, exams, eligibility and companies pass no source detail to the browser", Object.values(outcomes).every((o) => o === "clean"), outcomes);
  const detail = await (await import("@/app/(main)/jobs/[slug]/page")).default({ params: Promise.resolve({ slug: rec.slug }) } as never);
  const ds = serial(detail);
  check("C2 the job page passes none", ds.includes("TEST PV Bank PO") && clean(ds));

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
