// ═══════════════════════════════════════════════════════════
// CMS 2.0 R1: one LN Update → one grouped review → ONE save (fields and announcements in one transaction), through
// the real preview, apply and database functions on the in-memory test database. AI off. SYNTHETIC data only.
//   A. A combined update: stages, pattern, syllabus, posts, fees, two portals, an announcement and a supersession.
//   B. Several stages change with no Announcement block: the automatic one is never ticked for you.
//   C. Announcements only: recorded as applied; a repeat adds nothing.
//   D. Failures: a change arriving during the save, and a job changed after the preview. Nothing is half-saved.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/r1-unified-update.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type Change = { kind: string; element: string; detail: string };
type Item = { id: string; kind: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[]; changes?: Change[]; attention?: boolean };
type Proposal = { items: Item[]; warnings: string[]; lnUpdate?: { notRead: string[]; attention: string[]; kept: string[]; header: { identity: string } } };

const TITLE = "TEST RECORD R1 Combined Exam 2097";
const ORG = "Test R1 Selection Board";
const HEAD = (type: string, date: string) => `LN Update v1\nJob: ${TITLE}\nOrganisation: ${ORG}\nUpdate type: ${type}\nSource: Test notice, dated ${date}\nSource link: https://r1.example.gov.in/n-${date.replace(/ /g, "-")}.pdf\n`;
const CREATE = `${HEAD("New recruitment", "1 Jan 2097")}
Exam Stages:
Stage: Tier-I | Status: Scheduled | Date: 10 Mar 2097 | Confirmed
Stage: Tier-II | Status: Not declared
Stage: Document Verification | Status: Not declared

Exam Pattern:
Stage: Tier-I | Mode: Computer Based | Duration: 60 minutes
Subject: English: 25 Questions, 50 Marks
Subject: Reasoning: 25 Questions, 50 Marks
Total: 50 Questions, 100 Marks

Syllabus:
Stage: Tier-I
Subject: English: Grammar; Vocabulary
Subject: Reasoning: Analogy; Series

Application Fee: General/EWS/OBC Rs. 500, SC/ST/PwBD Nil

Important Links:
Apply Online: Main portal | https://r1.example.gov.in/apply | For: Graduate posts
`;
const COMBINED = `${HEAD("Admit card", "1 Mar 2097")}
Exam Stages:
Stage: Tier-I | Status: Admit card out | Date: 10 Mar 2097 | Confirmed

Exam Pattern:
Stage: Tier-II | Paper: Paper I | Mode: Computer Based | Duration: 120 minutes
Subject: Mathematics: 30 Questions, 90 Marks
Total: 30 Questions, 90 Marks

Syllabus:
Stage: Tier-I
Subject: Reasoning: Coding-decoding

Application Fee: General/EWS/OBC Rs. 500, SC/ST/PwBD Nil, Women Exempted

Important Links:
Apply Online: Statistics portal | https://stats.r1.example.gov.in/apply | For: Statistical posts
Admit Card: Tier-I admit card | https://r1.example.gov.in/admit

Announcement:
Title: Tier-I admit card released
Text: The Tier-I admit card is out. The exam is on 10 Mar 2097.
Action: Admit card
Stage: Tier-I

Supersede:
20 Feb 2097 – Tier-I moved to 30 Mar | Reason: the board kept 10 Mar; the earlier note was a mistake
`;
const SEVERAL = `${HEAD("Schedule", "5 Mar 2097")}
Exam Stages:
Stage: Tier-II | Status: Scheduled | Date: 5 May 2097 | Tentative
Stage: Document Verification | Status: Scheduled | Date: 1 Jun 2097 | Tentative
`;
const ONLY_SUPERSEDE = `${HEAD("Correction", "6 Mar 2097")}
Supersede:
21 Feb 2097 – Old help-desk number | Reason: the board's later notice gives a different number
`;

const S = { A: "A: a combined update in one save", B: "B: several stages change", C: "C: announcements only", D: "D: failures save nothing" };
expectChecks(S.A, [
  "A1 one review: stages, pattern, syllabus, fees, both links, the announcement and the supersession, each with its changes",
  "A2 the review says what the text left out (kept as it is) and checks the job",
  "A3 saved in one go: every ticked item on the job, Tier-I's pattern and syllabus kept, two portals with who each is for",
  "A4 one import applied, one announcement revision, one audit event naming the announcement items",
  "A5 no AI request",
]);
expectChecks(S.B, ["B1 the automatic announcement is offered unticked, under Needs attention, naming every stage"]);
expectChecks(S.C, ["C1 a supersession alone: the import is recorded as applied, with the item", "C2 the same save again: nothing added or marked twice"]);
expectChecks(S.D, [
  "D1 another change arrives during the save: refused, and the fields are NOT saved either",
  "D2 the job changed after the preview (another field edit): refused, the announcements are not saved either",
]);

