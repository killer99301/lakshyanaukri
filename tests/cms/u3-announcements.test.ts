// CMS 2.0 step U3: an LN Update's announcement and supersessions offered in the Smart Intake review, and saved
// through the existing announcement rules. Everything here is SYNTHETIC (the repository is public): invented
// organisations, titles, dates and addresses. Nothing is saved: items and the new announcement list are built in
// memory only.
//   npx tsx --tsconfig tsconfig.json tests/cms/u3-announcements.test.ts
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import type { ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import type { ExamStage, UpdateRecord } from "@/types";
import { readUpdateText, type JobIdentity } from "@/lib/cms/importer/update-format";
import { mergeUpdate } from "@/lib/cms/importer/update-merge";
import { announcementWrite, proposeAnnouncements, type AddAnnouncement, type AnnouncementValue, type SupersedeAnnouncement } from "@/lib/cms/importer/update-announcements";
import { toPublicUpdates, currentUpdates } from "@/lib/cms/announcements";

const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const ADMIN = "00000000-0000-4000-8000-00000000a0a0";
const TODAY = "2097-02-20";

const OLD: UpdateRecord[] = [
  { id: "u-1", date: "2097-01-12", type: "EXAM_NOTICE", title: "Tier-I exam date announced", description: "Tier-I is set for 10 Mar 2097." },
  { id: "u-2", date: "2097-01-24", type: "RESCHEDULE", title: "Tier-I rescheduled", description: "Tier-I has moved to 30 Mar 2097." },
  { id: "u-3", date: "2097-01-24", type: "GENERAL_NOTICE", title: "Correction window opened", description: "Applicants may correct their forms." },
];

function job(over: Partial<RecruitmentRecord> = {}): RecruitmentRecord {
  const stages: ExamStage[] = [
    { name: "Tier-I", order: 1, status: "SCHEDULED", kind: "SELECTION", dateIso: "2097-03-10", certainty: "CONFIRMED" },
    { name: "Tier-II", order: 2, status: "NOT_DECLARED", kind: "SELECTION" },
  ];
  return {
    id: "00000000-0000-4000-8000-0000000000u3", slug: "test-u3-exam-2097", draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: "tub", organizationName: "Test U3 Board", recruitmentYear: 2097, title: pf("TEST U3 Combined Exam 2097") },
    dates: {}, vacancies: {}, financial: {}, examStages: stages,
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] }, provenance: { status: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    links: [{ type: "APPLY_ONLINE", label: "Apply", url: "https://tub.example.gov.in/apply", official: true }],
    documents: [], updates: OLD.map((u) => ({ ...u })), publishedAt: "2097-01-05T00:00:00Z",
    createdAt: "2097-01-01T00:00:00Z", updatedAt: "2097-01-30T00:00:00Z",
    ...over,
  } as RecruitmentRecord;
}
const identity = (r: RecruitmentRecord): JobIdentity => ({ title: r.identity.title.value!, organizationName: r.identity.organizationName, organizationId: r.identity.organizationId });
const head = (type = "Admit card") => `LN Update v1\nJob: TEST U3 Combined Exam 2097\nOrganisation: Test U3 Board\nUpdate type: ${type}\nSource: Test notice, dated 18 Feb 2097\nSource link: https://tub.example.gov.in/notice-18feb.pdf\n\n`;
const RID = "22222222-2222-4222-8222-222222222222";

function propose(body: string, r: RecruitmentRecord | null = job(), type?: string) {
  const reading = readUpdateText(head(type) + body, { job: r ? identity(r) : undefined });
  const merge = mergeUpdate({ record: r, reading, organizationId: "tub" });
  const stages = merge.values.find((v) => v.fieldPath === "examStages")?.value as ExamStage[] | undefined;
  return proposeAnnouncements({ record: r, reading, retrievalId: RID, stages, today: TODAY, offeredLinks: merge.links });
}
const adds = (p: ReturnType<typeof propose>) => p.items.filter((i) => (i.value as AnnouncementValue).op === "ADD");
const sups = (p: ReturnType<typeof propose>) => p.items.filter((i) => (i.value as AnnouncementValue).op === "SUPERSEDE");
const write = (before: UpdateRecord[], items: ReturnType<typeof propose>["items"], stagesTicked = true) =>
  announcementWrite(before, items.map((i) => i.value as AnnouncementValue), { adminId: ADMIN, today: TODAY, stagesTicked });

