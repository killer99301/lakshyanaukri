// ═══════════════════════════════════════════════════════════
// Owner-controlled publication, Stage 1, on the local test database
// ═══════════════════════════════════════════════════════════
//
// docs/owner-controlled-publication-design.md, revision 3. Through the real
// route handlers and repository, against an in-memory database:
//   A. a job prepared only from GPT research text (no official PDF) publishes
//      with the owner's explicit approval, and the approval is audited;
//   B. permission: only CMS_PUBLISHERS (admin IDs) may publish, republish,
//      take down, put back or revert; empty = nobody; refusals are recorded
//      on their own and change nothing;
//   C. no approval, an unacknowledged approval, hard rules: refused;
//   D. freshness: an edit, a new claim or a new document after the review is
//      refused; the in-statement guard on its own; real concurrent races;
//   E. atomicity: a publication that fails writes no approval;
//   F. material disagreements: each acknowledged on its own, never blanket.
// Synthetic texts only. No AI, no network, Telegram off.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/owner-publication.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, note, section, summary, ORIGIN } from "./boot";

type J = Record<string, unknown>;
const GPT_TEXT = (year: number, extra = "") => `IBPS Probationary Officer Synthetic Test Recruitment ${year}

Basic Information
Organisation: Institute of Banking Personnel Selection
Post Name: Probationary Officer

Important Dates
Online Application Starts: 1 Jul ${year}
Last Date to Apply: 26 Jul ${year}

Eligibility and Age
Qualification: Graduation in any discipline from a recognised university.
Age Limit: Minimum 20 years, Maximum 30 years as on 1 Jul ${year}
Age Relaxation: 5 years for SC/ST, 3 years for OBC, 10 years for PwBD

Fees and Pay
Application Fee: General/EWS/OBC Rs. 850, SC/ST/PwBD Rs. 175
${extra}
Selection Process
Online Preliminary Examination:
English Language: 30 Questions, 30 Marks
Reasoning Ability: 35 Questions, 35 Marks
Online Main Examination:
Interview:

How to Apply
1. Read the recruitment notification carefully.
2. Register on the official registration portal.
3. Submit the application and keep the confirmation.

Important Links
Official Website: https://www.ibps.in/
Apply Online: https://ibpsreg.ibps.in/synthetic${year}/index.php
`;

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHANNEL_ID;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const takeDown = await import("@/app/api/admin/cms/records/[id]/take-down/route");
  const putBack = await import("@/app/api/admin/cms/records/[id]/put-back/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const reviewRoute = await import("@/app/api/admin/cms/records/[id]/publication-review/route");
  const repo = await import("@/lib/cms/repository");
  const { projectToPublished, PROJECTION_VERSION } = await import("@/lib/cms/projector");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));

  const row = async (id: string) => (await pg.query("SELECT draft_state, record_revision, taken_down FROM recruitments WHERE id = $1", [id])).rows[0] as { draft_state: string; record_revision: string; taken_down: unknown };
  const events = async (id: string, type: string) => (await pg.query("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = $2 ORDER BY created_at", [id, type])).rows.map((r) => r.metadata as J);
  const publishedCount = async (id: string) => (await pg.query("SELECT count(*)::int AS n FROM published_recruitments WHERE recruitment_id = $1", [id])).rows[0].n as number;
  const importGpt = async (year: number, extra = "") => {
    const p = await service.previewImport({ adminId, mode: "NEW", apiKey: undefined,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: `IBPS Probationary Officer Synthetic Test Recruitment ${year}`, govType: "PSU" },
      sources: [{ declaredKind: "RESEARCH", method: "paste", text: GPT_TEXT(year, extra), prepared: true }] } as never);
    const ticked = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: ticked, confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const importInto = async (id: string, text: string) => {
    const p = await service.previewImport({ adminId, mode: "EXISTING", recruitmentId: id, apiKey: undefined, sources: [{ declaredKind: "RESEARCH", method: "paste", text, prepared: true }] } as never);
    const ticked = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
    return service.applyImportFlow({ importId: p.importId, adminId, selected: ticked, confirmReplaceVerified: false, override: null });
  };
  const getReview = async (id: string) => (await (await reviewRoute.GET(req(`/api/admin/cms/records/${id}/publication-review`, "GET"), ctx(id))).json()) as { review: J & { reviewHash: string; freshness: J; conflicts: Array<{ fieldPath: string; part?: string }>; warnings: Array<{ code: string }>; hardRules: Array<{ code: string }>; standing: J; missing: unknown[] }; publisher: boolean; adminId: string };
  const approvalOf = (r: Awaited<ReturnType<typeof getReview>>["review"], acks?: string[]) =>
    ({ acknowledged: true, reviewHash: r.reviewHash, ...r.freshness, conflictsAcknowledged: acks ?? r.conflicts.map((c) => c.fieldPath) });
  const doPublish = async (id: string, body: J) => { const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", body), ctx(id)); return { status: r.status, data: (await r.json()) as J }; };
  const patch = async (id: string, fieldPath: string, value: unknown) => fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH",
    { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: (await row(id)).record_revision, reason: "owner-publication test" }), ctx(id));

  // ── A ──
  section("A. GPT research only, no official PDF: published with the owner's approval");
  const a = await importGpt(2090);
  const ra = await getReview(a);
  const aCodes = ra.review.warnings.map((w) => w.code);
  check("A1 the review: no hard rule; warns nothing is confirmed against an official document; official documents 0",
    ra.publisher && ra.review.hardRules.length === 0 && aCodes.includes("NOT_CONFIRMED") && (ra.review.standing as J).officialDocuments === 0, { warnings: aCodes, standing: ra.review.standing });
  const pa = await doPublish(a, { approveFirst: true, ownerApproval: approvalOf(ra.review) });
  const snapA = (await pg.query("SELECT snapshot, source_record_revision FROM published_recruitments WHERE recruitment_id = $1", [a])).rows[0] as { snapshot: J; source_record_revision: string } | undefined;
  check("A2 published (Approve & Publish); Telegram not asked; keyDetailsChecked false (nothing claimed as checked)",
    pa.status === 200 && pa.data.announced === "not-asked" && (await row(a)).draft_state === "PUBLISHED" && snapA?.snapshot.keyDetailsChecked === false, pa.status === 200 ? pa.data.announced : pa.data);
  const ev = (await events(a, "OWNER_PUBLICATION_APPROVAL"))[0] ?? {};
  check("A3 OWNER_PUBLICATION_APPROVAL: approver ID, the revision published, freshness, fingerprint, warnings, Telegram choice",
    (ev.approver as J)?.adminId === adminId && ev.recordRevision === snapA?.source_record_revision && ev.reviewHash === ra.review.reviewHash
      && ev.kind === "FIRST_PUBLISH" && ev.telegram === false && Array.isArray(ev.warnings) && typeof ev.claimSeq === "number" && typeof ev.retrievals === "number"
      // Research links are never pre-ticked at intake, so this job has no Apply link: recorded as such.
      && (ev.links as J)?.applyOnline === "NONE" && Array.isArray(ev.missing), ev);

  // ── B ──
  section("B. Only publishers act; refusals are recorded on their own and change nothing");
  const b = await importGpt(2091);
  await approve.POST(req(`/api/admin/cms/records/${b}/approve`, "POST"), ctx(b));
  const before = JSON.stringify((await pg.query("SELECT * FROM recruitments WHERE id = $1", [b])).rows[0]);
  const rb = await getReview(b);
  const other = "66666666-7777-4888-9999-aaaaaaaaaaaa";
  process.env.CMS_PUBLISHERS = other;
  const b1 = await doPublish(b, { ownerApproval: approvalOf(rb.review) });
  const b1again = await doPublish(b, { ownerApproval: approvalOf(rb.review) });
  const rbAs = await getReview(b);
  process.env.CMS_PUBLISHERS = "";
  const b2 = await doPublish(b, { ownerApproval: approvalOf(rb.review) });
  process.env.CMS_PUBLISHERS = "test-admin";
  const b3 = await doPublish(b, { ownerApproval: approvalOf(rb.review) });
  process.env.CMS_PUBLISHERS = adminId;
  check("B1 another admin's ID listed → 403, told their own admin ID; the review says not a publisher",
    b1.status === 403 && b1.data.code === "NOT_A_PUBLISHER" && String(b1.data.error).includes(adminId) && rbAs.publisher === false && rbAs.adminId === adminId, b1.data);
  check("B2 an empty list → 403: publishing is closed for everyone", b2.status === 403 && /Publishing is closed/.test(String(b2.data.error)), b2.data);
  check("B3 a username in the list does not count → 403", b3.status === 403, b3.status);
  check("B4 the refusals changed nothing: same row, nothing published", JSON.stringify((await pg.query("SELECT * FROM recruitments WHERE id = $1", [b])).rows[0]) === before && (await publishedCount(b)) === 0);
  const refusedB = await events(b, "PUBLICATION_REFUSED");
  check("B5 refusals recorded with only action, reason and revision; two identical within a minute → one row",
    b1again.status === 403 && refusedB.length === 1 && refusedB.every((m) => Object.keys(m).every((k) => ["action", "reason", "recordRevision", "fieldPaths", "ruleCodes"].includes(k)))
      && refusedB[0].reason === "NOT_A_PUBLISHER" && refusedB[0].action === "PUBLISH", refusedB);
  // Take-down, put-back and revert on the published job A, as a non-publisher.
  process.env.CMS_PUBLISHERS = other;
  const aBefore = JSON.stringify((await pg.query("SELECT * FROM recruitments WHERE id = $1", [a])).rows[0]);
  const td = await takeDown.POST(req(`/api/admin/cms/records/${a}/take-down`, "POST", { reason: "owner-publication test" }), ctx(a));
  const rv = await revert.POST(req(`/api/admin/cms/records/${a}/revert`, "POST"), ctx(a));
  const pb = await putBack.POST(req(`/api/admin/cms/records/${a}/put-back`, "POST"), ctx(a));
  process.env.CMS_PUBLISHERS = adminId;
  const refusedA = (await events(a, "PUBLICATION_REFUSED")).map((m) => `${m.action}:${m.reason}`);
  check("B6 take-down, revert and put-back by a non-publisher → 403 each, recorded, job unchanged",
    td.status === 403 && rv.status === 403 && pb.status === 403 && ["TAKE_DOWN:NOT_A_PUBLISHER", "REVERT:NOT_A_PUBLISHER", "PUT_BACK:NOT_A_PUBLISHER"].every((x) => refusedA.includes(x))
      && JSON.stringify((await pg.query("SELECT * FROM recruitments WHERE id = $1", [a])).rows[0]) === aBefore, { td: td.status, rv: rv.status, pb: pb.status, refusedA });
  const td2 = await takeDown.POST(req(`/api/admin/cms/records/${a}/take-down`, "POST", { reason: "owner-publication test" }), ctx(a));
  const pb2 = await putBack.POST(req(`/api/admin/cms/records/${a}/put-back`, "POST"), ctx(a));
  check("B7 the publisher can take down and put back as before", td2.status === 200 && pb2.status === 200, [td2.status, pb2.status]);

  // ── C ──
  section("C. No approval, an unacknowledged one, hard rules");
  const rb2 = await getReview(b);
  const c1 = await doPublish(b, {});
  const c2 = await doPublish(b, { ownerApproval: { ...approvalOf(rb2.review), acknowledged: false } });
  check("C1 no approval → 422 OWNER_REVIEW_REQUIRED with the review; not acknowledged → the same; nothing published",
    c1.status === 422 && c1.data.code === "OWNER_REVIEW_REQUIRED" && !!c1.data.review && c2.status === 422 && c2.data.code === "OWNER_REVIEW_REQUIRED" && (await publishedCount(b)) === 0, [c1.data.code, c2.data.code]);
  const links = (await repo.getRecruitmentById(b))!.links.filter((l) => l.type !== "APPLY_ONLINE");
  await patch(b, "links", [...links, { type: "APPLY_ONLINE", label: "Apply Online", url: "https://www.adda247.com/jobs/ibps-po-synthetic", official: false }]);
  const rb3 = await getReview(b);
  const c3 = await doPublish(b, { ownerApproval: approvalOf(rb3.review) });
  check("C2 a job-news site as the Apply link → 422 HARD_RULE even with a fresh approval",
    c3.status === 422 && c3.data.code === "HARD_RULE" && (c3.data.hardRules as Array<{ code: string }>).some((h) => h.code === "APPLY_AGGREGATOR"), c3.data.code);
  await patch(b, "links", links);
  await pg.query(`UPDATE recruitments SET lifecycle = jsonb_set(lifecycle, '{conflicts}', '[{"id":"lc1","fieldPath":"dates.applicationCloseDate","detectedAt":"2099-01-01T00:00:00Z","values":[]}]'::jsonb) WHERE id = $1`, [b]);
  const rb4 = await getReview(b);
  const c4 = await doPublish(b, { ownerApproval: approvalOf(rb4.review) });
  check("C3 an unresolved record conflict → 422 HARD_RULE even with a fresh approval",
    c4.status === 422 && (c4.data.hardRules as Array<{ code: string }>).some((h) => h.code === "LIFECYCLE_CONFLICT"), c4.data.code);
  await pg.query(`UPDATE recruitments SET lifecycle = jsonb_set(lifecycle, '{conflicts}', '[]'::jsonb) WHERE id = $1`, [b]);
  const refusedC = (await events(b, "PUBLICATION_REFUSED")).map((m) => m.reason);
  check("C4 the refusals are recorded (owner review required, hard rule), with rule codes", refusedC.includes("OWNER_REVIEW_REQUIRED") && refusedC.includes("HARD_RULE")
    && (await events(b, "PUBLICATION_REFUSED")).some((m) => (m.ruleCodes as string[] | undefined)?.includes("APPLY_AGGREGATOR")), refusedC);

  // ── D ──
  section("D. Freshness: whatever changed after the review is refused");
  const d0 = await getReview(b);
  await patch(b, "dates.applicationCloseDate", "2091-07-27");
  const d1 = await doPublish(b, { ownerApproval: approvalOf(d0.review) });
  check("D1 a field edited after the review → 409 REVIEW_CHANGED; nothing published", d1.status === 409 && d1.data.code === "REVIEW_CHANGED" && (await publishedCount(b)) === 0, d1.data.code);
  // A confirmation against an official document adds a claim without changing the record: the case a revision
  // check alone would miss.
  const off = await service.previewImport({ adminId, mode: "EXISTING", recruitmentId: b, apiKey: undefined, sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste",
    url: "https://www.ibps.in/synthetic-2091-notice.pdf", attestation: "Copied from the notice (owner-publication test)", text: GPT_TEXT(2091) }] } as never);
  const offTicked = (off.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
  await service.applyImportFlow({ importId: off.importId, adminId, selected: offTicked, confirmReplaceVerified: false, override: null });
  const d2r = await getReview(b);
  const revBefore = (await row(b)).record_revision;
  const checks = await service.checksFor((await repo.getRecruitmentById(b))!);
  const openRow = checks.rows.find((r) => r.fieldPath === "dates.applicationOpenDate")!;
  const offDoc = checks.retrievals.find((r) => r.declaredKind === "OFFICIAL_NOTIFICATION")!.id;
  await service.decide({ recruitmentId: b, adminId, fieldPath: "dates.applicationOpenDate", kind: "ADMIN_VERIFIED", retrievalId: offDoc, page: null,
    quote: "Online Application Starts: 1 Jul 2091", tableCell: null, reviewScope: null, justification: null, publicNote: null, seen: { revisionId: openRow.latestRevisionId, decisionId: openRow.decisionId ?? null } });
  const revAfter = (await row(b)).record_revision;
  const d2 = await doPublish(b, { ownerApproval: approvalOf(d2r.review) });
  note(`after a confirmation: record revision ${revBefore === revAfter ? "unchanged" : "changed"}; freshness now ${JSON.stringify((await getReview(b)).review.freshness)} vs reviewed ${JSON.stringify(d2r.review.freshness)}`);
  check("D2 a confirmation after the review (record revision unchanged, a new claim) → 409", revBefore === revAfter && d2.status === 409 && d2.data.code === "REVIEW_CHANGED", { revSame: revBefore === revAfter, code: d2.data.code });
  const d3r = await getReview(b);
  await service.previewImport({ adminId, mode: "EXISTING", recruitmentId: b, apiKey: undefined, sources: [{ declaredKind: "RESEARCH", method: "paste", text: GPT_TEXT(2091, "Pay Scale: Rs. 36000-63840\n"), prepared: true }] } as never);
  const d3 = await doPublish(b, { ownerApproval: approvalOf(d3r.review) });
  check("D3 a new document brought in after the review (no claim, no edit) → 409", d3.status === 409 && d3.data.code === "REVIEW_CHANGED", { code: d3.data.code, now: (await getReview(b)).review.freshness, then: d3r.review.freshness });
  // The in-statement guard on its own: the route's own check passed, then the job changed before the statement.
  const recB = (await repo.getRecruitmentById(b))!;
  const guardReview = await getReview(b);
  await patch(b, "identity.notificationNumber", "SYN/2091/7");
  let guard = "published";
  try {
    await repo.persistPublication(recB, projectToPublished(recB), PROJECTION_VERSION, adminId,
      { freshness: guardReview.review.freshness as never, approval: { test: true }, eventType: "OWNER_PUBLICATION_APPROVAL" });
  } catch (e) { guard = (e as Error).name; }
  check("D4 the statement itself refuses a stale revision: StaleReviewError, nothing published, no approval row",
    guard === "StaleReviewError" && (await publishedCount(b)) === 0 && (await events(b, "OWNER_PUBLICATION_APPROVAL")).length === 0 && (await row(b)).draft_state === "APPROVED", guard);
  const fresh = await getReview(b);
  const d5 = await doPublish(b, { ownerApproval: approvalOf(fresh.review) });
  check("D5 a fresh review then publishes", d5.status === 200, d5.data.code ?? d5.status);

  // Real concurrency: a publish and an edit (or an import) started together, on fresh jobs.
  const outcomes: string[] = [];
  let bad = 0;
  const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let k = 0; k < 6; k++) {
    const j = await importGpt(2092 + k);
    await approve.POST(req(`/api/admin/cms/records/${j}/approve`, "POST"), ctx(j));
    const rj = await getReview(j);
    const editing = k % 2 === 0;
    // The competing change starts at once, or a little later, so both orders occur.
    const delay = [0, 0, 40, 40, 400, 400][k];
    const [pub, other] = await Promise.all([
      doPublish(j, { ownerApproval: approvalOf(rj.review) }),
      later(delay).then(() => editing ? patch(j, "dates.applicationCloseDate", `${2092 + k}-07-28`).then((r) => r.status)
        : importInto(j, GPT_TEXT(2092 + k, "Pay Scale: Rs. 36000-63840\n")).then(() => 200, () => 409)),
    ]);
    const pubRow = (await pg.query("SELECT source_record_revision FROM published_recruitments WHERE recruitment_id = $1", [j])).rows[0] as { source_record_revision: string } | undefined;
    const appr = (await events(j, "OWNER_PUBLICATION_APPROVAL"))[0];
    const nowFresh = (await getReview(j)).review.freshness as J;
    outcomes.push(`${editing ? "edit" : "import"}: publish ${pub.status}, other ${other}`);
    // The invariant: published ⇔ approval row; and if published, it is exactly the reviewed state, and the other
    // change did not land afterwards (a published job is not editable) — or it landed before and the publish was refused.
    const published = pub.status === 200;
    const ok = published
      ? !!pubRow && !!appr && pubRow.source_record_revision === appr.recordRevision && appr.recordRevision === rj.review.freshness.recordRevision
        && nowFresh.recordRevision === rj.review.freshness.recordRevision && nowFresh.claimSeq === rj.review.freshness.claimSeq && other !== 200
      : !pubRow && !appr && pub.status === 409;
    if (!ok) bad++;
  }
  note(`concurrent outcomes: ${outcomes.join("; ")}`);
  check("D6 six concurrent publish-vs-edit/import races: never a publication of a state other than the one reviewed; approval row only with a publication", bad === 0, outcomes);

  // ── E ──
  section("E. A publication that fails writes no approval");
  const e = await importGpt(2098);
  await approve.POST(req(`/api/admin/cms/records/${e}/approve`, "POST"), ctx(e));
  await pg.exec(`CREATE OR REPLACE FUNCTION test_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'snapshot insert failed (test)'; END $$;
    CREATE TRIGGER test_boom BEFORE INSERT ON published_recruitments FOR EACH ROW WHEN (NEW.recruitment_id = '${e}') EXECUTE FUNCTION test_boom();`);
  const re = await getReview(e);
  const quiet = console.error; console.error = () => {};
  const e1 = await doPublish(e, { ownerApproval: approvalOf(re.review) });
  console.error = quiet;
  await pg.exec("DROP TRIGGER test_boom ON published_recruitments; DROP FUNCTION test_boom();");
  check("E1 the snapshot insert fails → 500; no approval row, no PUBLISHED row, still APPROVED, nothing public",
    e1.status === 500 && (await events(e, "OWNER_PUBLICATION_APPROVAL")).length === 0 && (await events(e, "RECORD_PUBLISHED")).length === 0
      && (await row(e)).draft_state === "APPROVED" && (await publishedCount(e)) === 0, e1.status);

  // ── F ──
  section("F. Disagreements: each acknowledged on its own");
  const f = await importGpt(2099, "Pay Scale: Rs. 36000-63840\nWork Experience: Minimum 2 years in a bank.\n");
  // Smart Intake settles disagreements at intake (a differing value is offered unticked, and a ticked replacement
  // supersedes the old claim), so the stored state "sources disagree" is seeded here directly: a second extracted
  // claim, from the same import, with another pay scale and another experience.
  await pg.query(`INSERT INTO recruitment_field_claims (id, recruitment_id, field_path, kind, value, value_hash, retrieval_id, page, quote, table_cell, import_id)
    SELECT gen_random_uuid(), recruitment_id, field_path, kind,
           CASE WHEN field_path = 'financial.payScale' THEN to_jsonb('Rs. 48480-85920'::text)
                ELSE jsonb_set(value, '{0,experience}', '["Minimum 3 years in a bank"]'::jsonb) END,
           repeat('0', 64), retrieval_id, page, quote, table_cell, import_id
    FROM recruitment_field_claims WHERE recruitment_id = $1 AND kind = 'EXTRACTED' AND field_path IN ('financial.payScale', 'eligibility')`, [f]);
  await approve.POST(req(`/api/admin/cms/records/${f}/approve`, "POST"), ctx(f));
  const rf = await getReview(f);
  const cf = rf.review.conflicts.map((c) => c.fieldPath).sort();
  note(`disagreements found: ${JSON.stringify(rf.review.conflicts)}`);
  check("F1 the review lists the disagreements (pay; eligibility named as experience)",
    cf.includes("financial.payScale") && rf.review.conflicts.some((c) => c.fieldPath === "eligibility" && c.part === "experience"), rf.review.conflicts);
  const f1 = await doPublish(f, { ownerApproval: approvalOf(rf.review, []) });
  const f2 = await doPublish(f, { ownerApproval: approvalOf(rf.review, cf.slice(0, 1)) });
  const f3 = await doPublish(f, { ownerApproval: approvalOf(rf.review, [...cf, cf[0]]) });
  check("F2 none, some, or a repeated acknowledgement → 422 CONFLICT_NOT_ACKNOWLEDGED, naming what is missing; nothing published",
    [f1, f2, f3].every((x) => x.status === 422 && x.data.code === "CONFLICT_NOT_ACKNOWLEDGED") && (await publishedCount(f)) === 0, [f1.data, f2.data.fieldPaths]);
  const f4 = await doPublish(f, { ownerApproval: approvalOf(rf.review, cf) });
  const ef = (await events(f, "OWNER_PUBLICATION_APPROVAL"))[0] ?? {};
  check("F3 each acknowledged → published; the approval records each disagreement with its values and action",
    f4.status === 200 && (ef.conflicts as Array<J>)?.length === cf.length && (ef.conflicts as Array<J>).every((c) => c.action === "ACKNOWLEDGED" && Array.isArray(c.values)), ef.conflicts);
  check("F4 the refused attempts name the unacknowledged fields only (no values)",
    (await events(f, "PUBLICATION_REFUSED")).some((m) => m.reason === "CONFLICT_NOT_ACKNOWLEDGED" && Array.isArray(m.fieldPaths) && !JSON.stringify(m).includes("Rs.")));

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
