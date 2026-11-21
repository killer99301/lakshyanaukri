// ═══════════════════════════════════════════════════════════
// Public data when the database fails (daily-refresh hardening, Nov 2026). In-memory test database, the real
// publish route, the real repository, the real page modules and the real refresh logic. SYNTHETIC data only.
//   A. Healthy: lists, the job page and lifecycle links read the published job; an unknown slug is a normal 404.
//   B. Database failing: every public loader and the pages THROW PublicDataUnavailableError. Nothing returns an
//      empty list, and the job page is not turned into "not found". The refresh's data check refuses (503).
//   C. Database back: the same reads return the job again; the refresh proceeds (200).
//   D. Privacy is unchanged: the public job data carries no internal source detail.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/public-data-failure.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { neonConfig } from "@neondatabase/serverless";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

const S = { A: "A: healthy database", B: "B: database failing", C: "C: database back", D: "D: privacy" };
expectChecks(S.A, ["A1 lists include the published job", "A2 the job page data reads it", "A3 an unknown slug is a normal 404 (undefined)",
  "A4 lifecycle links read without error", "A5 the /jobs and job page modules render"]);
expectChecks(S.B, ["B1 all-jobs list throws PublicDataUnavailableError", "B2 published-jobs list throws", "B3 job by slug throws (not undefined)",
  "B4 an unknown slug also throws: a failure is never reported as 'not found'", "B5 lifecycle links throw", "B6 the /jobs page module throws",
  "B7 the job page module throws the data error, not notFound()", "B8 the refresh's data check refuses with 503 and marks nothing"]);
expectChecks(S.C, ["C1 lists and the job page read the job again", "C2 the refresh proceeds and marks the two paths"]);
expectChecks(S.D, ["D1 the public job data carries no source line, retrieval id or reviewer note; figures kept"]);

const SECRET_ID = "4f7a1c33-9b2d-4e1f-8c55-pdf-failure-test";
const SECRETS = [SECRET_ID, "PDF-PASTED-LINE", "PDF-REVIEWER-NOTE"];