const ADMIT = `Exam Stages:
Stage: Tier-II | Status: Admit card out | Date: 5 Mar 2097 | Confirmed

Important Links:
Admit Card: Tier-II admit card | https://tub.example.gov.in/admit

Announcement:
Title: Tier-II admit card released
Text: The Tier-II admit card is out. The exam is on 5 Mar 2097.
Action: Admit card
Stage: Tier-II
Relevant until: 5 Mar 2097
`;

suite("U3: a significant announcement");

test("N01 one announcement is offered, ticked, with its kind, stage, button and relevance window, all from the text", () => {
  const p = propose(ADMIT);
  assert.equal(adds(p).length, 1);
  const item = adds(p)[0];
  const e = (item.value as AddAnnouncement).entry;
  assert.equal(item.kind, "ANNOUNCEMENT");
  assert.equal(item.defaultTicked, true);
  assert.equal(e.date, "2097-02-18", "the notice's date, from the Source line");
  assert.equal(e.title, "Tier-II admit card released");
  assert.equal(e.type, "EXAM_NOTICE");
  assert.deepEqual(e.event, { kind: "ADMIT_CARD", stage: "Tier-II" });
  assert.equal(e.action, "ADMIT_CARD");
  assert.equal(e.relevantUntil, "2097-03-05");
  assert.equal(e.sourceUrl, "https://tub.example.gov.in/notice-18feb.pdf");
  assert.ok(!item.flags.some((f) => /does not have yet/.test(f)), "the admit-card link is offered in the same update");
  assert.equal(item.claims[0].quote, "Title: Tier-II admit card released");
});

test("N02 the button names a link type the job does not have: said, never an invented address", () => {
  const p = propose(ADMIT.replace(/Important Links:\nAdmit Card: [^\n]+\n/, ""));
  const item = adds(p)[0];
  assert.ok(item.flags.some((f) => /admit card link, which the job does not have yet/.test(f)), item.flags);
  assert.ok(!JSON.stringify(item.value).includes("/admit"));
});

