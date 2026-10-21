// ═══════════════════════════════════════════════════════════
// The test stack can never post to the real Telegram channel.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/telegram-isolation.test.ts
//
// Settings are cleared by the shared setup and the launcher; a test that
// sets fake ones still cannot reach api.telegram.org without its own stub.
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  section("Settings");
  check("the shared setup clears every Telegram setting", !process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_CHANNEL_ID && !process.env.TELEGRAM_ADMIN_CHAT_ID && !process.env.CRON_SECRET);
  const launcher = readFileSync("tests/local-stack/run-next.mjs", "utf8");
  check("the launcher blanks every Telegram setting for the app and the cache test",
    ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID", "TELEGRAM_ADMIN_CHAT_ID", "CRON_SECRET"].every((k) => new RegExp(`${k}: ""`).test(launcher)));

  const { token } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const { sendToChannel } = await import("@/lib/telegram");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  section("A first publish, which posts by default");
  const r0 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU", title: "TEST RECORD Telegram isolation 2026", recruitmentYear: 2026 }));
  const created = (await r0.json()).record;
  await fields.PATCH(req(`/api/admin/cms/records/${created.id}/fields`, "PATCH", {
    fieldPath: "links", field: { value: [{ type: "OFFICIAL_WEBSITE", label: "Canara Bank", url: "https://www.canarabank.bank.in/", official: true }], status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: created.recordRevision, reason: "test",
  }), ctx(created.id));
  await approve.POST(req(`/api/admin/cms/records/${created.id}/approve`, "POST"), ctx(created.id));
  const r = await publish.POST(req(`/api/admin/cms/records/${created.id}/publish`, "POST"), ctx(created.id));
  const d = await r.json();
  check("published, and with no settings nothing was sent", r.status === 200 && d.announced === "skipped", d.announced);

  section("Fake settings, no stub");
  const quiet = console.error;
  console.error = () => {};
  const out = await sendToChannel("test", { TELEGRAM_BOT_TOKEN: "123:fake-token", TELEGRAM_CHANNEL_ID: "@fake" });
  console.error = quiet;
  check("a send with fake settings fails", out === "failed", out);
  let blocked = "";
  try {
    await fetch("https://api.telegram.org/bot123:fake-token/sendMessage", { method: "POST" });
  } catch (e) {
    blocked = e instanceof Error ? e.message : String(e);
  }
  check("…because the request is refused before it leaves the machine", /Blocked by the test stack/.test(blocked), blocked);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
