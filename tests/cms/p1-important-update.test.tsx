// CMS 2.0 P1: the recruitment page's "Important update" — the most relevant current notice, not the newest.
// SYNTHETIC data only (the repository is public): invented boards, titles, dates and addresses. Jobs are built the
// way public pages get them: record → published snapshot (projectForPreview) → page data (the adapter).
//   npx tsx --tsconfig tsconfig.json tests/cms/p1-important-update.test.tsx
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { ExamStage, Opportunity, UpdateRecord } from "@/types";
import type { CmsRecruitmentLink, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { pickImportantUpdate } from "@/lib/important-update";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";

const NOW = new Date("2097-03-03T06:00:00Z"); // 3 Mar 2097, India
const ADMIN = "0a0a0a0a-1111-4222-8333-444455556666";
const SECRET = "INTERNAL-REASON-never-public";
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const STAGES: ExamStage[] = [
  { name: "Tier-I", order: 1, status: "RESULT_DECLARED", kind: "SELECTION", dateIso: "2097-01-20", certainty: "CONFIRMED" },
  { name: "Tier-II", order: 2, status: "ADMIT_CARD_OUT", kind: "SELECTION", dateIso: "2097-03-06", certainty: "CONFIRMED" },
  { name: "Interview", order: 3, status: "SCHEDULED", kind: "SELECTION", dateIso: "2097-04-20", certainty: "TENTATIVE" },
];
const LINKS: CmsRecruitmentLink[] = [
  { type: "APPLY_ONLINE", label: "Apply", url: "https://tpb.example.gov.in/apply", official: true },
  { type: "ADMIT_CARD", label: "Admit card", url: "https://tpb.example.gov.in/admit", official: true },
  { type: "RESULT", label: "Result", url: "https://tpb.example.gov.in/result", official: true },
];
let n = 0;
const ann = (date: string, title: string, over: Partial<UpdateRecord> = {}): UpdateRecord =>
  ({ id: `u-${++n}`, date, type: "EXAM_NOTICE", title, description: `${title}.`, sourceUrl: `https://tpb.example.gov.in/n${n}.pdf`, ...over });

function page(updates: UpdateRecord[], over: { stages?: ExamStage[]; links?: CmsRecruitmentLink[]; dates?: RecruitmentRecord["dates"] } = {}): Opportunity {
  return snapshotToGovernmentRecruitment(projectForPreview({
    id: "rec-p1", slug: "test-p1-exam-2097", draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: "test-p1-board", organizationName: "Test P1 Board", recruitmentYear: 2097, title: pf("TEST P1 Combined Exam 2097") },
    dates: over.dates ?? { applicationOpenDate: pf("2097-01-01"), applicationCloseDate: pf("2097-01-31") }, vacancies: {}, financial: {},
    links: over.links ?? LINKS, documents: [], updates, examStages: over.stages ?? STAGES,
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2097-01-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    createdAt: "2097-01-01T00:00:00Z", updatedAt: "2097-03-01T00:00:00Z", createdBy: ADMIN, updatedBy: ADMIN,
  } as RecruitmentRecord)) as unknown as Opportunity;
}
const pick = (updates: UpdateRecord[], over?: Parameters<typeof page>[1]) => pickImportantUpdate(page(updates, over), NOW);
const header = (job: Opportunity) => renderToStaticMarkup(<JobDetailHeader job={job} now={NOW} />);

const ADMIT2 = ann("2097-02-25", "Tier-II admit card released", { event: { kind: "ADMIT_CARD", stage: "Tier-II" }, action: "ADMIT_CARD" });

suite("P1: what is chosen");

test("P01 a new admit card with an active link: chosen, with its stage, status and the download button", () => {
  const p = pick([ann("2097-01-10", "Tier-I exam held"), ADMIT2])!;
  assert.equal(p.update.title, "Tier-II admit card released");
  assert.equal(p.status, "Admit card out");
  assert.equal(p.tone, "ACTION");
  assert.deepEqual(p.stage, { name: "Tier-II", when: "2097-03-06" });
  assert.deepEqual(p.action, { label: "Download admit card", url: "https://tpb.example.gov.in/admit", host: "tpb.example.gov.in", official: false });
});

test("P02 an admit card whose exam is over: no longer current, and never shown with a download button", () => {
  const stages = STAGES.map((s) => (s.name === "Tier-II" ? { ...s, dateIso: "2097-02-28", status: "CONDUCTED" as const } : s));
  const p = pick([ADMIT2], { stages });
  assert.equal(p, null);
  const html = header(page([ADMIT2], { stages }));
  assert.ok(!/data-important-update/.test(html) && !/Download admit card/.test(html));
});

test("P03 a result declared after the same stage's admit card replaces it; the admit card stays in the history", () => {
  const admit1 = ann("2097-01-05", "Tier-I admit card released", { event: { kind: "ADMIT_CARD", stage: "Tier-I" } });
  const result1 = ann("2097-02-10", "Tier-I result declared", { event: { kind: "RESULT", stage: "Tier-I" } });
  const job = page([admit1, result1]);
  const p = pickImportantUpdate(job, NOW)!;
  assert.equal(p.update.title, "Tier-I result declared");
  assert.deepEqual(p.action, { label: "Check result", url: "https://tpb.example.gov.in/result", host: "tpb.example.gov.in", official: false });
  const history = renderToStaticMarkup(<JobDetailSections job={job} />);
  assert.ok(history.includes("Tier-I admit card released") && history.includes("Tier-I result declared"));
});

