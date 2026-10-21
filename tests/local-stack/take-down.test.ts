// ═══════════════════════════════════════════════════════════
// Taking a live job off the website and putting it back, through the REAL
// routes, repository and public read path, against the in-memory test
// database. Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/take-down.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token, adminId } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const takeDown = await import("@/app/api/admin/cms/records/[id]/take-down/route");
  const putBack = await import("@/app/api/admin/cms/records/[id]/put-back/route");
  const pub = await import("@/lib/cms/public-repository");
  const { listLiveRecruitments } = await import("@/lib/cms/repository");

  const req = (path: string, method: string, body?: unknown, extra: Record<string, string> = {}) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}`, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const pending = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const save = async (id: string, fieldPath: string, field: unknown) =>
    fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field, clientRevision: await rev(id), reason: "test" }), ctx(id));
  const events = async (id: string) => (await pg.query("SELECT event_type, admin_id, metadata FROM recruitment_audit_events WHERE recruitment_id = $1 ORDER BY created_at", [id])).rows as Array<{ event_type: string; admin_id: string; metadata: Record<string, unknown> }>;
  const visible = async (slug: string) => {
    const [one, slugs, all, live] = await Promise.all([pub.getPublishedBySlug(slug), pub.getPublishedSlugs(), pub.getAllPublishedSnapshots(), listLiveRecruitments()]);
    return { page: one !== null, sitemap: slugs.includes(slug), listing: all.some((s) => s.slug === slug), attention: live.some((r) => r.slug === slug), title: one?.title ?? null };
  };

  const r0 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "rrb", organizationName: "Railway Recruitment Board", govType: "Central Govt", title: "TEST RECORD RRB NTPC 2025", recruitmentYear: 2025 }));
  const created = (await r0.json()).record;
  const id: string = created.id;
  const slug: string = created.slug;
  await save(id, "links", pending([{ type: "OFFICIAL_WEBSITE", label: "RRB", url: "https://www.rrbcdg.gov.in/", official: true }]));
  await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  const p = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", { announce: false }), ctx(id));
  check("set-up: the job is published", p.status === 200, await p.clone().json());
  check("set-up: visible on its page, the listing and the sitemap", Object.values(await visible(slug)).slice(0, 4).every(Boolean), await visible(slug));

  section("Refused without a good reason or permission");
  let r = await takeDown.POST(req(`/api/admin/cms/records/${id}/take-down`, "POST", {}), ctx(id));
  check("no reason → 400", r.status === 400, await r.json());
  r = await takeDown.POST(req(`/api/admin/cms/records/${id}/take-down`, "POST", { reason: "  " }), ctx(id));
  check("blank reason → 400", r.status === 400, await r.json());
  r = await takeDown.POST(new NextRequest(`${ORIGIN}/api/admin/cms/records/${id}/take-down`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ reason: "out of date" }) }), ctx(id));
  check("not signed in → 401", r.status === 401);
  r = await takeDown.POST(req(`/api/admin/cms/records/${id}/take-down`, "POST", { reason: "out of date" }, { origin: "https://evil.example" }), ctx(id));
  check("from another site → 403", r.status === 403);
  check("still visible after the refusals", (await visible(slug)).page);

  section("Edits waiting in the draft, then taken off");
  await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  await save(id, "identity.title", pending("TEST RECORD RRB NTPC 2025 — UNREVIEWED DRAFT EDIT"));
  const revisionBefore = await rev(id);
  r = await takeDown.POST(req(`/api/admin/cms/records/${id}/take-down`, "POST", { reason: "Last date was 20 Nov 2025; out of date" }), ctx(id));
  let d = await r.json();
  check("→ 200", r.status === 200, d);
  check("the record says who, when and why", d.record?.takenDown?.reason === "Last date was 20 Nov 2025; out of date" && d.record.takenDown.by === adminId && d.record.takenDown.byName === "test-admin" && !Number.isNaN(Date.parse(d.record.takenDown.at)), d.record?.takenDown);
  const gone = await visible(slug);
  check("gone from its page, the listing, the sitemap and the attention list", !gone.page && !gone.sitemap && !gone.listing && !gone.attention, gone);
  check("the draft edit and the record revision are untouched", d.record.identity.title.value.endsWith("UNREVIEWED DRAFT EDIT") && d.record.recordRevision === revisionBefore && d.record.draftState === "DRAFT");
  const snaps = (await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [id])).rows[0].n;
  check("the published version is kept", snaps === 1, snaps);
  let ev = await events(id);
  check("history has the take-down with the admin and the reason", ev.some((e) => e.event_type === "TAKEN_OFF_SITE" && e.admin_id === adminId && e.metadata?.reason === "Last date was 20 Nov 2025; out of date"), ev.map((e) => e.event_type));
  check("nothing was posted to Telegram", !ev.some((e) => e.event_type === "TELEGRAM_CHANNEL_POST"));
  r = await takeDown.POST(req(`/api/admin/cms/records/${id}/take-down`, "POST", { reason: "again" }), ctx(id));
  check("taking it off twice → 409 with a plain reason", r.status === 409 && /not live/i.test((await r.json()).error));

  section("Put back: the last published version, never the draft edits");
  r = await putBack.POST(req(`/api/admin/cms/records/${id}/put-back`, "POST"), ctx(id));
  d = await r.json();
  check("→ 200, no longer marked as taken off", r.status === 200 && !d.record?.takenDown, d);
  const back = await visible(slug);
  check("visible again on its page, the listing and the sitemap", back.page && back.sitemap && back.listing, back);
  check("visitors see the published title, not the unreviewed edit", back.title === "TEST RECORD RRB NTPC 2025", back.title);
  check("the draft edit is still in the draft", d.record.identity.title.value.endsWith("UNREVIEWED DRAFT EDIT") && d.record.draftState === "DRAFT");
  ev = await events(id);
  check("history has the put-back", ev.some((e) => e.event_type === "PUT_BACK_ON_SITE" && e.admin_id === adminId && e.metadata?.via === "put-back"), ev.map((e) => e.event_type));
  r = await putBack.POST(req(`/api/admin/cms/records/${id}/put-back`, "POST"), ctx(id));
  check("putting back a job that is on the site → 409", r.status === 409);

  section("Publishing a new version also puts it back");
  await takeDown.POST(req(`/api/admin/cms/records/${id}/take-down`, "POST", { reason: "Fixing the title" }), ctx(id));
  check("off again", !(await visible(slug)).page);
  await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", { announce: false }), ctx(id));
  d = await r.json();
  check("published → no longer taken off", r.status === 200 && !d.record?.takenDown, d.error ?? d.record?.takenDown);
  const after = await visible(slug);
  check("visitors now see the newly published title", after.page && after.title?.endsWith("UNREVIEWED DRAFT EDIT"), after);
  ev = await events(id);
  check("history says publishing put it back", ev.some((e) => e.event_type === "PUT_BACK_ON_SITE" && e.metadata?.via === "publish"), ev.map((e) => e.event_type));

  section("Only a job that has been live can be taken off");
  const r1 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "ssc", organizationName: "Staff Selection Commission", govType: "Central Govt", title: "TEST RECORD SSC Never Published 2026", recruitmentYear: 2026, forceCreate: true }));
  const draftId: string = (await r1.json()).record.id;
  r = await takeDown.POST(req(`/api/admin/cms/records/${draftId}/take-down`, "POST", { reason: "test" }), ctx(draftId));
  check("a draft never published → 409", r.status === 409);
  r = await takeDown.POST(req(`/api/admin/cms/records/00000000-0000-0000-0000-000000000000/take-down`, "POST", { reason: "test" }), ctx("00000000-0000-0000-0000-000000000000"));
  check("an unknown record → 404", r.status === 404);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
