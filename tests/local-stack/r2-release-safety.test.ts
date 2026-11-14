// ═══════════════════════════════════════════════════════════
// CMS 2.0 R2: release safety of the one-transaction save, through the real Neon HTTP driver against the in-memory
// test database (the driver's batch is one transaction there, as on Neon). SYNTHETIC data only. AI off.
//   A. The abort mechanism itself: a failed check rolls back the whole batch; a passing one never fires.
//   B. Uncertain outcomes: the reply lost after the database committed; the network failing before it did.
//   C. Two clicks at once.
//   D. Stored but not shown publicly: said in the import review.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/r2-release-safety.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type Item = { id: string; fieldPath: string; action: string; defaultTicked: boolean; flags: string[] };
type Proposal = { items: Item[] };

const TITLE = "TEST RECORD R2 Combined Exam 2097";
const ORG = "Test R2 Selection Board";
const HEAD = (type: string, date: string) => `LN Update v1\nJob: ${TITLE}\nOrganisation: ${ORG}\nUpdate type: ${type}\nSource: Test notice, dated ${date}\nSource link: https://r2.example.gov.in/n-${date.replace(/ /g, "-")}.pdf\n`;
const CREATE = `${HEAD("New recruitment", "1 Jan 2097")}\nExam Stages:\nStage: Tier-I | Status: Scheduled | Date: 10 Mar 2097 | Confirmed\nStage: Tier-II | Status: Not declared\n\nImportant Links:\nApply Online: Main portal | https://r2.example.gov.in/apply | For: Graduate posts\n`;
const upd = (n: number) => `${HEAD("Admit card", `${n} Mar 2097`)}\nExam Stages:\nStage: Tier-II | Status: Scheduled | Date: ${n + 10} Apr 2097 | Confirmed\n\nAnnouncement:\nTitle: Tier-II date ${n}\nText: Tier-II is on ${n + 10} Apr 2097.\n`;

const S = { A: "A: the abort mechanism", B: "B: uncertain outcomes", C: "C: two clicks at once", D: "D: stored but not shown publicly" };
expectChecks(S.A, ["A1 a failed check rolls back every statement before it in the batch", "A2 a passing check never fires (20 runs, with bound parameters)"]);
expectChecks(S.B, [
  "B1 the reply is lost after the commit: the owner is told it saved, and nothing is written twice",
  "B2 saving again after that: nothing added, no second revision or audit event",
  "B3 the network fails before the commit: an error, nothing saved, and saving again then works once",
  "B4 an announcements-only save whose reply is lost: told it saved, nothing written twice",
]);
expectChecks(S.C, ["C1 two clicks at once: both answer 'saved', one save only"]);
expectChecks(S.D, ["D1 stored-but-not-shown is said only for what the page really leaves out (since U5: an aggregator portal, not the fee table or a second portal)", "D2 fee rows that give the same candidates two fees: under Needs attention, not ticked, both rows named", "D3 a general fee with stated exceptions (SC/ST/Female): offered without a 'needs attention' flag, the exception kept"]);