test("P04 a postponement or cancellation outranks an admit card for an exam three days away", () => {
  const post = ann("2097-02-20", "Interview postponed", { event: { kind: "POSTPONEMENT", stage: "Interview" } });
  const p = pick([ADMIT2, post])!;
  assert.equal(p.update.title, "Interview postponed");
  assert.equal(p.tone, "URGENT");
  assert.equal(p.status, "Postponed");
  assert.equal(p.action, undefined, "a postponement has no download; its official notice is linked instead");
  assert.equal(p.noticeUrl, post.sourceUrl);
  const cancel = ann("2097-02-01", "Recruitment cancelled", { type: "CANCELLATION" });
  assert.equal(pick([ADMIT2, cancel])!.update.title, "Recruitment cancelled", "older, but urgent");
});

test("P05 an application deadline extended: chosen with the Apply button while open; not once the new date has passed", () => {
  const ext = ann("2097-02-26", "Last date extended to 10 Mar 2097", { type: "DEADLINE_EXTENSION" });
  const open = pick([ext], { dates: { applicationOpenDate: pf("2097-01-01"), applicationCloseDate: pf("2097-03-10") } })!;
  assert.equal(open.status, "Date extended");
  assert.deepEqual(open.action, { label: "Apply online", url: "https://tpb.example.gov.in/apply", host: "tpb.example.gov.in", official: false });
  assert.equal(pick([ext], { dates: { applicationOpenDate: pf("2097-01-01"), applicationCloseDate: pf("2097-03-01") } }), null);
});

test("P06 several current notices: urgency first, then the nearest action, then results, then routine news", () => {
  const result1 = ann("2097-02-10", "Tier-I result declared", { event: { kind: "RESULT", stage: "Tier-I" } });
  const routine = ann("2097-03-02", "Help desk number added", { type: "GENERAL_NOTICE" });
  assert.equal(pick([result1, routine, ADMIT2])!.update.title, "Tier-II admit card released", "exam in 3 days beats a result and newer routine news");
  assert.equal(pick([result1, routine])!.update.title, "Tier-I result declared", "a result beats newer routine news");
  const r = pick([routine])!;
  assert.equal(r.tone, "INFO", "routine news is a small note, not a big banner");
});

test("P07 no known expiry: a result stays current; a stage's passed date never expires a result", () => {
  const result1 = ann("2096-12-01", "Tier-I result declared", { event: { kind: "RESULT", stage: "Tier-I" } });
  const p = pick([result1])!;
  assert.equal(p.update.title, "Tier-I result declared");
});

test("P08 'Relevant until' ends a notice only on that day; a superseded announcement is never chosen", () => {
  const key = ann("2097-02-20", "Tier-I answer key out", { event: { kind: "ANSWER_KEY", stage: "Tier-I" }, relevantUntil: "2097-03-02" });
  assert.equal(pick([key]), null, "its window ended yesterday");
  assert.equal(pick([{ ...key, relevantUntil: "2097-03-03" }])!.update.title, "Tier-I answer key out", "the last day itself still counts");
  const wrong = ann("2097-03-01", "Interview rescheduled", { event: { kind: "EXAM_DATE", stage: "Interview" }, superseded: { on: "2097-03-02", by: ADMIN, reason: SECRET, sourceUrl: "https://tpb.example.gov.in/c.pdf" } });
  const p = pick([ann("2097-02-01", "Tier-I result declared", { event: { kind: "RESULT", stage: "Tier-I" } }), wrong])!;
  assert.equal(p.update.title, "Tier-I result declared");
});

test("P09 the button only for a real link: none for a missing admit-card link, and that is said", () => {
  const p = pick([ADMIT2], { links: LINKS.filter((l) => l.type !== "ADMIT_CARD") })!;
  assert.equal(p.action, undefined);
  assert.match(p.noAction ?? "", /Admit card link not on this page yet/);
});

test("P10 older snapshots (no recorded kind or stage): read from the words and the stage the automatic entry names", () => {
  const auto = ann("2097-02-25", "Tier-II: admit card released", { field: "Tier-II", previousValue: "Scheduled", newValue: "Admit card released" });
  const p = pick([auto])!;
  assert.equal(p.kind, "ADMIT_CARD");
  assert.equal(p.inferred, true);
  assert.equal(p.stage?.name, "Tier-II");
  assert.ok(p.action?.url === "https://tpb.example.gov.in/admit");
});

suite("P1: the page");

