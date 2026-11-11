// ═══════════════════════════════════════════════════════════
// Adding an update entry (announcement), through the REAL route handlers and
// repository, against the in-memory test database. Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/updates-live.test.ts
//
// Update-workflow safety fix, 11 Nov 2026: an announcement never goes live by
// itself. On a published job the route refuses it (open the job for editing
// first); on a draft it waits in the job and goes live only with the owner's
// reviewed publish, exactly once. The public keeps the last published version
// the whole time.
//
// Covers the required tests 1–6: an ordinary admin cannot publish an
// announcement directly; a pending one is invisible; it appears exactly once
// after the reviewed publish; the public page stays up throughout; a deadline
// extension and admit card / result / answer key changes stay pending until
// the publish. Plus: the review lists pending announcements and its fingerprint
// covers them, and the audit trail records each step.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const updates = await import("@/app/api/admin/cms/records/[id]/updates/route");
  const publicRepo = await import("@/lib/repository");
  const { lifecycleLinksOf } = await import("@/lib/cms/lifecycle-links");
  const { getAllPublishedSnapshots } = await import("@/lib/cms/public-repository");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { buildPublicationReview } = await import("@/lib/cms/publication-review");
  const { todayInIndia } = await import("@/lib/cms/attention");

  const req = (path: string, method: string, body?: unknown, opts: { auth?: boolean; origin?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  type PublicJob = { updates?: Array<{ title: string }> } | undefined;
  const publicJob = async (slug: string) => (await publicRepo.getBySlug(slug)) as PublicJob;
  const titles = async (slug: string) => (await publicJob(slug))?.updates?.map((u) => u.title) ?? null;
  const snapshots = async (id: string) => ((await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [id])).rows[0] as { n: number }).n;
  const state = async (id: string) => ((await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [id])).rows[0] as { draft_state: string }).draft_state;
  const events = async (id: string, type: string) => (await pg.query("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = $2", [id, type])).rows;
  const lifecycleKinds = async (slug: string) => {
    const snap = (await getAllPublishedSnapshots()).find((s) => s.slug === slug);
    return snap ? lifecycleLinksOf(snap).filter((l) => !l.fromStage).map((l) => l.kind).sort().join(",") : null;
  };
  const entry = (title: string, type = "GENERAL_NOTICE") => ({ update: { type, date: "2026-11-11", title, description: `${title}.` } });

  let r = await records.POST(req("/api/admin/cms/records", "POST", {
    organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU", title: "TEST RECORD Canara Bank Clerk 2026", recruitmentYear: 2026,
  }));
  let d = await r.json();
  const id: string = d.record.id;
  const slug: string = d.record.slug;
  let rev: string = d.record.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "test",
    }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return res.status;
  };
  const reopen = async () => {
    const res = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return res.status;
  };
  const ownerPublish = async () => {
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    const res = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id));
    return res.status;
  };
  const UPDATES = `/api/admin/cms/records/${id}/updates`;
  const OFFICIAL = { type: "OFFICIAL_WEBSITE", label: "Canara Bank", url: "https://www.canarabank.bank.in/", official: true };

  section("A draft that was never published");
  await patch("links", [OFFICIAL]);
  await patch("dates.applicationCloseDate", "2026-11-30");
  r = await updates.POST(req(UPDATES, "POST", entry("Draft note")), ctx(id));
  d = await r.json();
  check("update added → 200, not live", r.status === 200 && d.live === false, d);
  check("the job is still not public and has no snapshot", (await titles(slug)) === null && (await snapshots(id)) === 0);

  section("First publish by the owner");
  check("published", (await ownerPublish()) === 200);
  check("the earlier note went live with the publish", JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note"]), await titles(slug));

  section("Test 1: no announcement goes straight onto a live job");
  const before = await snapshots(id);
  r = await updates.POST(req(UPDATES, "POST", entry("Exam postponed")), ctx(id));
  d = await r.json();
  check("on a published job the route refuses → 409 LIVE_JOB", r.status === 409 && d.code === "LIVE_JOB", { status: r.status, d });
  check("nothing reached the public page, no snapshot written, job still PUBLISHED",
    JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note"]) && (await snapshots(id)) === before && (await state(id)) === "PUBLISHED");
  check("nothing was stored in the job either", ((await getRecruitmentById(id))?.updates ?? []).length === 1);
  // An ordinary admin (not in CMS_PUBLISHERS) cannot get it live another way.
  process.env.CMS_PUBLISHERS = "00000000-0000-4000-8000-0000000000aa";
  r = await updates.POST(req(UPDATES, "POST", entry("Exam postponed")), ctx(id));
  check("ordinary admin: the announcement route → 409 on the live job", r.status === 409, r.status);
  r = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  check("ordinary admin: opening the live job for editing → 403", r.status === 403, r.status);
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", { announce: true }), ctx(id));
  check("ordinary admin: publish (even with announce) → 403", r.status === 403, r.status);
  check("the public page is unchanged after all three", JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note"]) && (await snapshots(id)) === before);
  process.env.CMS_PUBLISHERS = adminId;

  section("Session and origin");
  r = await updates.POST(req(UPDATES, "POST", entry("x"), { auth: false }), ctx(id));
  check("without a session → 401", r.status === 401, r.status);
  r = await updates.POST(req(UPDATES, "POST", entry("x"), { origin: "https://evil.example" }), ctx(id));
  check("foreign origin → 403", r.status === 403, r.status);

  section("Tests 2, 4, 5, 6: open for editing, everything waits");
  check("reopened", (await reopen()) === 200 && (await state(id)) === "DRAFT");
  const staleApproval = await approved(id);
  check("the public page is still there (test 4)", (await publicJob(slug)) !== undefined);
  check("deadline extended in the draft", (await patch("dates.applicationCloseDate", "2026-12-15")) === 200);
  check("admit card, result and answer key links added in the draft", (await patch("links", [
    OFFICIAL,
    { type: "ADMIT_CARD", label: "Admit card", url: "https://www.canarabank.bank.in/admit-2026", official: true },
    { type: "RESULT", label: "Result", url: "https://www.canarabank.bank.in/result-2026", official: true },
    { type: "ANSWER_KEY", label: "Answer key", url: "https://www.canarabank.bank.in/key-2026", official: true },
  ])) === 200);
  const mid = await snapshots(id);
  for (const [title, type] of [["Last date extended to 15 Dec 2026", "DEADLINE_EXTENSION"], ["Admit card released", "EXAM_NOTICE"]] as const) {
    r = await updates.POST(req(UPDATES, "POST", entry(title, type)), ctx(id));
    d = await r.json();
    check(`announcement "${title}" → 200, saved, not live`, r.status === 200 && d.live === false, d);
  }
  const pub = JSON.stringify(await publicJob(slug));
  check("test 2: the pending announcements are not on the public page", JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note"]) && (await snapshots(id)) === mid, await titles(slug));
  check("test 5: the public close date is still the old one", pub.includes("2026-11-30") && !pub.includes("2026-12-15"));
  check("test 6: no admit card, result or answer key link is public yet (Results, Admit Cards, Answer Keys pages)", (await lifecycleKinds(slug)) === "", await lifecycleKinds(slug));
  check("test 4: the job is still public while the update waits", (await publicJob(slug)) !== undefined && (await getAllPublishedSnapshots()).some((s) => s.slug === slug));

  section("The publication review shows the pending announcements");
  const record = (await getRecruitmentById(id))!;
  const review = await buildPublicationReview(record, todayInIndia());
  check("the review lists exactly the two pending announcements", review.announcements.map((a) => a.title).join("|") === "Last date extended to 15 Dec 2026|Admit card released", review.announcements);
  await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", staleApproval), ctx(id));
  check("an approval given before the announcements were added is refused", r.status !== 200 && (await snapshots(id)) === mid, r.status);

  section("Test 3: after the owner's reviewed publish, each appears exactly once");
  check("reviewed publish → 200", (await ownerPublish()) === 200);
  const after = (await titles(slug)) ?? [];
  check("all three entries public, none twice", after.join("|") === "Draft note|Last date extended to 15 Dec 2026|Admit card released", after);
  const pubAfter = JSON.stringify(await publicJob(slug));
  check("test 5: the new close date is public now", pubAfter.includes("2026-12-15"));
  check("test 6: admit card, result and answer key are listed now", (await lifecycleKinds(slug)) === "admitCard,answerKey,result", await lifecycleKinds(slug));
  check("a later republish with nothing new does not repeat them", (await reopen()) === 200 && (await ownerPublish()) === 200 && ((await titles(slug)) ?? []).length === 3, await titles(slug));
  const review2 = await buildPublicationReview((await getRecruitmentById(id))!, todayInIndia());
  check("and the review then lists no pending announcements", review2.announcements.length === 0, review2.announcements);

  section("Audit trail");
  const revs = (await pg.query("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates'", [id])).rows[0] as { n: number };
  check("each stored announcement has a history entry (three)", revs.n === 3, revs);
  check("the refused stale publish was recorded", (await events(id, "PUBLICATION_REFUSED")).length >= 1);
  check("the ordinary admin's refused reopen and publish were recorded", (await events(id, "PUBLICATION_REFUSED")).length >= 3);

  section("Stage changes on a job that has been public");
  check("reopened again", (await reopen()) === 200);
  const stagePatch = async (value: unknown, quiet?: boolean) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath: "examStages", field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "test", ...(quiet ? { quiet: true } : {}),
    }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return { status: res.status, updates: (body.record?.updates ?? []) as Array<{ title: string }> };
  };
  let s = await stagePatch([{ name: "Online Test", status: "SCHEDULED", dateDisplay: "Nov 2026", certainty: "TENTATIVE" }]);
  check("a new dated stage is announced in the draft", s.status === 200 && s.updates.length === 4 && s.updates[3].title === "Online Test date announced", s.updates.map((u) => u.title));
  check("…and is not public before the publish", ((await titles(slug)) ?? []).length === 3);
  s = await stagePatch([{ name: "Online Test", status: "SCHEDULED", dateDisplay: "Dec 2026", certainty: "TENTATIVE" }], true);
  check("a correction is saved but announces nothing", s.status === 200 && s.updates.length === 4, s.updates.map((u) => u.title));
  s = await stagePatch([{ name: "Online Test", status: "POSTPONED" }]);
  check("the next real change is announced again", s.status === 200 && s.updates.length === 5 && s.updates[4].title === "Online Test postponed", s.updates.map((u) => u.title));
  check("both go live once with the owner's publish", (await ownerPublish()) === 200 && ((await titles(slug)) ?? []).length === 5, await titles(slug));

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