(async () => {
  const { token } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const repo = await import("@/lib/repository");
  const { getLifecycleLinks } = await import("@/lib/cms/lifecycle-links");
  const { runPublicRefresh } = await import("@/lib/public-refresh");
  const { getAllPublishedSnapshots } = await import("@/lib/cms/public-repository");
  const JobsPage = (await import("@/app/(main)/jobs/page")).default;
  const JobPage = (await import("@/app/(main)/jobs/[slug]/page")).default;

  const req = (path: string, method: string, body?: unknown) => new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const quiet = async <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await f(); } finally { console.error = e; } };
  const errOf = async (f: () => Promise<unknown>) => quiet(async () => { try { await f(); return null; } catch (e) { return e as Error & { digest?: string }; } });
  const isDataError = (e: Error | null) => !!e && e.name === "PublicDataUnavailableError";

  // One synthetic published job with a vacancy table whose source details must stay private.
  const r = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "pdf-board", organizationName: "Test PDF Recruitment Board", govType: "Central Govt", title: "TEST PDF Clerk Recruitment 2098", recruitmentYear: 2098 }));
  const rec = (await r.json()).record as { id: string; slug: string; recordRevision: string };
  let rev = rec.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${rec.id}/fields`, "PATCH", { fieldPath, field: manual(value), clientRevision: rev, reason: "pdf test" }), ctx(rec.id));
    const j = await res.json(); if (!j.record) throw new Error(`setup: ${fieldPath} → ${JSON.stringify(j).slice(0, 300)}`); rev = j.record.recordRevision;
  };
  await patch("dates.applicationCloseDate", "2098-01-31");
  await patch("vacancies.total", 75);
  await patch("vacancies.table", {
    dimensions: [{ key: "post", label: "Post" }],
    categories: [...["ur", "obc", "sc"].map((k) => ({ key: k, label: k.toUpperCase(), kind: "VERTICAL" })),
      { key: "pwd", label: "PwBD", kind: "HORIZONTAL", established: { by: "ADMIN", note: "PDF-REVIEWER-NOTE checked" } }],
    rows: [{ id: "c1", at: { post: "Clerk" }, status: "STATED", total: 75, cells: { ur: 40, obc: 20, sc: 15, pwd: 3 },
      source: { retrievalId: SECRET_ID, page: 4, line: "PDF-PASTED-LINE Clerk 40 20 15 75", readBy: "PREPARED" } }],
    statedTotals: [],
  });
  await patch("links", [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://pdf.example.gov.in/notice.pdf", official: true }]);
  await approve.POST(req(`/api/admin/cms/records/${rec.id}/approve`, "POST"), ctx(rec.id));
  const pub = await quiet(async () => publish.POST(req(`/api/admin/cms/records/${rec.id}/publish`, "POST", await approved(rec.id)), ctx(rec.id)));
  if (pub.status !== 200) throw new Error(`setup: publish → ${pub.status}`);

  const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
  const refreshDeps = (calls: string[]) => ({
    secret: "pdf-test-secret", authorization: "Bearer pdf-test-secret",
    countPublishedJobs: async () => (await getAllPublishedSnapshots()).length,
    revalidate: (p: string) => { calls.push(p); }, log: () => {},
  });

  section(S.A);
  const all = await repo.getAllVerifiedOpportunitiesWithCMS(), published = await repo.getPublishedCmsOpportunities();
  check("A1 lists include the published job", all.some((j) => j.slug === rec.slug) && published.some((j) => j.slug === rec.slug), { all: all.length, published: published.length });
  const job = await repo.getBySlug(rec.slug);
  check("A2 the job page data reads it", job?.slug === rec.slug);
  check("A3 an unknown slug is a normal 404 (undefined)", (await repo.getBySlug("no-such-job-pdf-2098")) === undefined);
  check("A4 lifecycle links read without error", Array.isArray((await getLifecycleLinks()).results));
  const jobsOk = (await errOf(() => JobsPage())) === null, jobOk = (await errOf(() => JobPage(params(rec.slug)))) === null;
  check("A5 the /jobs and job page modules render", jobsOk && jobOk, { jobsOk, jobOk });

  section(S.B);
  const healthyFetch = neonConfig.fetchFunction;
  neonConfig.fetchFunction = async () => { throw new TypeError("fetch failed: connect ECONNREFUSED (simulated outage)"); };
  check("B1 all-jobs list throws PublicDataUnavailableError", isDataError(await errOf(() => repo.getAllVerifiedOpportunitiesWithCMS())));
  check("B2 published-jobs list throws", isDataError(await errOf(() => repo.getPublishedCmsOpportunities())));
  check("B3 job by slug throws (not undefined)", isDataError(await errOf(() => repo.getBySlug(rec.slug))));
  check("B4 an unknown slug also throws: a failure is never reported as 'not found'", isDataError(await errOf(() => repo.getBySlug("no-such-job-pdf-2098"))));
  check("B5 lifecycle links throw", isDataError(await errOf(() => getLifecycleLinks())));
  check("B6 the /jobs page module throws", isDataError(await errOf(() => JobsPage())));
  const jobErr = await errOf(() => JobPage(params(rec.slug)));
  check("B7 the job page module throws the data error, not notFound()", isDataError(jobErr) && !String(jobErr?.digest ?? "").includes("NOT_FOUND"), { name: jobErr?.name, digest: jobErr?.digest });
  const calls: string[] = [];
  const refused = await quiet(() => runPublicRefresh(refreshDeps(calls)));
  check("B8 the refresh's data check refuses with 503 and marks nothing", refused.status === 503 && calls.length === 0, refused);

  section(S.C);
  neonConfig.fetchFunction = healthyFetch;
  const back = (await repo.getAllVerifiedOpportunitiesWithCMS()).some((j) => j.slug === rec.slug) && (await repo.getBySlug(rec.slug))?.slug === rec.slug;
  check("C1 lists and the job page read the job again", back);
  const calls2: string[] = [];
  const ok = await runPublicRefresh(refreshDeps(calls2));
  check("C2 the refresh proceeds and marks the two paths", ok.status === 200 && calls2.join(",") === "/,/sitemap.xml", ok);

  section(S.D);
  const s = JSON.stringify(await repo.getBySlug(rec.slug));
  check("D1 the public job data carries no source line, retrieval id or reviewer note; figures kept",
    SECRETS.every((x) => !s.includes(x)) && !/"(readBy|sourceLine|suggested)"/.test(s) && s.includes("75"), s.slice(0, 200));

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
