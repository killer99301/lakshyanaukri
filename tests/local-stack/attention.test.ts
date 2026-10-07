// ═══════════════════════════════════════════════════════════
// "Needs attention" through the REAL route handlers and repository,
// against the in-memory test database. Never touches production and
// never calls Telegram.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/attention.test.ts
//
// Covers: session and origin checks on the admin route, the cron route's
// secret, that only live records are read, and that no record is changed.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  // The message must never leave the test: no bot token, no chat.
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  delete process.env.CRON_SECRET;

  const admin = await import("@/app/api/admin/cms/attention/route");
  const cron = await import("@/app/api/cron/attention/route");
  const records = await import("@/app/api/admin/cms/records/route");
  const { todayInIndia } = await import("@/lib/cms/attention");

  const req = (path: string, method: string, opts: { auth?: boolean; origin?: string; bearer?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    if (opts.bearer !== undefined) headers.authorization = opts.bearer;
    return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: method === "POST" ? "{}" : undefined });
  };
  const ADMIN = "/api/admin/cms/attention";
  const CRON = "/api/cron/attention";
  // One record to work with, made through the real create route.
  const created = await records.POST(new NextRequest(`${ORIGIN}/api/admin/cms/records`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` },
    body: JSON.stringify({ organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU", title: "TEST RECORD SSC Exam 2026", recruitmentYear: 2026 }),
  }));
  check("test record created", created.status === 201, created.status);

  const snapshot = async () => JSON.stringify((await pg.query("SELECT id, record_revision, draft_state, updated_at FROM recruitments ORDER BY id")).rows);
  const before = await snapshot();

  section("Admin route: session and origin");
  let r = await admin.GET(req(ADMIN, "GET", { auth: false }));
  check("list without a session → 401", r.status === 401, r.status);
  r = await admin.POST(req(ADMIN, "POST", { auth: false }));
  check("send without a session → 401", r.status === 401, r.status);
  r = await admin.POST(req(ADMIN, "POST", { origin: "https://evil.example" }));
  check("send from a foreign origin → 403", r.status === 403, r.status);

  section("Admin route: the list");
  r = await admin.GET(req(ADMIN, "GET"));
  let d = await r.json();
  const liveRows = ((await pg.query("SELECT count(*)::int AS n FROM recruitments WHERE published_at IS NOT NULL AND draft_state <> 'ARCHIVED'")).rows[0] as { n: number }).n;
  check("list → 200 with today's date in Indian time", r.status === 200 && d.today === todayInIndia(), d);
  check("counts only records the public can see", d.liveCount === liveRows, { got: d.liveCount, liveRows });
  check("says Telegram is not set up", d.telegramReady === false, d.telegramReady);

  // A live job closing tomorrow must show up; a never-published draft closing tomorrow must not.
  const tomorrow = new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const closing = JSON.stringify({ applicationCloseDate: { value: tomorrow, status: "PENDING", evidenceIds: [], conflict: false } });
  const any = (await pg.query("SELECT id FROM recruitments ORDER BY created_at LIMIT 1")).rows[0] as { id: string } | undefined;
  if (any) {
    await pg.query("UPDATE recruitments SET dates = $1::jsonb, published_at = now(), draft_state = 'PUBLISHED' WHERE id = $2", [closing, any.id]);
    r = await admin.GET(req(ADMIN, "GET"));
    d = await r.json();
    const job = d.jobs.find((j: { id: string }) => j.id === any.id);
    check("a live job closing tomorrow is listed", job?.items.some((i: { code: string }) => i.code === "CLOSES_SOON"), d.jobs);
    await pg.query("UPDATE recruitments SET published_at = NULL, draft_state = 'DRAFT' WHERE id = $1", [any.id]);
    r = await admin.GET(req(ADMIN, "GET"));
    d = await r.json();
    check("the same record as a never-published draft is not listed", !d.jobs.some((j: { id: string }) => j.id === any.id), d.jobs);
  } else {
    check("seed record present for the closing-soon check", false, "no records in the test database");
  }

  section("Admin route: send now");
  r = await admin.POST(req(ADMIN, "POST"));
  d = await r.json();
  check("send with Telegram not set up → 409, nothing sent", r.status === 409 && d.sent === "skipped", d);

  section("Cron route: the secret");
  r = await cron.GET(req(CRON, "GET", { auth: false, bearer: "Bearer anything" }));
  check("no CRON_SECRET configured → every call refused", r.status === 401, r.status);
  process.env.CRON_SECRET = "test-cron-secret";
  r = await cron.GET(req(CRON, "GET", { auth: false }));
  check("no Authorization header → 401", r.status === 401, r.status);
  r = await cron.GET(req(CRON, "GET", { auth: false, bearer: "Bearer wrong-secret-value" }));
  check("wrong secret → 401", r.status === 401, r.status);
  r = await cron.GET(req(CRON, "GET", { bearer: "test-cron-secret" }));
  check("secret without 'Bearer' → 401, even with an admin session", r.status === 401, r.status);
  r = await cron.GET(req(CRON, "GET", { auth: false, bearer: "Bearer test-cron-secret" }));
  d = await r.json();
  check("right secret → 200, message skipped because Telegram is not set up", r.status === 200 && d.sent === "skipped", d);

  section("Nothing else changed");
  const after = JSON.parse(await snapshot()) as Array<{ id: string }>;
  const untouched = (JSON.parse(before) as Array<{ id: string }>).filter((row) => row.id !== any?.id);
  check("the routes themselves changed no record", JSON.stringify(after.filter((row) => row.id !== any?.id)) === JSON.stringify(untouched));

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
