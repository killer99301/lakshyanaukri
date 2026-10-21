// ═══════════════════════════════════════════════════════════
// Restoring an earlier value, through the REAL field route and repository,
// against the in-memory test database. Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/restore-value.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { pg, token } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const { restorable } = await import("@/lib/cms/restore-value");

  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const r0 = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "canara-bank", organizationName: "Canara Bank", govType: "PSU", title: "TEST RECORD Canara Bank PO 2026", recruitmentYear: 2026 }));
  const id: string = (await r0.json()).record.id;
  let rev: string = (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const save = async (fieldPath: string, field: unknown, extra: Record<string, unknown> = {}) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", { fieldPath, field, clientRevision: rev, reason: "test", ...extra }), ctx(id));
    const d = await r.json();
    if (r.status === 200) rev = d.record.recordRevision;
    return { status: r.status, record: d.record, error: d.error };
  };
  const pending = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const history = async (fieldPath: string) => (await pg.query("SELECT old_value, new_value FROM field_revisions WHERE recruitment_id = $1 AND field_path = $2 ORDER BY revised_at", [id, fieldPath])).rows as Array<{ old_value: unknown; new_value: unknown }>;

  section("A date changed by mistake");
  await save("dates.applicationCloseDate", pending("2026-10-20"));
  await save("dates.applicationCloseDate", pending("2026-01-26"));
  const mistake = (await history("dates.applicationCloseDate"))[1];
  const back = restorable(mistake.old_value);
  check("the value before the mistake can be restored", back.ok, back);
  let out = await save("dates.applicationCloseDate", back.ok ? back.field : null);
  check("restored through the ordinary field route, Pending", out.status === 200 && out.record.dates.applicationCloseDate.value === "2026-10-20" && out.record.dates.applicationCloseDate.status === "PENDING", out);
  const all = await history("dates.applicationCloseDate");
  check("the history keeps all three changes; nothing was removed", all.length === 3, all.length);

  section("Lists kept without a status");
  await save("links", pending([{ type: "OFFICIAL_WEBSITE", label: "Canara Bank", url: "https://www.canarabank.bank.in/", official: true }]));
  await save("links", pending([]));
  const linkBack = restorable((await history("links"))[1].old_value);
  out = await save("links", linkBack.ok ? linkBack.field : null);
  check("the removed link is back", out.status === 200 && out.record.links.length === 1 && out.record.links[0].official === true, out.record?.links ?? out.error);

  section("A stage on a live job, put back quietly");
  await save("examStages", pending([{ name: "Online Test", status: "SCHEDULED", dateDisplay: "Nov 2026", certainty: "TENTATIVE" }]));
  await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
  await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", { announce: false }), ctx(id));
  await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  rev = (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  out = await save("examStages", pending([{ name: "Online Test", status: "POSTPONED" }]));
  const notesAfterMistake = out.record.updates.length;
  const stageBack = restorable((await history("examStages")).at(-1)!.old_value);
  out = await save("examStages", stageBack.ok ? stageBack.field : null, { quiet: true });
  check("the stage is back as it was", out.status === 200 && out.record.examStages[0].status === "SCHEDULED", out.record?.examStages ?? out.error);
  check("putting it back wrote no update note for visitors", out.record.updates.length === notesAfterMistake, out.record.updates.map((u: { title: string }) => u.title));

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