test("P11 one block only, replacing the old 'newest announcement' banner; the earlier updates stay in the history", () => {
  const list = [ann("2097-01-05", "Tier-I admit card released"), ann("2097-02-10", "Tier-I result declared", { event: { kind: "RESULT", stage: "Tier-I" } }), ADMIT2];
  const job = page(list);
  const html = header(job);
  assert.equal((html.match(/data-important-update=/g) ?? []).length, 1);
  assert.ok(!html.includes("View all corrigenda"), "the old banner is gone");
  assert.ok(html.includes("Tier-II admit card released") && html.includes("Download admit card") && html.includes('href="#updates-history"'));
  const history = renderToStaticMarkup(<JobDetailSections job={job} />);
  for (const u of list) assert.ok(history.includes(u.title), u.title);
});

test("P16 links say where they go: 'Official notice' only on the recruiting body's own site; a third-party source is named by its host; an aggregator is never the button", () => {
  const official = { ...page([{ ...ADMIT2, sourceUrl: "https://www.ibps.in/notice.pdf" }], { links: [...LINKS.filter((l) => l.type !== "ADMIT_CARD"), { type: "ADMIT_CARD", label: "Admit card", url: "https://www.ibps.in/admit", official: true }] }), organizationId: "ibps" } as Opportunity;
  const p = pickImportantUpdate(official, NOW)!;
  assert.deepEqual([p.action?.official, p.notice?.official, p.action?.host], [true, true, "ibps.in"]);
  const html = header(official);
  assert.ok(html.includes("Official notice") && html.includes("Official site · ibps.in"));
  const thirdParty = page([{ ...ADMIT2, sourceUrl: "https://news.example.com/admit-card-story" }]);
  const tp = header(thirdParty);
  assert.ok(tp.includes("Source: news.example.com") && !tp.includes("Official notice"), "a third-party notice is a source, not 'official'");
  assert.ok(tp.includes("Opens tpb.example.gov.in") && !tp.includes("Official site ·"), "a host not on the trusted list is named, not called official");
  const agg = pick([ADMIT2], { links: [...LINKS.filter((l) => l.type !== "ADMIT_CARD"), { type: "ADMIT_CARD", label: "Admit card", url: "https://www.sarkariresult.com/x", official: false }] })!;
  assert.equal(agg.action, undefined, "an aggregator page is never the download button");
});

test("P17 the block uses the design system's status colours: blue for a download, red for an urgent change, neutral for routine news", () => {
  assert.match(header(page([ADMIT2])), /data-important-update="action"[^>]*class="[^"]*bg-ln-action-soft/);
  assert.match(header(page([ann("2097-02-20", "Interview postponed", { event: { kind: "POSTPONEMENT", stage: "Interview" } })])), /data-important-update="urgent"[^>]*class="[^"]*bg-ln-urgent-soft/);
  assert.match(header(page([ann("2097-03-02", "Help desk number added", { type: "GENERAL_NOTICE" })])), /data-important-update="info"[^>]*class="[^"]*bg-white/);
  const css = readFileSync("src/app/globals.css", "utf8");
  for (const t of ["--color-ln-action", "--color-ln-urgent", "--color-ln-past"]) assert.ok(css.includes(t), t);
  assert.match(css, /--primary: #ea580c;/, "the site's existing colours are unchanged");
});

test("P12 a job with no announcements: no block at all", () => {
  assert.ok(!/data-important-update/.test(header(page([]))));
});

test("P13 the page data carries no internal note, author or admin identifier", () => {
  const wrong = ann("2097-02-01", "Old exam date", { superseded: { on: "2097-02-05", by: ADMIN, reason: SECRET, sourceUrl: "https://tpb.example.gov.in/c.pdf" } });
  const job = page([wrong, ADMIT2]);
  const data = JSON.stringify(job);
  assert.ok(!data.includes(SECRET) && !data.includes(ADMIN), "no reason, no admin id anywhere in the page data");
  assert.ok(!/"(by|reason|createdBy|updatedBy|claims|evidenceIds)"\s*:/.test(data), "no internal keys");
  const html = header(job) + renderToStaticMarkup(<JobDetailSections job={job} />);
  assert.ok(!html.includes(SECRET) && !html.includes(ADMIN));
  const shown = (job.updates ?? []).find((u) => u.id === ADMIT2.id)!;
  assert.deepEqual(Object.keys(shown).sort(), ["action", "date", "description", "event", "id", "sourceUrl", "title", "type"]);
  const hidden = (job.updates ?? []).find((u) => u.id === wrong.id)!;
  assert.ok(!("event" in hidden) && !("action" in hidden) && hidden.description === "");
});

test("P14 the block stacks on a phone: the button is full width there and beside the text from small screens up", () => {
  const html = header(page([ADMIT2]));
  assert.match(html, /flex flex-col sm:flex-row/);
  assert.match(html, /data-important-action[^>]*class="[^"]*w-full sm:w-auto/);
});

test("P15 the page's title, canonical and metadata code is untouched; no new public route", () => {
  const route = readFileSync("src/app/(main)/jobs/[slug]/page.tsx", "utf8");
  assert.ok(!/important/i.test(route), "the route file is not changed for P1");
  assert.ok(!/getLatestUpdate/.test(readFileSync("src/components/jobs/JobDetailHeader.tsx", "utf8")));
});
