// ═══════════════════════════════════════════════════════════
// Smart intake keeps a real disagreement between two sources after the owner picks one value
// (owner's correction after Stage 2), through the real preview, apply, review, publish and audit
// on the in-memory test database. No AI, no network, no claim inserted by hand.
//
// Two saved research texts disagree on the last date, both fees and the age limit. The owner ticks
// source A's value in each. The job holds only those values; source B's values stay as claims with
// their own document and words, so the field reads "the sources disagree", the publication review
// shows each disagreement, reopening keeps it, publishing needs one acknowledgement each, and the
// audit records the owner's decision. A job without disagreements is saved exactly as before.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/conflict-retention.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; defaultTicked: boolean; conflict: boolean; claims: Array<{ retrievalId: string; quote?: string }> };

const TEXT = (year: number, o: { last: string; max: number; gen: number; sc: number }) => `IBPS Specialist Officer Synthetic Conflict Test ${year}

Basic Information
Organisation: Institute of Banking Personnel Selection
Post Name: Specialist Officer

Important Dates
Online Application Starts: 1 Jul ${year}
Last Date to Apply: ${o.last} Jul ${year}

Eligibility and Age
Age Limit: Minimum 20 years, Maximum ${o.max} years as on 1 Jul ${year}

Fees and Pay
Application Fee: General/EWS/OBC Rs. ${o.gen}, SC/ST/PwBD Rs. ${o.sc}

How to Apply
1. Read the notification carefully.
2. Register on the online portal and pay the fee.
`;
const A = { last: "26", max: 30, gen: 850, sc: 175 };
const B = { last: "28", max: 32, gen: 800, sc: 150 };
const DISAGREE = ["dates.applicationCloseDate", "age", "financial.feeGeneral", "financial.feeSCST"].sort();

