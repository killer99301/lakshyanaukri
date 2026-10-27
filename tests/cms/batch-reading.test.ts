// Reading a long notice in page batches (stage B2.2), with a stand-in for
// the model: pages and batches, each value's page in the whole document,
// lists joined across batches by code, differing values kept apart as a
// conflict, failed and unstarted batches reported page by page, and the
// pacing of requests (a gate, resends after a refusal for load, each resend
// counted against the daily allowance). No network.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/batch-reading.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { judgeArticle, mergeReadings, pageBatches, pagesOf, readArticleInBatches } from "@/lib/cms/importer/article";
import { createGate, retryingFetch } from "@/lib/cms/importer/pacing";

process.env.AI_DAILY_CAP = "100000";

/** A made-up notice: `n` pages of filler, with given lines on given pages; a page in `blank` has no text. */
function notice(n: number, lines: Record<number, string[]>, blank: number[] = []): string {
  let out = "";
  for (let p = 1; p <= n; p++) {
    const body = blank.includes(p) ? "" : [`Page ${p} of the CRP notice.`, ...(lines[p] ?? []), ...Array.from({ length: 40 }, (_, i) => `General instruction ${p}.${i} for candidates applying online to this recruitment.`)].join("\n");
    out += `${body}\n\n-- ${p} of ${n} --\n\n`;
  }
  return out;
}

/** A stand-in model: answers each batch from the lines it was given. */
function model(answer: (text: string, first: number, last: number) => unknown, status: (first: number, attempt: number) => number = () => 200) {
  const calls: Array<{ first: number; last: number }> = [];
  const tries = new Map<number, number>();
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
    const m = /pages (\d+) to (\d+) of a/.exec(prompt);
    const first = m ? Number(m[1]) : 1, last = m ? Number(m[2]) : 0;
    calls.push({ first, last });
    const attempt = (tries.get(first) ?? 0) + 1;
    tries.set(first, attempt);
    const st = status(first, attempt);
    if (st !== 200) return new Response("{}", { status: st });
    const text = prompt.slice(prompt.indexOf("TEXT:"));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer(text, first, last)) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const has = (text: string, line: string) => text.includes(line);

suite("Pages and batches");

test("BR01 pages are cut at their marks; batches hold whole pages; a page without text is left out and named", () => {
  const text = notice(20, {}, [9]);
  const pages = pagesOf(text)!;
  assert.equal(pages.length, 20);
  assert.ok(pages.every((p, i) => p.page === i + 1 && p.text.trimEnd().endsWith(`-- ${i + 1} of 20 --`)));
  const batches = pageBatches(pages);
  assert.equal(batches.map((b) => b.text).join(""), pages.filter((p) => p.page !== 9).map((p) => p.text).join(""), "every page with text, once, in order");
  assert.ok(batches.every((b) => b.last - b.first + 1 <= 8 && b.text.length <= 30_000 + 4000));
  assert.ok(!batches.some((b) => b.first <= 9 && b.last >= 9), "page 9 (no text) is in no batch");
  assert.equal(pagesOf("no page marks here"), null);
});

suite("Reading in batches, put together by code");

