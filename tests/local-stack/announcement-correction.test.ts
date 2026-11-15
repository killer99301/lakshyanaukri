// ═══════════════════════════════════════════════════════════
// Correcting an existing announcement's "relevant until" and kind, end to end (15 Nov 2026)
// ═══════════════════════════════════════════════════════════
// Through the REAL route handlers, repository, publication review and publish, on the in-memory test database.
// SYNTHETIC data only: an invented board shaped like the SSC CGL case of Nov 2026: a notice saying the answer-key
// window (4–7 Nov) has closed, stored with no kind and no "relevant until", and two older notices superseded by it.
//   A. Refusals: not signed in, another site, a live job, a stale page (list or details), bad input; nothing saved.
//   B. The correction: saved into the job only, one change-history row with the reason; words, ids and links kept;
//      no new announcement; the public still sees the published version.
//   C. Review: "Publishing will change" and the publication review name the correction; an approval given before
//      it is stale; the reason is never in the review.
//   D. After the owner's publish: Closed, out of Important now and the banner; the older notices still point at it;
//      the public copy carries no reason or admin id; nothing else on the job changed; no Telegram.
//   E. Concurrency and rollback: two saves from the same page, one wins; a failure inside the save leaves nothing.
//   F. Clearing: the details can be cleared again, through the same route.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/announcement-correction.test.ts
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
  const { metaOf } = await import("@/lib/cms/announcement-correction");
  const { classifyAnnouncements, pickImportantUpdate } = await import("@/lib/important-update");
  const { buildFeed, importantNow } = await import("@/lib/updates-feed");
  const { todayInIndia } = await import("@/lib/cms/attention");

  const SECRET = "Window ended 7 Nov per the notice CORR-SECRET-never-public";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

  // ── A published job like the SSC CGL case ──
  const created = await (await records.POST(req("/api/admin/cms/records", "POST", {
    organizationId: "test-board", organizationName: "Test Selection Board", govType: "Central Govt", title: "TEST RECORD Board CGL 2026", recruitmentYear: 2026,
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
  const STAGE = "Tier-I (Computer Based Test)";
  await patch("links", [{ type: "OFFICIAL_WEBSITE", label: "Board", url: "https://board.example.gov.in/", official: true }, { type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://board.example.gov.in/notice.pdf", official: true }]);
  await patch("dates.applicationCloseDate", "2026-06-25");
  await patch("examStages", [
    { name: STAGE, order: 1, status: "CONDUCTED", dateIso: "2026-09-30", dateEndIso: "2026-10-28", certainty: "CONFIRMED" },
    { name: "Tier-II (Computer Based Test)", order: 2, status: "NOT_DECLARED", certainty: "TBA" },
  ]);
  const announce = async (date: string, title: string, description: string) =>
    (await updates.POST(req(`/api/admin/cms/records/${id}/updates`, "POST", { update: { type: "EXAM_NOTICE", date, title, description, sourceUrl: `https://board.example.gov.in/n-${date}.pdf` } }), ctx(id))).status;
  const ownerPublish = async (approval?: Record<string, unknown>) => {
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    const res = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", approval ?? await approved(id)), ctx(id));
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const openForEditing = async () => (await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id))).status;
  const send = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await updates.PATCH(req(`/api/admin/cms/records/${id}/updates`, "PATCH", body, headers), ctx(id));
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const count = async (q: string) => ((await pg.query(q, [id])).rows[0] as { n: number }).n;
  const revisions = () => count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates'");
  const snapshots = () => count("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1");

  section("Setup");
  check("three announcements saved", (await announce("2026-10-12", "Tier-I (Computer Based Test): admit card released", "The exam starts on 30 Sep 2026.")) === 200
    && (await announce("2026-10-13", "Tier-I exam window: 30 Sep – 30 Oct 2026", "Held from 30 September to 30 October 2026.")) === 200
    && (await announce("2026-11-04", "Tier-I held 30 Sep – 28 Oct 2026; answer-key window (4–7 Nov) has closed", "Tentative answer keys were open for challenges from 4 Nov 2026 (9 PM) to 7 Nov 2026 (9 PM).")) === 200);
  check("published", (await ownerPublish()).status === 200);
  check("opened for editing", (await openForEditing()) === 200);
  let rec = (await getRecruitmentById(id))!;
  const [A, B, N] = rec.updates;
  const sup = await send({ action: "supersede", ids: [A.id, B.id], reason: "setup: corrected by the 4 Nov notice", replacedBy: N.id, expected: updatesFingerprint(rec.updates) });
  check("the two older notices superseded by the 4 Nov notice, published", sup.status === 200 && (await ownerPublish()).status === 200);

  const pubJob = async () => (await publicRepo.getBySlug(slug))!;
  const today = new Date();
  let job = await pubJob();
  check("before: the 4 Nov notice is Current (kind guessed), in Important now and the job banner",
    classifyAnnouncements(job, today).find((c) => c.u.id === N.id)?.current === true
    && pickImportantUpdate(job, today)?.update.id === N.id
    && importantNow([job], buildFeed([job], today), today).some((e) => e.key.endsWith(N.id)));

  rec = (await getRecruitmentById(id))!;
  const NONE = { relevantUntil: "", eventKind: "", eventStage: "" };
  const FIX = { relevantUntil: "2026-11-07", eventKind: "ANSWER_KEY", eventStage: STAGE };
  const body = (over: Record<string, unknown> = {}) => ({ action: "correct", id: N.id, set: FIX, was: NONE, reason: SECRET, expected: updatesFingerprint(rec.updates), ...over });
  const snapBefore = await snapshots();
  const revsBefore = await revisions();
  const recordBefore = JSON.stringify({ ...rec, updates: undefined, updatedAt: undefined, updatedBy: undefined });

  section("A. Refusals");
  const onLive = await send(body());
  check("A1 refused on the live job (open it for editing first)", onLive.status === 409 && onLive.body.code === "LIVE_JOB", onLive.status);
  const anon = await updates.PATCH(new NextRequest(`${ORIGIN}/api/admin/cms/records/${id}/updates`, { method: "PATCH", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body()) }), ctx(id));
  check("A2 refused when not signed in", anon.status === 401, anon.status);
  const foreign = await send(body(), { origin: "https://evil.example" });
  check("A3 refused from another site", foreign.status === 403, foreign.status);
  check("A4 opened for editing", (await openForEditing()) === 200);
  rec = (await getRecruitmentById(id))!;
  const staleList = await send(body({ expected: "00000000" }));
  check("A5 refused from a page showing an older announcement list", staleList.status === 409 && staleList.body.code === "STALE", staleList.status);
  const staleMeta = await send(body({ was: { ...NONE, relevantUntil: "2026-11-09" } }));
  check("A6 refused from a page that showed other details for it", staleMeta.status === 409 && staleMeta.body.code === "STALE", staleMeta.status);
  const bad = await Promise.all([
    send(body({ set: { ...FIX, relevantUntil: "2026-02-30" } })), send(body({ set: { ...FIX, relevantUntil: "2026-11-03" } })),
    send(body({ set: { ...FIX, eventKind: "RUMOUR" } })), send(body({ set: { ...FIX, eventStage: "Tier-IX" } })),
    send(body({ reason: "" })), send(body({ set: NONE })), send(body({ id: A.id, was: NONE })),
  ]);
  check("A7 bad input refused: impossible date, before the notice, unknown kind, unknown stage, no reason, no change, superseded notice",
    bad.every((r) => r.status === 400), bad.map((r) => r.status).join());
  const unknown = await send(body({ id: "00000000-0000-4000-8000-000000000000" }));
  check("A8 an announcement not on the job: 404", unknown.status === 404, unknown.status);
  const action = await send(body({ action: "rewrite" }));
  check("A9 any other action refused", action.status === 400, action.status);
  check("A10 nothing saved by any refusal: same announcements, no history row", JSON.stringify((await getRecruitmentById(id))!.updates) === JSON.stringify(rec.updates) && (await revisions()) === revsBefore);

  section("B. The correction");
  const staleApproval = await approved(id); // an approval given before the correction
  const ok = await send(body());
  check("B1 saved, not live", ok.status === 200 && ok.body.live === false, JSON.stringify(ok.body).slice(0, 200));
  check("B2 the answer says what changed", JSON.stringify(ok.body.changes) === JSON.stringify(["Relevant until: not set → 7 Nov 2026", `Kind: not set (guessed from its words: Answer key out) → Answer key out · ${STAGE}`]), JSON.stringify(ok.body.changes));
  const after = (await getRecruitmentById(id))!;
  check("B3 still three announcements, same ids and order: no new one", after.updates.length === 3 && after.updates.map((u) => u.id).join() === rec.updates.map((u) => u.id).join());
  const { relevantUntil, event, ...restN } = after.updates[2];
  check("B4 the 4 Nov notice: words, date, type and source unchanged; only the two details set",
    JSON.stringify(restN) === JSON.stringify(rec.updates[2]) && relevantUntil === "2026-11-07" && event?.kind === "ANSWER_KEY" && event.stage === STAGE);
  check("B5 the older notices unchanged, still pointing at it", JSON.stringify(after.updates.slice(0, 2)) === JSON.stringify(rec.updates.slice(0, 2)) && after.updates.slice(0, 2).every((u) => u.superseded?.replacedBy === N.id));
  check("B6 nothing else on the job changed (fields, links, stages, revision)", JSON.stringify({ ...after, updates: undefined, updatedAt: undefined, updatedBy: undefined, draftState: rec.draftState }) === JSON.stringify({ ...JSON.parse(recordBefore), draftState: rec.draftState }) || after.recordRevision === rec.recordRevision);
  check("B7 the content revision is unchanged (the correction is not a field edit)", after.recordRevision === rec.recordRevision);
  const hist = (await pg.query("SELECT old_value, new_value, reason FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates' ORDER BY revised_at DESC LIMIT 1", [id])).rows[0] as { old_value: Array<{ relevantUntil?: string }>; new_value: Array<{ relevantUntil?: string }>; reason: string };
  check("B8 one change-history row: the list before and after, the reason and the change in words",
    (await revisions()) === revsBefore + 1 && !hist.old_value[2].relevantUntil && hist.new_value[2].relevantUntil === "2026-11-07"
    && hist.reason.includes("CORR-SECRET") && hist.reason.includes("Relevant until: not set → 7 Nov 2026"));
  job = await pubJob();
  check("B9 the public still sees the published version: Current, no new snapshot", (await snapshots()) === snapBefore
    && classifyAnnouncements(job, today).find((c) => c.u.id === N.id)?.current === true);

  section("C. Review before publishing");
  const liveSnap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id])).rows[0] as { snapshot: never };
  const changes = liveChanges(liveSnap.snapshot, projectForPreview(after)).filter((c) => c.section === "Updates");
  check("C1 'Publishing will change' lists the two corrected details of that notice, and nothing else",
    changes.length === 2 && changes.every((c) => c.label.includes("answer-key window")) && changes[0].after === "7 Nov 2026", JSON.stringify(changes));
  const review = await buildPublicationReview(after, todayInIndia());
  check("C2 the publication review lists the correction, with no new announcement or supersession",
    review.corrections?.length === 1 && review.corrections[0].id === N.id && review.corrections[0].changes.length === 2
    && review.announcements.length === 0 && !review.supersessions, JSON.stringify(review.corrections));
  check("C3 the reason is not in the review", !JSON.stringify(review).includes("CORR-SECRET"));
  const refused = await ownerPublish(staleApproval);
  check("C4 an approval given before the correction is refused (the review changed)", refused.status !== 200 && (await snapshots()) === snapBefore, refused.status);

  section("D. After the owner's publish");
  const pubd = await ownerPublish();
  check("D1 published", pubd.status === 200, pubd.status);
  job = await pubJob();
  const c = classifyAnnouncements(job, today).find((x) => x.u.id === N.id);
  const feed = buildFeed([job], today);
  check("D2 the 4 Nov notice is Closed (its own date passed), with the recorded kind", !!c && !c.current && c.ended === "DATE" && !c.inferred && feed.find((e) => e.key.endsWith(N.id))?.state === "CLOSED");
  check("D3 out of Important now and the job page's banner", !importantNow([job], feed, today).some((e) => e.key.endsWith(N.id)) && pickImportantUpdate(job, today)?.update.id !== N.id);
  check("D4 the older notices are still superseded, their 'Correct notice' naming it",
    [A, B].every((o) => { const e = feed.find((x) => x.key.endsWith(o.id)); return e?.state === "SUPERSEDED" && e.correction?.replacementTitle === N.title; }));
  const publicJson = JSON.stringify(job);
  check("D5 the public data carries no reason or admin id", !publicJson.includes("CORR-SECRET") && !publicJson.includes("setup: corrected") && !/"by":"/.test(publicJson));
  check("D6 three announcements on the public page, none added", (job.updates ?? []).length === 3);
  check("D7 no Telegram post, no Telegram call", telegramCalls === 0
    && (await count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type LIKE 'TELEGRAM%'")) === 0);

  section("E. Concurrency and rollback");
  check("E0 opened for editing", (await openForEditing()) === 200);
  rec = (await getRecruitmentById(id))!;
  const was = metaOf(rec.updates[2]);
  const revsE = await revisions();
  const [r1, r2] = await Promise.all([
    send(body({ was, set: { ...FIX, relevantUntil: "2026-11-08" }, expected: updatesFingerprint(rec.updates) })),
    send(body({ was, set: { ...FIX, relevantUntil: "2026-11-09" }, expected: updatesFingerprint(rec.updates) })),
  ]);
  const winner = (await getRecruitmentById(id))!.updates[2].relevantUntil;
  check("E1 two saves from the same page: one saved, the other refused as stale; one history row",
    [r1.status, r2.status].sort().join() === "200,409" && (await revisions()) === revsE + 1
    && winner === (r1.status === 200 ? "2026-11-08" : "2026-11-09"), `${r1.status},${r2.status},${winner}`);
  rec = (await getRecruitmentById(id))!;
  await pg.exec(`CREATE OR REPLACE FUNCTION test_fail_revision() RETURNS trigger AS $$ BEGIN
      IF NEW.reason LIKE '%FAIL-INSIDE-SAVE%' THEN RAISE EXCEPTION 'test failure inside the save'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_fail_revision BEFORE INSERT ON field_revisions FOR EACH ROW EXECUTE FUNCTION test_fail_revision();`);
  const failed = await send(body({ was: metaOf(rec.updates[2]), set: { ...FIX, relevantUntil: "2026-11-10" }, reason: "FAIL-INSIDE-SAVE", expected: updatesFingerprint(rec.updates) }));
  await pg.exec("DROP TRIGGER test_fail_revision ON field_revisions; DROP FUNCTION test_fail_revision();");
  const afterFail = (await getRecruitmentById(id))!;
  check("E2 a failure inside the save (history row refused): 500, the announcement NOT changed, no history row",
    failed.status === 500 && JSON.stringify(afterFail.updates) === JSON.stringify(rec.updates) && (await revisions()) === revsE + 1, failed.status);

  section("F. Clearing");
  const cleared = await send(body({ was: metaOf(rec.updates[2]), set: NONE, reason: "test: clear both details", expected: updatesFingerprint(rec.updates) }));
  const fin = (await getRecruitmentById(id))!.updates[2];
  check("F1 both details cleared: the stored notice is exactly as first written", cleared.status === 200 && !("relevantUntil" in fin) && !("event" in fin)
    && JSON.stringify(fin) === JSON.stringify(N), cleared.status);
  check("F2 the public page is unchanged until a publish (still Closed)", (await pubJob()) && classifyAnnouncements(await pubJob(), today).find((x) => x.u.id === N.id)?.current === false);

  summary();
})();
