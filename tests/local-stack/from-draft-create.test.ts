// ═══════════════════════════════════════════════════════════
// Creating a job from an intelligence draft after the move to the locked
// create (cms_create_job_from_draft): same answers as before, links stored
// with the job, and an audit row when "create anyway" overrides a match.
// Simultaneous promotions are tested on PostgreSQL in tests/pg.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/from-draft-create.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, adminId, token } = await boot();
  const fromDraft = await import("@/app/api/admin/cms/records/from-draft/route");
  const records = await import("@/app/api/admin/cms/records/route");
  const post = (route: { POST: (r: NextRequest) => Promise<Response> }, path: string, body: unknown) =>
    route.POST(new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: JSON.stringify(body) }));
  const promote = (draftId: string, forceCreate?: boolean) => post(fromDraft, "/api/admin/cms/records/from-draft", { draftId, forceCreate });
  const count = async (q: string, args: unknown[] = []) => Number((await pg.query(q, args)).rows[0].n);
  const jobs = (org: string) => count("SELECT count(*)::int AS n FROM recruitments WHERE organization_id = $1", [org]);

  const insertDraft = async (o: { org?: string; year?: number; notif?: string; title: string; links?: unknown[] }) => {
    const snapshot = {
      id: "", identity: {
        organizationId: o.org ? { value: o.org, evidence: [] } : { evidence: [] },
        organizationName: o.org ? { value: o.org.toUpperCase(), evidence: [] } : { evidence: [] },
        recruitmentYear: o.year ? { value: o.year, evidence: [] } : { evidence: [] },
        title: { value: o.title, evidence: [] }, shortTitle: { evidence: [] },
        notificationNumber: o.notif ? { value: o.notif, evidence: [] } : { evidence: [] }, advertisementNumber: { evidence: [] },
      },
      dates: {}, vacancies: {}, links: o.links ?? [], sources: [],
    };
    const row = await pg.query("INSERT INTO intelligence_drafts (created_by, updated_by, snapshot) VALUES ($1,$1,$2) RETURNING id", [adminId, JSON.stringify(snapshot)]);
    const did = (row.rows[0] as { id: string }).id;
    await pg.query("UPDATE intelligence_drafts SET snapshot = jsonb_set(snapshot, '{id}', to_jsonb($1::text)) WHERE id=$2", [did, did]);
    return did;
  };

  section("No match: created, with its links");
  const link = { type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://ibps.in/crp-xv.pdf", official: true };
  const d1 = await insertDraft({ org: "ibps", year: 2026, notif: "CRP RRBs-XV", title: "TEST RECORD IBPS RRB XV 2026", links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: link.url, evidence: [] }] });
  let r = await promote(d1);
  let d = await r.json();
  check("201 with recordId, alreadyExisted false", r.status === 201 && d.recordId && d.alreadyExisted === false, d);
  const firstId = d.recordId;
  const stored = (await pg.query("SELECT links, provenance->>'sourceDraftId' AS src, draft_state FROM recruitments WHERE id = $1", [firstId])).rows[0] as { links: Array<{ url: string }>; src: string; draft_state: string };
  check("links stored with the job in the same insert", Array.isArray(stored.links) && stored.links.some((l) => l.url === link.url), stored.links);
  check("DRAFT, tied to its draft", stored.draft_state === "DRAFT" && stored.src === d1, stored);

  section("Same draft again");
  r = await promote(d1);
  d = await r.json();
  check("alreadyExisted with the same record, nothing created", r.status === 200 && d.alreadyExisted === true && d.recordId === firstId && await jobs("ibps") === 1, d);
  r = await promote(d1, true);
  d = await r.json();
  check("even with create anyway, the same draft makes one job", d.alreadyExisted === true && d.recordId === firstId && await jobs("ibps") === 1, d);

  section("Duplicates: the same answers as before");
  const d2 = await insertDraft({ org: "ibps", year: 2026, notif: "crp  rrbs-xv", title: "TEST RECORD IBPS RRB XV again" });
  r = await promote(d2);
  d = await r.json();
  check("same notification number (case and spaces differ) → duplicate (notification_number)", r.status === 200 && d.duplicate?.matchReason === "notification_number" && d.duplicate?.id === firstId, d);
  check("duplicate keeps the review page's fields", d.duplicate && "organizationId" in d.duplicate && "recruitmentYear" in d.duplicate && "draftState" in d.duplicate && "slug" in d.duplicate, d.duplicate);
  check("nothing created", await jobs("ibps") === 1);
  const d3 = await insertDraft({ org: "ibps", year: 2026, notif: "CRP PO-XVI", title: "TEST RECORD IBPS PO XVI 2026" });
  r = await promote(d3);
  d = await r.json();
  check("different notification number, same org and year → created (not a duplicate)", r.status === 201 && d.recordId && d.recordId !== firstId, d);
  const d4 = await insertDraft({ org: "ibps", year: 2026, title: "TEST RECORD IBPS clerk, no number" });
  r = await promote(d4);
  d = await r.json();
  check("no notification number, same org and year → duplicate (org_year)", d.duplicate?.matchReason === "org_year", d);

  section("Create anyway");
  r = await promote(d2, true);
  d = await r.json();
  check("created with 201", r.status === 201 && d.recordId && d.alreadyExisted === false, d);
  const ev = (await pg.query("SELECT admin_id, metadata FROM recruitment_audit_events WHERE event_type = 'DUPLICATE_OVERRIDE' AND recruitment_id = $1", [d.recordId])).rows as Array<{ admin_id: string; metadata: { via: string; draftId: string; matches: Array<{ id: string }> } }>;
  check("override recorded with the admin, the draft and the matching job", ev.length === 1 && ev[0].admin_id === adminId && ev[0].metadata.via === "from-draft" && ev[0].metadata.draftId === d2 && ev[0].metadata.matches.some((m) => m.id === firstId), ev);

  section("Shares the lock rule with manual New job");
  r = await post(records, "/api/admin/cms/records", { organizationId: "ibps", organizationName: "IBPS", govType: "Central Govt", recruitmentYear: 2026, title: "TEST RECORD IBPS manual" });
  d = await r.json();
  check("manual create of the same org and year now warns about the promoted jobs", r.status === 200 && Array.isArray(d.duplicates) && d.duplicates.length >= 1, d);

  section("A draft with no organisation or year");
  const d5 = await insertDraft({ title: "TEST RECORD unknown body notice" });
  r = await promote(d5);
  d = await r.json();
  check("created as before (no org + year rule to apply)", r.status === 201 && d.recordId, d);

  section("Unchanged answers");
  r = await promote("00000000-0000-0000-0000-000000000000");
  check("unknown draft → 404", r.status === 404);
  r = await post(fromDraft, "/api/admin/cms/records/from-draft", {});
  check("missing draftId → 400", r.status === 400);
  // The promoter's address is the title plus the draft id's first 8
  // characters; give an existing job that address to force a clash.
  const d6 = await insertDraft({ org: "ibps", year: 2026, notif: "CRP PO-XVI", title: "TEST RECORD IBPS PO XVI 2026" });
  await pg.query("UPDATE recruitments SET slug = $1 WHERE id = $2", [`test-record-ibps-po-xvi-2026-${d6.slice(0, 8)}`, firstId]);
  r = await promote(d6, true);
  check("same address as an existing job → 409 with the old message", r.status === 409 && /already exists/.test((await r.json()).error));
  check("the failed insert left no job and no override row behind",
    await count("SELECT count(*)::int AS n FROM recruitments WHERE provenance->>'sourceDraftId' = $1", [d6]) === 0
    && await count("SELECT count(*)::int AS n FROM recruitment_audit_events WHERE event_type = 'DUPLICATE_OVERRIDE' AND metadata->>'draftId' = $1", [d6]) === 0);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