test("BR02 each value's page counts in the whole document; stages from two batches become one list with both quotes", async () => {
  const text = notice(24, { 3: ["Online Preliminary Examination: November 2026"], 19: ["Common Interview: January 2027"], 5: ["Application fee Rs. 850/- for General candidates"] });
  const { fetchFn, calls } = model((t) => {
    const out: Record<string, unknown> = {};
    const stages = [];
    if (has(t, "Online Preliminary Examination: November 2026")) stages.push({ name: "Online Preliminary Examination", dateText: "November 2026", quote: "Online Preliminary Examination: November 2026" });
    if (has(t, "Common Interview: January 2027")) stages.push({ name: "Common Interview", dateText: "January 2027", quote: "Common Interview: January 2027" });
    if (stages.length) out.examStages = stages;
    if (has(t, "Rs. 850/-")) out.feeGeneral = { value: 850, quote: "Application fee Rs. 850/- for General candidates" };
    return out;
  });
  const r = await readArticleInBatches({ text, subject: "CRP — IBPS", apiKey: "test-key", fetchFn });
  assert.equal(r.coverage.mode, "batches");
  assert.ok(calls.length >= 3 && r.coverage.batches.every((b) => b.status === "read"), JSON.stringify(r.coverage.batches));
  const stages = r.values.filter((v) => v.fieldPath === "examStages");
  assert.equal(stages.length, 2, "one value per contributing batch, each with its own quote");
  assert.deepEqual((stages[0].value as Array<{ name: string }>).map((s) => s.name), ["Online Preliminary Examination", "Common Interview"]);
  assert.equal(JSON.stringify(stages[0].value), JSON.stringify(stages[1].value), "the same joined list, so the review shows one item with two quotes");
  assert.deepEqual(stages.map((s) => s.page), [3, 19]);
  assert.equal(r.values.find((v) => v.fieldPath === "financial.feeGeneral")!.page, 5);
});
test("BR03 two batches that state a value differently are both kept: a conflict, not a choice", () => {
  const merged = mergeReadings([
    { values: [{ fieldPath: "financial.feeGeneral", value: 850, quote: "Rs. 850", page: 5 }, { fieldPath: "examPattern", value: [{ name: "Main", sections: [{ subject: "Reasoning", questions: 40, marks: 50 }] }], quote: "q1", page: 21 }], refused: [] },
    { values: [{ fieldPath: "financial.feeGeneral", value: 800, quote: "Rs. 800", page: 40 }, { fieldPath: "examPattern", value: [{ name: "Main", sections: [{ subject: "Reasoning", questions: 40, marks: 40 }] }], quote: "q2", page: 24 }], refused: [{ fieldPath: "age", reason: "the quote is not in the text" }] },
  ]);
  assert.deepEqual(merged.values.filter((v) => v.fieldPath === "financial.feeGeneral").map((v) => v.value), [850, 800]);
  const papers = merged.values.filter((v) => v.fieldPath === "examPattern");
  assert.equal(papers.length, 2);
  assert.notEqual(JSON.stringify(papers[0].value), JSON.stringify(papers[1].value), "the same paper given differently is not joined");
  assert.deepEqual(merged.refused, [{ fieldPath: "age", reason: "the quote is not in the text" }]);
});
test("BR04 a batch that keeps failing is reported with its pages; the others are read", async () => {
  const text = notice(24, { 20: ["Last date for registration 21.09.2026"] });
  const { fetchFn } = model((t) => (has(t, "21.09.2026") ? { dates: { applicationCloseDate: { value: "2026-09-21", quote: "Last date for registration 21.09.2026" } } } : {}), (first) => (first === 9 ? 503 : 200));
  const r = await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn });
  const bad = r.coverage.batches.filter((b) => b.status !== "read");
  assert.equal(bad.length, 1);
  assert.equal(bad[0].first, 9);
  assert.equal(bad[0].status, "failed");
  assert.ok(/unavailable/i.test(bad[0].reason ?? ""), bad[0].reason);
  assert.equal(r.values.find((v) => v.fieldPath === "dates.applicationCloseDate")?.page, 20);
  assert.equal(r.skipped, undefined, "the reading ran; only those pages are missing");
});
/** A stand-in that cuts its answer off (not whole JSON) when given more than `maxPages` pages. */
function cutOffModel(maxPages: number, answer: (text: string) => unknown) {
  const calls: Array<{ first: number; last: number }> = [];
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
    const m = /pages (\d+) to (\d+) of a/.exec(prompt);
    const first = m ? Number(m[1]) : 1, last = m ? Number(m[2]) : 0;
    calls.push({ first, last });
    const whole = JSON.stringify(answer(prompt.slice(prompt.indexOf("TEXT:"))));
    const out = last - first + 1 > maxPages ? whole.slice(0, Math.max(1, Math.floor(whole.length / 2))) + ',"examStages":[{"name":"Onl' : whole;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test("BR10 an answer cut off for an 8-page batch is read again in halves; every value keeps its page; the split is said", async () => {
  const text = notice(16, { 2: ["Last date for registration 21.09.2026"], 7: ["Application fee Rs. 850/- for General candidates"] });
  const { fetchFn, calls } = cutOffModel(4, (t) => ({
    ...(has(t, "21.09.2026") ? { dates: { applicationCloseDate: { value: "2026-09-21", quote: "Last date for registration 21.09.2026" } } } : {}),
    ...(has(t, "Rs. 850/-") ? { feeGeneral: { value: 850, quote: "Application fee Rs. 850/- for General candidates" } } : {}),
  }));
  const r = await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn });
  assert.ok(r.coverage.split?.length, "the split is recorded");
  assert.ok(r.coverage.split!.every((s) => s.last - s.first + 1 > 4));
  assert.ok(r.coverage.batches.every((b) => b.status === "read" && b.last - b.first + 1 <= 4), JSON.stringify(r.coverage.batches));
  const read = r.coverage.batches.flatMap((b) => Array.from({ length: b.last - b.first + 1 }, (_, i) => b.first + i));
  assert.deepEqual(read, Array.from({ length: 16 }, (_, i) => i + 1), "every page read once, none twice, none missing");
  assert.equal(r.values.find((v) => v.fieldPath === "dates.applicationCloseDate")?.page, 2);
  assert.equal(r.values.find((v) => v.fieldPath === "financial.feeGeneral")?.page, 7);
  assert.ok(calls.some((c) => c.last - c.first + 1 > 4) && calls.some((c) => c.last - c.first + 1 <= 4));
});
test("BR11 a page whose answer is still cut off alone is failed, never read; the reading says so", async () => {
  const text = notice(16, { 11: ["Last date for registration 21.09.2026"] });
  const { fetchFn } = cutOffModel(0, (t) => (has(t, "21.09.2026") ? { dates: { applicationCloseDate: { value: "2026-09-21", quote: "Last date for registration 21.09.2026" } } } : {}));
  const r = await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn });
  assert.ok(r.coverage.batches.length > 0 && r.coverage.batches.every((b) => b.status === "failed" && /incomplete/i.test(b.reason ?? "")), JSON.stringify(r.coverage.batches));
  assert.equal(r.values.length, 0, "nothing taken from a cut-off answer");
  assert.ok(r.skipped && /incomplete/i.test(r.skipped), "the reading says it read nothing, and why");
});
test("BR12 halving stops at its depth: a long batch never turns into endless requests", async () => {
  const text = notice(16, {});
  const { fetchFn, calls } = cutOffModel(0, () => ({}));
  await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn });
  // 2 batches of 8 → halves of 4 → 2 → 1: 1+2+4+8 reads each, plus one resend of each final piece.
  assert.ok(calls.length <= 2 * (1 + 2 + 4 + 8 + 8), String(calls.length));
});

