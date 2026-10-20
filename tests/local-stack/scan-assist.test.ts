// ═══════════════════════════════════════════════════════════
// AI Assist on a scanned PDF, through the REAL route handlers and repository,
// against the in-memory test database. The AI is replaced by canned answers:
// nothing leaves the test, and production is never touched.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/scan-assist.test.ts
//
// Covers the two steps the admin page runs: read-scan (the scan goes to the
// AI, text comes back, nothing is saved) and AI Assist fed with that text.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  process.env.GEMINI_API_KEY = "test-key-not-real";

  const records = await import("@/app/api/admin/cms/records/route");
  const readScan = await import("@/app/api/admin/cms/records/[id]/read-scan/route");
  const aiAssist = await import("@/app/api/admin/cms/records/[id]/ai-assist/route");

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const json = (path: string, body: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify(body) });
  const form = (path: string, fill: (f: FormData) => void, opts: { auth?: boolean; origin?: string } = {}) => {
    const f = new FormData();
    fill(f);
    const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    return new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers, body: f });
  };

  // The AI: every request to the model's endpoint gets `aiAnswer`.
  let aiAnswer: { status: number; text: string } = { status: 200, text: "" };
  let aiCalls = 0;
  let lastParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    aiCalls++;
    lastParts = JSON.parse(String(init?.body ?? "{}")).contents?.[0]?.parts ?? [];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: aiAnswer.text }] } }] }), { status: aiAnswer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const r0 = await records.POST(json("/api/admin/cms/records", {
    organizationId: "mp-esb", organizationName: "Madhya Pradesh Employees Selection Board", govType: "State Govt", title: "TEST RECORD MP Police Constable (Driver) 2026", recruitmentYear: 2026,
  }));
  const id: string = (await r0.json()).record.id;
  const SCAN = `/api/admin/cms/records/${id}/read-scan`;
  const ASSIST = `/api/admin/cms/records/${id}/ai-assist`;
  // A PDF with no text in it: only the header that says it is a PDF.
  const PDF = new Uint8Array([...new TextEncoder().encode("%PDF-1.4\n%scanned pages only\n"), 0, 1, 2, 3]);
  const READING = [
    "POLICE CONSTABLE (DRIVER) RECRUITMENT TEST - 2026",
    "Madhya Pradesh Employees Selection Board, Bhopal",
    "IMPORTANT DATES",
    "Start date for filling online application form: 15-10-2026",
    "Last date for filling online application form: 29-10-2026",
    "VACANCIES",
    "Total posts: 1000. Special Armed Force 200, District Police Force 800.",
    "APPLICATION FEE",
    "Unreserved candidates: Rs. 500. SC / ST / OBC / EWS candidates of Madhya Pradesh: Rs. 250.",
    "AGE LIMIT",
    "Minimum 18 years and maximum 33 years as on 29-10-2026.",
  ].join("\n");

  section("Reading the scan");
  let r = await readScan.POST(form(SCAN, (f) => f.set("file", new File([PDF as BlobPart], "rulebook.pdf")), { auth: false }), ctx(id));
  check("without a session → 401", r.status === 401, r.status);
  r = await readScan.POST(form(SCAN, (f) => f.set("file", new File([PDF as BlobPart], "rulebook.pdf")), { origin: "https://evil.example" }), ctx(id));
  check("foreign origin → 403", r.status === 403, r.status);
  r = await readScan.POST(form(SCAN, (f) => f.set("file", new File([new TextEncoder().encode("not a pdf at all") as BlobPart], "x.pdf"))), ctx(id));
  check("a file that is not a PDF → 400", r.status === 400, r.status);
  check("none of those reached the AI", aiCalls === 0, aiCalls);

  aiAnswer = { status: 200, text: READING };
  r = await readScan.POST(form(SCAN, (f) => f.set("file", new File([PDF as BlobPart], "rulebook.pdf"))), ctx(id));
  let d = await r.json();
  check("→ 200 with the text the AI wrote out, one AI request", r.status === 200 && d.text === READING && aiCalls === 1, { status: r.status, aiCalls });
  check("the PDF itself went to the AI", lastParts[1]?.inline_data?.mime_type === "application/pdf" && lastParts[1]?.inline_data?.data === Buffer.from(PDF).toString("base64"));
  check("the AI was told which recruitment and not to guess", /TEST RECORD MP Police Constable/.test(lastParts[0]?.text ?? "") && /do not guess/i.test(lastParts[0]?.text ?? ""));
  const row = async () => JSON.stringify((await pg.query("SELECT record_revision, dates, vacancies, financial, age FROM recruitments WHERE id = $1", [id])).rows[0]);
  const before = await row();

  aiAnswer = { status: 200, text: "too short" };
  r = await readScan.POST(form(SCAN, (f) => f.set("file", new File([PDF as BlobPart], "rulebook.pdf"))), ctx(id));
  d = await r.json();
  check("a scan the AI could barely read → 502 with a plain reason", r.status === 502 && /could not read enough/i.test(d.error), d);
  aiAnswer = { status: 429, text: "quota exceeded for key test-key-not-real" };
  r = await readScan.POST(form(SCAN, (f) => f.set("file", new File([PDF as BlobPart], "rulebook.pdf"))), ctx(id));
  d = await r.json();
  check("rate limited → 502, with no key or provider text", r.status === 502 && /rate limit/i.test(d.error) && !/test-key|quota/.test(JSON.stringify(d)), d);
  check("reading a scan saved nothing", (await row()) === before);

  section("AI Assist: the scanned PDF itself");
  const calls = aiCalls;
  r = await aiAssist.POST(form(ASSIST, (f) => { f.set("url", "https://esb.mp.gov.in/rulebook.pdf"); f.set("file", new File([PDF as BlobPart], "rulebook.pdf")); }), ctx(id));
  d = await r.json();
  check("→ 422 and says it is a scan, so the page reads it with the AI", r.status === 422 && d.scanned === true && aiCalls === calls, d);

  section("AI Assist: fed with what the AI read");
  // The three extraction requests find nothing here; the dates below come from the plain reading of the text.
  aiAnswer = { status: 200, text: "{}" };
  r = await aiAssist.POST(form(ASSIST, (f) => { f.set("url", "https://esb.mp.gov.in/rulebook.pdf"); f.set("scanText", "short"); }), ctx(id));
  check("too little text → 400", r.status === 400, r.status);
  r = await aiAssist.POST(form(ASSIST, (f) => { f.set("scanText", READING); }), ctx(id));
  check("no address for the source → 400", r.status === 400, r.status);
  r = await aiAssist.POST(form(ASSIST, (f) => { f.set("url", "https://esb.mp.gov.in/rulebook.pdf"); f.set("scanText", READING); }), ctx(id));
  d = await r.json();
  check("→ 200, marked as read from a scan", r.status === 200 && d.fromScan === true && d.sourceKind === "pdf", { status: r.status, error: d.error, fromScan: d.fromScan });
  const filled = (d.filled ?? []) as Array<{ fieldPath: string; value: unknown }>;
  check("whatever was filled is Pending, never Verified", filled.every((f) => {
    const [block, key] = f.fieldPath.split(".");
    const field = key ? d.record[block]?.[key] : d.record[block];
    return !field || field.status === undefined || field.status === "PENDING";
  }), filled.map((f) => f.fieldPath));
  const history = (await pg.query("SELECT reason FROM field_revisions WHERE recruitment_id = $1", [id])).rows as Array<{ reason: string }>;
  check("the history says the source was a scan read by AI", history.length === 0 || history.every((h) => /scanned PDF uploaded by admin, read by AI/.test(h.reason)), history.map((h) => h.reason));

  section("AI Assist: notice text pasted by the admin");
  const pasteJob = await records.POST(json("/api/admin/cms/records", {
    organizationId: "upsssc", organizationName: "Uttar Pradesh Subordinate Services Selection Commission", govType: "State Govt", title: "TEST RECORD UPSSSC Junior Assistant 2026", recruitmentYear: 2026,
  }));
  const pasteId: string = (await pasteJob.json()).record.id;
  const PASTE = `/api/admin/cms/records/${pasteId}/ai-assist`;
  aiAnswer = { status: 200, text: "{}" };
  const callsBefore = aiCalls;
  r = await aiAssist.POST(form(PASTE, (f) => { f.set("url", "https://upsssc.gov.in/notice"); f.set("pastedText", "Last date 25-11-2026"); }), ctx(pasteId));
  d = await r.json();
  check("too little pasted text → 400 with a plain reason, no AI request", r.status === 400 && /too little text/i.test(d.error) && aiCalls === callsBefore, d);
  r = await aiAssist.POST(form(PASTE, (f) => { f.set("pastedText", READING); }), ctx(pasteId));
  d = await r.json();
  check("no address → 400 asking where the text came from", r.status === 400 && /address the text was copied from/.test(d.error), d);
  r = await aiAssist.POST(form(PASTE, (f) => { f.set("url", "https://upsssc.gov.in/notice"); f.set("pastedText", READING); }), ctx(pasteId));
  d = await r.json();
  check("→ 200, and not marked as read from a scan", r.status === 200 && d.fromScan === undefined, { status: r.status, error: d.error, fromScan: d.fromScan });
  const pasteHistory = (await pg.query("SELECT reason FROM field_revisions WHERE recruitment_id = $1", [pasteId])).rows as Array<{ reason: string }>;
  check("the history says the text was pasted by the admin", pasteHistory.length === 0 || pasteHistory.every((h) => /text pasted by admin/.test(h.reason)), pasteHistory.map((h) => h.reason));

  globalThis.fetch = realFetch;
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