const S = {
  P: "P: two sources, preview",
  S: "S: the owner picks source A and saves",
  R: "R: reopened, reviewed, acknowledged, published",
  N: "N: no disagreement, unchanged",
};
expectChecks(S.P, ["P1 the preview shows each disagreement, both values unticked"]);
expectChecks(S.S, [
  "S1 the job holds only the ticked values",
  "S2 one revision per field: the unticked value writes nothing on the record",
  "S3 both sources' values are kept as claims, each with its own document and words, none superseded",
  "S4 the four fields read “the sources disagree”",
  "S5 the public preview shows one value per field (the ticked one)",
]);
expectChecks(S.R, [
  "R1 reopened, the publication review lists the four disagreements with both values",
  "R2 publishing with three of four acknowledged is refused, the job stays a draft",
  "R3 with each acknowledged, it publishes (no official PDF, Telegram not asked)",
  "R4 the audit records each acknowledged disagreement with both values",
  "R5 the published job shows the ticked values only",
]);
expectChecks(S.N, [
  "N1 one source: only the ticked values' claims are stored, nothing disagrees",
  "N2 two sources that agree: no disagreement, published with no acknowledgement",
  "N3 a disagreement with neither value ticked: both kept as claims, the field stays empty",
]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHANNEL_ID;
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const reviewRoute = await import("@/app/api/admin/cms/records/[id]/publication-review/route");
  const checksRoute = await import("@/app/api/admin/cms/records/[id]/checks/route");
  await setImporterEnabled(true);
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const research = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const preview = async (year: number, texts: string[]) => {
    const p = await service.previewImport({ adminId, mode: "NEW", apiKey: undefined, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }),
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: `IBPS Specialist Officer Synthetic Conflict Test ${year}`, govType: "PSU" },
      sources: texts.map(research) } as never);
    return { importId: p.importId, items: (p.proposal as unknown as { items: Item[] }).items };
  };
  const apply = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const review = async (id: string) => (await (await reviewRoute.GET(req(`/api/admin/cms/records/${id}/publication-review`, "GET"), ctx(id))).json()).review as
    { reviewHash: string; freshness: J; conflicts: Array<{ fieldPath: string; values: string[] }> };
  const classes = async (id: string) => Object.fromEntries(((await (await checksRoute.GET(req(`/api/admin/cms/records/${id}/checks`, "GET"), ctx(id))).json()).rows as Array<{ fieldPath: string; cls: string }>).map((r) => [r.fieldPath, r.cls]));
  const doPublish = async (id: string, v: Awaited<ReturnType<typeof review>>, acks: string[]) => {
    const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", { approveFirst: true, ownerApproval: { acknowledged: true, reviewHash: v.reviewHash, ...v.freshness, conflictsAcknowledged: acks } }), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const claimRows = async (id: string) => (await pg.query(`SELECT c.field_path, c.value, c.quote, c.retrieval_id,
      EXISTS (SELECT 1 FROM recruitment_claim_supersessions x WHERE x.superseded_claim_id = c.id) AS superseded
      FROM recruitment_field_claims c WHERE c.recruitment_id = $1 AND c.kind = 'EXTRACTED'`, [id])).rows as Array<{ field_path: string; value: unknown; quote: string; retrieval_id: string; superseded: boolean }>;
  const isA = (i: Item) => (i.fieldPath === "dates.applicationCloseDate" && i.value === "2091-07-26") || (i.fieldPath === "age" && (i.value as { max?: number }).max === 30)
    || (i.fieldPath === "financial.feeGeneral" && i.value === 850) || (i.fieldPath === "financial.feeSCST" && i.value === 175);

  section(S.P);
  const p = await preview(2091, [TEXT(2091, A), TEXT(2091, B)]);
  const conflicting = p.items.filter((i) => i.conflict);
  check("P1 the preview shows each disagreement, both values unticked",
    JSON.stringify([...new Set(conflicting.map((i) => i.fieldPath))].sort()) === JSON.stringify(DISAGREE) && conflicting.length === 8 && conflicting.every((i) => !i.defaultTicked),
    conflicting.map((i) => [i.fieldPath, i.value, i.defaultTicked]));

  section(S.S);
  const selected = [...p.items.filter((i) => i.defaultTicked).map((i) => i.id), ...conflicting.filter(isA).map((i) => i.id)];
  const { recruitmentId: id } = await apply(p.importId, selected);
  let job = (await getRecruitmentById(id))!;
  check("S1 the job holds only the ticked values",
    job.dates.applicationCloseDate?.value === "2091-07-26" && job.age?.value?.max === 30 && job.financial.feeGeneral?.value === 850 && job.financial.feeSCST?.value === 175,
    [job.dates.applicationCloseDate?.value, job.age?.value, job.financial.feeGeneral?.value, job.financial.feeSCST?.value]);
  const revs = (await pg.query("SELECT field_path, count(*)::int AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = ANY($2) GROUP BY field_path", [id, DISAGREE])).rows;
  check("S2 one revision per field: the unticked value writes nothing on the record", revs.length === 4 && revs.every((r) => r.n === 1), revs);
  const retrievals = (await pg.query("SELECT id FROM recruitment_source_retrievals WHERE import_id = $1 ORDER BY id", [p.importId])).rows.map((r) => r.id as string);
  const claims = (await claimRows(id)).filter((c) => DISAGREE.includes(c.field_path));
  const perField = DISAGREE.map((f) => {
    const cs = claims.filter((c) => c.field_path === f);
    // Each value has a quoted claim from its own document (the date reader adds a second, unquoted claim, as before).
    const vals = [...new Set(cs.map((c) => JSON.stringify(c.value)))];
    return { f, values: vals.length, docs: new Set(cs.map((c) => c.retrieval_id)).size, quoted: vals.every((x) => cs.some((c) => JSON.stringify(c.value) === x && !!c.quote)), superseded: cs.some((c) => c.superseded) };
  });
  check("S3 both sources' values are kept as claims, each with its own document and words, none superseded",
    retrievals.length === 2 && perField.every((x) => x.values === 2 && x.docs === 2 && x.quoted && !x.superseded)
    && claims.some((c) => c.field_path === "financial.feeGeneral" && c.value === 800 && /Rs\. 800/.test(c.quote)), perField);
  const cls = await classes(id);
  check("S4 the four fields read “the sources disagree”", DISAGREE.every((f) => cls[f] === "CONFLICTING"), DISAGREE.map((f) => [f, cls[f]]));
  const pub = projectForPreview(job);
  check("S5 the public preview shows one value per field (the ticked one)",
    pub.financial.feeGeneral === 850 && pub.financial.feeSCST === 175 && !JSON.stringify(pub).includes("2091-07-28") && !/"feeGeneral":800|"max":32/.test(JSON.stringify(pub)), pub.financial);

  section(S.R);
  job = (await getRecruitmentById(id))!; // reopened
  const v = await review(id);
  const byField = Object.fromEntries(v.conflicts.map((c) => [c.fieldPath, c.values]));
  check("R1 reopened, the publication review lists the four disagreements with both values",
    JSON.stringify(Object.keys(byField).sort()) === JSON.stringify(DISAGREE)
    && byField["financial.feeGeneral"].includes("850") && byField["financial.feeGeneral"].includes("800")
    && byField["dates.applicationCloseDate"].includes("2091-07-26") && byField["dates.applicationCloseDate"].includes("2091-07-28")
    && byField.age.some((x) => /20 to 30 years/.test(x)) && byField.age.some((x) => /20 to 32 years/.test(x)), v.conflicts);
  const partial = await doPublish(id, v, DISAGREE.slice(0, 3));
  const state = (await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [id])).rows[0].draft_state;
  check("R2 publishing with three of four acknowledged is refused, the job stays a draft",
    partial.status === 422 && partial.data.code === "CONFLICT_NOT_ACKNOWLEDGED" && state === "DRAFT", [partial.status, partial.data.code, state]);
  const full = await doPublish(id, await review(id), DISAGREE);
  check("R3 with each acknowledged, it publishes (no official PDF, Telegram not asked)", full.status === 200 && full.data.announced !== "sent", [full.status, full.data.error, full.data.announced]);
  const approval = (await pg.query("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'OWNER_PUBLICATION_APPROVAL'", [id])).rows[0]?.metadata as J | undefined;
  const acks = (approval?.conflicts ?? []) as Array<{ fieldPath: string; action: string; values: string[] }>;
  check("R4 the audit records each acknowledged disagreement with both values",
    acks.length === 4 && acks.every((a) => a.action === "ACKNOWLEDGED" && a.values.length === 2) && JSON.stringify(acks.map((a) => a.fieldPath).sort()) === JSON.stringify(DISAGREE)
    && approval?.telegram === false, approval);
  const snap = (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1", [id])).rows[0]?.snapshot as J;
  const fin = snap?.financial as J;
  check("R5 the published job shows the ticked values only", fin?.feeGeneral === 850 && fin?.feeSCST === 175 && !JSON.stringify(snap).includes("2091-07-28"), fin);

  section(S.N);
  const one = await preview(2092, [TEXT(2092, A)]);
  const oneTicked = one.items.filter((i) => i.defaultTicked);
  const { recruitmentId: oneId } = await apply(one.importId, oneTicked.map((i) => i.id));
  const oneClaims = await claimRows(oneId);
  const oneCls = await classes(oneId);
  check("N1 one source: only the ticked values' claims are stored, nothing disagrees",
    oneClaims.length === oneTicked.reduce((n, i) => n + i.claims.length, 0) && !Object.values(oneCls).includes("CONFLICTING") && (await review(oneId)).conflicts.length === 0,
    [oneClaims.length, oneTicked.length, oneCls]);
  const same = await preview(2093, [TEXT(2093, A), TEXT(2093, A)]);
  const { recruitmentId: sameId } = await apply(same.importId, same.items.filter((i) => i.defaultTicked).map((i) => i.id));
  const sv = await review(sameId);
  const samePub = await doPublish(sameId, sv, []);
  check("N2 two sources that agree: no disagreement, published with no acknowledgement",
    same.items.every((i) => !i.conflict) && sv.conflicts.length === 0 && samePub.status === 200, [sv.conflicts, samePub.status, samePub.data.error]);
  const none = await preview(2094, [TEXT(2094, A), TEXT(2094, B)]);
  const { recruitmentId: noneId } = await apply(none.importId, none.items.filter((i) => i.defaultTicked).map((i) => i.id));
  const noneJob = (await getRecruitmentById(noneId))!;
  const noneClaims = (await claimRows(noneId)).filter((c) => c.field_path === "financial.feeGeneral");
  const noneCls = await classes(noneId);
  check("N3 a disagreement with neither value ticked: both kept as claims, the field stays empty",
    noneJob.financial.feeGeneral?.value == null && noneClaims.length === 2 && noneCls["financial.feeGeneral"] === "MISSING", [noneJob.financial.feeGeneral, noneClaims.length, noneCls["financial.feeGeneral"]]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
