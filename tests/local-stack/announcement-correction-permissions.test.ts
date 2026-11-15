// ═══════════════════════════════════════════════════════════
// Who may correct an announcement's details (15 Nov 2026): only the owner or an authorised publisher
// ═══════════════════════════════════════════════════════════
// Through the REAL routes on the in-memory test database. SYNTHETIC data only. Three admins:
//   owner     – the test admin, in CMS_PUBLISHERS (as in production, the owner is a listed publisher)
//   publisher – a second admin, also in CMS_PUBLISHERS
//   editor    – a signed-in admin NOT in CMS_PUBLISHERS
//   P1 a publisher's correction succeeds;  P2 the owner's correction succeeds
//   P3 the editor's correction is refused on a job open for editing (403), and on a live job
//   P4 direct requests cannot get round it: forged body fields, other casing, the fields route, an appended entry
//   P5 a refused correction changes nothing: announcements, history, audit events, published versions, public data
//   P6 the editor's other permissions are unchanged: supersede, restore, append, field edits on a draft still work;
//      opening a live job and publishing are still refused
//   npx tsx --tsconfig tsconfig.json tests/local-stack/announcement-correction-permissions.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

(async () => {
  const { pg, token: ownerToken, adminId: ownerId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  let telegramCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("api.telegram.org")) telegramCalls++;
    return realFetch(input, init);
  }) as typeof fetch;

  const { createSession } = await import("@/lib/auth/session");
  const addAdmin = async (name: string) => {
    const r = await pg.query("INSERT INTO admins (username, email, password_hash) VALUES ($1, $2, 'not-a-real-hash') RETURNING id", [name, `${name}@example.test`]);
    const id = String((r.rows[0] as { id: string }).id);
    return { id, token: await createSession(id, "127.0.0.1", "local-stack") };
  };
  const publisher = await addAdmin("test-second-publisher");
  const editor = await addAdmin("test-editor-not-publisher");
  process.env.CMS_PUBLISHERS = `${ownerId},${publisher.id}`;

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const updates = await import("@/app/api/admin/cms/records/[id]/updates/route");
  const publicRepo = await import("@/lib/repository");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { updatesFingerprint } = await import("@/lib/cms/announcements");
  const { metaOf } = await import("@/lib/cms/announcement-correction");

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (token: string, path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });

  const created = await (await records.POST(req(ownerToken, "/api/admin/cms/records", "POST", {
    organizationId: "test-board", organizationName: "Test Selection Board", govType: "Central Govt", title: "TEST RECORD Board Permissions 2026", recruitmentYear: 2026,
  }))).json();
  const id: string = created.record.id;
  const slug: string = created.record.slug;
  let rev: string = created.record.recordRevision;
  const fieldPatch = async (token: string, fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(token, `/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "setup" }), ctx(id));
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) rev = body.record.recordRevision;
    return res.status;
  };
  await fieldPatch(ownerToken, "links", [{ type: "OFFICIAL_WEBSITE", label: "Board", url: "https://board.example.gov.in/", official: true }]);
  await fieldPatch(ownerToken, "examStages", [{ name: "Tier-I", order: 1, status: "CONDUCTED", dateIso: "2026-09-30", dateEndIso: "2026-10-28", certainty: "CONFIRMED" }]);
  const append = async (token: string, date: string, title: string, extra: Record<string, unknown> = {}) =>
    (await updates.POST(req(token, `/api/admin/cms/records/${id}/updates`, "POST", { update: { type: "EXAM_NOTICE", date, title, description: `${title}.`, sourceUrl: `https://board.example.gov.in/${date}.pdf`, ...extra } }), ctx(id))).status;
  const ownerPublish = async () => {
    await approve.POST(req(ownerToken, `/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    return (await publish.POST(req(ownerToken, `/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id))).status;
  };
  const open = async (token: string) => (await revert.POST(req(token, `/api/admin/cms/records/${id}/revert`, "POST"), ctx(id))).status;
  const patchUpdates = async (token: string, body: unknown) => {
    const res = await updates.PATCH(req(token, `/api/admin/cms/records/${id}/updates`, "PATCH", body), ctx(id));
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const correctBody = (rec: Awaited<ReturnType<typeof getRecruitmentById>>, nid: string, until: string, extra: Record<string, unknown> = {}) => ({
    action: "correct", id: nid, set: { relevantUntil: until, eventKind: "ANSWER_KEY", eventStage: "Tier-I" },
    was: metaOf(rec!.updates.find((u) => u.id === nid)!), reason: "Window ended per the notice", expected: updatesFingerprint(rec!.updates), ...extra,
  });
  const count = async (q: string) => ((await pg.query(q, [id])).rows[0] as { n: number }).n;
  const state = async () => ({
    updates: JSON.stringify((await getRecruitmentById(id))!.updates),
    history: await count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1"),
    audit: await count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1"),
    snapshots: await count("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1"),
    publicUpdates: JSON.stringify((await publicRepo.getBySlug(slug))?.updates ?? null),
  });

  section("Setup");
  check("two announcements, published", (await append(ownerToken, "2026-11-04", "Answer-key window (4–7 Nov) has closed")) === 200
    && (await append(ownerToken, "2026-10-12", "Tier-I admit card released")) === 200 && (await ownerPublish()) === 200);
  let rec = (await getRecruitmentById(id))!;
  const [N, O] = rec.updates;

  section("P3/P5. The editor (not a publisher)");
  const s0 = await state();
  const onLive = await patchUpdates(editor.token, correctBody(rec, N.id, "2026-11-07"));
  check("P3a refused on the live job: 403 NOT_A_PUBLISHER (checked before the job's state)", onLive.status === 403 && onLive.body.code === "NOT_A_PUBLISHER", onLive.status);
  check("P3b the editor cannot open the live job either (existing rule)", (await open(editor.token)) === 403);
  check("P5a nothing changed: announcements, history, published versions, public data", JSON.stringify({ ...(await state()), audit: 0 }) === JSON.stringify({ ...s0, audit: 0 }));
  check("owner opens the job for editing", (await open(ownerToken)) === 200);
  rec = (await getRecruitmentById(id))!;
  const s1 = await state();
  const onDraft = await patchUpdates(editor.token, correctBody(rec, N.id, "2026-11-07"));
  check("P3c refused on a job open for editing: 403, saying only the owner or a publisher can correct", onDraft.status === 403 && onDraft.body.code === "NOT_A_PUBLISHER"
    && /owner or an authorised publisher can correct an announcement/.test(onDraft.body.error), JSON.stringify(onDraft.body));
  check("P3d the refusal names the editor's admin ID (so the owner can add it if wanted)", String(onDraft.body.error).includes(editor.id));
  const s1b = await state();
  check("P5c a refused correction writes nothing at all, not even an audit row", JSON.stringify(s1b) === JSON.stringify(s1));

  section("P4. Direct requests cannot get round it");
  const forged = await Promise.all([
    patchUpdates(editor.token, correctBody(rec, N.id, "2026-11-07", { adminId: ownerId, publisher: true, by: ownerId })),
    patchUpdates(editor.token, { ...correctBody(rec, N.id, "2026-11-07"), set: { relevantUntil: "2026-11-07" } }),
    patchUpdates(editor.token, { ...correctBody(rec, N.id, ""), set: { relevantUntil: "", eventKind: "", eventStage: "" } }),
  ]);
  check("P4a forged owner id / publisher flag, a partial body, a 'clear' request: all 403", forged.every((r) => r.status === 403), forged.map((r) => r.status).join());
  const casing = await patchUpdates(editor.token, { ...correctBody(rec, N.id, "2026-11-07"), action: "CORRECT" });
  check("P4b another casing of the action is not an action: 400, nothing done", casing.status === 400);
  const viaFields = await fieldPatch(editor.token, "updates", rec.updates.map((u) => (u.id === N.id ? { ...u, relevantUntil: "2026-11-07" } : u)));
  check("P4c the fields route cannot write the announcements list", viaFields !== 200, viaFields);
  check("P4d an appended announcement never carries 'relevant until' or a kind (new entry only, existing rule)",
    (await append(editor.token, "2026-11-05", "Editor note", { relevantUntil: "2026-11-07", event: { kind: "ANSWER_KEY" } })) === 200
    && (() => true)());
  rec = (await getRecruitmentById(id))!;
  const added = rec.updates.find((u) => u.title === "Editor note")!;
  check("P4e …stored without them, and the 4 Nov notice untouched", !("relevantUntil" in added) && !("event" in added)
    && JSON.stringify(rec.updates.find((u) => u.id === N.id)) === JSON.stringify(N));
  const s2 = await state();
  check("P5b refused corrections changed nothing: the 4 Nov notice, no history row beyond the editor's append, no published version, public data the same",
    s2.snapshots === s1.snapshots && s2.publicUpdates === s1.publicUpdates && s2.history === s1.history + 1
    && JSON.stringify(JSON.parse(s2.updates).filter((u: { id: string }) => u.id !== added.id)) === s1.updates);

  section("P1/P2. Publishers");
  const byPublisher = await patchUpdates(publisher.token, correctBody(rec, N.id, "2026-11-08", { reason: "second publisher" }));
  check("P1 a second authorised publisher's correction succeeds", byPublisher.status === 200, byPublisher.status);
  rec = (await getRecruitmentById(id))!;
  const histBefore = await count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates'");
  const byOwner = await patchUpdates(ownerToken, correctBody(rec, N.id, "2026-11-07", { reason: "owner" }));
  check("P2 the owner's correction succeeds", byOwner.status === 200, byOwner.status);
  rec = (await getRecruitmentById(id))!;
  const n = rec.updates.find((u) => u.id === N.id)!;
  check("P2b the notice keeps its id, title, text, date and source; only the details changed; one history row per save",
    n.title === N.title && n.description === N.description && n.date === N.date && n.sourceUrl === N.sourceUrl && n.relevantUntil === "2026-11-07"
    && n.event?.kind === "ANSWER_KEY" && (await count("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates'")) === histBefore + 1);
  const pubNow = await publicRepo.getBySlug(slug);
  check("P2c still unpublished: the public page has no 'relevant until' yet", !(pubNow?.updates ?? []).some((u) => u.relevantUntil));

  section("P6. The editor's other permissions are unchanged");
  rec = (await getRecruitmentById(id))!;
  const sup = await patchUpdates(editor.token, { action: "supersede", ids: [O.id], reason: "test supersede", replacedBy: N.id, expected: updatesFingerprint(rec.updates) });
  check("P6a the editor can still mark an announcement superseded on a draft", sup.status === 200, sup.status);
  rec = (await getRecruitmentById(id))!;
  const res = await patchUpdates(editor.token, { action: "restore", ids: [O.id], reason: "test restore", expected: updatesFingerprint(rec.updates) });
  check("P6b …and restore it", res.status === 200, res.status);
  check("P6c …and edit a field", (await fieldPatch(editor.token, "dates.applicationCloseDate", "2026-06-25")) === 200);
  await approve.POST(req(editor.token, `/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  const edPub = await publish.POST(req(editor.token, `/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id));
  check("P6d …and still cannot publish", edPub.status === 403, edPub.status);
  check("P6e the owner publishes; no Telegram at any point", (await ownerPublish()) === 200 && telegramCalls === 0);

  summary();
})();