test("BR05 batches not started before the time limit are \"not read\", never read", async () => {
  const text = notice(24, {});
  const { fetchFn, calls } = model(() => ({}));
  const r = await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn, deadline: Date.now() + 1000 });
  assert.equal(calls.length, 0);
  assert.ok(r.coverage.batches.length >= 3 && r.coverage.batches.every((b) => b.status === "not_read" && /time/.test(b.reason ?? "")));
});
test("BR06 a short text, or one without page marks, is read whole in one request", async () => {
  const { fetchFn, calls } = model(() => ({}));
  const r = await readArticleInBatches({ text: notice(3, {}), subject: "x", apiKey: "test-key", fetchFn });
  assert.equal(calls.length, 1);
  assert.equal(r.coverage.mode, "whole");
  assert.deepEqual(r.coverage.batches.map((b) => [b.first, b.last, b.status]), [[1, 3, "read"]]);
});

suite("What a batch without the schedule must not take");

test("BR07 a date's quote must name its event: a signature date or a result deadline is not an exam or admit-card date", () => {
  const text = ["Mumbai Director", "Date: 01.09.2026", "Proper document from Board / University for having declared the result on or before 21.09.2026 has to be produced.", "Online Examination – Preliminary on 22.11.2026"].join("\n");
  const r = judgeArticle({ dates: {
    admitCardDate: { value: "2026-09-01", quote: "Date: 01.09.2026" },
    examDate: { value: "2026-09-21", quote: "declared the result on or before 21.09.2026" },
    interviewDate: { value: "2026-11-22", quote: "Online Examination – Preliminary on 22.11.2026" },
  } }, text);
  assert.deepEqual(r.values, []);
  assert.deepEqual(r.refused.map((x) => [x.fieldPath, x.reason]), [
    ["dates.examDate", "the quote does not name this event"], ["dates.admitCardDate", "the quote does not name this event"], ["dates.interviewDate", "the quote does not name this event"],
  ]);
  const ok = judgeArticle({ dates: { examDate: { value: "2026-11-22", quote: "Online Examination – Preliminary on 22.11.2026" } } }, text);
  assert.deepEqual(ok.values.map((v) => v.value), ["2026-11-22"]);
});
test("BR08 a schedule step with only a month is a stage, its month kept as written, not turned into a date", () => {
  const text = "Online Examination – Preliminary (Officers/OA) November / December, 2026";
  const r = judgeArticle({ examStages: [{ name: "Online Examination – Preliminary", date: null, dateText: "November / December, 2026", quote: text }] }, text);
  assert.deepEqual(r.values[0].value, [{ name: "Online Examination – Preliminary", order: 1, kind: "SELECTION", status: "NOT_DECLARED", certainty: "TBA", notes: "November / December, 2026" }]);
});

