// ═══════════════════════════════════════════════════════════
// Adding an update entry, through the REAL route handlers and repository,
// against the in-memory test database. Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/updates-live.test.ts
//
// Covers: an update added to a published job is public at once; one added
// while the job is open for editing waits for the publish and takes nothing
// else live with it; a never-published draft stays private.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const updates = await import("@/app/api/admin/cms/records/[id]/updates/route");
  const publicRepo = await import("@/lib/repository");

  const req = (path: string, method: string, body?: unknown, opts: { auth?: boolean; origin?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  type PublicJob = { updates?: Array<{ title: string }>; closeDate?: string; application?: { closeDate?: string } } | undefined;
  const titles = async (slug: string) => ((await publicRepo.getBySlug(slug)) as PublicJob)?.updates?.map((u) => u.title) ?? null;
  const snapshots = async (id: string) => ((await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [id])).rows[0] as { n: number }).n;
  const entry = (title: string) => ({ update: { type: "GENERAL_NOTICE", date: "2026-10-12", title, description: `${title}.` } });

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
  const UPDATES = `/api/admin/cms/records/${id}/updates`;

  section("A draft that was never published");
  await patch("links", [{ type: "OFFICIAL_WEBSITE", label: "Canara Bank", url: "https://www.canarabank.bank.in/", official: true }]);
  r = await updates.POST(req(UPDATES, "POST", entry("Draft note")), ctx(id));
  d = await r.json();
  check("update added → 200, not live", r.status === 200 && d.live === false, d);
  check("the job is still not public and has no snapshot", (await titles(slug)) === null && (await snapshots(id)) === 0);

  section("A published job");
  await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  check("published", r.status === 200, r.status);
  check("the earlier note went live with the publish", JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note"]), await titles(slug));
  const before = await snapshots(id);
  r = await updates.POST(req(UPDATES, "POST", entry("Exam postponed")), ctx(id));
  d = await r.json();
  check("update added → 200, live at once", r.status === 200 && d.live === true && d.record.draftState === "PUBLISHED", d);
  check("it is on the public page without republishing", JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note", "Exam postponed"]), await titles(slug));
  check("one new snapshot was written", (await snapshots(id)) === before + 1, await snapshots(id));
  check("the record's revision did not change", d.record.recordRevision === d.record.lastPublishedRevision, { rev: d.record.recordRevision, last: d.record.lastPublishedRevision });
  r = await updates.POST(req(UPDATES, "POST", entry("Second notice")), ctx(id));
  check("a second one also goes live, in order", JSON.stringify(await titles(slug)) === JSON.stringify(["Draft note", "Exam postponed", "Second notice"]), await titles(slug));

  section("Session and origin");
  r = await updates.POST(req(UPDATES, "POST", entry("x"), { auth: false }), ctx(id));
  check("without a session → 401", r.status === 401, r.status);
  r = await updates.POST(req(UPDATES, "POST", entry("x"), { origin: "https://evil.example" }), ctx(id));
  check("foreign origin → 403", r.status === 403, r.status);
  check("neither reached the public page", (await titles(slug))?.length === 3, await titles(slug));

  section("A job open for editing");
  r = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  d = await r.json();
  rev = d.record.recordRevision;
  check("reopened", r.status === 200 && d.record.draftState === "DRAFT", d);
  check("an unpublished edit is saved", (await patch("dates.applicationCloseDate", "2026-12-31")) === 200);
  const mid = await snapshots(id);
  r = await updates.POST(req(UPDATES, "POST", entry("Held back")), ctx(id));
  d = await r.json();
  check("update added → 200, not live yet", r.status === 200 && d.live === false, d);
  check("the public page is unchanged: no new entry, no new snapshot", (await titles(slug))?.length === 3 && (await snapshots(id)) === mid, await titles(slug));
  const live = (await publicRepo.getBySlug(slug)) as PublicJob;
  check("and the unpublished edit has not leaked out", JSON.stringify(live).includes("2026-12-31") === false);
  await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  check("after publishing, all four entries are public", r.status === 200 && (await titles(slug))?.join("|") === "Draft note|Exam postponed|Second notice|Held back", await titles(slug));

  section("Stage changes on a job that has been public");
  r = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  d = await r.json();
  rev = d.record.recordRevision;
  const stagePatch = async (value: unknown, quiet?: boolean) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath: "examStages", field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "test", ...(quiet ? { quiet: true } : {}),
    }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return { status: res.status, updates: (body.record?.updates ?? []) as Array<{ title: string }> };
  };
  let s = await stagePatch([{ name: "Online Test", status: "SCHEDULED", dateDisplay: "Nov 2026", certainty: "TENTATIVE" }]);
  check("a new dated stage is announced", s.status === 200 && s.updates.length === 5 && s.updates[4].title === "Online Test date announced", s.updates.map((u) => u.title));
  s = await stagePatch([{ name: "Online Test", status: "SCHEDULED", dateDisplay: "Dec 2026", certainty: "TENTATIVE" }], true);
  check("a correction is saved but announces nothing", s.status === 200 && s.updates.length === 5, s.updates.map((u) => u.title));
  s = await stagePatch([{ name: "Online Test", status: "POSTPONED" }]);
  check("the next real change is announced again", s.status === 200 && s.updates.length === 6 && s.updates[5].title === "Online Test postponed", s.updates.map((u) => u.title));

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
