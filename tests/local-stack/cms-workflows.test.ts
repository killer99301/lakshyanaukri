// ═══════════════════════════════════════════════════════════
// CMS workflows through the REAL route handlers and repositories,
// against the in-memory test database. Never touches production.
//
//   npm run test:stack
//
// Covers: create, duplicate detection, edit, AI-assisted values, links and
// how-to-apply, preview, approve/publish, public read path, revert/edit/
// republish, history and audit trail, origin and session checks.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, note, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token, adminId } = await boot();
  // Loaded after boot() so the database client is already routed locally.
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const revisions = await import("@/app/api/admin/cms/records/[id]/revisions/route");
  const fromDraft = await import("@/app/api/admin/cms/records/from-draft/route");
  const publicRepo = await import("@/lib/repository");
  const cmsRepo = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const { aiAssistReason, buildAiField } = await import("@/lib/cms/ai-assist-apply");
  const { proxy } = await import("@/proxy");

  const req = (path: string, method: string, body?: unknown, opts: { auth?: boolean; origin?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  let rev = "";
  const patch = async (id: string, fieldPath: string, field: unknown, reason?: string) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field, clientRevision: rev, reason }), ctx(id));
    const d = await r.json();
    if (r.status === 200) rev = d.record.recordRevision;
    return { status: r.status, data: d };
  };
  const publicJob = async (slug: string) => publicRepo.getBySlug(slug);
  const publicList = async () => publicRepo.getAllVerifiedOpportunitiesWithCMS();

  const CREATE = {
    organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU",
    title: "TEST RECORD Canara Bank Graduate Apprentice 2026", recruitmentYear: 2026,
  };

  section("Session and origin protection");
  {
    const body = { organizationId: "ibps", organizationName: "IBPS", title: "X", recruitmentYear: 2026 };
    let res = await records.POST(req("/api/admin/cms/records", "POST", body, { auth: false }));
    check("API without a session → 401", res.status === 401, res.status);
    res = await records.POST(req("/api/admin/cms/records", "POST", body, { origin: "https://evil.example" }));
    check("foreign origin → 403", res.status === 403, res.status);
    res = await records.POST(req("/api/admin/cms/records", "POST", body, { origin: `${ORIGIN}.evil.example` }));
    check("look-alike origin (allowed origin as a prefix) → 403", res.status === 403, res.status);
    res = await records.POST(req("/api/admin/cms/records", "POST", body, { origin: `${ORIGIN}/` }));
    check("origin with a path/trailing slash is not an origin → 403", res.status === 403, res.status);

    // Proxy: the only gate for routes that do not call requireAdmin themselves.
    const through = (path: string, headers: Record<string, string>) => proxy(new NextRequest(`${ORIGIN}${path}`, { headers }));
    const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";
    process.env.ADMIN_SECRET = "legacy-secret-for-test";
    check("proxy: valid session passes", passes(await through("/api/admin/intake", { cookie: `admin_sid=${token}` })));
    res = await through("/api/admin/intake", {});
    check("proxy: API without a session → 401", res.status === 401, res.status);
    res = await through("/admin/cms", {});
    check("proxy: page without a session → redirect to login", res.status === 307 && (res.headers.get("location") ?? "").includes("/admin/login"), res.status);
    res = await through("/api/admin/intake", { authorization: "Bearer legacy-secret-for-test" });
    check("proxy: legacy shared secret as Bearer no longer grants access", res.status === 401, res.status);
    res = await through("/api/admin/candidates", { cookie: "admin_session=legacy-secret-for-test" });
    check("proxy: legacy shared-secret cookie no longer grants access", res.status === 401, res.status);
    res = await through("/admin/cms?s=legacy-secret-for-test", {});
    check("proxy: legacy ?s= login no longer sets a cookie", !res.headers.get("set-cookie") && (res.headers.get("location") ?? "").includes("/admin/login"), res.headers.get("location"));
    res = await through("/api/admin/intake", { cookie: "admin_sid=not-a-real-token" });
    check("proxy: forged session token → 401", res.status === 401, res.status);
    check("proxy: login page stays public", passes(await through("/admin/login", {})));
    delete process.env.ADMIN_SECRET;
  }

  section("A. Create a genuinely new record (custom organisation)");
  let r = await records.POST(req("/api/admin/cms/records", "POST", CREATE));
  let d = await r.json();
  check("create → 201, DRAFT", r.status === 201 && d.record?.draftState === "DRAFT", d);
  const id: string = d.record.id;
  const slug: string = d.record.slug;
  rev = d.record.recordRevision;
  check("slug has no repeated organisation or year", slug === "canara-bank-test-record-canara-bank-graduate-apprentice-2026", slug);
  check("organisation name stored as entered", d.record.identity.organizationName === "Canara Bank");
  check("title starts PENDING, never VERIFIED", d.record.identity.title.status === "PENDING");
  check("never-published draft is not public", (await publicJob(slug)) === undefined);

  r = await records.POST(req("/api/admin/cms/records", "POST", { ...CREATE, organizationId: "Bad Org!" }));
  check("invalid organisation id → 400", r.status === 400, r.status);

  section("D. Duplicate detection");
  r = await records.POST(req("/api/admin/cms/records", "POST", { ...CREATE, title: "TEST RECORD Canara Bank PO 2026" }));
  d = await r.json();
  check("manual create, same org+year → duplicate warning, nothing created", r.status === 200 && d.duplicates?.[0]?.id === id && !d.record, d);
  let count = (await pg.query("SELECT count(*)::int AS n FROM recruitments")).rows[0] as { n: number };
  check("still exactly one record", count.n === 1, count);
  r = await records.POST(req("/api/admin/cms/records", "POST", { ...CREATE, title: "TEST RECORD Canara Bank PO 2026", forceCreate: true }));
  d = await r.json();
  check("'create anyway' → separate DRAFT", r.status === 201 && d.record.id !== id, d);
  r = await records.POST(req("/api/admin/cms/records", "POST", { ...CREATE, forceCreate: true }));
  check("identical slug → 409 with clear message", r.status === 409, r.status);

  // Intake-draft promotion path
  const draftSnapshot = (notif: string | undefined) => ({
    id: "", identity: {
      organizationId: { value: "canara-bank", evidence: [] }, organizationName: { value: "Canara Bank", evidence: [] },
      recruitmentYear: { value: 2026, evidence: [] }, title: { value: "TEST RECORD Canara Bank Apprentice (intake)", evidence: [] },
      shortTitle: { evidence: [] }, notificationNumber: notif ? { value: notif, evidence: [] } : { evidence: [] }, advertisementNumber: { evidence: [] },
    },
    dates: {}, vacancies: {}, links: [], sources: [],
  });
  const insertDraft = async (notif: string | undefined) => {
    const row = await pg.query("INSERT INTO intelligence_drafts (created_by, updated_by, snapshot) VALUES ($1,$1,$2) RETURNING id", [adminId, JSON.stringify(draftSnapshot(notif))]);
    const did = (row.rows[0] as { id: string }).id;
    await pg.query("UPDATE intelligence_drafts SET snapshot = jsonb_set(snapshot, '{id}', to_jsonb($1::text)) WHERE id=$2", [did, did]);
    return did;
  };
  const draftNoNotif = await insertDraft(undefined);
  r = await fromDraft.POST(req("/api/admin/cms/records/from-draft", "POST", { draftId: draftNoNotif }));
  d = await r.json();
  check("intake draft without notification no., same org+year → duplicate (org_year)", d.duplicate?.matchReason === "org_year", d);
  await patch(id, "identity.notificationNumber", manual("CB/HR/APP/2026-27"));
  const draftSameNotif = await insertDraft("cb/hr/app/2026-27");
  r = await fromDraft.POST(req("/api/admin/cms/records/from-draft", "POST", { draftId: draftSameNotif }));
  d = await r.json();
  check("intake draft with same notification no. (different case) → duplicate (notification_number)", d.duplicate?.matchReason === "notification_number" && d.duplicate?.id === id, d);
  const draftOtherNotif = await insertDraft("CB/HR/PO/2026-27");
  r = await fromDraft.POST(req("/api/admin/cms/records/from-draft", "POST", { draftId: draftOtherNotif, forceCreate: false }));
  d = await r.json();
  note(`intake draft with a DIFFERENT notification no. → HTTP ${r.status} ${JSON.stringify(d).slice(0, 140)}`);
  const promotedId: string | undefined = d.recordId;
  check("different notification no. is not blocked as a duplicate of the first record", d.duplicate?.id !== id, d);
  if (promotedId) {
    r = await fromDraft.POST(req("/api/admin/cms/records/from-draft", "POST", { draftId: draftOtherNotif }));
    d = await r.json();
    check("promoting the same draft twice → alreadyExisted, no second record", d.alreadyExisted === true && d.recordId === promotedId, d);
  }

  section("B. Edit the draft");
  for (const [p, v] of [["dates.applicationOpenDate", "2026-10-01"], ["dates.applicationCloseDate", "2026-10-21"], ["vacancies.total", 3500]] as const) {
    const out = await patch(id, p, manual(v), "harness edit");
    check(`edit ${p}`, out.status === 200, out.data);
  }
  let out = await patch(id, "identity.title", { value: null, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  check("invalid field (null value with PENDING) rejected", out.status !== 200, out.status);

  section("AI-assisted values: PENDING, source URL in history, evidence preserved");
  const SRC = "https://www.canarabank.bank.in/documents/d/guest/apprenticeship-advertisement-2026-27";
  out = await patch(id, "financial.feeGeneral", buildAiField(500), aiAssistReason(SRC, "filled"));
  check("AI fill → PENDING", out.status === 200 && out.data.record.financial.feeGeneral.status === "PENDING", out.data);
  await pg.query(`UPDATE recruitments SET vacancies = jsonb_set(vacancies, '{total,evidenceIds}', '["evid-keep-1"]') WHERE id=$1`, [id]);
  out = await patch(id, "vacancies.total", buildAiField(3500, ["evid-keep-1"]), aiAssistReason(SRC, "applied"));
  check("AI apply keeps existing evidence IDs, stays PENDING", out.status === 200 && out.data.record.vacancies.total.status === "PENDING" && out.data.record.vacancies.total.evidenceIds[0] === "evid-keep-1", out.data?.record?.vacancies);
  check("AI apply does not change draft state", out.data.record.draftState === "DRAFT");

  section("Links and how-to-apply (new write path)");
  out = await patch(id, "links", manual([{ type: "OFFICIAL_NOTIFICATION", label: "x", url: "javascript:alert(1)", official: true }]));
  check("non-http link rejected (422)", out.status === 422, out);
  out = await patch(id, "links", manual([{ type: "NOT_A_TYPE", label: "x", url: "https://a.example", official: true }]));
  check("unknown link type rejected (422)", out.status === 422, out.status);
  out = await patch(id, "links", manual([{ type: "OFFICIAL_WEBSITE", label: "Third-party page", url: "https://www.govtjobguru.in/x", official: false }]), "Added link");
  check("non-official link saved", out.status === 200 && out.data.record.links.length === 1, out.data);
  out = await patch(id, "howToApply", manual(["Register on the NATS portal", "Apply on the bank's website", "Pay the fee"]), "Edited steps");
  check("how-to-apply steps saved", out.status === 200 && out.data.record.howToApply.length === 3, out.data);

  section("E. Preview matches what will be published");
  const current = (await cmsRepo.getRecruitmentById(id))!;
  const preview = snapshotToGovernmentRecruitment(projectForPreview(current));
  check("preview renders title, org, vacancies, dates, fee, steps",
    preview.title === CREATE.title && preview.organizationName === "Canara Bank" && preview.totalVacancies === 3500 &&
    preview.application.closeDate === "2026-10-21" && preview.fee?.rows?.[0]?.amount === 500 && preview.howToApply?.length === 3, preview);

  section("F. Approve and publish");
  r = await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  check("approve → APPROVED", r.status === 200 && (await r.json()).record.draftState === "APPROVED");
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  d = await r.json();
  check("publish blocked while only a third-party link exists (422, actionable message)", r.status === 422 && /Links section/.test(d.error), d);
  check("blocked publish leaves nothing public", (await publicJob(slug)) === undefined);
  rev = (await pg.query("SELECT record_revision FROM recruitments WHERE id=$1", [id])).rows[0].record_revision as string;
  out = await patch(id, "links", manual([
    { type: "OFFICIAL_WEBSITE", label: "Third-party page", url: "https://www.govtjobguru.in/x", official: false },
    { type: "OFFICIAL_NOTIFICATION", label: "Official Notification", url: SRC, official: true },
    { type: "APPLY_ONLINE", label: "Apply Online", url: "https://www.canarabank.bank.in/pages/Recruitment", official: true },
  ]), "Added official links");
  check("official links added while APPROVED", out.status === 200, out.data);
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  d = await r.json();
  check("publish → PUBLISHED", r.status === 200 && d.record.draftState === "PUBLISHED", d);
  note(`revalidated flag outside the Next runtime: ${d.revalidated} (expected false here; verified in the browser test instead)`);
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  check("publishing twice → 409, no second snapshot", r.status === 409 && ((await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id=$1", [id])).rows[0] as { n: number }).n === 1);

  section("G. Public listing and detail page data");
  let job = await publicJob(slug);
  check("detail data: title, organisation, vacancies, dates", job?.title === CREATE.title && job?.organizationName === "Canara Bank" && job?.totalVacancies === 3500 && job?.application.openDate === "2026-10-01" && job?.application.closeDate === "2026-10-21", job);
  check("detail data: notification and apply links", job?.links.notification === SRC && job?.links.apply === "https://www.canarabank.bank.in/pages/Recruitment", job?.links);
  check("detail data: fee and how-to-apply", job?.fee?.rows?.[0]?.amount === 500 && job?.howToApply?.length === 3, job?.fee);
  let list = await publicList();
  check("listing includes the new record exactly once", list.filter((o: { slug: string }) => o.slug === slug).length === 1);
  check("unpublished drafts are not in the listing", !list.some((o: { title: string }) => /PO 2026|intake/.test(o.title)));
  check("slug is in the static-params/sitemap slug list", (await publicRepo.getAllSlugs()).includes(slug));
  note(`public verification label source: provenance.status = ${job?.provenance.status}`);

  section("C / I. Update a published record: revert → edit → republish");
  out = await patch(id, "vacancies.total", manual(3600));
  check("direct edit of a PUBLISHED record is refused (409)", out.status === 409, out.status);
  r = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  d = await r.json();
  check("revert → DRAFT, lastPublishedRevision kept", r.status === 200 && d.record.draftState === "DRAFT" && !!d.record.lastPublishedRevision, d);
  rev = d.record.recordRevision;
  out = await patch(id, "vacancies.total", manual(3600), "Corrigendum");
  check("edit after revert", out.status === 200, out.data);
  out = await patch(id, "dates.applicationCloseDate", manual("2026-10-28"), "Date extended");
  job = await publicJob(slug);
  check("I. public still serves the last published snapshot while in draft", job?.totalVacancies === 3500 && job?.application.closeDate === "2026-10-21", { v: job?.totalVacancies, c: job?.application.closeDate });
  check("I. listing still shows the record while in draft", (await publicList()).some((o: { slug: string }) => o.slug === slug));

  section("H. Republish shows the edits");
  r = await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  check("republish → PUBLISHED", r.status === 200, r.status);
  job = await publicJob(slug);
  check("public now shows updated vacancies and closing date", job?.totalVacancies === 3600 && job?.application.closeDate === "2026-10-28", { v: job?.totalVacancies, c: job?.application.closeDate });
  list = await publicList();
  const listed = list.find((o: { slug: string }) => o.slug === slug) as { totalVacancies: number } | undefined;
  check("listing shows the updated record once", list.filter((o: { slug: string }) => o.slug === slug).length === 1 && listed?.totalVacancies === 3600);

  section("History and audit trail");
  r = await revisions.GET(req(`/api/admin/cms/records/${id}/revisions`, "GET"), ctx(id));
  const revs = (await r.json()).revisions as Array<{ fieldPath: string; reason?: string; oldValue: unknown; newValue: unknown }>;
  check("revision history records links, steps and field edits", ["links", "howToApply", "vacancies.total", "draftState"].every((p) => revs.some((x) => x.fieldPath === p)), revs.map((x) => x.fieldPath));
  check("AI revisions carry the exact source URL", revs.filter((x) => x.reason?.includes(SRC)).length === 2);
  const audit = (await pg.query("SELECT event_type FROM recruitment_audit_events WHERE recruitment_id=$1 ORDER BY created_at", [id])).rows.map((x) => (x as { event_type: string }).event_type);
  note(`audit events: ${audit.join(", ")}`);
  check("audit trail has 2 approvals, 2 publications, 1 revert", audit.filter((e) => /APPROV/.test(e)).length === 2 && audit.filter((e) => /PUBLISH/.test(e)).length === 2 && audit.filter((e) => /REVERT/.test(e)).length === 1, audit);
  const snaps = (await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id=$1", [id])).rows[0] as { n: number };
  check("both snapshots retained (history not overwritten)", snaps.n === 2, snaps);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