test("BR09 a stage name too long for the editor is left out, and said; the other stages are kept", () => {
  const long = "Download of call letters for online examination – Preliminary for Officers Scale I and Office Assistants";
  const text = `${long} November, 2026
Online Examination – Preliminary (Officers/OA) November / December, 2026`;
  const r = judgeArticle({ examStages: [
    { name: long, date: null, dateText: "November, 2026", quote: `${long} November, 2026` },
    { name: "Online Examination – Preliminary", date: null, dateText: "November / December, 2026", quote: "Online Examination – Preliminary (Officers/OA) November / December, 2026" },
  ] }, text);
  assert.deepEqual((r.values[0].value as Array<{ name: string }>).map((s) => s.name), ["Online Examination – Preliminary"]);
  assert.ok(r.refused.some((x) => x.fieldPath === "examStages" && /longer than 80/.test(x.reason)), JSON.stringify(r.refused));
});

suite("Pacing");

test("PC01 a refusal for load is resent after a wait, each resend counted first; a hard refusal is not resent", async () => {
  const statuses = [429, 503, 200];
  const reserved: string[] = [], failures: string[] = [], waits: number[] = [];
  const base = (async () => new Response("{}", { status: statuses.shift() ?? 200 })) as unknown as typeof fetch;
  const p = retryingFetch(base, { backoffMs: [5, 7], sleep: async (ms) => { waits.push(ms); }, reserve: async (f) => { reserved.push(f); return { allowed: true }; }, recordFailure: async (f) => { failures.push(f); } });
  const res = await p.fetch("https://x/", {});
  assert.equal(res.status, 200);
  assert.deepEqual(waits, [5, 7]);
  assert.equal(reserved.length, 2, "two resends, each counted against the allowance");
  assert.equal(failures.length, 2, "two refused attempts, each counted as a failure");
  assert.deepEqual(p.stats, { sent: 3, retried: 2, failed: 2 });
  const hard = retryingFetch((async () => new Response("{}", { status: 400 })) as unknown as typeof fetch, { sleep: async () => {}, reserve: async () => ({ allowed: true }), recordFailure: async () => {} });
  assert.equal((await hard.fetch("https://x/", {})).status, 400);
  assert.equal(hard.stats.sent, 1);
});
test("PC02 no resend once the daily allowance is used up; at most `retries` resends", async () => {
  const always429 = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
  const capped = retryingFetch(always429, { sleep: async () => {}, reserve: async () => ({ allowed: false }), recordFailure: async () => {} });
  assert.equal((await capped.fetch("https://x/", {})).status, 429);
  assert.equal(capped.stats.sent, 1);
  const bounded = retryingFetch(always429, { retries: 2, sleep: async () => {}, reserve: async () => ({ allowed: true }), recordFailure: async () => {} });
  await bounded.fetch("https://x/", {});
  assert.equal(bounded.stats.sent, 3);
});
test("PC03 the gate lets at most two tasks run at once, in the order they asked", async () => {
  const gate = createGate(2);
  let running = 0, most = 0;
  const order: number[] = [];
  await Promise.all([1, 2, 3, 4, 5].map((n) => gate(async () => {
    running++; most = Math.max(most, running); order.push(n);
    await new Promise((r) => setTimeout(r, 10));
    running--;
  })));
  assert.equal(most, 2);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test("BR13 a short notice read in one request whose answer is cut off is read again in halves; every page once, values on their pages", async () => {
  const text = notice(4, { 1: ["Last date for registration 21.09.2026"], 4: ["Application fee Rs. 850/- for General candidates"] });
  const calls: string[] = [];
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
    const m = /pages (\d+) to (\d+) of a/.exec(prompt);
    calls.push(m ? `${m[1]}-${m[2]}` : "whole");
    const t = prompt.slice(prompt.indexOf("TEXT:"));
    const answer = JSON.stringify({
      ...(t.includes("21.09.2026") ? { dates: { applicationCloseDate: { value: "2026-09-21", quote: "Last date for registration 21.09.2026" } } } : {}),
      ...(t.includes("Rs. 850/-") ? { feeGeneral: { value: 850, quote: "Application fee Rs. 850/- for General candidates" } } : {}),
    });
    // The whole notice in one answer is too much: cut off. Two pages at a time is fine.
    const out = m ? answer : answer.slice(0, 20);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn });
  assert.deepEqual(calls, ["whole", "1-2", "3-4"]);
  assert.deepEqual(r.coverage.split, [{ first: 1, last: 4 }]);
  assert.deepEqual(r.coverage.batches.map((b) => `${b.first}-${b.last}:${b.status}`), ["1-2:read", "3-4:read"]);
  assert.equal(r.values.find((v) => v.fieldPath === "dates.applicationCloseDate")?.page, 1);
  assert.equal(r.values.find((v) => v.fieldPath === "financial.feeGeneral")?.page, 4);
  assert.equal(r.skipped, undefined);
});

