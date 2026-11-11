// ═══════════════════════════════════════════════════════════
// Simple Update, every kind, on a job that has been published (CMS usability batch 2)
// ═══════════════════════════════════════════════════════════
// Through the REAL route handlers and repository, against the in-memory test
// database, with the panel's own plan (lib/cms/simple-update.ts) and save path
// (apply-saves.ts). The panel's fetch calls are routed to the route handlers.
// No AI is involved at all; a guard fails the run if any AI address is called.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/simple-update.test.ts
//
// For each kind: the right fields and stages are saved as Pending, nothing
// unrelated changes, nothing is approved or published, the public keeps the
// published version, the publication review shows every change, and the
// owner's publish puts it live, with each announcement exactly once.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

(async () => {
  const { pg, token } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  let aiCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("generativelanguage.googleapis.com")) aiCalls++;
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
  const { getAllPublishedSnapshots } = await import("@/lib/cms/public-repository");
  const { lifecycleLinksOf } = await import("@/lib/cms/lifecycle-links");
  const { todayInIndia } = await import("@/lib/cms/attention");
  const { planSimpleUpdate } = await import("@/lib/cms/simple-update");
  const { applySaves } = await import("@/app/admin/cms/[id]/apply-saves");
  type Input = import("@/lib/cms/simple-update").SimpleInput;

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  // The panel's fetch, answered by the route handlers. Counts what it was asked to do.
  const called: string[] = [];
  const panelFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const m = url.match(/^\/api\/admin\/cms\/records\/([^/]+)\/(revert|fields|updates|approve|publish)$/);
    if (!m) throw new Error(`unexpected call ${url}`);
    called.push(m[2]);
    const [, id, what] = m;
    const r = new NextRequest(`${ORIGIN}${url}`, { method: init?.method ?? "GET", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: init?.body as string | undefined });
    if (what === "revert") return revert.POST(r, ctx(id));
    if (what === "fields") return fields.PATCH(r, ctx(id));
    if (what === "updates") return updates.POST(r, ctx(id));
    throw new Error(`the panel must never call ${what}`);
  }) as typeof fetch;

  // ── A published job, like RRB Paramedical ──
  const r = await records.POST(req("/api/admin/cms/records", "POST", {
    organizationId: "rrb", organizationName: "Railway Recruitment Boards", govType: "Central Govt", title: "TEST RECORD RRB Paramedical 2026", recruitmentYear: 2026,
  }));
  const d = await r.json();
  const id: string = d.record.id;
  const slug: string = d.record.slug;
  let rev: string = d.record.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "setup" }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return res.status;
  };
  await patch("links", [{ type: "OFFICIAL_WEBSITE", label: "RRB", url: "https://www.rrbcdg.gov.in/", official: true }]);
  await patch("dates.applicationCloseDate", "2026-10-14");
  await patch("examStages", [{ name: "CBT", order: 1, status: "SCHEDULED", dateDisplay: "Nov 2026", certainty: "TENTATIVE" }]);
  await patch("vacancies.total", 590);
  // The vacancy total is one an admin has checked against the notice.
  await pg.query(`UPDATE recruitments SET vacancies = jsonb_set(vacancies, '{total,status}', '"VERIFIED"') WHERE id = $1`, [id]);
  const ownerPublish = async () => {
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    return (await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id))).status;
  };
  check("setup: published", (await ownerPublish()) === 200);

  const SOURCE = "https://www.rrbcdg.gov.in/notice-cen-05-2026.pdf";
  const row = async () => (await pg.query("SELECT * FROM recruitments WHERE id = $1", [id])).rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const snapshots = async () => ((await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [id])).rows[0] as { n: number }).n;
  const pub = async () => JSON.stringify(await publicRepo.getBySlug(slug));
  const kinds = async () => {
    const snap = (await getAllPublishedSnapshots()).find((s) => s.slug === slug);
    return snap ? lifecycleLinksOf(snap).filter((l) => !l.fromStage).map((l) => `${l.kind}:${l.url}`).sort().join(" ") : "";
  };
  const publicTitles = async () => ((await publicRepo.getBySlug(slug)) as { updates?: Array<{ title: string }> } | undefined)?.updates?.map((u) => u.title) ?? [];
  // Columns a given update may touch; every other column must stay exactly as it was.
  const OTHERS = ["identity", "vacancies", "eligibility", "age", "financial", "selection", "how_to_apply", "exam_pattern", "syllabus", "documents", "conditions"];

  const runOne = async (name: string, input: Input, expect: { touches: string[]; fieldCheck: (row: Record<string, any>) => boolean; publicHas: string[]; lifecycle?: string; ownAnnouncement?: string; autoAnnouncement?: RegExp }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    section(name);
    const before = await row();
    const publicBefore = await pub();
    const snapsBefore = await snapshots();
    const record = (await getRecruitmentById(id))!;
    const plan = planSimpleUpdate(record, input, todayInIndia());
    check("the plan has no problems", plan.problems.length === 0, plan.problems);
    called.length = 0;
    const out = await applySaves(record, (opened) => planSimpleUpdate(opened, input, todayInIndia()).saves, plan.announcement, panelFetch);
    check("saved without error; only revert / fields / updates were called", !out.error && called.every((c) => ["revert", "fields", "updates"].includes(c)), { error: out.error, called });
    const after = await row();
    check("nothing approved or published: the job is an open draft", after.draft_state === "DRAFT" && (await snapshots()) === snapsBefore, after.draft_state);
    check("the right fields were saved", expect.fieldCheck(after), JSON.stringify({ dates: after.dates?.applicationCloseDate, stages: after.exam_stages, links: after.links?.map((l: { type: string }) => l.type) }));
    const untouched = OTHERS.filter((c) => !expect.touches.includes(c)).filter((c) => JSON.stringify(before[c]) !== JSON.stringify(after[c]));
    check("no unrelated field changed (vacancies still Verified 590)", untouched.length === 0 && after.vacancies.total.value === 590 && after.vacancies.total.status === "VERIFIED", untouched);
    check("the public page still shows the published version", (await pub()) === publicBefore);
    const review = await buildPublicationReview((await getRecruitmentById(id))!, todayInIndia());
    const pending = review.announcements.map((a) => a.title);
    if (expect.ownAnnouncement) check("the review lists the announcement", pending.includes(expect.ownAnnouncement), pending);
    if (expect.autoAnnouncement) check("the review lists the stage's own announcement (and the plan predicted it)", pending.some((t) => expect.autoAnnouncement!.test(t)) && plan.autoEntries.some((e) => expect.autoAnnouncement!.test(e.title)), { pending, predicted: plan.autoEntries });
    check("owner's reviewed publish → 200", (await ownerPublish()) === 200);
    const live = await pub();
    check("the public page now has the update", expect.publicHas.every((t) => live.includes(t)), expect.publicHas.filter((t) => !live.includes(t)));
    if (expect.lifecycle) check("listed on the Admit Cards / Results / Answer Keys data", (await kinds()).includes(expect.lifecycle), await kinds());
    const titles = await publicTitles();
    const counts = new Map<string, number>();
    titles.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
    check("every announcement is public exactly once", [...counts.values()].every((n) => n === 1), titles);
  };

  await runOne("Exam date (confirmed)", { kind: "EXAM_DATE", source: SOURCE, stageName: "CBT", examChange: "RESCHEDULED", dateIso: "2026-11-23", certainty: "CONFIRMED" }, {
    touches: [], fieldCheck: (a) => a.exam_stages.length === 1 && a.exam_stages[0].dateIso === "2026-11-23" && a.exam_stages[0].certainty === "CONFIRMED" && a.exam_stages[0].dateDisplay === undefined,
    publicHas: ["2026-11-23"], autoAnnouncement: /CBT/,
  });

  await runOne("Admit card (with the stage marked)", { kind: "ADMIT_CARD", source: SOURCE, stageName: "CBT", linkUrl: "https://www.rrbcdg.gov.in/admit-card-cen-05", linkLabel: "CBT admit card", linkOfficial: true, dateIso: "2026-11-18" }, {
    touches: [], fieldCheck: (a) => a.exam_stages[0].status === "ADMIT_CARD_OUT" && a.links.some((l: { type: string; official: boolean }) => l.type === "ADMIT_CARD" && l.official) && a.dates.admitCardDate?.value === "2026-11-18" && a.dates.admitCardDate?.status === "PENDING",
    publicHas: ["admit-card-cen-05"], lifecycle: "admitCard:https://www.rrbcdg.gov.in/admit-card-cen-05", autoAnnouncement: /admit card released/,
  });

  await runOne("Answer key (with an announcement)", { kind: "ANSWER_KEY", source: SOURCE, linkUrl: "https://www.rrbcdg.gov.in/answer-key-cen-05", linkOfficial: true, announcement: { type: "GENERAL_NOTICE", date: "2026-11-30", title: "CBT answer key published", description: "Objections can be raised till 5 Dec 2026." } }, {
    touches: [], fieldCheck: (a) => a.links.some((l: { type: string }) => l.type === "ANSWER_KEY"),
    publicHas: ["answer-key-cen-05", "CBT answer key published"], lifecycle: "answerKey:https://www.rrbcdg.gov.in/answer-key-cen-05", ownAnnouncement: "CBT answer key published",
  });

  await runOne("Result (stage result, not the final result)", { kind: "RESULT", source: SOURCE, stageName: "CBT", linkUrl: "https://www.rrbcdg.gov.in/result-cen-05", linkOfficial: true }, {
    touches: [], fieldCheck: (a) => a.exam_stages[0].status === "RESULT_DECLARED" && a.links.some((l: { type: string }) => l.type === "RESULT") && !a.dates.resultDate?.value,
    publicHas: ["result-cen-05"], lifecycle: "result:https://www.rrbcdg.gov.in/result-cen-05", autoAnnouncement: /result declared/,
  });

  await runOne("Cut-off (link not ticked official)", { kind: "CUT_OFF", source: SOURCE, linkUrl: "https://example-coaching.example/cutoff", linkOfficial: false }, {
    touches: [], fieldCheck: (a) => a.links.some((l: { type: string; official: boolean }) => l.type === "CUT_OFF" && l.official === false),
    publicHas: [],
  });
  check("an unticked cut-off link is not listed on the public Results data", !(await kinds()).includes("example-coaching"), await kinds());

  await runOne("Deadline extension (with its announcement)", { kind: "DEADLINE", source: SOURCE, dateIso: "2026-10-24", announcement: { type: "DEADLINE_EXTENSION", date: "2026-10-12", title: "Last date extended to 24 Oct 2026", description: "The last date to apply is now 24 Oct 2026." } }, {
    touches: [], fieldCheck: (a) => a.dates.applicationCloseDate.value === "2026-10-24" && a.dates.applicationCloseDate.status === "PENDING",
    publicHas: ["2026-10-24", "Last date extended to 24 Oct 2026"], ownAnnouncement: "Last date extended to 24 Oct 2026",
  });

  await runOne("Corrigendum (announcement and its PDF)", { kind: "NOTICE", source: SOURCE, linkUrl: "https://www.rrbcdg.gov.in/corrigendum-1.pdf", linkOfficial: true, announcement: { type: "CORRIGENDUM", date: "2026-11-02", title: "Corrigendum 1: exam city intimation date", description: "City intimation slips from 13 Nov 2026." } }, {
    touches: [], fieldCheck: (a) => a.links.some((l: { type: string }) => l.type === "CORRIGENDUM"),
    publicHas: ["Corrigendum 1: exam city intimation date"], ownAnnouncement: "Corrigendum 1: exam city intimation date",
  });

  await runOne("A new stage with a tentative date", { kind: "EXAM_DATE", source: SOURCE, stageName: "Skill Test", examChange: "ANNOUNCED", dateIso: "2026-12-14", certainty: "TENTATIVE" }, {
    touches: [], fieldCheck: (a) => a.exam_stages.some((s: { name: string; dateIso?: string; certainty?: string }) => s.name === "Skill Test" && s.dateIso === "2026-12-14" && s.certainty === "TENTATIVE"),
    publicHas: ["Skill Test"], autoAnnouncement: /Skill Test/,
  });
  {
    const titlesBefore = (await publicTitles()).length;
    await runOne("Same date, now confirmed (no new announcement)", { kind: "EXAM_DATE", source: SOURCE, stageName: "Skill Test", examChange: "CONFIRMED" }, {
      touches: [], fieldCheck: (a) => a.exam_stages.some((s: { name: string; dateIso?: string; certainty?: string; status: string }) => s.name === "Skill Test" && s.dateIso === "2026-12-14" && s.certainty === "CONFIRMED" && s.status === "SCHEDULED"),
      publicHas: ["Skill Test"],
    });
    check("confirming wrote no announcement", (await publicTitles()).length === titlesBefore, await publicTitles());
    const again = planSimpleUpdate((await getRecruitmentById(id))!, { kind: "EXAM_DATE", source: SOURCE, stageName: "Skill Test", examChange: "CONFIRMED" }, todayInIndia());
    check("confirming it again is refused", again.problems.some((p) => /already confirmed/.test(p)) && again.saves.length === 0, again.problems);
    const same = planSimpleUpdate((await getRecruitmentById(id))!, { kind: "EXAM_DATE", source: SOURCE, stageName: "Skill Test", examChange: "ANNOUNCED", dateIso: "2026-12-14", certainty: "CONFIRMED" }, todayInIndia());
    check("the same date marked the same way is refused", same.problems.some((p) => /already has this date, marked the same way/.test(p)), same.problems);
    const viaDate = planSimpleUpdate({ ...(await getRecruitmentById(id))!, examStages: [{ name: "Interview", order: 9, status: "SCHEDULED", dateIso: "2027-02-01", certainty: "TENTATIVE" }] }, { kind: "EXAM_DATE", source: SOURCE, stageName: "Interview", examChange: "ANNOUNCED", dateIso: "2027-02-01", certainty: "CONFIRMED" }, todayInIndia());
    check("the same date entered again as confirmed is accepted too", viaDate.problems.length === 0 && viaDate.saves.length === 1, viaDate.problems);
  }

  section("Postponement without a new date");
  {
    const record = (await getRecruitmentById(id))!;
    const plan = planSimpleUpdate(record, { kind: "EXAM_DATE", source: SOURCE, stageName: "Document Verification", examChange: "POSTPONED" }, todayInIndia());
    check("a new stage can be marked postponed without inventing a date", plan.problems.length === 0 && plan.saves.length === 1, plan.problems);
    const stage = (plan.saves[0].value as Array<{ name: string; status: string; dateIso?: string }>).find((s) => s.name === "Document Verification");
    check("…with no date on it", stage?.status === "POSTPONED" && stage.dateIso === undefined, stage);
  }

  section("Mistakes are caught before saving");
  {
    const record = (await getRecruitmentById(id))!;
    const t = todayInIndia();
    check("no source → refused", planSimpleUpdate(record, { kind: "DEADLINE", source: "", dateIso: "2026-10-30" }, t).problems.some((p) => /official page or PDF/.test(p)));
    check("no date → refused, nothing invented", planSimpleUpdate(record, { kind: "DEADLINE", source: SOURCE }, t).problems.some((p) => /Enter the last date/.test(p)));
    check("exam date without saying confirmed or tentative → refused", planSimpleUpdate(record, { kind: "EXAM_DATE", source: SOURCE, stageName: "CBT", examChange: "ANNOUNCED", dateIso: "2026-12-01" }, t).problems.some((p) => /final \(confirmed\) or tentative/.test(p)));
    check("a link already on the job → refused", planSimpleUpdate(record, { kind: "ADMIT_CARD", source: SOURCE, linkUrl: "https://www.rrbcdg.gov.in/admit-card-cen-05" }, t).problems.some((p) => /already on the job/.test(p)));
    await pg.query(`UPDATE recruitments SET dates = jsonb_set(dates, '{applicationCloseDate,status}', '"VERIFIED"') WHERE id = $1`, [id]);
    const verified = (await getRecruitmentById(id))!;
    const p1 = planSimpleUpdate(verified, { kind: "DEADLINE", source: SOURCE, dateIso: "2026-10-31" }, t);
    check("replacing a Verified date needs the owner's tick", p1.verifiedReplaced.length === 1 && p1.problems.some((p) => /marked Verified/.test(p)) && p1.saves.length === 0, p1.problems);
    const p2 = planSimpleUpdate(verified, { kind: "DEADLINE", source: SOURCE, dateIso: "2026-10-31", replaceVerified: true }, t);
    check("…and with the tick it is planned, as Pending", p2.problems.length === 0 && p2.saves.length === 1 && p2.changes[0].note === "replaces a Verified value", p2);
    const dup = planSimpleUpdate(verified, { kind: "ANSWER_KEY", source: SOURCE, linkUrl: "https://www.rrbcdg.gov.in/answer-key-revised", announcement: { type: "GENERAL_NOTICE", date: "2026-12-01", title: "Revised answer key out", description: "Revised key." } }, t);
    check("an announcement like one already public is flagged as a likely duplicate", dup.duplicates.some((h) => /answer key/.test(h.why)), dup.duplicates);
    const stagePlan = planSimpleUpdate(verified, { kind: "ADMIT_CARD", source: SOURCE, stageName: "CBT", linkUrl: "https://www.rrbcdg.gov.in/admit-2", announcement: { type: "GENERAL_NOTICE", date: "2026-12-01", title: "x", description: "y" } }, t);
    check("when the stage changes, no second announcement is offered or saved", !stagePlan.offersAnnouncement && stagePlan.announcement === null);
  }

  section("No AI");
  check("no AI address was called in this file", aiCalls === 0, aiCalls);

  globalThis.fetch = realFetch;
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
