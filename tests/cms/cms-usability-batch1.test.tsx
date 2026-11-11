// CMS usability batch 1: AI Assist Stop / time limit / errors, the date box, the duplicate-announcement warning.
// Pure and source checks; no AI request, no database. The route itself is covered by
// tests/local-stack/ai-assist-safety.test.ts.
//   npx tsx --tsconfig tsconfig.json tests/cms/cms-usability-batch1.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import {
  ASSIST_CLIENT_TIMEOUT_MS, ASSIST_SERVER_LIMIT_MS, LATE_RESULT_WINDOW_MS,
  classifyAssistFailure, describeAssistFailure, lateResultNote, mayStillBeRunning, runAssistRequest,
} from "@/app/admin/cms/[id]/assist-run";
import { likelyDuplicates, eventsOf } from "@/lib/cms/announcement-duplicates";
import { SmartDateInput, UNREADABLE_DATE } from "@/app/admin/SmartDateInput";
import type { UpdateRecord } from "@/types";

const src = (p: string) => readFileSync(p, "utf8");
const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetch that never answers until its signal is aborted, like a server still working. */
const hanging: typeof fetch = (_u, init) => new Promise((_, reject) => {
  init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});

suite("AI Assist request: Stop, time limit, errors");

test("B1-01 limits: the editor waits a little longer than the server may run; a stopped run is watched past the server's limit", () => {
  assert.equal(ASSIST_SERVER_LIMIT_MS, 90_000);
  assert.ok(ASSIST_CLIENT_TIMEOUT_MS > ASSIST_SERVER_LIMIT_MS);
  assert.ok(LATE_RESULT_WINDOW_MS > ASSIST_SERVER_LIMIT_MS);
  assert.match(src("src/app/api/admin/cms/records/[id]/ai-assist/route.ts"), /export const maxDuration = 90;/);
});

test("B1-02 a normal answer comes back as it is, with one request", async () => {
  let calls = 0;
  const f: typeof fetch = async () => { calls++; return okJson({ filled: [], record: { id: "x" } }); };
  const out = await runAssistRequest(f, "/x", { method: "POST" }, new AbortController().signal);
  assert.equal(out.ok, true);
  assert.equal(calls, 1);
});

test("B1-03 Stop during extraction ends the wait at once and says the server may still finish", async () => {
  const stop = new AbortController();
  const started = Date.now();
  const p = runAssistRequest(hanging, "/x", { method: "POST" }, stop.signal);
  setTimeout(() => stop.abort(), 20);
  const out = await p;
  assert.ok(Date.now() - started < 2_000);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "STOPPED");
  assert.equal(mayStillBeRunning(out), true);
});

test("B1-04 the time limit stops a request that never answers, and nothing retries by itself", async () => {
  let calls = 0;
  const f: typeof fetch = (u, init) => { calls++; return hanging(u, init); };
  const out = await runAssistRequest(f, "/x", { method: "POST" }, new AbortController().signal, 40);
  assert.equal(!out.ok && out.kind, "TIMEOUT");
  assert.equal(mayStillBeRunning(out), false);
  assert.equal(calls, 1);
  assert.match(!out.ok ? out.message : "", /took too long.*Nothing more is running.*retry/i);
  // A retry is the admin's own second request, and it can succeed.
  const again = await runAssistRequest(async () => okJson({ record: {} }), "/x", { method: "POST" }, new AbortController().signal);
  assert.equal(again.ok, true);
});

test("B1-05 a gateway's own timeout page (not JSON) reads as a timeout, not a code error", async () => {
  const out = await runAssistRequest(async () => new Response("<html>504 Gateway Timeout</html>", { status: 504, headers: { "content-type": "text/html" } }), "/x", {}, new AbortController().signal);
  assert.equal(!out.ok && out.kind, "TIMEOUT");
  assert.ok(!/SyntaxError|JSON/.test(!out.ok ? out.message : ""));
});

