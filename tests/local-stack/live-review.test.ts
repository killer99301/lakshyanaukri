// ═══════════════════════════════════════════════════════════
// Reviewing an LN Update against a LIVE job without opening it (CMS 2.0, 14 Nov 2026), through the real routes,
// service and database functions on the in-memory test database. AI off. SYNTHETIC data only.
//   A. Live → preview → discard: the job stays live; its fields, revision, published version and history unchanged.
//   B. Live → preview → save: the job is opened for editing AND the ticked changes saved, in one transaction; the
//      public keeps the published version until the owner publishes.
//   C. A save that fails (a change elsewhere; announcements changed meanwhile): nothing saved and the job NOT opened.
//   D. Only a publisher can save into a live job (it opens the job); the refusal leaves the job live.
//   E. The job's state changes during the save: refused, nothing saved; the next save goes through.
//   F. A preview made on a draft, the job published before the save: refused (a new preview), the job stays live.
//   H. Links, exam stages or classification changed after the preview (not covered by the content revision): refused,
//      checked inside the save's transaction; a preview stored without its basis is made again.
//   G. An identity mismatch is still reported; an archived job takes no preview.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/live-review.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

type Item = { id: string; fieldPath: string; action: string; defaultTicked: boolean };
type Proposal = { items: Item[]; lnUpdate?: { header: { identity: string } } };

const TITLE = "TEST RECORD Live Review Engineer Recruitment 2097";
const ORG = "Test Live Review Bank";
const HEAD = (type: string, date: string, title = TITLE) => `LN Update v1\nJob: ${title}\nOrganisation: ${ORG}\nUpdate type: ${type}\nSource: Test advertisement, dated ${date}\nSource link: https://bank.example.gov.in/ad-${date.replace(/ /g, "-")}.pdf\n\n`;
const FEES = `${HEAD("Correction", "4 Jan 2097")}Application Fee: General/EWS/OBC Rs. 750, SC/ST Nil\n`;
const ADMIT = `${HEAD("Admit card", "1 Feb 2097")}Exam Stages:\nStage: Online Written Test | Status: Admit card out | Date: 10 Feb 2097 | Confirmed\n\nAnnouncement:\nTitle: Online test call letters released\nText: Call letters are out. The test is on 10 Feb 2097.\n`;

