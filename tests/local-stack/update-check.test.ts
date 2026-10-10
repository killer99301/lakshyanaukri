// ═══════════════════════════════════════════════════════════
// "Check for updates" through the REAL route handlers and repository,
// against the in-memory test database. The AI is replaced by a canned
// answer: nothing leaves the test, and production is never touched.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/update-check.test.ts
//
// Covers: session and origin checks, input checks, that a check changes
// nothing, a search-mode answer becoming proposals, AI failures, and the
// whole "apply and publish" chain the panel runs: reopen → save each accepted
// change → approve → publish → visible on the public read path.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  delete process.env.TELEGRAM_BOT_TOKEN;

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const checkUpdates = await import("@/app/api/admin/cms/records/[id]/check-updates/route");
  const publicRepo = await import("@/lib/repository");
  const { savesFor } = await import("@/lib/cms/update-check");
  type Proposal = import("@/lib/cms/update-check").UpdateProposal;

  const req = (path: string, method: string, body?: unknown, opts: { auth?: boolean; origin?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  // The AI: every request to the model's endpoint gets `aiAnswer`.
  let aiAnswer: { status: number; body: unknown } = { status: 200, body: {} };
  let aiCalls = 0;
  let lastAiRequest: { tools?: unknown; contents?: Array<{ parts?: Array<{ text?: string }> }> } = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    aiCalls++;
    lastAiRequest = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify(aiAnswer.body), { status: aiAnswer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const gemini = (answer: unknown, sites: string[]) => ({
    candidates: [{
      content: { parts: [{ text: `Here is what I found.\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }] },
      groundingMetadata: { groundingChunks: sites.map((s) => ({ web: { uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${s}`, title: s } })) },
    }],
  });

  // ── A published job to check ──
  let r = await records.POST(req("/api/admin/cms/records", "POST", {
    organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU",
    title: "TEST RECORD Canara Bank Officer 2026", recruitmentYear: 2026,
  }));
  let d = await r.json();
  check("test record created", r.status === 201, d);
  const id: string = d.record.id;
  const slug: string = d.record.slug;
  let rev: string = d.record.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "test setup",
    }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return { status: res.status, body };
  };
  await patch("dates.applicationCloseDate", "2026-09-30");
  await patch("examStages", [{ name: "Online Test", order: 1, status: "SCHEDULED", dateIso: "2026-10-04", certainty: "CONFIRMED" }]);
  const linked = await patch("links", [{ type: "OFFICIAL_WEBSITE", label: "Canara Bank", url: "https://www.canarabank.bank.in/", official: true }]);
  check("setup: date, stage and official link saved", linked.status === 200, linked.body);
  r = await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  d = await r.json();
  check("setup: published", r.status === 200 && d.record.draftState === "PUBLISHED", d);
  const rowBefore = JSON.stringify((await pg.query("SELECT record_revision, draft_state, dates, exam_stages, links FROM recruitments WHERE id = $1", [id])).rows[0]);

  const PATH = `/api/admin/cms/records/${id}/check-updates`;

  section("Session, origin and input");
  r = await checkUpdates.POST(req(PATH, "POST", {}, { auth: false }), ctx(id));
  check("without a session → 401", r.status === 401, r.status);
  r = await checkUpdates.POST(req(PATH, "POST", {}, { origin: "https://evil.example" }), ctx(id));
  check("foreign origin → 403", r.status === 403, r.status);
  r = await checkUpdates.POST(req(PATH, "POST", { url: "not a url" }), ctx(id));
  check("a url that is not a web address → 400", r.status === 400, r.status);
  r = await checkUpdates.POST(req(PATH, "POST", { url: "file:///etc/passwd" }), ctx(id));
  check("a non-http address → 400", r.status === 400, r.status);
  r = await checkUpdates.POST(req(PATH, "POST", { url: 42 }), ctx(id));
  check("a url that is not text → 400", r.status === 400, r.status);
  r = await checkUpdates.POST(req("/api/admin/cms/records/00000000-0000-4000-8000-000000000000/check-updates", "POST", {}), ctx("00000000-0000-4000-8000-000000000000"));
  check("unknown record → 404", r.status === 404, r.status);
  check("none of those reached the AI", aiCalls === 0, aiCalls);

  section("Search mode: the answer becomes proposals");
  aiAnswer = { status: 200, body: gemini({
    summary: "The online test was held and the result date is announced.",
    changes: [
      { type: "stage", stage: "online test", status: "CONDUCTED", evidence: "Online test held on 04.10.2026", source: "canarabank.bank.in" },
      { type: "date", field: "resultDate", value: "2026-11-12", evidence: "Result on 12.11.2026", source: "https://www.canarabank.bank.in/pages/recruitment" },
      { type: "date", field: "admitCardDate", value: "2026-09-25", evidence: "Call letters from 25 Sept", source: "coaching.example" },
      { type: "link", linkType: "RESULT", url: "https://www.canarabank.bank.in/result-2026", label: "Result", source: "canarabank.bank.in" },
      { type: "date", field: "applicationCloseDate", value: "2026-09-30", source: "canarabank.bank.in" },
      { type: "date", field: "resultDate", value: "soon" },
    ],
  }, ["canarabank.bank.in", "coaching.example"]) };
  r = await checkUpdates.POST(req(PATH, "POST", {}), ctx(id));
  d = await r.json();
  check("→ 200 in search mode, one AI request, with the search tool", r.status === 200 && d.mode === "search" && aiCalls === 1 && Array.isArray(lastAiRequest.tools), { status: r.status, mode: d.mode, aiCalls });
  check("the question names the job and what is on record", /TEST RECORD Canara Bank Officer 2026/.test(lastAiRequest.contents?.[0]?.parts?.[0]?.text ?? "") && /Online Test: status SCHEDULED/.test(lastAiRequest.contents?.[0]?.parts?.[0]?.text ?? ""));
  const proposals: Proposal[] = d.proposals;
  check("four usable proposals; the unchanged date and the malformed one are dropped", proposals.length === 4 && d.dropped === 2, { n: proposals.length, dropped: d.dropped });
  check("pages the search opened are reported", d.searchedSites.join(",") === "canarabank.bank.in,coaching.example", d.searchedSites);
  const by = (idPart: string) => proposals.find((p) => p.id.startsWith(idPart))!;
  check("stage: official and confirmed", by("stage:").official && by("stage:").confirmed && by("stage:").newText === "held, 4 Oct 2026", by("stage:"));
  check("date from the bank's site: official and confirmed", by("date:resultDate").official && by("date:resultDate").confirmed, by("date:resultDate"));
  check("date from a coaching site: confirmed but not official", !by("date:admitCardDate").official && by("date:admitCardDate").confirmed, by("date:admitCardDate"));
  check("link: official site, but never confirmed in search mode", by("link:").official && !by("link:").confirmed, by("link:"));
  const rowAfterCheck = JSON.stringify((await pg.query("SELECT record_revision, draft_state, dates, exam_stages, links FROM recruitments WHERE id = $1", [id])).rows[0]);
  check("checking changed nothing on the record", rowAfterCheck === rowBefore);

  section("When the AI cannot answer");
  aiAnswer = { status: 429, body: { error: { message: "quota exceeded for key=test-key-not-real" } } };
  r = await checkUpdates.POST(req(PATH, "POST", {}), ctx(id));
  d = await r.json();
  check("rate limited → 502 with a plain reason and no key or provider text", r.status === 502 && /rate limit/i.test(d.error) && !/test-key|quota exceeded/.test(JSON.stringify(d)), d);
  aiAnswer = { status: 400, body: {} };
  r = await checkUpdates.POST(req(PATH, "POST", {}), ctx(id));
  d = await r.json();
  check("search refused by the provider → says to paste the page address", r.status === 502 && /Paste the official page address/.test(d.error), d);
  aiAnswer = { status: 200, body: { candidates: [{ content: { parts: [{ text: "I could not find anything." }] } }] } };
  r = await checkUpdates.POST(req(PATH, "POST", {}), ctx(id));
  check("an answer with no JSON → 502, not an empty success", r.status === 502, r.status);
  aiAnswer = { status: 200, body: gemini({ summary: "Nothing new.", changes: [] }, ["canarabank.bank.in"]) };
  r = await checkUpdates.POST(req(PATH, "POST", {}), ctx(id));
  d = await r.json();
  check("nothing new → 200 with no proposals", r.status === 200 && d.proposals.length === 0, d);

  section("Apply and publish: the chain the panel runs");
  const accepted = proposals.filter((p) => p.official);
  check("accepting the three official proposals", accepted.length === 3, accepted.map((p) => p.id));
  r = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  d = await r.json();
  check("reopen → draft", r.status === 200 && d.record.draftState === "DRAFT", d);
  let current = d.record;
  check("still public while it is being edited", (await publicRepo.getBySlug(slug)) !== undefined);
  const saves = savesFor(current, accepted);
  check("three saves: the date, the stages, the links", saves.map((s) => s.fieldPath).join(",") === "dates.resultDate,examStages,links", saves.map((s) => s.fieldPath));
  for (const save of saves) {
    r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath: save.fieldPath,
      field: { value: save.value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false },
      clientRevision: current.recordRevision,
      reason: save.reason,
    }), ctx(id));
    d = await r.json();
    check(`save ${save.fieldPath} → 200`, r.status === 200, d);
    if (r.status === 200) current = d.record;
  }
  check("the date is saved as Pending, never Verified", current.dates.resultDate?.value === "2026-11-12" && current.dates.resultDate?.status === "PENDING", current.dates.resultDate);
  check("the stage is marked held and keeps its date", current.examStages?.[0]?.status === "CONDUCTED" && current.examStages?.[0]?.dateIso === "2026-10-04", current.examStages);
  check("the result link is added beside the existing one", current.links.length === 2 && current.links[1].type === "RESULT" && current.links[1].official === true, current.links);
  const live = await publicRepo.getBySlug(slug);
  check("nothing new is public before publishing", (live as { examStages?: Array<{ status: string }> } | undefined)?.examStages?.[0]?.status === "SCHEDULED", (live as { examStages?: unknown } | undefined)?.examStages);

  r = await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  check("approve → 200", r.status === 200, r.status);
  r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
  d = await r.json();
  check("publish → 200, published", r.status === 200 && d.record.draftState === "PUBLISHED", d);
  const after = await publicRepo.getBySlug(slug) as { examStages?: Array<{ status: string }>; links?: { result?: string } } | undefined;
  check("the public page now shows the stage as held", after?.examStages?.[0]?.status === "CONDUCTED", after?.examStages);
  const history = (await pg.query("SELECT reason FROM field_revisions WHERE recruitment_id = $1 AND reason LIKE 'Check for updates:%'", [id])).rows as Array<{ reason: string }>;
  check("each change is in the history with where it came from", history.length === 3 && history.some((h) => /source: canarabank\.bank\.in/.test(h.reason)), history);

  globalThis.fetch = realFetch;
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