test("N03 no 'relevant until' without the text saying it; one before the notice's date is left out", () => {
  const none = adds(propose(ADMIT.replace("Relevant until: 5 Mar 2097\n", "")))[0];
  assert.equal((none.value as AddAnnouncement).entry.relevantUntil, undefined);
  const early = adds(propose(ADMIT.replace("Relevant until: 5 Mar 2097", "Relevant until: 1 Feb 2097")))[0];
  assert.equal((early.value as AddAnnouncement).entry.relevantUntil, undefined);
  assert.ok(early.flags.some((f) => /before the notice's date/.test(f)));
});

test("N04 an announcement with no Text, or with no date anywhere, is not offered; the reason is said", () => {
  const noText = propose("Announcement:\nTitle: Tier-II admit card released\n");
  assert.equal(adds(noText).length, 0);
  assert.ok(noText.warnings.some((w) => /no “Text:” line/.test(w)));
  const reading = readUpdateText(head().replace("Source: Test notice, dated 18 Feb 2097\n", "Source: Test notice\n") + "Announcement:\nTitle: Admit card out\nText: Out now.\n", { job: identity(job()) });
  const p = proposeAnnouncements({ record: job(), reading, retrievalId: RID, today: TODAY });
  assert.equal(p.items.length, 0);
  assert.ok(p.warnings.some((w) => /no date is guessed/.test(w)));
});

test("N05 the saved list: the old announcements word for word, the new one at the end", () => {
  const r = job();
  const p = propose(ADMIT, r);
  const w = write(r.updates!, adds(p));
  assert.ok(w.ok);
  if (!w.ok) return;
  assert.equal(w.write.after.length, 4);
  assert.deepEqual(w.write.after.slice(0, 3), OLD);
  assert.equal(w.write.after[3].title, "Tier-II admit card released");
});

suite("U3: quiet corrections, the automatic stage announcement, and duplicates");

test("N06 a correction: GPT's announcement is offered unticked, with the reason", () => {
  const p = propose("Announcement:\nTitle: Tier-I date fixed\nText: Our page showed the wrong date.\n", job(), "Correction");
  assert.equal(adds(p).length, 1);
  assert.equal(adds(p)[0].defaultTicked, false);
  assert.ok(adds(p)[0].flags.some((f) => /saved quietly/.test(f)));
});

test("N07 a correction of a public job's stages: no announcement at all, and that is said", () => {
  const p = propose("Exam Stages:\nStage: Tier-I | Status: Scheduled | Date: 12 Mar 2097 | Confirmed\n", job(), "Correction");
  assert.equal(p.items.length, 0);
  assert.ok(p.warnings.some((w) => /saved quietly, with no announcement/.test(w)));
});

test("N08 no Announcement block, a public job's stage changes: the stage editor's own announcement is offered (never both)", () => {
  const p = propose("Exam Stages:\nStage: Tier-I | Status: Scheduled | Date: 30 Mar 2097 | Confirmed\n", job(), "Schedule");
  assert.equal(adds(p).length, 1);
  const v = adds(p)[0].value as AddAnnouncement;
  assert.equal(v.origin, "STAGES");
  assert.equal(v.entry.title, "Tier-I rescheduled");
  assert.equal(v.entry.date, "2097-02-18");
  // With an Announcement block, only GPT's is offered.
  const both = propose("Exam Stages:\nStage: Tier-I | Status: Scheduled | Date: 30 Mar 2097 | Confirmed\n\nAnnouncement:\nTitle: Tier-I moved\nText: Tier-I is now on 30 Mar 2097.\n", job(), "Schedule");
  assert.equal(adds(both).length, 1);
  assert.equal((adds(both)[0].value as AddAnnouncement).origin, "TEXT");
});

test("N09 the automatic stage announcement only on a job that has been public, and only saved with the stages", () => {
  const draftOnly = propose("Exam Stages:\nStage: Tier-I | Status: Scheduled | Date: 30 Mar 2097 | Confirmed\n", job({ publishedAt: undefined }), "Schedule");
  assert.equal(draftOnly.items.length, 0);
  const r = job();
  const p = propose("Exam Stages:\nStage: Tier-I | Status: Scheduled | Date: 30 Mar 2097 | Confirmed\n", r, "Schedule");
  const w = write(r.updates!, adds(p), false);
  assert.ok(!w.ok && /needs the exam stages ticked/.test(w.error));
});

test("N10 never a duplicate: the same announcement again is Matches; probably the same news is offered unticked with the reason", () => {
  const r = job({ updates: [...OLD, { id: "u-9", date: "2097-02-18", type: "EXAM_NOTICE", title: "Tier-II admit card released", description: "The Tier-II admit card is out. The exam is on 5 Mar 2097." }] });
  const same = adds(propose(ADMIT, r))[0];
  assert.equal(same.action, "MATCHES");
  assert.equal(same.defaultTicked, false);
  const r2 = job({ updates: [...OLD, { id: "u-8", date: "2097-02-16", type: "EXAM_NOTICE", title: "Tier-II: admit card released", description: "The admit card for Tier-II has been released." }] });
  const near = adds(propose(ADMIT, r2))[0];
  assert.equal(near.action, "FILL");
  assert.equal(near.defaultTicked, false);
  assert.ok(near.flags.some((f) => /probably already on the job: “Tier-II: admit card released”/.test(f)), near.flags);
});

test("N11 two announcements in one text: none is offered (an update carries at most one)", () => {
  const p = propose("Announcement:\nTitle: One\nText: First.\nTitle: Two\nText: Second.\n");
  assert.equal(adds(p).length, 0);
});

suite("U3: supersession");

const SUPERSEDE = `Exam Stages:
Stage: Tier-I | Status: Scheduled | Date: 10 Mar 2097 | Confirmed

Supersede:
24 Jan 2097 – Tier-I rescheduled | Reason: the board withdrew the 30 Mar date; Tier-I stays on 10 Mar 2097
`;

test("N12 a correction with a supersession: no announcement; the named announcement is offered, ticked, with the official notice", () => {
  const p = propose(SUPERSEDE, job(), "Correction");
  assert.equal(adds(p).length, 0);
  assert.equal(sups(p).length, 1);
  const s = sups(p)[0];
  const v = s.value as SupersedeAnnouncement;
  assert.equal(s.defaultTicked, true);
  assert.equal(v.targetId, "u-2");
  assert.equal(v.sourceUrl, "https://tub.example.gov.in/notice-18feb.pdf");
  assert.deepEqual(s.current, { date: "2097-01-24", title: "Tier-I rescheduled" });
});

test("N13 saved with the existing supersede rules: only the note is added; text, date and id are kept; the public copy has no reason or author", () => {
  const r = job();
  const w = write(r.updates!, sups(propose(SUPERSEDE, r, "Correction")));
  assert.ok(w.ok);
  if (!w.ok) return;
  const old = w.write.after.find((u) => u.id === "u-2")!;
  assert.equal(old.title, "Tier-I rescheduled");
  assert.equal(old.description, "Tier-I has moved to 30 Mar 2097.");
  assert.deepEqual(old.superseded, { on: TODAY, by: ADMIN, reason: "the board withdrew the 30 Mar date; Tier-I stays on 10 Mar 2097", sourceUrl: "https://tub.example.gov.in/notice-18feb.pdf" });
  assert.equal(currentUpdates(w.write.after).length, 2);
  const pub = toPublicUpdates(w.write.after).find((u) => u.id === "u-2")!;
  assert.ok(!("reason" in pub.superseded!) && !("by" in pub.superseded!) && pub.description === "");
});

test("N14 'Replaced by' this update's new announcement: linked to it when both are ticked; without it, the official notice is used", () => {
  const body = `Announcement:\nTitle: Tier-I stays on 10 Mar\nText: The board confirms Tier-I on 10 Mar 2097.\n\nSupersede:\n24 Jan 2097 – Tier-I rescheduled | Reason: withdrawn by the board | Replaced by: Tier-I stays on 10 Mar\n`;
  const r = job();
  const p = propose(body, r, "Schedule");
  const s = sups(p)[0].value as SupersedeAnnouncement;
  assert.equal(s.replacedByNew, true);
  const both = write(r.updates!, p.items);
  assert.ok(both.ok);
  if (!both.ok) return;
  const added = both.write.after.find((u) => u.title === "Tier-I stays on 10 Mar")!;
  assert.equal(both.write.after.find((u) => u.id === "u-2")!.superseded!.replacedBy, added.id);
  const onlySup = write(r.updates!, sups(p));
  assert.ok(onlySup.ok && !onlySup.write.after.find((u) => u.id === "u-2")!.superseded!.replacedBy, "falls back to the official notice");
});

test("N15 an announcement the text cannot name unambiguously, or that is not on the job: nothing is superseded, and it is said", () => {
  const amb = propose("Supersede:\n24 Jan 2097 – Notice | Reason: outdated\n", job({ updates: [...OLD, { id: "u-4", date: "2097-01-24", type: "GENERAL_NOTICE", title: "Notice", description: "A." }, { id: "u-5", date: "2097-01-24", type: "GENERAL_NOTICE", title: "Notice", description: "B." }] }));
  assert.equal(sups(amb).length, 0);
  assert.ok(amb.warnings.some((w) => /could be any of/.test(w)));
  const none = propose("Supersede:\n2 Jan 2097 – Tier-I rescheduled | Reason: outdated\n");
  assert.equal(sups(none).length, 0);
  assert.ok(none.warnings.some((w) => /not among the job's announcements on that date/.test(w)));
});

test("N16 already superseded: Matches, unticked, nothing changed", () => {
  const r = job({ updates: OLD.map((u) => (u.id === "u-2" ? { ...u, superseded: { on: "2097-02-01", by: ADMIN, reason: "earlier", sourceUrl: "https://tub.example.gov.in/x.pdf" } } : u)) });
  const s = sups(propose(SUPERSEDE, r, "Correction"))[0];
  assert.equal(s.action, "MATCHES");
  assert.equal(s.defaultTicked, false);
});

test("N17 saving again changes nothing; a list changed since the preview is refused", () => {
  const r = job();
  const p = propose(ADMIT + "\nSupersede:\n24 Jan 2097 – Tier-I rescheduled | Reason: outdated\n", r);
  const first = write(r.updates!, p.items);
  assert.ok(first.ok);
  if (!first.ok) return;
  const again = write(first.write.after, p.items);
  assert.ok(again.ok && again.write.nothingToDo && again.write.after.length === first.write.after.length);
  const changed = write([...r.updates!, { id: "u-x", date: "2097-02-19", type: "GENERAL_NOTICE", title: "Other", description: "Other." }], p.items);
  assert.ok(!changed.ok && /changed after this preview/.test(changed.error));
});

suite("U3: safety");

test("N18 text about another job offers no announcement or supersession", () => {
  const reading = readUpdateText(head().replace("Organisation: Test U3 Board", "Organisation: Test Coal Company") + ADMIT + SUPERSEDE.replace("Exam Stages:", "Notes:"), { job: identity(job()) });
  const p = proposeAnnouncements({ record: job(), reading, retrievalId: RID, today: TODAY });
  assert.equal(p.items.length, 0);
});

test("N19 the public copy: since P1, a current announcement carries its button, relevance and event (shape-checked); a superseded one never does", () => {
  const r = job();
  const w = write(r.updates!, adds(propose(ADMIT, r)));
  assert.ok(w.ok);
  if (!w.ok) return;
  const pub = toPublicUpdates(w.write.after).at(-1)!;
  assert.deepEqual([pub.action, pub.relevantUntil, pub.event], ["ADMIT_CARD", "2097-03-05", { kind: "ADMIT_CARD", stage: "Tier-II" }]);
  const odd = toPublicUpdates([{ ...pub, action: "https://evil.example/x" as never, relevantUntil: "soon", event: { kind: "MADE_UP" as never } }])[0];
  for (const k of ["action", "relevantUntil", "event"]) assert.ok(!(k in odd), k);
  const old = toPublicUpdates([{ ...pub, superseded: { on: TODAY, by: ADMIN, reason: "x" } }])[0];
  for (const k of ["action", "relevantUntil", "event"]) assert.ok(!(k in old), k);
});

test("N20 no database, network, AI or Telegram in the U3 module; the import's database function never receives announcement ids", () => {
  const mod = readFileSync("src/lib/cms/importer/update-announcements.ts", "utf8").replace(/\/\/.*$/gm, "");
  for (const forbidden of [/from\s+["']@\/lib\/db/, /\bfetch\(/, /gemini/i, /from\s+["'][^"']*telegram/i, /repository"/, /channel-post/]) assert.ok(!forbidden.test(mod), String(forbidden));
  const svc = readFileSync("src/lib/cms/importer/service.ts", "utf8");
  assert.match(svc, /applyImport\(\{ importId: opts\.importId, adminId: opts\.adminId, selected: fieldSelected,/);
  assert.match(svc, /buildApplyPayload\(\{\s*record, proposal: imp\.proposal, selected: fieldSelected,/);
});