// A 429 as Gemini sends it (quota fields as observed on 2026-10-28; the message text is never shown).
const quota429 = (quotaId: string, delay: string, value = "500") => new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue: value }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay },
] } }), { status: 429 });

test("PC04 a refusal for the provider's DAILY quota is not resent, and is said as such (not \"wait a minute\")", async () => {
  let sent = 0;
  const base = (async () => { sent++; return quota429("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "44763s"); }) as unknown as typeof fetch;
  const p = retryingFetch(base, { sleep: async () => {}, reserve: async () => ({ allowed: true }), recordFailure: async () => {} });
  assert.equal((await p.fetch("https://x/", {})).status, 429);
  assert.equal(sent, 1, "no resend: nothing sent today can succeed");
  const r = await readArticleInBatches({ text: notice(3, {}), subject: "x", apiKey: "test-key", fetchFn: p.fetch });
  assert.match(r.skipped ?? "", /^The AI provider's daily request quota is used up \(500 requests a day on this key\); it resets in about 12 hours\./);
  assert.equal(sent, 2, "the reading tried once; the batch was not tried again either");
});
test("PC05 a per-minute 429 is resent after the wait the provider asks for, when that is short; a long one falls back to the usual waits", async () => {
  const waits: number[] = [];
  const replies = [quota429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "7s", "15"), new Response("{}", { status: 200 })];
  const p = retryingFetch((async () => replies.shift()!) as unknown as typeof fetch, { backoffMs: [5_000, 12_000], sleep: async (ms) => { waits.push(ms); }, reserve: async () => ({ allowed: true }), recordFailure: async () => {} });
  assert.equal((await p.fetch("https://x/", {})).status, 200);
  assert.deepEqual(waits, [7_500]);
  const waits2: number[] = [];
  const replies2 = [quota429("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "95s", "15"), new Response("{}", { status: 200 })];
  const p2 = retryingFetch((async () => replies2.shift()!) as unknown as typeof fetch, { backoffMs: [5_000, 12_000], sleep: async (ms) => { waits2.push(ms); }, reserve: async () => ({ allowed: true }), recordFailure: async () => {} });
  await p2.fetch("https://x/", {});
  assert.deepEqual(waits2, [5_000]);
});

test("BR14 a short notice read whole gets the same room for its answer as a page batch; an answer stopped at its length limit is incomplete and read in halves", async () => {
  const text = notice(4, { 3: ["Last date for registration 21.09.2026"] });
  const sent: Array<{ what: string; tokens: number }> = [];
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const m = /pages (\d+) to (\d+) of a/.exec(body.contents[0].parts[0].text as string);
    sent.push({ what: m ? `${m[1]}-${m[2]}` : "whole", tokens: body.generationConfig.maxOutputTokens });
    const t = body.contents[0].parts[0].text as string;
    const answer = JSON.stringify(t.includes("21.09.2026") ? { dates: { applicationCloseDate: { value: "2026-09-21", quote: "Last date for registration 21.09.2026" } } } : {});
    // The whole notice: the model stops at its length limit (a valid start, then cut).
    const candidate = m ? { content: { parts: [{ text: answer }] }, finishReason: "STOP" } : { content: { parts: [{ text: "{\"dates\":{}}" }] }, finishReason: "MAX_TOKENS" };
    return new Response(JSON.stringify({ candidates: [candidate] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  const r = await readArticleInBatches({ text, subject: "x", apiKey: "test-key", fetchFn });
  assert.deepEqual(sent.map((s) => `${s.what}:${s.tokens}`), ["whole:16384", "1-2:16384", "3-4:16384"]);
  assert.deepEqual(r.coverage.split, [{ first: 1, last: 4 }], "a cut-off answer, even one that parses, is not taken as the reading");
  assert.equal(r.values.find((v) => v.fieldPath === "dates.applicationCloseDate")?.page, 3);
});
