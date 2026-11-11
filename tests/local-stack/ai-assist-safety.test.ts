// ═══════════════════════════════════════════════════════════
// AI Assist: Stop, time limit, late results and retries (CMS usability batch 1)
// ═══════════════════════════════════════════════════════════
// Through the REAL route handler and repository, against the in-memory test
// database. The AI is tests/local-stack/fake-ai.mjs (it answers from the
// source text, word for word), wrapped here so a test can hold its answer,
// fail it, or move the clock while it waits. No request leaves the machine.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/ai-assist-safety.test.ts
//
// Covers: a run asked of a version the editor has not seen saves nothing; Stop
// before saving saves nothing; a run past its time budget saves nothing; a late
// result after a newer edit is refused and the edit kept; Verified values are
// never touched; AI busy / limit reached and an unreadable source are reported
// plainly; a retry adds no duplicate evidence; nothing is approved or published.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  await import("./fake-ai.mjs");
  const fakeAi = globalThis.fetch;

  // The wrapper: count AI requests, optionally hold them, fail them, or block a source host.
  let aiCalls = 0;
  let gate: Promise<void> | null = null;
  let onAiHeld: (() => void) | null = null;
  let aiStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://blocked.example/")) return new Response("Forbidden", { status: 403, headers: { "content-type": "text/html" } });
    if (!url.includes("generativelanguage.googleapis.com")) return fakeAi(input, init);
    aiCalls++;
    if (gate) { onAiHeld?.(); await gate; }
    if (aiStatus !== 200) return new Response(JSON.stringify({ error: { message: "provider text with key=test-key-not-real" } }), { status: aiStatus, headers: { "content-type": "application/json" } });
    return fakeAi(input, init);
  }) as typeof fetch;
  const hold = () => {
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const held = new Promise<void>((r) => { onAiHeld = r; });
    return { held, release: () => { gate = null; onAiHeld = null; release(); } };
  };

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const aiAssist = await import("@/app/api/admin/cms/records/[id]/ai-assist/route");
  const { classifyAssistFailure } = await import("@/app/admin/cms/[id]/assist-run");
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const json = (path: string, method: string, body: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify(body) });

  const NOTICE = [
    "TEST BOARD CLERK RECRUITMENT 2026",
    "IMPORTANT DATES",
    "Online application: 01.11.2026 to 30.11.2026",
    "Last date for online application: 30.11.2026",
    "APPLICATION FEE",
    "General / OBC candidates: Rs. 750/-",
    "SC / ST candidates: Rs. 100/-",
    "VACANCIES",
    "Total posts: 1000",
    "Candidates must apply online through the official website only. No other mode of application will be accepted.",
  ].join("\n");
  const SOURCE = "https://www.testboard.gov.in/clerk-2026.pdf";

  let n = 0;
  const newJob = async () => {
    n++;
    const r = await records.POST(json("/api/admin/cms/records", "POST", {
      organizationId: "test-board", organizationName: "Test Board", govType: "State Govt", title: `TEST RECORD Clerk ${n} 2026`, recruitmentYear: 2026, forceCreate: true,
    }));
    const d = await r.json();
    return { id: d.record.id as string, rev: d.record.recordRevision as string };
  };
  const run = (id: string, revision: string | undefined, opts: { signal?: AbortSignal; url?: string; json?: boolean } = {}) => {
    const path = `/api/admin/cms/records/${id}/ai-assist`;
    if (opts.json) {
      return aiAssist.POST(new NextRequest(`${ORIGIN}${path}`, { method: "POST", signal: opts.signal, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify({ url: opts.url ?? SOURCE, ...(revision ? { revision } : {}) }) }), ctx(id));
    }
    const f = new FormData();
    f.set("url", opts.url ?? SOURCE);
    f.set("pastedText", NOTICE);
    if (revision) f.set("revision", revision);
    return aiAssist.POST(new NextRequest(`${ORIGIN}${path}`, { method: "POST", signal: opts.signal, headers: { origin: ORIGIN, cookie: `admin_sid=${token}` }, body: f }), ctx(id));
  };
  const row = async (id: string) => (await pg.query("SELECT record_revision, draft_state, dates, financial, vacancies, last_published_revision FROM recruitments WHERE id = $1", [id])).rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const aiRevisions = async (id: string) => ((await pg.query("SELECT count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND reason LIKE 'AI Assist (auto-filled%'", [id])).rows[0] as { n: number }).n;
  const excerpts = async (id: string) => ((await pg.query("SELECT coalesce(sum(jsonb_array_length(excerpts)), 0)::int AS n FROM recruitment_evidence WHERE recruitment_id = $1", [id])).rows[0] as { n: number }).n;
  const patch = async (id: string, rev: string, fieldPath: string, value: unknown) => {
    const r = await fields.PATCH(json(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "admin edit",
    }), ctx(id));
    const d = await r.json();
    return { status: r.status, rev: d.record?.recordRevision as string };
  };

  section("A run asked of a version the editor has not seen");
  {
    const job = await newJob();
    const r = await run(job.id, "deadbeef");
    const d = await r.json();
    check("→ 409 CHANGED, told to reload", r.status === 409 && /Reload it/.test(d.error) && classifyAssistFailure(409, d.error) === "CHANGED", d);
    check("no AI request was made and nothing saved", aiCalls === 0 && (await aiRevisions(job.id)) === 0, aiCalls);
  }

  section("A normal run, then a retry: Verified kept, no duplicate evidence");
  {
    const job = await newJob();
    // An admin's checked total, and a fee the notice disagrees with.
    await pg.query(`UPDATE recruitments SET vacancies = jsonb_set(vacancies, '{total}', '{"value": 999, "status": "VERIFIED", "evidenceIds": ["test-evidence"], "conflict": false, "manuallyEdited": true}'::jsonb) WHERE id = $1`, [job.id]);
    const p = await patch(job.id, (await row(job.id)).record_revision, "financial.feeGeneral", 600);
    check("setup: Verified total and an existing fee", p.status === 200);
    const before = aiCalls;
    let r = await run(job.id, p.rev);
    let d = await r.json();
    check("→ 200, empty fields filled as Pending", r.status === 200 && d.filled.length > 0 && d.filled.every((f: { fieldPath: string }) => (f.fieldPath !== "vacancies.total" && f.fieldPath !== "financial.feeGeneral")), d.filled?.map((f: { fieldPath: string }) => f.fieldPath));
    const after = await row(job.id);
    check("the Verified total is untouched (999, Verified)", after.vacancies.total.value === 999 && after.vacancies.total.status === "VERIFIED", after.vacancies.total);
    check("the existing fee is only suggested, never overwritten", after.financial.feeGeneral.value === 600 && d.suggested.some((s: { fieldPath: string }) => s.fieldPath === "financial.feeGeneral"), after.financial.feeGeneral);
    check("AI requests were made for this run only (no retry by itself)", aiCalls - before >= 1 && aiCalls - before <= 3, aiCalls - before);
    const e1 = await excerpts(job.id);
    check("evidence quotes were kept", e1 > 0, e1);
    r = await run(job.id, after.record_revision);
    d = await r.json();
    check("retry → 200, fills nothing new", r.status === 200 && d.filled.length === 0, d.filled);
    check("retry added no duplicate evidence quotes", (await excerpts(job.id)) === e1, { before: e1, after: await excerpts(job.id) });
    check("nothing approved or published", after.draft_state === "DRAFT" && after.last_published_revision === null);
  }

  section("Stop before saving");
  {
    const job = await newJob();
    const h = hold();
    const stop = new AbortController();
    const pending = run(job.id, job.rev, { signal: stop.signal });
    await h.held;
    stop.abort();
    h.release();
    const r = await pending;
    const d = await r.json();
    check("→ 499, stopped before anything was saved", r.status === 499 && d.stopped === true && classifyAssistFailure(499, d.error) !== "CHANGED", { status: r.status, d });
    check("nothing saved, no evidence", (await aiRevisions(job.id)) === 0 && (await excerpts(job.id)) === 0 && (await row(job.id)).record_revision === job.rev);
  }

  section("Past the time budget");
  {
    const job = await newJob();
    const h = hold();
    const realNow = Date.now;
    const pending = run(job.id, job.rev);
    await h.held;
    Date.now = () => realNow() + 80_000;
    h.release();
    const r = await pending;
    Date.now = realNow;
    const d = await r.json();
    check("→ 504, took too long, nothing saved", r.status === 504 && /nothing was saved/.test(d.error) && classifyAssistFailure(504, d.error) === "TIMEOUT", { status: r.status, d });
    check("the job is unchanged", (await aiRevisions(job.id)) === 0 && (await row(job.id)).record_revision === job.rev);
  }

  section("A late result after a newer edit");
  {
    const job = await newJob();
    const h = hold();
    const pending = run(job.id, job.rev);
    await h.held;
    // The admin gave up waiting (or pressed Stop and the host kept going) and typed the close date by hand.
    const edit = await patch(job.id, job.rev, "dates.applicationCloseDate", "2026-12-05");
    check("the admin's edit is saved while the run waits", edit.status === 200, edit);
    h.release();
    const r = await pending;
    const d = await r.json();
    check("the late run is refused (409), told to reload", r.status === 409 && classifyAssistFailure(409, d.error) === "CHANGED", { status: r.status, d });
    const after = await row(job.id);
    check("the admin's date is kept, nothing from the late run saved", after.dates.applicationCloseDate.value === "2026-12-05" && (await aiRevisions(job.id)) === 0, after.dates.applicationCloseDate);
  }

  section("The AI busy or out of its limit; the source unreadable");
  {
    const job = await newJob();
    aiStatus = 429;
    let r = await run(job.id, job.rev);
    let d = await r.json();
    check("429 → the run still completes; aiProblem says rate limit; no provider text", r.status === 200 && /rate limit/i.test(d.aiProblem ?? "") && !/test-key/.test(JSON.stringify(d)), { status: r.status, aiProblem: d.aiProblem });
    const job2 = await newJob();
    aiStatus = 503;
    r = await run(job2.id, job2.rev);
    d = await r.json();
    check("503 (overloaded) → aiProblem says unavailable", r.status === 200 && /unavailable/i.test(d.aiProblem ?? ""), d.aiProblem);
    aiStatus = 200;
    const job3 = await newJob();
    const callsBefore = aiCalls;
    r = await run(job3.id, job3.rev, { json: true, url: "https://blocked.example/notice" });
    d = await r.json();
    check("a site that refuses us → 422, read as SOURCE, no AI request", r.status === 422 && classifyAssistFailure(422, d.error) === "SOURCE" && aiCalls === callsBefore, { status: r.status, d });
  }

  section("Unauthorised");
  {
    const job = await newJob();
    const r = await aiAssist.POST(new NextRequest(`${ORIGIN}/api/admin/cms/records/${job.id}/ai-assist`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ url: SOURCE }) }), ctx(job.id));
    check("without a session → 401", r.status === 401, r.status);
    const pub = ((await pg.query("SELECT count(*)::int AS n FROM published_recruitments")).rows[0] as { n: number }).n;
    check("no run in this file published anything", pub === 0, pub);
  }

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