test("B1-06 each failure says what happened in plain words", () => {
  assert.equal(classifyAssistFailure(422, "Fetch failed: 403"), "SOURCE");
  assert.equal(classifyAssistFailure(502, undefined), "AI_BUSY");
  assert.equal(classifyAssistFailure(503, undefined), "AI_BUSY");
  assert.equal(classifyAssistFailure(429, undefined), "AI_BUSY");
  assert.equal(classifyAssistFailure(200, "AI rate limit reached — wait a minute and try again"), "AI_BUSY");
  assert.equal(classifyAssistFailure(409, "Record was modified concurrently — please reload and try again"), "CHANGED");
  assert.equal(classifyAssistFailure(409, "Cannot edit a PUBLISHED record"), "INPUT");
  assert.equal(classifyAssistFailure(504, "AI Assist took too long, so nothing was saved."), "TIMEOUT");
  assert.match(describeAssistFailure("SOURCE", "Fetch failed: 403"), /could not be read.*Fetch failed: 403.*upload it, or paste/);
  assert.match(describeAssistFailure("AI_BUSY"), /busy or its limit.*Wait a minute/);
  assert.match(describeAssistFailure("CHANGED"), /reloaded with the latest saved values/);
});

test("B1-07 a lost connection is treated like Stop: the server may still be working", async () => {
  const out = await runAssistRequest(async () => { throw new TypeError("Failed to fetch"); }, "/x", {}, new AbortController().signal);
  assert.equal(!out.ok && out.kind, "NETWORK");
  assert.equal(mayStillBeRunning(out), true);
});

test("B1-08 after a Stop, the late-result note reads the job's history by server time", () => {
  const known = "2026-11-11T10:00:00.000Z";
  assert.match(lateResultNote([], known), /saved nothing/);
  assert.match(lateResultNote([
    { fieldPath: "dates.applicationCloseDate", revisedAt: "2026-11-11T09:59:00.000Z", reason: "AI Assist (auto-filled empty field) — extracted from x" },
    { fieldPath: "financial.feeGeneral", revisedAt: "2026-11-11T10:00:30.000Z", reason: "AI Assist (suggestion applied by admin) — x" },
  ], known), /saved nothing/);
  const late = lateResultNote([
    { fieldPath: "dates.applicationCloseDate", revisedAt: "2026-11-11T10:00:40.000Z", reason: "AI Assist (auto-filled empty field) — extracted from x" },
    { fieldPath: "vacancies.total", revisedAt: "2026-11-11T10:00:41.000Z", reason: "AI Assist (auto-filled empty field) — extracted from x" },
  ], known);
  assert.match(late, /finished on the server and filled 2 empty fields as Pending \(dates.applicationCloseDate, vacancies.total\)\. Nothing already filled was changed/);
});

test("B1-09 the editor: Stop button, ticking time, Retry locked while a stopped run may still save, no automatic retry", () => {
  const page = src("src/app/admin/cms/[id]/page.tsx");
  assert.match(page, /data-ai-stop[\s\S]{0,120}aiStop\.current\?\.abort\(\)/);
  assert.match(page, /data-ai-retry[\s\S]{0,80}disabled=\{Boolean\(aiLate\)\}/);
  assert.match(page, /setAiLate\(\{ until: started \+ LATE_RESULT_WINDOW_MS, knownUntil \}\)/);
  assert.match(page, /disabled=\{aiLoading \|\| Boolean\(aiLate\) \|\| !aiUrl\.trim\(\)\}/);
  // The only callers of handleAiAssist are buttons and Enter: nothing calls it from a timer or an error path.
  const calls = page.match(/handleAiAssist\(/g) ?? [];
  assert.equal(calls.length, 6, `handleAiAssist call sites: ${calls.length}`);
  assert.ok(!/Extracting…/.test(page), "the old endless label is gone");
  // The page sends the version it shows, so a stale page cannot start a run.
  assert.match(page, /revision \}\)\)|revision \}, |JSON\.stringify\(\{ url: aiUrl\.trim\(\), revision \}\)/);
});

suite("Duplicate announcement warning");

const entry = (id: string, date: string, title: string, description = ""): UpdateRecord => ({ id, date, title, description, type: "EXAM_NOTICE" } as UpdateRecord);

test("B1-10 a manual admit-card note next to the one a stage change wrote is caught", () => {
  const stage = entry("s1", "2026-11-11", "Preliminary Examination: admit card released", "The admit card for Preliminary Examination has been released.");
  const hits = likelyDuplicates({ date: "2026-11-11", title: "Prelims admit card released", description: "Call letters are available." }, [stage]);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /admit card/);
  assert.deepEqual(eventsOf("Call letters out"), ["admit card"]);
});

