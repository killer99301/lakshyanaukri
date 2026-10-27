// ═══════════════════════════════════════════════════════════
// A long notice read in page batches (stage B2.2), through the real
// preview, on the in-memory test database, with a stand-in for the model:
// values from batches far apart reach the preview with their pages; a batch
// refused once for load is resent and read; a batch that keeps failing is
// named page by page in the warnings and the coverage, and the reading is
// not called complete; the requests made are counted.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-batches.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

type Item = { fieldPath: string; value: unknown; claims: Array<{ page?: number | null; quote?: string | null }> };
type Coverage = { mode: string; pages: number; batches: Array<{ first: number; last: number; status: string; reason?: string }>; noTextPages: number[] };

/** 40 pages of instructions; the facts on pages 3, 22 and 37; page 30 has no text (a scanned page). */
function notice(): string {
  const facts: Record<number, string[]> = {
    3: ["Online registration of application 01.09.2026 to 21.09.2026", "Online Preliminary Examination: November 2026"],
    22: ["Application fee Rs. 850/- for General candidates"],
    37: ["Common Interview: January 2027"],
  };
  let out = "";
  for (let p = 1; p <= 40; p++) {
    const body = p === 30 ? "" : [`CRP RRBs-XV notice, page ${p}.`, ...(facts[p] ?? []), ...Array.from({ length: 30 }, (_, i) => `Instruction ${p}.${i}: candidates must read the rules for applying online carefully.`)].join("\n");
    out += `${body}\n-- ${p} of 40 --\n`;
  }
  return out;
}

(async () => {
  const { adminId, token } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  await switchRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/switch`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify({ on: true, confirm: true }) }));

  const tries = new Map<string, number>();
  let sent = 0;
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    sent++;
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
    const ok = (data: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    const part = /pages (\d+) to (\d+) of a/.exec(prompt);
    if (!part) return ok({}); // the section readers: nothing
    const key = part[1];
    const n = (tries.get(key) ?? 0) + 1;
    tries.set(key, n);
    // Pages from 9 on: refused once for load, then answered. Pages from 17 on: always refused.
    if (key === "9" && n === 1) return new Response("{}", { status: 429 });
    if (key === "17") return new Response("{}", { status: 503 });
    const t = prompt.slice(prompt.indexOf("TEXT:"));
    const out: Record<string, unknown> = {};
    const stages = [];
    if (t.includes("Online Preliminary Examination: November 2026")) stages.push({ name: "Online Preliminary Examination", dateText: "November 2026", quote: "Online Preliminary Examination: November 2026" });
    if (t.includes("Common Interview: January 2027")) stages.push({ name: "Common Interview", dateText: "January 2027", quote: "Common Interview: January 2027" });
    if (stages.length) out.examStages = stages;
    if (t.includes("Rs. 850/-")) out.feeGeneral = { value: 850, quote: "Application fee Rs. 850/- for General candidates" };
    return ok(out);
  }) as unknown as typeof fetch;

  section("A 40-page notice, pasted, read in page batches");
  const p = await service.previewImport({
    adminId, apiKey: "test-key", fetchFn, retryBackoffMs: [5, 5],
    mode: "NEW", newJob: { organizationId: "ibps-batch", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, title: "TEST RECORD CRP batches", govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: notice() }],
  } as never);
  const proposal = p.proposal as unknown as { items: Item[]; warnings: string[]; meta: { sources: Array<{ reading: Coverage }>; aiRequests: { sent: number; retried: number; failed: number } } };
  const cov = proposal.meta.sources[0].reading;
  check("read in batches of whole pages, page 30 (no text) in none", cov.mode === "batches" && cov.pages === 40 && cov.noTextPages.join() === "30" && !cov.batches.some((b) => b.first <= 30 && b.last >= 30), cov);
  const failed = cov.batches.filter((b) => b.status !== "read");
  check("the batch refused once for load was resent and read", cov.batches.find((b) => b.first === 9)?.status === "read" && (tries.get("9") ?? 0) >= 2, cov.batches);
  check("the batch that kept failing is named with its pages and why", failed.length === 1 && failed[0].first === 17 && /unavailable/i.test(failed[0].reason ?? ""), failed);
  check("…and said in the warnings, with pages 17–24 and the scanned page 30", proposal.warnings.some((w) => /pages 17–24 of 40 were not read/.test(w)) && proposal.warnings.some((w) => /pages 30 have no text/.test(w)), proposal.warnings);
  const stages = proposal.items.filter((i) => i.fieldPath === "examStages");
  check("exam stages from pages 3 and 37 are one item with both quotes and pages", stages.length === 1
    && (stages[0].value as Array<{ name: string }>).map((s) => s.name).join(" | ") === "Online Preliminary Examination | Common Interview"
    && stages[0].claims.map((c) => c.page).join() === "3,37", stages);
  const fee = proposal.items.find((i) => i.fieldPath === "financial.feeGeneral");
  check("the fee on page 22, in the batch that failed, is missing, not guessed", fee === undefined, fee);
  check("the requests are counted: resends and failures included", proposal.meta.aiRequests.sent === sent && proposal.meta.aiRequests.retried >= 1 && proposal.meta.aiRequests.failed >= 1, proposal.meta.aiRequests);

  section("The browser's time limit: batches not started are not read, and said");
  const q = await service.previewImport({
    adminId, apiKey: "test-key", fetchFn: (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 })) as unknown as typeof fetch,
    deadline: Date.now() + 1000,
    mode: "NEW", newJob: { organizationId: "ibps-batch2", organizationName: "IBPS", recruitmentYear: 2026, title: "TEST RECORD CRP time limit", govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: notice() }],
  } as never);
  const qp = q.proposal as unknown as { warnings: string[]; meta: { sources: Array<{ reading: Coverage }> } };
  check("no batch is called read; every page range is said as not read", qp.meta.sources[0].reading.batches.every((b) => b.status === "not_read")
    && qp.warnings.some((w) => /were not read \(the time for this reading ran out/.test(w)), qp.warnings);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