(async () => {
  const { pg, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById, persistUpdateAppend } = await import("@/lib/cms/repository");
  const db = await import("@/lib/db");
  await setImporterEnabled(true);
  let calls = 0;
  const noAi = (async () => { calls++; throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: "unused", fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const paste = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const existing = (id: string, text: string) => preview({ mode: "EXISTING", recruitmentId: id, sources: [paste(text)] });
  const apply = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const offered = (p: Proposal) => p.items.filter((i) => i.action !== "MATCHES");
  const status = async (importId: string) => (await pg.query<{ status: string; selected_items: string[] | null }>("SELECT status, selected_items FROM recruitment_imports WHERE import_id = $1", [importId])).rows[0];
  const count = async (q: string, args: unknown[]) => Number((await pg.query<{ n: string }>(q, args)).rows[0].n);

  const made = await preview({ mode: "NEW", newJob: { organizationId: "r1-test-board", organizationName: ORG, recruitmentYear: 2097, title: TITLE, govType: "Central Govt" }, sources: [paste(CREATE)] });
  const { recruitmentId: id } = await apply(made.importId, made.proposal.items.filter((i) => i.defaultTicked || i.fieldPath.startsWith("links#")).map((i) => i.id));
  await pg.query("UPDATE recruitments SET published_at = now() WHERE id = $1", [id]);
  const seed = (date: string, title: string, description: string) => persistUpdateAppend(id, { id: crypto.randomUUID(), date, type: "GENERAL_NOTICE", title, description }, adminId);
  await seed("2097-02-20", "Tier-I moved to 30 Mar", "Tier-I has moved to 30 Mar 2097.");
  await seed("2097-02-21", "Old help-desk number", "Call 000-0000.");

  section(S.A);
  const a = await existing(id, COMBINED);
  const at = (f: string) => a.proposal.items.filter((i) => i.fieldPath === f);
  const want = ["examStages", "examPattern", "syllabus", "financial.feeTable", "links#APPLY_ONLINE", "links#ADMIT_CARD", "updates#new"];
  check("A1 one review: stages, pattern, syllabus, fees, both links, the announcement and the supersession, each with its changes",
    want.every((f) => at(f).length === 1) && a.proposal.items.some((i) => i.fieldPath.startsWith("updates#supersede:"))
    && ["examStages", "examPattern", "syllabus"].every((f) => (at(f)[0].changes ?? []).length > 0),
    a.proposal.items.map((i) => [i.fieldPath, i.action, i.defaultTicked, i.changes?.length ?? 0]));
  const ln = a.proposal.lnUpdate;
  check("A2 the review says what the text left out (kept as it is) and checks the job",
    !!ln && ln.header.identity === "MATCH" && ["Eligibility", "Vacancies", "Selection process"].every((k) => ln.kept.includes(k)) && !ln.kept.includes("Syllabus"), ln);
  const before = (await getRecruitmentById(id))!;
  const saved = await apply(a.importId, offered(a.proposal).map((i) => i.id)) as { recruitmentId: string; announcements?: { saved: boolean; done: string[] } };
  const j = (await getRecruitmentById(id))!;
  const tier1Pattern = j.examPattern?.value?.find((p) => /Tier-I\b/.test(p.name) && !/Tier-II/.test(p.name));
  const reasoning = j.syllabus?.value?.find((s) => s.subject === "Reasoning");
  check("A3 saved in one go: every ticked item on the job, Tier-I's pattern and syllabus kept, two portals with who each is for",
    saved.announcements?.saved === true && j.examStages?.[0].status === "ADMIT_CARD_OUT"
    && j.examPattern?.value?.length === 2 && tier1Pattern?.sections.length === 2
    && JSON.stringify(reasoning?.topics) === JSON.stringify(["Analogy", "Series", "Coding-decoding"]) && j.syllabus?.value?.find((s) => s.subject === "English")?.topics.length === 2
    && j.financial.feeTable?.value?.length === 3
    && j.links.filter((l) => l.type === "APPLY_ONLINE").map((l) => l.appliesTo).join("|") === "Graduate posts|Statistical posts"
    && j.updates!.length === before.updates!.length + 1 && !!j.updates!.find((u) => u.title === "Tier-I moved to 30 Mar")?.superseded,
    { saved, pattern: j.examPattern?.value, syl: j.syllabus?.value, fees: j.financial.feeTable?.value, links: j.links, updates: j.updates });
  const st = await status(a.importId);
  const revs = await count("SELECT count(*) AS n FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates' AND reason LIKE $2", [id, `%${a.importId}%`]);
  const ev = (await pg.query<{ metadata: { items: string[] } }>("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'IMPORT_ANNOUNCEMENTS' AND metadata->>'importId' = $2", [id, a.importId])).rows;
  check("A4 one import applied, one announcement revision, one audit event naming the announcement items",
    st.status === "APPLIED" && revs === 1 && ev.length === 1 && ev[0].metadata.items.length === 2, { st, revs, ev });
  check("A5 no AI request", calls === 0, calls);

  section(S.B);
  const b = await existing(id, SEVERAL);
  const auto = b.proposal.items.find((i) => i.fieldPath === "updates#new");
  check("B1 the automatic announcement is offered unticked, under Needs attention, naming every stage",
    !!auto && !auto.defaultTicked && auto.attention === true && auto.flags.some((f) => /needs attention: 2 stages change/.test(f) && f.includes("Document Verification")), auto);

  section(S.C);
  const c = await existing(id, ONLY_SUPERSEDE);
  const cIds = offered(c.proposal).map((i) => i.id);
  const revBefore = (await getRecruitmentById(id))!.recordRevision;
  await apply(c.importId, cIds);
  const cst = await status(c.importId);
  const jc = (await getRecruitmentById(id))!;
  check("C1 a supersession alone: the import is recorded as applied, with the item",
    cIds.length === 1 && cst.status === "APPLIED" && JSON.stringify(cst.selected_items) === JSON.stringify(cIds)
    && !!jc.updates!.find((u) => u.title === "Old help-desk number")?.superseded && jc.recordRevision === revBefore, { cst, cIds });
  const again = await apply(c.importId, cIds) as { replayed: boolean; announcements?: { saved: boolean } };
  const jc2 = (await getRecruitmentById(id))!;
  check("C2 the same save again: nothing added or marked twice", again.replayed && again.announcements?.saved === true && JSON.stringify(jc2.updates) === JSON.stringify(jc.updates), again);

  section(S.D);
  // D1: another announcement is added to the job between the save's checks and its transaction.
  const d = await existing(id, `${HEAD("Admit card", "8 Mar 2097")}\nExam Stages:\nStage: Tier-II | Status: Admit card out | Date: 5 May 2097 | Confirmed\n\nAnnouncement:\nTitle: Tier-II admit card released\nText: Out now.\n`);
  const dBefore = (await getRecruitmentById(id))!;
  const original = db.sql.transaction.bind(db.sql);
  (db.sql as unknown as { transaction: unknown }).transaction = async (qs: unknown) => {
    await pg.query(`UPDATE recruitments SET updates = updates || '[{"id":"x-race","date":"2097-03-08","type":"GENERAL_NOTICE","title":"Added meanwhile","description":"Another tab."}]'::jsonb WHERE id = $1`, [id]);
    return (original as (q: unknown) => unknown)(qs);
  };
  let refused = "";
  try { await apply(d.importId, offered(d.proposal).map((i) => i.id)); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
  (db.sql as unknown as { transaction: unknown }).transaction = original;
  const jd = (await getRecruitmentById(id))!;
  check("D1 another change arrives during the save: refused, and the fields are NOT saved either",
    /Nothing was saved/.test(refused) && JSON.stringify(jd.examStages) === JSON.stringify(dBefore.examStages) && jd.recordRevision === dBefore.recordRevision
    && (await status(d.importId)).status === "PREVIEWED" && !jd.updates!.some((u) => u.title === "Tier-II admit card released"),
    { refused, stages: jd.examStages });
  // D2: the job's fields change after the preview (another tab saves a field).
  const e = await existing(id, `${HEAD("Admit card", "9 Mar 2097")}\nExam Stages:\nStage: Tier-II | Status: Admit card out | Date: 6 May 2097 | Confirmed\n\nAnnouncement:\nTitle: Tier-II admit card out\nText: Out.\n`);
  await pg.query("UPDATE recruitments SET record_revision = 'changed-elsewhere' WHERE id = $1", [id]);
  const eBefore = (await getRecruitmentById(id))!;
  let refusedE = "";
  try { await apply(e.importId, offered(e.proposal).map((i) => i.id)); } catch (err) { refusedE = err instanceof Error ? err.message : String(err); }
  const je = (await getRecruitmentById(id))!;
  check("D2 the job changed after the preview (another field edit): refused, the announcements are not saved either",
    /changed after this preview/.test(refusedE) && JSON.stringify(je.updates) === JSON.stringify(eBefore.updates) && (await status(e.importId)).status === "PREVIEWED", refusedE);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