const S = {
  A: "A: live → preview → discard", B: "B: live → preview → save", C: "C: a failed save opens nothing",
  D: "D: only a publisher saves into a live job", E: "E: the job's state changes during the save",
  F: "F: preview on a draft, published before the save", G: "G: identity and archived jobs",
  H: "H: links, stages and classification changed after the preview",
};
expectChecks(S.A, [
  "A1 a preview can be made on a live job, read by code (no AI)",
  "A2 making the preview changed nothing on the job: still live, same fields, revision, published version and history",
  "A3 discarded: the preview is marked discarded, the job is still live and unchanged, no 'opened for editing' history",
]);
expectChecks(S.B, [
  "B1 saved: the ticked fee rows are on the job, and the job is open for editing (said in the answer)",
  "B2 one 'opened for editing' revision and one RECORD_REVERTED event, both naming the import",
  "B3 the public still sees the published version: same published snapshot, no new one",
  "B4 the job's revision is the saved content's: the preview was not made stale by opening the job",
]);
expectChecks(S.C, [
  "C1 the job changes elsewhere during the save: refused, the job is NOT opened, nothing saved, preview still open",
  "C2 a stale preview (job edited after the preview): refused, the job stays live",
  "C3 announcements changed meanwhile (the announcements path): refused, the job is NOT opened, nothing saved",
]);
expectChecks(S.D, ["D1 a non-publisher's save into a live job is refused; the job stays live, the refusal is recorded"]);
expectChecks(S.E, ["E1 opened elsewhere during the save: refused, nothing saved", "E2 saving again goes through (the job is already open)"]);
expectChecks(S.F, [
  "F1 published after a draft preview: refused with 'make a new preview', nothing saved, the job stays live and is not reopened",
  "F2 a new preview of the live job then saves, opening it in the same transaction",
]);
expectChecks(S.H, [
  "H1 a link edited after a preview of a draft: refused, nothing saved",
  "H2 a live job reopened, its link changed and republished after a live preview: refused, the job stays live",
  "H3 exam stages changed during the save (inside the transaction): refused, nothing saved",
  "H4 a preview stored without its basis (made before this check): refused, make a new preview",
  "H5 an unchanged preview still saves",
]);
expectChecks(S.G, ["G1 another job's title: the identity check still says it is not this job", "G2 an archived job: no preview"]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const db = await import("@/lib/db");
  await setImporterEnabled(true);

  const req = (path: string, method: string, body?: unknown) => new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  let calls = 0;
  const noAi = (async () => { calls++; throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  const paste = (text: string) => ({ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text });
  const preview = async (id: string, text: string) => {
    const p = await service.previewImport({ adminId, apiKey: "unused", fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }),
      mode: "EXISTING", recruitmentId: id, sources: [paste(text)] } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const ticked = (p: Proposal) => p.items.filter((i) => i.defaultTicked && i.action !== "MATCHES").map((i) => i.id);
  const offered = (p: Proposal) => p.items.filter((i) => i.action !== "MATCHES" && i.fieldPath === "financial.feeTable").map((i) => i.id);
  const save = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null }) as Promise<{ openedForEditing?: boolean; replayed: boolean }>;
  const attempt = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); } };
  const one = async <T,>(q: string, args: unknown[]) => (await pg.query(q, args)).rows[0] as T;
  const state = async (id: string) => (await one<{ draft_state: string }>("SELECT draft_state FROM recruitments WHERE id = $1", [id])).draft_state;
  const importStatus = async (importId: string) => (await one<{ status: string }>("SELECT status FROM recruitment_imports WHERE import_id = $1", [importId])).status;
  const n = async (q: string, args: unknown[]) => Number((await one<{ n: string }>(q, args)).n);
  // Everything a preview or a failed save must leave alone, in one fingerprint.
  const fingerprint = async (id: string) => {
    const r = (await getRecruitmentById(id))!;
    return JSON.stringify({
      state: r.draftState, revision: r.recordRevision, financial: r.financial, stages: r.examStages, updates: r.updates, links: r.links,
      lastPublished: r.lastPublishedRevision,
      snapshots: await n("SELECT count(*) AS n FROM published_recruitments WHERE recruitment_id = $1", [id]),
      latest: (await one<{ s: unknown }>("SELECT snapshot AS s FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id]))?.s ?? null,
      revisions: await n("SELECT count(*) AS n FROM field_revisions WHERE recruitment_id = $1", [id]),
      reverted: await n("SELECT count(*) AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'RECORD_REVERTED'", [id]),
    });
  };

  // A live synthetic job: created, given a fee, a link and a closing date, then published by the owner.
  const made = await (await records.POST(req("/api/admin/cms/records", "POST", {
    organizationId: "live-review-bank", organizationName: ORG, govType: "PSU", title: TITLE, recruitmentYear: 2097,
  }))).json();
  const id: string = made.record.id;
  let rev: string = made.record.recordRevision;
  const patch = async (fieldPath: string, value: unknown) => {
    const res = await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH", {
      fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: rev, reason: "test" }), ctx(id));
    const body = await res.json();
    if (res.status === 200) rev = body.record.recordRevision;
    return res.status;
  };
  const ownerPublish = async () => {
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    return (await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id))).status;
  };
  await patch("links", [{ type: "OFFICIAL_WEBSITE", label: "Test bank", url: "https://bank.example.gov.in/", official: true }]);
  await patch("dates.applicationCloseDate", "2097-01-25");
  await patch("financial.feeGeneral", 750);
  const published = await ownerPublish();
  if (published !== 200 || (await state(id)) !== "PUBLISHED") throw new Error(`setup: publish failed (${published}, ${await state(id)})`);

  section(S.A);
  const live0 = await fingerprint(id);
  const a = await preview(id, FEES);
  check("A1 a preview can be made on a live job, read by code (no AI)",
    a.proposal.lnUpdate?.header.identity === "MATCH" && a.proposal.items.some((i) => i.fieldPath === "financial.feeTable") && calls === 0, a.proposal.items.map((i) => i.fieldPath));
  check("A2 making the preview changed nothing on the job: still live, same fields, revision, published version and history", (await fingerprint(id)) === live0);
  await service.discardImport(a.importId);
  check("A3 discarded: the preview is marked discarded, the job is still live and unchanged, no 'opened for editing' history",
    (await importStatus(a.importId)) === "DISCARDED" && (await fingerprint(id)) === live0 && (await state(id)) === "PUBLISHED");

  section(S.B);
  const snapBefore = await one<{ n: string; s: unknown }>("SELECT count(*) OVER () AS n, snapshot AS s FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id]);
  const b = await preview(id, FEES);
  const bSaved = await save(b.importId, ticked(b.proposal));
  const jb = (await getRecruitmentById(id))!;
  check("B1 saved: the ticked fee rows are on the job, and the job is open for editing (said in the answer)",
    bSaved.openedForEditing === true && jb.draftState === "DRAFT" && jb.financial.feeTable?.value?.length === 2 && (await importStatus(b.importId)) === "APPLIED",
    { bSaved, state: jb.draftState, fees: jb.financial.feeTable?.value });
  const openedRev = (await pg.query("SELECT old_value, new_value, reason FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'draftState' AND reason LIKE $2", [id, `%${b.importId}%`])).rows;
  const openedEv = (await pg.query("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'RECORD_REVERTED' AND metadata->>'importId' = $2", [id, b.importId])).rows;
  check("B2 one 'opened for editing' revision and one RECORD_REVERTED event, both naming the import",
    openedRev.length === 1 && openedEv.length === 1 && (openedEv[0] as { metadata: { via: string } }).metadata.via === "import", { openedRev, openedEv });
  const snapAfter = await one<{ n: string; s: unknown }>("SELECT count(*) OVER () AS n, snapshot AS s FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id]);
  check("B3 the public still sees the published version: same published snapshot, no new one",
    snapAfter.n === snapBefore.n && JSON.stringify(snapAfter.s) === JSON.stringify(snapBefore.s) && jb.lastPublishedRevision !== undefined);
  check("B4 the job's revision is the saved content's: the preview was not made stale by opening the job", jb.recordRevision !== rev && typeof jb.recordRevision === "string", jb.recordRevision);
  rev = jb.recordRevision;
  if ((await ownerPublish()) !== 200) throw new Error("setup: republish failed");

  section(S.C);
  // C1: a field changes elsewhere between the save's checks and its transaction.
  const c1 = await preview(id, `${HEAD("Schedule", "5 Jan 2097")}Exam Stages:\nStage: Online Written Test | Status: Scheduled | Date: 10 Feb 2097 | Tentative\n`);
  const live1 = await fingerprint(id);
  const realRev = (await getRecruitmentById(id))!.recordRevision;
  const original = db.sql.transaction.bind(db.sql);
  const meanwhile = (sqlText: string) => { (db.sql as unknown as { transaction: unknown }).transaction = async (qs: unknown) => { await pg.query(sqlText, [id]); return (original as (q: unknown) => unknown)(qs); }; };
  const restore = () => { (db.sql as unknown as { transaction: unknown }).transaction = original; };
  meanwhile("UPDATE recruitments SET record_revision = 'changed-elsewhere' WHERE id = $1");
  const c1Err = await attempt(() => save(c1.importId, ticked(c1.proposal)));
  restore();
  await pg.query("UPDATE recruitments SET record_revision = $2 WHERE id = $1", [id, realRev]);
  check("C1 the job changes elsewhere during the save: refused, the job is NOT opened, nothing saved, preview still open",
    /changed after this preview/.test(c1Err) && (await fingerprint(id)) === live1 && (await state(id)) === "PUBLISHED" && (await importStatus(c1.importId)) === "PREVIEWED", c1Err);
  // C2: the job is edited after the preview (its content fingerprint moved on).
  await pg.query("UPDATE recruitments SET record_revision = 'edited-after-preview' WHERE id = $1", [id]);
  const c2Err = await attempt(() => save(c1.importId, ticked(c1.proposal)));
  const c2State = await state(id);
  await pg.query("UPDATE recruitments SET record_revision = $2 WHERE id = $1", [id, realRev]);
  check("C2 a stale preview (job edited after the preview): refused, the job stays live",
    /changed after this preview/.test(c2Err) && c2State === "PUBLISHED" && (await fingerprint(id)) === live1, c2Err);
  // C3: the announcements path: another announcement lands during the save.
  const c3 = await preview(id, ADMIT);
  const c3Ids = c3.proposal.items.filter((i) => i.action !== "MATCHES").map((i) => i.id);
  meanwhile(`UPDATE recruitments SET updates = coalesce(updates, '[]'::jsonb) || '[{"id":"x-race","date":"2097-02-01","type":"GENERAL_NOTICE","title":"Added meanwhile","description":"Another tab."}]'::jsonb WHERE id = $1`);
  const c3Err = await attempt(() => save(c3.importId, c3Ids));
  restore();
  const afterC3 = (await getRecruitmentById(id))!;
  await pg.query(`UPDATE recruitments SET updates = (SELECT coalesce(jsonb_agg(u), '[]'::jsonb) FROM jsonb_array_elements(updates) u WHERE u->>'id' <> 'x-race') WHERE id = $1`, [id]);
  check("C3 announcements changed meanwhile (the announcements path): refused, the job is NOT opened, nothing saved",
    /Nothing was saved/.test(c3Err) && afterC3.draftState === "PUBLISHED" && JSON.stringify(afterC3.examStages) === JSON.stringify(JSON.parse(live1).stages)
      && !afterC3.updates!.some((u) => u.title === "Online test call letters released") && (await importStatus(c3.importId)) === "PREVIEWED"
      && (await fingerprint(id)) === live1, c3Err);

  section(S.D);
  const d = await preview(id, FEES.replace("Rs. 750", "Rs. 800"));
  const publishers = process.env.CMS_PUBLISHERS;
  process.env.CMS_PUBLISHERS = "00000000-0000-4000-8000-000000000999";
  const dErr = await attempt(() => save(d.importId, offered(d.proposal)));
  process.env.CMS_PUBLISHERS = publishers;
  const refusals = await n("SELECT count(*) AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'PUBLICATION_REFUSED' AND metadata->>'action' = 'REVERT'", [id]);
  check("D1 a non-publisher's save into a live job is refused; the job stays live, the refusal is recorded",
    /saving opens it for editing/.test(dErr) && (await state(id)) === "PUBLISHED" && (await fingerprint(id)) === live1 && refusals >= 1 && (await importStatus(d.importId)) === "PREVIEWED", dErr);

  section(S.E);
  // Someone opens the job for editing between the save's read and its transaction.
  meanwhile("UPDATE recruitments SET draft_state = 'DRAFT' WHERE id = $1");
  const eErr = await attempt(() => save(d.importId, offered(d.proposal)));
  restore();
  const je = (await getRecruitmentById(id))!;
  check("E1 opened elsewhere during the save: refused, nothing saved",
    /live or open for editing changed while saving\. Nothing was saved/.test(eErr) && je.financial.feeTable?.value?.[0]?.amount === 750 && (await importStatus(d.importId)) === "PREVIEWED", eErr);
  const eSaved = await save(d.importId, offered(d.proposal));
  const je2 = (await getRecruitmentById(id))!;
  check("E2 saving again goes through (the job is already open)",
    !eSaved.openedForEditing && je2.draftState === "DRAFT" && je2.financial.feeTable?.value?.find((r) => r.category === "General/EWS/OBC")?.amount === 800, { eSaved, fees: je2.financial.feeTable?.value });
  rev = je2.recordRevision;

  section(S.F);
  const f = await preview(id, `${HEAD("Schedule", "6 Jan 2097")}Exam Stages:
Stage: Interview | Status: Scheduled | Date: 1 Mar 2097 | Tentative
`);
  if ((await ownerPublish()) !== 200) throw new Error("setup: publish before F failed");
  const liveF = await fingerprint(id);
  const fErr = await attempt(() => save(f.importId, ticked(f.proposal)));
  check("F1 published after a draft preview: refused with 'make a new preview', nothing saved, the job stays live and is not reopened",
    /published after this preview was made\. Nothing was saved\. Make a new preview/.test(fErr) && (await fingerprint(id)) === liveF && (await importStatus(f.importId)) === "PREVIEWED", fErr);
  const f2 = await preview(id, `${HEAD("Schedule", "6 Jan 2097")}Exam Stages:
Stage: Interview | Status: Scheduled | Date: 1 Mar 2097 | Tentative
`);
  const f2Saved = await save(f2.importId, ticked(f2.proposal));
  const jf = (await getRecruitmentById(id))!;
  check("F2 a new preview of the live job then saves, opening it in the same transaction",
    f2Saved.openedForEditing === true && jf.draftState === "DRAFT" && (jf.examStages ?? []).some((s) => s.name === "Interview"), { f2Saved, state: jf.draftState });
  rev = jf.recordRevision;

  section(S.H);
  const LINKS = (url: string) => [{ type: "OFFICIAL_WEBSITE", label: "Test bank", url, official: true }];
  const STAGE = (date: string) => `${HEAD("Schedule", "8 Jan 2097")}Exam Stages:
Stage: Interview | Status: Scheduled | Date: ${date} | Tentative
`;
  // H1: a draft; another editor changes a link after the preview.
  const h1 = await preview(id, STAGE("2 Mar 2097"));
  await patch("links", LINKS("https://bank.example.gov.in/careers"));
  const h1Before = await fingerprint(id);
  const h1Err = await attempt(() => save(h1.importId, ticked(h1.proposal)));
  check("H1 a link edited after a preview of a draft: refused, nothing saved",
    /links, exam stages or classification were changed after this preview/.test(h1Err) && (await fingerprint(id)) === h1Before && (await importStatus(h1.importId)) === "PREVIEWED", h1Err);
  // H2: live; after the preview the job is reopened, a link changed, and published again (content revision unchanged).
  if ((await ownerPublish()) !== 200) throw new Error("setup: publish before H2 failed");
  const h2 = await preview(id, STAGE("3 Mar 2097"));
  await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  rev = (await getRecruitmentById(id))!.recordRevision;
  await patch("links", LINKS("https://bank.example.gov.in/recruitment"));
  if ((await ownerPublish()) !== 200) throw new Error("setup: republish in H2 failed");
  const h2Before = await fingerprint(id);
  const h2Err = await attempt(() => save(h2.importId, ticked(h2.proposal)));
  check("H2 a live job reopened, its link changed and republished after a live preview: refused, the job stays live",
    /links, exam stages or classification were changed after this preview/.test(h2Err) && (await state(id)) === "PUBLISHED" && (await fingerprint(id)) === h2Before, h2Err);
  // H3: the change lands between the save's own checks and its transaction.
  const h3 = await preview(id, STAGE("4 Mar 2097"));
  const h3Before = await fingerprint(id);
  meanwhile(`UPDATE recruitments SET exam_stages = '[{"name":"Written","order":1,"status":"NOT_DECLARED","kind":"SELECTION"}]'::jsonb WHERE id = $1`);
  const h3Err = await attempt(() => save(h3.importId, ticked(h3.proposal)));
  restore();
  const h3After = (await getRecruitmentById(id))!;
  check("H3 exam stages changed during the save (inside the transaction): refused, nothing saved",
    /links, exam stages or classification were changed after this preview/.test(h3Err) && h3After.draftState === "PUBLISHED"
      && (h3After.examStages ?? []).some((s) => s.name === "Written") && !(h3After.examStages ?? []).some((s) => s.name === "Interview")
      && (await importStatus(h3.importId)) === "PREVIEWED" && JSON.parse(h3Before).revisions === JSON.parse(await fingerprint(id)).revisions, h3Err);
  // H4: a preview stored before the basis existed.
  const h4 = await preview(id, STAGE("5 Mar 2097"));
  // Stored previews cannot be changed (a trigger guards them); only here, on the throwaway database, is it lifted.
  await pg.exec("ALTER TABLE recruitment_imports DISABLE TRIGGER USER");
  await pg.query("UPDATE recruitment_imports SET proposal = proposal #- '{meta,basis}' WHERE import_id = $1", [h4.importId]);
  await pg.exec("ALTER TABLE recruitment_imports ENABLE TRIGGER USER");
  const h4Err = await attempt(() => save(h4.importId, ticked(h4.proposal)));
  check("H4 a preview stored without its basis (made before this check): refused, make a new preview",
    /made before the current checks\. Make a new preview/.test(h4Err) && (await state(id)) === "PUBLISHED", h4Err);
  const h5 = await preview(id, STAGE("6 Mar 2097"));
  const h5Saved = await save(h5.importId, ticked(h5.proposal));
  check("H5 an unchanged preview still saves", h5Saved.openedForEditing === true && (await state(id)) === "DRAFT", h5Saved);

  section(S.G);
  const g = await preview(id, `${HEAD("Correction", "7 Jan 2097", "TEST RECORD Some Other Recruitment 2097")}Application Fee: General Rs. 100\n`);
  check("G1 another job's title: the identity check still says it is not this job", g.proposal.lnUpdate?.header.identity !== "MATCH", g.proposal.lnUpdate?.header);
  await pg.query("UPDATE recruitments SET draft_state = 'ARCHIVED' WHERE id = $1", [id]);
  const gErr = await attempt(() => preview(id, FEES));
  check("G2 an archived job: no preview", /archived/.test(gErr), gErr);
  void revert;

  summary();
})().catch((e) => { console.error(e); process.exit(1); });
