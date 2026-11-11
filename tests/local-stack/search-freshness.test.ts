// ═══════════════════════════════════════════════════════════
// Search sees what the CMS publishes, and only that (search quality, 11 Nov 2026).
// Through the REAL route handlers and the REAL public job list, against the
// in-memory test database. Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/search-freshness.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

const S = { A: "A. Publishing makes a job searchable", B: "B. What is never searchable" };
expectChecks(S.A, [
  "A1 a newly published job is found by its title, a typo, its body's initials and its notice number",
  "A2 a job of a body new to the site is found by that body's name and initials",
  "A3 an edited and republished job is found by its new title and shows it",
]);
expectChecks(S.B, [
  "B1 a draft never published is not in the public list and not found",
  "B2 an archived job leaves the public list and search",
  "B3 a taken-down job leaves the public list and search",
]);

(async () => {
  const { pg, token } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const takeDown = await import("@/app/api/admin/cms/records/[id]/take-down/route");
  const publicRepo = await import("@/lib/repository");
  const { textSearch, searchOpportunities, getDefaultFilterState } = await import("@/lib/filters");

  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body ? JSON.stringify(body) : undefined });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const revisionOf = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id=$1", [id])).rows[0].record_revision as string;
  const patch = async (id: string, fieldPath: string, value: unknown) =>
    (await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field: manual(value), clientRevision: await revisionOf(id), reason: "search test" }), ctx(id))).status;
  const create = async (body: Record<string, unknown>) => {
    const r = await records.POST(req("/api/admin/cms/records", "POST", body));
    const d = await r.json();
    if (!d.record) throw new Error(`create refused (${r.status}): ${JSON.stringify(d).slice(0, 300)}`);
    return { id: d.record.id as string, slug: d.record.slug as string };
  };
  const publishJob = async (id: string, notice: string) => {
    await patch(id, "dates.applicationOpenDate", "2026-11-01");
    await patch(id, "dates.applicationCloseDate", "2099-12-31");
    await patch(id, "identity.notificationNumber", notice);
    await patch(id, "links", [{ type: "OFFICIAL_NOTIFICATION", label: "Official Notification", url: "https://example.gov.in/notice.pdf", official: true }]);
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id));
    return r.status;
  };
  const list = () => publicRepo.getAllVerifiedOpportunitiesWithCMS();
  const finds = async (q: string, slug: string) => textSearch(await list(), q).some((o) => o.slug === slug);

  section(S.A);
  const ntpc = await create({ organizationId: "rrb", organizationName: "Railway Recruitment Boards", govType: "Central Govt", title: "TEST RRB NTPC Graduate Level Recruitment 2026", recruitmentYear: 2026 });
  const s1 = await publishJob(ntpc.id, "CEN 99/2026");
  check("A1 a newly published job is found by its title, a typo, its body's initials and its notice number",
    s1 === 200 && await finds("rrb ntpc", ntpc.slug) && await finds("rrb ntcp", ntpc.slug) && await finds("railway recruitment graduate", ntpc.slug)
      && await finds("CEN 99/2026", ntpc.slug)
      && searchOpportunities(await list(), "rrb ntcp", "All India", getDefaultFilterState(), "latest", new Date())[0]?.slug === ntpc.slug,
    { status: s1 });

  const fresh = await create({ organizationId: "test-hill-state-service-board", organizationName: "Test Hill State Service Board", govType: "State Govt", title: "TEST Forest Guard Recruitment 2026", recruitmentYear: 2026 });
  const s2 = await publishJob(fresh.id, "THSSB/FG/2026");
  check("A2 a job of a body new to the site is found by that body's name and initials",
    s2 === 200 && await finds("hill state forest guard", fresh.slug) && await finds("thssb", fresh.slug) && await finds("forest gaurd", fresh.slug), { status: s2 });

  const before = await finds("forest guard", fresh.slug);
  // An update as the editor makes it: back to draft, edit, approve, publish again.
  await revert.POST(req(`/api/admin/cms/records/${fresh.id}/revert`, "POST"), ctx(fresh.id));
  await patch(fresh.id, "identity.title", "TEST Forest Ranger Recruitment 2026");
  const s3 = await publishJob(fresh.id, "THSSB/FG/2026");
  // (Its address does not change with its title, and addresses are searchable, so the old wording still finds it.)
  const shown = (await list()).find((o) => o.slug === fresh.slug)?.title;
  check("A3 an edited and republished job is found by its new title and shows it",
    before && s3 === 200 && await finds("forest ranger", fresh.slug) && shown === "TEST Forest Ranger Recruitment 2026", { status: s3, shown });

  section(S.B);
  const draft = await create({ organizationId: "rrb", organizationName: "Railway Recruitment Boards", govType: "Central Govt", title: "TEST RRB Draft Only Paramedical 2026", recruitmentYear: 2026, forceCreate: true });
  check("B1 a draft never published is not in the public list and not found",
    !(await list()).some((o) => o.slug === draft.slug) && !(await finds("draft only paramedical", draft.slug)));

  await pg.query("UPDATE recruitments SET draft_state='ARCHIVED' WHERE id=$1", [ntpc.id]);
  check("B2 an archived job leaves the public list and search",
    !(await list()).some((o) => o.slug === ntpc.slug) && !(await finds("rrb ntpc", ntpc.slug)));

  const td = await takeDown.POST(req(`/api/admin/cms/records/${fresh.id}/take-down`, "POST", { reason: "search test: taken down" }), ctx(fresh.id));
  check("B3 a taken-down job leaves the public list and search",
    td.status === 200 && !(await list()).some((o) => o.slug === fresh.slug) && !(await finds("forest ranger", fresh.slug)));

  summary();
})();
