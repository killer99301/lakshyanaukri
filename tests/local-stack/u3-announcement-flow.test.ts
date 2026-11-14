// ═══════════════════════════════════════════════════════════
// CMS 2.0 U3: an LN Update's announcement and supersessions through the real preview, apply and database
// functions on the in-memory test database, with the AI off (a fetch that counts any request). SYNTHETIC data only.
//   1. A significant announcement (admit card): stage, link and announcement saved in one reviewed save.
//   2. A correction with a supersession: the stage fixed quietly, the old announcement marked, kept word for word.
//   3. The same save twice, and the same text again: nothing is added twice.
//   4. Announcements only (a quiet supersession, no field change).
//   5. The announcements changed after the preview: refused, nothing saved.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/u3-announcement-flow.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type Item = { id: string; kind: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; flags: string[] };
type Proposal = { items: Item[]; warnings: string[] };

const TITLE = "TEST RECORD U3 Combined Exam 2097";
const ORG = "Test U3 Selection Board";
const HEAD = (type: string, date: string) => `LN Update v1
Job: ${TITLE}
Organisation: ${ORG}
Update type: ${type}
Source: Test notice, dated ${date}
Source link: https://u3.example.gov.in/notice-${date.replace(/ /g, "-")}.pdf
`;
const CREATE = `${HEAD("New recruitment", "1 Jan 2097")}
Exam Stages:
Stage: Tier-I | Status: Scheduled | Date: 10 Mar 2097 | Confirmed
Stage: Tier-II | Status: Not declared
`;
const ADMIT = `${HEAD("Admit card", "1 Mar 2097")}
Exam Stages:
Stage: Tier-I | Status: Admit card out | Date: 10 Mar 2097 | Confirmed

Important Links:
Admit Card: Tier-I admit card | https://u3.example.gov.in/admit

Announcement:
Title: Tier-I admit card released
Text: The Tier-I admit card is out. The exam is on 10 Mar 2097.
Action: Admit card
Stage: Tier-I
Relevant until: 10 Mar 2097
`;
const CORRECTION = `${HEAD("Correction", "2 Mar 2097")}
Exam Stages:
Stage: Tier-II | Status: Not declared | Note: No date announced yet.

Supersede:
20 Feb 2097 – Tier-II rescheduled | Reason: arose from an editing mistake, not an official notice
`;
const QUIET = `${HEAD("Correction", "3 Mar 2097")}
Supersede:
21 Feb 2097 – Old help-desk number | Reason: the board's notice of 3 Mar gives a different number
`;

const S = {
  A: "A: a significant announcement in the same review", B: "B: a correction with a supersession",
  C: "C: nothing twice", D: "D: announcements only", E: "E: announcements changed after the preview",
};
expectChecks(S.A, [
  "A1 the announcement is offered and ticked, beside the stage and link changes",
  "A2 saved: stage, link and announcement on the job; the old announcements untouched",
  "A3 the announcement holds its kind, stage, button and relevance window; the job's history records it",
  "A4 no AI request was made",
]);
expectChecks(S.B, [
  "B1 no new announcement is offered; the named announcement is offered for superseding",
  "B2 saved: the stage fixed, the old announcement marked and kept word for word, no announcement added",
]);
expectChecks(S.C, [
  "C1 the same save again: nothing added or marked twice",
  "C2 the same text again: the announcement and the supersession are 'Matches', nothing ticked",
]);
expectChecks(S.D, ["D1 a supersession alone is saved, with no field change", "D2 saved again: nothing changes"]);
expectChecks(S.E, ["E1 refused before anything is saved, with the reason"]);