test("B1-11 different news, or the same news long apart, is not flagged", () => {
  const existing = [entry("a", "2026-11-11", "Preliminary Examination: admit card released"), entry("b", "2026-08-01", "Result declared for Mains")];
  assert.equal(likelyDuplicates({ date: "2026-11-12", title: "Answer key published", description: "Objections till 20 Nov" }, existing).length, 0);
  assert.equal(likelyDuplicates({ date: "2026-11-12", title: "Mains result declared" }, existing).length, 0, "the old result is months away");
  assert.equal(likelyDuplicates({ date: "2026-08-03", title: "Mains result declared" }, existing).length, 1);
});

test("B1-12 nearly the same title is caught even without a known kind of news", () => {
  const hits = likelyDuplicates({ date: "2026-11-11", title: "Important notice for candidates of Patna centre" }, [entry("c", "2026-11-10", "Important notice for Patna centre candidates")]);
  assert.equal(hits.length, 1);
  assert.match(hits[0].why, /nearly the same/);
});

test("B1-13 the form warns once, adds nothing, and lets the owner go ahead; nothing is merged or removed", () => {
  const page = src("src/app/admin/cms/[id]/page.tsx");
  assert.match(page, /if \(dupes\?\.shownFor !== form\) \{\s*const hits = likelyDuplicates\(/);
  assert.match(page, /data-duplicate-warning[\s\S]{0,900}Nothing has been added\. If this is different news, press Add Update again/);
  assert.match(page, /existingUpdates=\{record\.updates\}/);
  assert.ok(!/deleteUpdate|removeUpdate|mergeUpdate/.test(page));
});

suite("The date box");

test("B1-14 an unreadable date is marked, says nothing can be saved, and never claims the old date is kept", () => {
  const html = renderToStaticMarkup(<SmartDateInput value="2026-11-11" onChange={() => {}} />);
  assert.match(html, /value="11 Nov 2026"/);
  assert.ok(!/is kept/.test(src("src/app/admin/SmartDateInput.tsx")), "the old 'is kept' wording is gone");
  assert.match(src("src/app/admin/SmartDateInput.tsx"), /onValidity\?\.\(r\.ok !== false\)/);
  assert.match(src("src/app/admin/SmartDateInput.tsx"), /aria-invalid=\{reading\.ok === false \|\| undefined\}/);
  assert.match(UNREADABLE_DATE, /nothing has been saved/);
});

test("B1-15 clicking into the box selects its date, so typing replaces it", () => {
  const s = src("src/app/admin/SmartDateInput.tsx");
  assert.match(s, /onFocus=\{\(e\) => \{ e\.currentTarget\.select\(\); keepSelection\.current = true; \}\}/);
  assert.match(s, /onMouseUp=\{\(e\) => \{ if \(keepSelection\.current\) \{ e\.preventDefault\(\);/);
});

test("B1-16 every form with a date box refuses to save while it cannot read its date", () => {
  const page = src("src/app/admin/cms/[id]/page.tsx");
  const age = src("src/app/admin/cms/[id]/AgeEditor.tsx");
  const stages = src("src/app/admin/cms/[id]/ExamStagesEditor.tsx");
  const uses = [page, age, stages].join("\n").match(/<SmartDateInput[\s\S]*?\/>/g) ?? [];
  assert.equal(uses.length, 6, "six date boxes in the editor");
  for (const u of uses) assert.match(u, /onValidity=/, u);
  // Field editor and Add Update (page.tsx), age editor, stages editor: each save refuses.
  assert.equal((page.match(/if \(dateBad\) \{ setErr\(UNREADABLE_DATE\); return; \}/g) ?? []).length, 2);
  assert.match(age, /if \(badDates\.length > 0\) \{ setErr\(UNREADABLE_DATE\); return; \}/);
  assert.match(stages, /if \(dateBad\) \{ setErr\(UNREADABLE_DATE\); return; \}/);
});

test("B1-17 Add Update starts with no date, asks for one, and says a live job's update waits for the publish", () => {
  const page = src("src/app/admin/cms/[id]/page.tsx");
  assert.match(page, /const \[date, setDate\] = useState\(""\);/);
  assert.ok(!/useState\(new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/.test(page));
  assert.match(page, /if \(!date\) \{ setErr\("Enter the date printed on the notice\."\); return; \}/);
  assert.ok(!/shows on the public page as soon as you add it/.test(page));
});