(async () => {
  const { pg, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById, persistUpdateAppend } = await import("@/lib/cms/repository");
  const db = await import("@/lib/db");
  await setImporterEnabled(true);
  const noAi = (async () => { throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: "unused", fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const paste = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const existing = (id: string, text: string) => preview({ mode: "EXISTING", recruitmentId: id, sources: [paste(text)] });
  const apply = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const offered = (p: Proposal) => p.items.filter((i) => i.action !== "MATCHES").map((i) => i.id);
  const n = async (q: string, args: unknown[]) => Number((await pg.query<{ n: string }>(q, args)).rows[0].n);
  const tx = db.sql as unknown as { transaction: (q: unknown) => Promise<unknown> };
  const original = tx.transaction.bind(db.sql);

  const made = await preview({ mode: "NEW", newJob: { organizationId: "r2-test-board", organizationName: ORG, recruitmentYear: 2097, title: TITLE, govType: "Central Govt" }, sources: [paste(CREATE)] });
  const { recruitmentId: id } = await apply(made.importId, made.proposal.items.map((i) => i.id));
  await persistUpdateAppend(id, { id: crypto.randomUUID(), date: "2097-02-21", type: "GENERAL_NOTICE", title: "Old help-desk number", description: "Call 000." }, adminId);

  section(S.A);
  const titleBefore = (await pg.query<{ t: string }>("SELECT title_text AS t FROM recruitments WHERE id = $1", [id])).rows[0].t;
  let aborted = "";
  try {
    await db.sql.transaction([
      db.sql`UPDATE recruitments SET title_text = 'SHOULD ROLL BACK' WHERE id = ${id}::uuid`,
      db.sql`WITH u AS (UPDATE recruitments SET updated_at = now() WHERE id = ${id}::uuid AND draft_state = 'NO SUCH STATE' RETURNING id)
             SELECT CASE WHEN (SELECT count(*) FROM u) = 1 THEN 'ok' ELSE ('ANNOUNCEMENTS_STALE ' || (SELECT count(*) FROM u))::int::text END AS ok`,
    ]);
  } catch (e) { aborted = e instanceof Error ? e.message : String(e); }
  const titleAfter = (await pg.query<{ t: string }>("SELECT title_text AS t FROM recruitments WHERE id = $1", [id])).rows[0].t;
  check("A1 a failed check rolls back every statement before it in the batch", /ANNOUNCEMENTS_STALE 0/.test(aborted) && titleAfter === titleBefore, { aborted, titleAfter });
  let fired = 0;
  for (let k = 0; k < 20; k++) {
    try {
      await db.sql.transaction([db.sql`WITH u AS (UPDATE recruitments SET updated_at = now() WHERE id = ${id}::uuid AND draft_state IN (${"DRAFT"}, ${"APPROVED"}) RETURNING id)
        SELECT CASE WHEN (SELECT count(*) FROM u) = 1 THEN 'ok' ELSE ('ANNOUNCEMENTS_STALE ' || (SELECT count(*) FROM u))::int::text END AS ok`]);
    } catch { fired++; }
  }
  check("A2 a passing check never fires (20 runs, with bound parameters)", fired === 0, fired);

  section(S.B);
  const counts = async (importId: string) => ({
    updates: ((await getRecruitmentById(id))!.updates ?? []).length,
    revs: await n("SELECT count(*) AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates' AND reason LIKE $2", [id, `%${importId}%`]),
    events: await n("SELECT count(*) AS n FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'IMPORT_ANNOUNCEMENTS' AND metadata->>'importId' = $2", [id, importId]),
  });
  const b = await existing(id, upd(1));
  const before = await counts(b.importId);
  tx.transaction = async (q: unknown) => { await original(q); throw new TypeError("fetch failed"); };
  const lost = await apply(b.importId, offered(b.proposal)) as { replayed: boolean; recovered?: boolean; announcements?: { saved: boolean } };
  tx.transaction = original;
  const afterLost = await counts(b.importId);
  check("B1 the reply is lost after the commit: the owner is told it saved, and nothing is written twice",
    lost.recovered === true && lost.announcements?.saved === true && afterLost.updates === before.updates + 1 && afterLost.revs === 1 && afterLost.events === 1, { lost, before, afterLost });
  const again = await apply(b.importId, offered(b.proposal)) as { replayed: boolean };
  const afterAgain = await counts(b.importId);
  check("B2 saving again after that: nothing added, no second revision or audit event", again.replayed && JSON.stringify(afterAgain) === JSON.stringify(afterLost), afterAgain);

  const c = await existing(id, upd(2));
  const cBefore = await counts(c.importId);
  const revBefore = (await getRecruitmentById(id))!.recordRevision;
  tx.transaction = async () => { throw new TypeError("fetch failed"); };
  let failed = "";
  try { await apply(c.importId, offered(c.proposal)); } catch (e) { failed = e instanceof Error ? e.message : String(e); }
  tx.transaction = original;
  const cMid = await counts(c.importId);
  const unchanged = (await getRecruitmentById(id))!.recordRevision === revBefore;
  const retry = await apply(c.importId, offered(c.proposal)) as { replayed: boolean; announcements?: { saved: boolean } };
  const cAfter = await counts(c.importId);
  check("B3 the network fails before the commit: an error, nothing saved, and saving again then works once",
    /Nothing was saved/.test(failed) && JSON.stringify(cMid) === JSON.stringify(cBefore) && unchanged
    && retry.replayed === false && retry.announcements?.saved === true && cAfter.updates === cBefore.updates + 1 && cAfter.revs === 1, { failed, cMid, cAfter });

  const d = await existing(id, `${HEAD("Correction", "3 Mar 2097")}\nSupersede:\n21 Feb 2097 – Old help-desk number | Reason: the board's later notice gives a different number\n`);
  const dBefore = await counts(d.importId);
  tx.transaction = async (q: unknown) => { await original(q); throw new TypeError("fetch failed"); };
  const dLost = await apply(d.importId, offered(d.proposal)) as { recovered?: boolean };
  tx.transaction = original;
  const dAgain = await apply(d.importId, offered(d.proposal)) as { replayed: boolean };
  const dAfter = await counts(d.importId);
  check("B4 an announcements-only save whose reply is lost: told it saved, nothing written twice",
    dLost.recovered === true && dAgain.replayed && dAfter.revs === 1 && dAfter.events === 1 && dAfter.updates === dBefore.updates
    && !!(await getRecruitmentById(id))!.updates!.find((u) => u.title === "Old help-desk number")?.superseded, { dLost, dAfter });

  section(S.C);
  const e = await existing(id, upd(3));
  const eBefore = await counts(e.importId);
  const both = await Promise.all([apply(e.importId, offered(e.proposal)), apply(e.importId, offered(e.proposal))]) as Array<{ replayed: boolean }>;
  const eAfter = await counts(e.importId);
  check("C1 two clicks at once: both answer 'saved', one save only",
    both.filter((r) => !r.replayed).length === 1 && eAfter.updates === eBefore.updates + 1 && eAfter.revs === 1 && eAfter.events === 1, { both, eAfter });

  section(S.D);
  const f = await existing(id, `${HEAD("Corrigendum", "4 Mar 2097")}\nApplication Fee: General/EWS/OBC Rs. 500, SC/ST/PwBD Nil, Women Exempted\n\nImportant Links:\nApply Online: ITI portal | https://iti.r2.example.gov.in/apply | For: ITI trade apprentices\n`);
  const fee = f.proposal.items.find((i) => i.fieldPath === "financial.feeTable");
  const portal = f.proposal.items.find((i) => i.fieldPath === "links#APPLY_ONLINE");
  // Since U5 the page shows the fee table and every portal, so neither is flagged; an aggregator "portal" still is.
  const g = await existing(id, `${HEAD("Corrigendum", "5 Mar 2097")}\nImportant Links:\nApply Online: Portal list | https://www.sarkariresult.com/r2-test | For: everyone\n`);
  const agg = g.proposal.items.find((i) => i.fieldPath === "links#APPLY_ONLINE");
  check("D1 stored-but-not-shown is said only for what the page really leaves out (since U5: an aggregator portal, not the fee table or a second portal)",
    !!fee && !fee.flags.some((x) => /not shown on the public page/.test(x)) && !!portal && !portal.flags.some((x) => /not shown on the public page/.test(x))
    && !!agg?.flags.some((x) => /saved, but not shown on the public page as an Apply portal/.test(x)),
    { fee: fee?.flags, portal: portal?.flags, agg: agg?.flags });
  // U5: a fee for all posts and a different one for a post, for the same candidates: held for the owner, not guessed.
  const h = await existing(id, `${HEAD("Corrigendum", "6 Mar 2097")}\nApplication Fee: General/EWS/OBC Rs. 750, SC/ST/PwBD Nil\nApplication Fee (Trade Apprentice): General Rs. 500\n`);
  const overlap = h.proposal.items.find((i) => i.fieldPath === "financial.feeTable") as (Item & { attention?: boolean }) | undefined;
  check("D2 fee rows that give the same candidates two fees: under Needs attention, not ticked, both rows named",
    !!overlap && overlap.attention === true && !overlap.defaultTicked && overlap.flags.some((x) => /needs attention: the rows give the same candidates more than one fee/.test(x) && x.includes("₹750") && x.includes("₹500")),
    overlap?.flags);
  // U5 correction: a general fee with exceptions the notice states is ordinary wording, never flagged.
  const k = await existing(id, `${HEAD("Corrigendum", "7 Mar 2097")}\nApplication Fee: All candidates Rs. 500, except SC/ST/Female Rs. 250\n`);
  const stated = k.proposal.items.find((i) => i.fieldPath === "financial.feeTable") as (Item & { attention?: boolean; value?: unknown }) | undefined;
  check("D3 a general fee with stated exceptions (SC/ST/Female): offered without a 'needs attention' flag, the exception kept",
    !!stated && stated.attention !== true && !stated.flags.some((x) => /more than one fee/.test(x))
    && JSON.stringify(stated.value).includes('"residual":true'),
    { flags: stated?.flags, value: stated?.value });

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
