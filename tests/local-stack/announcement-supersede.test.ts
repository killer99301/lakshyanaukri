// ═══════════════════════════════════════════════════════════
// Superseding announcements, end to end (maintenance batch, Nov 2026)
// ═══════════════════════════════════════════════════════════
// Through the REAL route handlers and repository, against the in-memory test
// database. A synthetic SSC-like job: three announcements published, two of
// them later superseded by the third; then one restored. Checks: refused on a
// live job; saved only while open for editing; one change-history row with the
// whole list before and after; original text untouched; stale pages refused;
// the review and "Publishing will change" name it; the public page changes only
// after the owner's publish; no Telegram post, no new announcement.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/announcement-supersede.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

(async () => {
  const { pg, token } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  let telegramCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("api.telegram.org")) telegramCalls++;
    return realFetch(input, init);
  }) as typeof fetch;

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const updates = await import("@/app/api/admin/cms/records/[id]/updates/route");
  const publicRepo = await import("@/lib/repository");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { buildPublicationReview } = await import("@/lib/cms/publication-review");
  const { projectForPreview } = await import("@/lib/cms/projector");
  const { liveChanges } = await import("@/lib/cms/live-changes");
  const { updatesFingerprint } = await import("@/lib/cms/announcements");
  const { getLatestUpdate, getUpdatesSortedByDate, getSupersededUpdates } = await import("@/lib/lifecycle");
  const { todayInIndia } = await import("@/lib/cms/attention");

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });

  // ── A published job with three announcements ──
  const created = await (await records.POST(req("/api/admin/cms/records", "POST", {
    organizationId: "ssc", organizationName: "Staff Selection Commission", govType: "Central Govt", title: "TEST RECORD SSC Exam 2026", recruitmentYear: 2026,
  }))).json();
  const id: string = created.record.id;
  const slug: string = created.record.slug;
  let rev: string = created.record.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "setup" }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return res.status;
  };
  await patch("links", [{ type: "OFFICIAL_WEBSITE", label: "SSC", url: "https://ssc.gov.in/", official: true }, { type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://ssc.gov.in/notice.pdf", official: true }]);
  await patch("dates.applicationCloseDate", "2026-06-25");
  const announce = async (date: string, title: string, description: string) =>
    (await updates.POST(req(`/api/admin/cms/records/${id}/updates`, "POST", { update: { type: "EXAM_NOTICE", date, title, description } }), ctx(id))).status;
  const ownerPublish = async () => {
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    return (await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id))).status;
  };
  const openForEditing = async () => (await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id))).status;

  section("Setup");
  check("three announcements saved", (await announce("2026-10-12", "Tier-I admit card released", "The exam is on 30 Sep 2026.")) === 200
    && (await announce("2026-10-13", "Tier-I exam window: 30 Sep – 30 Oct 2026", "Held from 30 September to 30 October 2026.")) === 200
    && (await announce("2026-11-04", "Tier-I held 30 Sep – 28 Oct 2026; answer-key window closed", "Per SSC notice of 4 Nov.")) === 200);
  check("published", (await ownerPublish()) === 200);
  const pub = async () => (await publicRepo.getBySlug(slug)) as never as Parameters<typeof getLatestUpdate>[0];
  check("public: 3 current announcements", getUpdatesSortedByDate(await pub()).length === 3);

  let rec = (await getRecruitmentById(id))!;
  const [A, B, N] = rec.updates;
  const supersedeBody = (expected: string, extra: Record<string, unknown> = {}) =>
    ({ action: "supersede", ids: [A.id, B.id], reason: "Wrong end date; SSC notice of 4 Nov gives 28 Oct", replacedBy: N.id, expected, ...extra });
  const send = async (body: unknown) => {
    const res = await updates.PATCH(req(`/api/admin/cms/records/${id}/updates`, "PATCH", body), ctx(id));
    return { status: res.status, body: await res.json() };
  };

  section("Refusals");
  const onLive = await send(supersedeBody(updatesFingerprint(rec.updates)));
  check("refused on the live job (open it for editing first)", onLive.status === 409 && onLive.body.code === "LIVE_JOB", onLive.status);
  check("opened for editing", (await openForEditing()) === 200);
  const stale = await send(supersedeBody("00000000"));
  check("refused from a stale page", stale.status === 409 && stale.body.code === "STALE", stale.status);
  const noReason = await send(supersedeBody(updatesFingerprint(rec.updates), { reason: "" }));
  check("refused without a reason", noReason.status === 400, noReason.status);
  const foreign = await updates.PATCH(new NextRequest(`${ORIGIN}/api/admin/cms/records/${id}/updates`, { method: "PATCH", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: `admin_sid=${token}` }, body: JSON.stringify(supersedeBody(updatesFingerprint(rec.updates))) }), ctx(id));
  check("refused from another site", foreign.status === 403, foreign.status);
  const anon = await updates.PATCH(new NextRequest(`${ORIGIN}/api/admin/cms/records/${id}/updates`, { method: "PATCH", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(supersedeBody(updatesFingerprint(rec.updates))) }), ctx(id));
  check("refused when not signed in", anon.status === 401, anon.status);

  section("Supersede two in one save");
  const revisionsBefore = ((await pg.query("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates'", [id])).rows[0] as { n: number }).n;
  const ok = await send(supersedeBody(updatesFingerprint(rec.updates)));
  check("saved", ok.status === 200 && ok.body.live === false, ok.status);
  rec = (await getRecruitmentById(id))!;
  check("three announcements, none added or removed", rec.updates.length === 3);
  check("original text, date and id untouched", rec.updates[0].title === A.title && rec.updates[0].description === A.description && rec.updates[0].date === A.date && rec.updates[0].id === A.id);
  check("both carry the note, pointing at the 4 Nov notice", rec.updates[0].superseded?.replacedBy === N.id && rec.updates[1].superseded?.replacedBy === N.id && !rec.updates[2].superseded);
  const hist = (await pg.query("SELECT old_value, new_value, reason FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates' ORDER BY revised_at DESC LIMIT 1", [id])).rows[0] as { old_value: unknown[]; new_value: Array<{ superseded?: unknown }>; reason: string };
  const revisionsAfter = ((await pg.query("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates'", [id])).rows[0] as { n: number }).n;
  check("one change-history row, with the whole list before and after and the reason", revisionsAfter === revisionsBefore + 1
    && Array.isArray(hist.old_value) && hist.old_value.length === 3 && hist.new_value.filter((u) => u.superseded).length === 2 && hist.reason.includes("Wrong end date"));
  check("the public page has not changed yet", getUpdatesSortedByDate(await pub()).length === 3);
  const review = await buildPublicationReview(rec, todayInIndia());
  check("review: 2 supersessions, no new announcement", (review.supersessions ?? []).length === 2 && review.announcements.length === 0, JSON.stringify(review.supersessions));
  const live = await publicRepo.getBySlug(slug);
  void live;
  const liveSnap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id])).rows[0] as { snapshot: never };
  const changes = liveChanges(liveSnap.snapshot, projectForPreview(rec)).filter((c) => c.section === "Updates");
  check("'Publishing will change' lists both as superseded", changes.length === 2 && changes.every((c) => c.after.startsWith("Superseded")), JSON.stringify(changes));
  const again = await send(supersedeBody(updatesFingerprint(rec.updates)));
  check("superseding them twice is refused", again.status === 400, again.status);

  section("Owner publishes");
  const auditBefore = ((await pg.query("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type LIKE 'TELEGRAM%'", [id])).rows[0] as { n: number }).n;
  check("published", (await ownerPublish()) === 200);
  const after = await pub();
  check("public banner: the 4 Nov notice", getLatestUpdate(after)?.id === N.id);
  check("public count: 1 current, 2 in the correction list", getUpdatesSortedByDate(after).length === 1 && getSupersededUpdates(after).length === 2);
  const auditAfter = ((await pg.query("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type LIKE 'TELEGRAM%'", [id])).rows[0] as { n: number }).n;
  check("no Telegram post, no Telegram call", auditAfter === auditBefore && telegramCalls === 0);

  section("Restore one");
  check("opened for editing", (await openForEditing()) === 200);
  rec = (await getRecruitmentById(id))!;
  const restored = await send({ action: "restore", ids: [A.id], reason: "Superseded by mistake", expected: updatesFingerprint(rec.updates) });
  check("restore saved", restored.status === 200, restored.status);
  rec = (await getRecruitmentById(id))!;
  check("A current again, exactly as written; B still superseded", !rec.updates[0].superseded && rec.updates[0].description === A.description && Boolean(rec.updates[1].superseded));
  const review2 = await buildPublicationReview(rec, todayInIndia());
  check("review: 1 restored", (review2.supersessions ?? []).map((s) => s.change).join() === "RESTORED");
  check("published", (await ownerPublish()) === 200);
  const final = await pub();
  check("public: 2 current, 1 corrected", getUpdatesSortedByDate(final).length === 2 && getSupersededUpdates(final).length === 1);
  check("no Telegram call at any point", telegramCalls === 0);

  summary();
})();
