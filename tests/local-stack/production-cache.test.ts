// ═══════════════════════════════════════════════════════════
// Production-mode test: do published changes reach the statically
// cached public pages without a redeploy?
// ═══════════════════════════════════════════════════════════
//
// Needs, in this order (each in its own terminal):
//   npm run test:stack:db       local test database
//   npm run test:stack:build    production build against it
//   npm run test:stack:start    production server on :3000
// then:
//   npm run test:stack:cache
//
// Talks only to localhost. Refuses to run against any other database.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";

// Set before any project module loads. Never falls back to .env.local.
process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.ADMIN_ALLOWED_ORIGINS = "http://localhost:3000";
if (!process.env.NODE_EXTRA_CA_CERTS) {
  console.error("Run this through the launcher so the local certificate is trusted: npm run test:stack:cache");
  process.exit(1);
}

const BASE = "http://localhost:3000";

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 220) : ""}`); }
};
const section = (s: string) => console.log(`\n── ${s}`);

(async () => {
  const { sql } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const admin = (await sql`SELECT id FROM admins LIMIT 1`)[0].id as string;
  const token = await createSession(admin, "127.0.0.1", "cache-test");

  const api = async (path: string, method: string, body?: unknown) => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: BASE, cookie: `__Secure-admin_sid=${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const page = async (path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: { accept: "text/html" } });
    return { status: r.status, html: await r.text(), cache: r.headers.get("x-nextjs-cache") };
  };
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const OFFICIAL = [{ type: "OFFICIAL_NOTIFICATION", label: "Official Notification", url: "https://www.ibps.in/x.pdf", official: true }];

  section("Server sanity");
  const unauth = await fetch(`${BASE}/api/admin/cms/records`);
  check("production build: admin API without a session → 401", unauth.status === 401, unauth.status);
  const list = await api("/api/admin/cms/records", "GET");
  check("authenticated API works and sees only test records", list.status === 200 && list.data.records.every((r: { title_text: string; slug: string }) => /test/i.test(r.slug)), list.data.records?.map((r: { slug: string }) => r.slug));

  const B_SLUG = "sbi-cache-test-b-2026";
  section("Baseline (static pages built before these records existed)");
  let jobs = await page("/jobs");
  check("/jobs is served and lists the seed record", jobs.status === 200 && jobs.html.includes("TEST SEED IBPS Clerk 2026"));
  check("/jobs does not contain record B yet", !jobs.html.includes("CACHE TEST B"));
  const pre = await page(`/jobs/${B_SLUG}`);
  check("record B's future URL is 404 before publication (this 404 gets cached)", pre.status === 404, pre.status);

  section("Old behaviour reproduced: publish WITHOUT cache refresh");
  // Route handlers called outside the Next runtime: the database changes, no revalidation happens.
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const inproc = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${BASE}${path}`, { method, headers: { "content-type": "application/json", origin: BASE, cookie: `admin_sid=${token}` }, body: body ? JSON.stringify(body) : undefined });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  let r = await records.POST(inproc("/api/admin/cms/records", "POST", { organizationId: "upsc", organizationName: "Union Public Service Commission", title: "CACHE TEST X Stale", recruitmentYear: 2026 }));
  const x = (await r.json()).record;
  r = await fields.PATCH(inproc(`/x`, "PATCH", { fieldPath: "links", field: manual(OFFICIAL), clientRevision: x.recordRevision }), ctx(x.id));
  await approve.POST(inproc("/x", "POST"), ctx(x.id));
  r = await publish.POST(inproc("/x", "POST"), ctx(x.id));
  const xPub = await r.json();
  check("record X published in the database without revalidation", r.status === 200 && xPub.revalidated === false, xPub);
  jobs = await page("/jobs");
  check("DEFECT CONFIRMED: /jobs stays stale — published record X is missing", !jobs.html.includes("CACHE TEST X Stale"));

  section("New behaviour: publish through the running app");
  let c = await api("/api/admin/cms/records", "POST", { organizationId: "sbi", organizationName: "State Bank of India", govType: "PSU", title: "CACHE TEST B", recruitmentYear: 2026 });
  check("create B → 201", c.status === 201 && c.data.record.slug === B_SLUG, c.data);
  const b = c.data.record;
  c = await api(`/api/admin/cms/records/${b.id}/fields`, "PATCH", { fieldPath: "vacancies.total", field: manual(777), clientRevision: b.recordRevision });
  c = await api(`/api/admin/cms/records/${b.id}/fields`, "PATCH", { fieldPath: "links", field: manual(OFFICIAL), clientRevision: c.data.record.recordRevision });
  check("edit B (vacancies, official link)", c.status === 200, c.data);
  c = await api(`/api/admin/cms/records/${b.id}/approve`, "POST");
  c = await api(`/api/admin/cms/records/${b.id}/publish`, "POST");
  check("publish B → 200 and revalidated: true", c.status === 200 && c.data.revalidated === true, c.data);

  jobs = await page("/jobs");
  check("G. /jobs now lists B without a redeploy", jobs.html.includes("CACHE TEST B"));
  check("…and the previously stale record X appears too", jobs.html.includes("CACHE TEST X Stale"));
  const detail = await page(`/jobs/${B_SLUG}`);
  check("G. B's detail page is live (the cached 404 was cleared)", detail.status === 200 && detail.html.includes("CACHE TEST B") && detail.html.includes("777"), detail.status);
  const home = await page("/");
  check("home page is served after revalidation", home.status === 200);
  const sitemap = await page("/sitemap.xml");
  check("sitemap now includes B", sitemap.html.includes(B_SLUG));

  section("H / I. Update an existing published record");
  const seed = (await sql`SELECT id, slug FROM recruitments WHERE slug = 'ibps-test-seed-ibps-clerk-2026'`)[0] as { id: string; slug: string };
  let before = await page(`/jobs/${seed.slug}`);
  check("seed detail page shows 1,000 posts", before.html.includes("1,000 Posts"));
  c = await api(`/api/admin/cms/records/${seed.id}/revert`, "POST");
  check("revert → DRAFT", c.status === 200 && c.data.record.draftState === "DRAFT", c.data);
  c = await api(`/api/admin/cms/records/${seed.id}/fields`, "PATCH", { fieldPath: "vacancies.total", field: manual(1234), clientRevision: c.data.record.recordRevision, reason: "cache test" });
  check("edit while draft", c.status === 200, c.data);
  before = await page(`/jobs/${seed.slug}`);
  check("I. public page still shows the last published snapshot (1,000) while in draft", before.status === 200 && before.html.includes("1,000 Posts") && !before.html.includes("1,234 Posts"));
  jobs = await page("/jobs");
  check("I. listing still shows the record while in draft", jobs.html.includes("TEST SEED IBPS Clerk 2026"));
  await api(`/api/admin/cms/records/${seed.id}/approve`, "POST");
  c = await api(`/api/admin/cms/records/${seed.id}/publish`, "POST");
  check("republish → revalidated: true", c.status === 200 && c.data.revalidated === true, c.data);
  const after = await page(`/jobs/${seed.slug}`);
  check("H. public detail page shows the update (1,234) without a redeploy", after.html.includes("1,234 Posts") && !after.html.includes("1,000 Posts"));

  console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
})().catch((e) => { console.error("CACHE TEST ERROR:", e); process.exit(1); });
