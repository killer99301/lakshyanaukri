// ═══════════════════════════════════════════════════════════
// The Telegram channel post on publish, through the REAL route handlers and
// repository, against the in-memory test database. Telegram itself is
// replaced by a stub: nothing leaves the test, production is never touched.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/channel-post.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  process.env.TELEGRAM_BOT_TOKEN = "123:test-token-not-real";
  process.env.TELEGRAM_CHANNEL_ID = "@test_channel";

  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");

  const posts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("api.telegram.org")) return realFetch(input, init);
    posts.push(JSON.parse(String(init?.body ?? "{}")).text ?? "");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const r0 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU", title: "TEST RECORD Canara Bank Clerk 2026", recruitmentYear: 2026 }));
  const created = (await r0.json()).record;
  const id: string = created.id;
  let rev: string = created.recordRevision;
  const r1 = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
    fieldPath: "links", field: { value: [{ type: "OFFICIAL_WEBSITE", label: "Canara Bank", url: "https://www.canarabank.bank.in/", official: true }], status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "test",
  }), ctx(id));
  rev = (await r1.json()).record.recordRevision;

  const cycle = async (body?: unknown) => {
    const state = (await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [id])).rows[0] as { draft_state: string };
    if (state.draft_state === "PUBLISHED") await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", body), ctx(id));
    return { status: r.status, announced: (await r.json()).announced as string };
  };
  const logged = async () => ((await pg.query("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'TELEGRAM_CHANNEL_POST'", [id])).rows[0] as { n: number }).n;

  section("First publish");
  let out = await cycle();
  check("with no choice given, a job going live posts “New job”", out.status === 200 && out.announced === "sent" && posts.length === 1 && /NEW JOB/.test(posts[0]), { out, posts: posts.length });
  check("the post is recorded", (await logged()) === 1);

  section("Republishing");
  out = await cycle();
  check("with no choice given, a republish posts nothing", out.announced === "not-asked" && posts.length === 1, out);
  out = await cycle({ announce: false });
  check("unticked: nothing", out.announced === "not-asked" && posts.length === 1, out);
  out = await cycle({ announce: true });
  check("ticked: “Updated” is posted", out.announced === "sent" && posts.length === 2 && /UPDATED/.test(posts[1]), out);
  out = await cycle({ announce: true });
  check("the same message again within 24 hours is not posted", out.announced === "duplicate" && posts.length === 2, out);
  check("two posts recorded, no more", (await logged()) === 2);

  globalThis.fetch = realFetch;
  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
