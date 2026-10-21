// ═══════════════════════════════════════════════════════════
// Manual "New job" after the move to the locked create: same answers as
// before, plus an audit row when "create anyway" overrides a match.
// Simultaneous creates are tested on PostgreSQL in tests/pg.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/manual-create.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const req = (body: unknown) =>
    new NextRequest(`${ORIGIN}/api/admin/cms/records`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify(body) });
  const overrides = async () => Number((await pg.query("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE event_type = 'DUPLICATE_OVERRIDE'")).rows[0].n);
  const BASE = { organizationId: "rrb", organizationName: "Railway Recruitment Board", govType: "Central Govt", recruitmentYear: 2026 };

  section("No match");
  let r = await records.POST(req({ ...BASE, title: "TEST RECORD RRB Group D 2026" }));
  let d = await r.json();
  check("created with 201 and the record", r.status === 201 && d.record?.identity?.organizationId === "rrb", d);
  check("no override recorded", await overrides() === 0);
  const firstId = d.record.id;

  section("Match: the same warning as before");
  r = await records.POST(req({ ...BASE, title: "TEST RECORD RRB NTPC 2026" }));
  d = await r.json();
  check("200 with duplicates, nothing created", r.status === 200 && !d.record && d.duplicates?.[0]?.id === firstId, d);
  check("each duplicate has exactly id, slug, draftState, title", Object.keys(d.duplicates[0]).sort().join(",") === "draftState,id,slug,title", d.duplicates[0]);
  check("still one rrb job", Number((await pg.query("SELECT count(*)::int AS n FROM recruitments WHERE organization_id = 'rrb'")).rows[0].n) === 1);

  section("Create anyway");
  r = await records.POST(req({ ...BASE, title: "TEST RECORD RRB NTPC 2026", forceCreate: true }));
  d = await r.json();
  check("created with 201", r.status === 201 && d.record?.id && d.record.id !== firstId, d);
  const ev = (await pg.query("SELECT admin_id, metadata FROM recruitment_audit_events WHERE event_type = 'DUPLICATE_OVERRIDE'")).rows as Array<{ admin_id: string; metadata: { via: string; matches: Array<{ id: string }> } }>;
  check("override recorded with the admin and the matching job", ev.length === 1 && ev[0].admin_id && ev[0].metadata.via === "manual" && ev[0].metadata.matches[0].id === firstId, ev);

  section("Unchanged answers");
  r = await records.POST(req({ ...BASE, title: "TEST RECORD RRB NTPC 2026", forceCreate: true }));
  check("same address twice → 409 with the old message", r.status === 409 && /already exists/.test((await r.json()).error));
  r = await records.POST(req({ ...BASE, recruitmentYear: undefined, title: "x" }));
  check("missing year → 400 as before", r.status === 400);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