(async () => {
  const { pg, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById, persistUpdateAppend } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  let calls = 0;
  const noAi = (async () => { calls++; throw new Error("no AI in this test"); }) as unknown as typeof fetch;
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: "would-be-used-if-the-ai-ran", fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const paste = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const existing = (id: string, text: string) => preview({ mode: "EXISTING", recruitmentId: id, sources: [paste(text)] });
  const apply = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const announcementsOf = (p: Proposal) => p.items.filter((i) => i.kind === "ANNOUNCEMENT");
  const changesOf = (p: Proposal) => p.items.filter((i) => i.action !== "MATCHES");

  // The job, made from an LN Update, then treated as one that has been public (set directly on the test database).
  const made = await preview({ mode: "NEW", newJob: { organizationId: "u3-test-board", organizationName: ORG, recruitmentYear: 2097, title: TITLE, govType: "Central Govt" }, sources: [paste(CREATE)] });
  const { recruitmentId: id } = await apply(made.importId, made.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id));
  await pg.query("UPDATE recruitments SET published_at = now() WHERE id = $1", [id]);
  const seed = async (date: string, title: string, description: string) =>
    persistUpdateAppend(id, { id: crypto.randomUUID(), date, type: "GENERAL_NOTICE", title, description }, adminId);
  await seed("2097-02-20", "Tier-II rescheduled", "Tier-II has moved to 1 May 2097.");
  await seed("2097-02-21", "Old help-desk number", "Call 000-0000 for help.");
  const start = (await getRecruitmentById(id))!;

  section(S.A);
  const a = await existing(id, ADMIT);
  const ann = announcementsOf(a.proposal);
  check("A1 the announcement is offered and ticked, beside the stage and link changes",
    ann.length === 1 && ann[0].defaultTicked && ann[0].fieldPath === "updates#new"
    && a.proposal.items.some((i) => i.fieldPath === "examStages") && a.proposal.items.some((i) => i.fieldPath === "links#ADMIT_CARD"),
    a.proposal.items.map((i) => [i.fieldPath, i.action, i.defaultTicked]));
  const savedA = await apply(a.importId, changesOf(a.proposal).map((i) => i.id)) as { recruitmentId: string; announcements?: { saved: boolean; done: string[]; error?: string } };
  const jA = (await getRecruitmentById(id))!;
  const newest = jA.updates!.at(-1)!;
  check("A2 saved: stage, link and announcement on the job; the old announcements untouched",
    savedA.announcements?.saved === true && jA.examStages?.[0].status === "ADMIT_CARD_OUT" && jA.links.some((l) => l.type === "ADMIT_CARD")
    && jA.updates!.length === start.updates!.length + 1 && JSON.stringify(jA.updates!.slice(0, -1)) === JSON.stringify(start.updates),
    { result: savedA, updates: jA.updates });
  const hist = await pg.query<{ reason: string }>("SELECT reason FROM field_revisions WHERE recruitment_id = $1 AND field_path = 'updates' ORDER BY revised_at DESC LIMIT 1", [id]);
  check("A3 the announcement holds its kind, stage, button and relevance window; the job's history records it",
    newest.title === "Tier-I admit card released" && newest.date === "2097-03-01" && newest.action === "ADMIT_CARD" && newest.relevantUntil === "2097-03-10"
    && newest.event?.kind === "ADMIT_CARD" && newest.event.stage === "Tier-I" && /^LN Update \(import [0-9a-f-]+\): added “Tier-I admit card released”/.test(hist.rows[0]?.reason ?? ""),
    { newest, hist: hist.rows });
  check("A4 no AI request was made", calls === 0, calls);

  section(S.B);
  const b = await existing(id, CORRECTION);
  const bAnn = announcementsOf(b.proposal);
  check("B1 no new announcement is offered; the named announcement is offered for superseding",
    bAnn.length === 1 && bAnn[0].fieldPath.startsWith("updates#supersede:") && bAnn[0].defaultTicked, { items: b.proposal.items.map((i) => [i.fieldPath, i.action, i.defaultTicked]), warnings: b.proposal.warnings });
  const beforeB = (await getRecruitmentById(id))!;
  const savedB = await apply(b.importId, changesOf(b.proposal).filter((i) => i.defaultTicked || i.fieldPath === "examStages").map((i) => i.id)) as { announcements?: { saved: boolean } };
  const jB = (await getRecruitmentById(id))!;
  const marked = jB.updates!.find((u) => u.title === "Tier-II rescheduled")!;
  check("B2 saved: the stage fixed, the old announcement marked and kept word for word, no announcement added",
    savedB.announcements?.saved === true && jB.updates!.length === beforeB.updates!.length
    && marked.description === "Tier-II has moved to 1 May 2097." && marked.superseded?.reason === "arose from an editing mistake, not an official notice"
    && marked.superseded.sourceUrl === "https://u3.example.gov.in/notice-2-Mar-2097.pdf" && jB.examStages?.[1].notes === "No date announced yet.",
    { updates: jB.updates, stages: jB.examStages });

  section(S.C);
  const replay = await apply(b.importId, changesOf(b.proposal).map((i) => i.id)) as { replayed: boolean };
  const jC = (await getRecruitmentById(id))!;
  check("C1 the same save again: nothing added or marked twice", replay.replayed === true && JSON.stringify(jC.updates) === JSON.stringify(jB.updates), replay);
  const again = await existing(id, ADMIT);
  const againB = await existing(id, CORRECTION);
  const aa = [...announcementsOf(again.proposal), ...announcementsOf(againB.proposal)];
  check("C2 the same text again: the announcement and the supersession are 'Matches', nothing ticked",
    aa.length === 2 && aa.every((i) => i.action === "MATCHES" && !i.defaultTicked), aa.map((i) => [i.fieldPath, i.action, i.defaultTicked, i.flags]));

  section(S.D);
  const d = await existing(id, QUIET);
  const dIds = changesOf(d.proposal).map((i) => i.id);
  const revBefore = (await getRecruitmentById(id))!.recordRevision;
  const savedD = await apply(d.importId, dIds) as { announcements?: { saved: boolean; done: string[] } };
  const jD = (await getRecruitmentById(id))!;
  check("D1 a supersession alone is saved, with no field change",
    dIds.length === 1 && savedD.announcements?.saved === true && !!jD.updates!.find((u) => u.title === "Old help-desk number")?.superseded && jD.recordRevision === revBefore,
    { savedD, items: d.proposal.items.map((i) => [i.fieldPath, i.action]) });
  const savedD2 = await apply(d.importId, dIds) as { announcements?: { saved: boolean; done: string[] } };
  const jD2 = (await getRecruitmentById(id))!;
  check("D2 saved again: nothing changes", savedD2.announcements?.saved === true && savedD2.announcements.done.length === 0 && JSON.stringify(jD2.updates) === JSON.stringify(jD.updates), savedD2);

  section(S.E);
  const e = await existing(id, ADMIT.replace(/Tier-I admit card released/g, "Tier-I admit card released again").replace("Status: Admit card out", "Status: Admit card out | Note: Download from the admit card link."));
  await seed("2097-03-04", "Meanwhile added by hand", "Another tab added this.");
  const beforeE = (await getRecruitmentById(id))!;
  let refused = "";
  try { await apply(e.importId, changesOf(e.proposal).map((i) => i.id)); } catch (err) { refused = err instanceof Error ? err.message : String(err); }
  const jE = (await getRecruitmentById(id))!;
  check("E1 refused before anything is saved, with the reason",
    /announcements changed after this preview/.test(refused) && JSON.stringify(jE.examStages) === JSON.stringify(beforeE.examStages) && jE.updates!.length === beforeE.updates!.length,
    { refused, items: e.proposal.items.map((i) => [i.fieldPath, i.action]) });

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
