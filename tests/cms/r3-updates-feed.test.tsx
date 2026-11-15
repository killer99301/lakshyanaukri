// CMS 2.0 R3: the Latest updates archive, built from published recruitments' reviewed announcements.
// SYNTHETIC data only (the repository is public): invented boards, titles, dates and addresses. Jobs are built the
// way public pages get them: record → published snapshot (projectForPreview) → page data (the adapter, which keeps
// only the allowlisted public copy of each announcement).
//   npx tsx --tsconfig tsconfig.json tests/cms/r3-updates-feed.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { ExamStage, Opportunity, UpdateRecord } from "@/types";
import type { CmsRecruitmentLink, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { pickImportantUpdate } from "@/lib/important-update";
import { buildFeed, byMonth, feedHref, feedPage, filterFeed, importantNow, isFiltered, readFeedQuery, typeCounts, PAGE_SIZE, type FeedEntry } from "@/lib/updates-feed";
import { UpdateRow, UpdateList } from "@/components/updates/UpdateRow";
import { PreviousUpdates } from "@/components/updates/PreviousUpdates";
import { ImportantNow } from "@/components/updates/ImportantNow";
import { Pager } from "@/components/updates/Pager";

const NOW = new Date("2097-03-03T06:00:00Z"); // 3 Mar 2097, India
const ADMIN = "0a0a0a0a-1111-4222-8333-444455556666";
const SECRET = "INTERNAL-R3-REASON-never-public";
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const STAGES: ExamStage[] = [
  { name: "Tier-I", order: 1, status: "RESULT_DECLARED", kind: "SELECTION", dateIso: "2097-01-20", certainty: "CONFIRMED" },
  { name: "Tier-II", order: 2, status: "ADMIT_CARD_OUT", kind: "SELECTION", dateIso: "2097-03-06", certainty: "CONFIRMED" },
  { name: "Interview", order: 3, status: "SCHEDULED", kind: "SELECTION", dateIso: "2097-04-20", certainty: "TENTATIVE" },
];
const LINKS: CmsRecruitmentLink[] = [
  { type: "APPLY_ONLINE", label: "Apply", url: "https://r3.example.gov.in/apply", official: true },
  { type: "ADMIT_CARD", label: "Admit card", url: "https://r3.example.gov.in/admit", official: true },
  { type: "RESULT", label: "Result", url: "https://r3.example.gov.in/result", official: true },
];
let n = 0;
const ann = (date: string, title: string, over: Partial<UpdateRecord> = {}): UpdateRecord =>
  ({ id: `u-${++n}`, date, type: "EXAM_NOTICE", title, description: `${title}. Details from the notice.`, sourceUrl: `https://r3.example.gov.in/n${n}.pdf`, ...over });

function job(slug: string, title: string, updates: UpdateRecord[], over: { stages?: ExamStage[]; links?: CmsRecruitmentLink[] } = {}): Opportunity {
  return snapshotToGovernmentRecruitment(projectForPreview({
    id: `rec-${slug}`, slug, draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: "test-r3-board", organizationName: "Test R3 Board", recruitmentYear: 2097, title: pf(title) },
    dates: { applicationOpenDate: pf("2097-01-01"), applicationCloseDate: pf("2097-01-31") }, vacancies: {}, financial: {},
    links: over.links ?? LINKS, documents: [], updates, examStages: over.stages ?? STAGES,
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2097-01-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    createdAt: "2097-01-01T00:00:00Z", updatedAt: "2097-03-01T00:00:00Z", createdBy: ADMIN, updatedBy: ADMIN,
  } as RecordLike)) as unknown as Opportunity;
}
type RecordLike = RecruitmentRecord;

// Job A: an admit card current, an older admit card replaced by a result, a superseded wrong date, a tentative interview date.
const A_RESULT = ann("2097-02-10", "Tier-I result declared", { event: { kind: "RESULT", stage: "Tier-I" }, action: "RESULT" });
const A_ADMIT1 = ann("2097-01-05", "Tier-I admit card released", { event: { kind: "ADMIT_CARD", stage: "Tier-I" }, action: "ADMIT_CARD" });
const A_ADMIT2 = ann("2097-02-25", "Tier-II admit card released", { event: { kind: "ADMIT_CARD", stage: "Tier-II" }, action: "ADMIT_CARD" });
const A_FIX = ann("2097-02-01", "Tier-II correct date notice", { event: { kind: "EXAM_DATE", stage: "Tier-II" } });
const A_WRONG = ann("2097-01-25", "Tier-II moved to 30 Mar", {
  event: { kind: "EXAM_DATE", stage: "Tier-II" },
  superseded: { on: "2097-02-01", by: ADMIN, reason: SECRET, replacedBy: A_FIX.id, sourceUrl: "https://r3.example.gov.in/fix.pdf" },
});
const A_INTERVIEW = ann("2097-02-20", "Interview dates announced", { event: { kind: "EXAM_DATE", stage: "Interview" } });
const jobA = job("test-r3-a-exam-2097", "TEST R3 A Combined Exam 2097", [A_ADMIT1, A_RESULT, A_WRONG, A_FIX, A_INTERVIEW, A_ADMIT2]);
// Job B: a postponement (urgent) and routine news.
const B_POST = ann("2097-03-01", "Mains postponed", { type: "POSTPONEMENT", event: { kind: "POSTPONEMENT" } });
const B_NEWS = ann("2097-02-15", "Help desk number added", { event: { kind: "OTHER" } });
const jobB = job("test-r3-b-mains-2097", "TEST R3 B Mains 2097", [B_POST, B_NEWS]);
// Job C: no announcements at all (only links): never in the feed.
const jobC = job("test-r3-c-links-only-2097", "TEST R3 C Links Only 2097", []);
const JOBS = [jobA, jobB, jobC];
const FEED = buildFeed(JOBS, NOW);
const byTitle = (t: string) => FEED.find((e) => e.title === t)!;

suite("R3: the feed");

test("R01 only announcements of the given recruitments, links alone never become entries, every key unique", () => {
  assert.equal(FEED.length, 8);
  assert.ok(!FEED.some((e) => e.job.slug === jobC.slug));
  assert.equal(new Set(FEED.map((e) => e.key)).size, FEED.length);
});

test("R02 newest first, with a stable order for the same date", () => {
  const dates = FEED.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.deepEqual(buildFeed([...JOBS].reverse(), NOW).map((e) => e.key), FEED.map((e) => e.key));
});

test("R03 states: current, closed by its date, closed by a newer notice, superseded with its correction", () => {
  assert.equal(byTitle("Tier-II admit card released").state, "CURRENT");
  assert.equal(byTitle("Tier-I admit card released").state, "CLOSED"); // its exam (20 Jan) is over
  assert.equal(byTitle("Tier-I result declared").state, "CURRENT");
  const wrong = byTitle("Tier-II moved to 30 Mar");
  assert.equal(wrong.state, "SUPERSEDED");
  assert.equal(wrong.summary, undefined);
  assert.equal(wrong.correction?.replacementTitle, "Tier-II correct date notice");
  assert.equal(wrong.correction?.on, "2097-02-01");
  assert.equal(byTitle("Tier-II correct date notice").state, "CLOSED"); // replaced by the newer Tier-II admit card
});

test("R04 Current agrees with the job page: its important update is a current entry", () => {
  for (const j of [jobA, jobB]) {
    const p = pickImportantUpdate(j, NOW)!;
    assert.equal(FEED.find((e) => e.key === `${j.slug}#${p.update.id}`)?.state, "CURRENT");
  }
});

test("R05 the official button only on current entries, from the job's own link of that kind", () => {
  assert.deepEqual(byTitle("Tier-II admit card released").action, { label: "Download admit card", url: "https://r3.example.gov.in/admit" });
  assert.equal(byTitle("Tier-I admit card released").action, undefined);
  assert.equal(byTitle("Tier-II moved to 30 Mar").action, undefined);
});

test("R06 a tentative stage is marked; a confirmed one is not", () => {
  assert.equal(byTitle("Interview dates announced").stage?.tentative, true);
  assert.equal(byTitle("Tier-II admit card released").stage?.tentative, undefined);
});

test("R07 nothing internal leaves the feed: no reason, no admin, no superseded body", () => {
  const json = JSON.stringify(FEED);
  assert.ok(!json.includes(SECRET) && !json.includes(ADMIN), "internal value leaked");
  assert.ok(!/"reason"|"by"\s*:|evidenceIds|manuallyEdited/.test(json));
});

suite("R3: filters and pages");

// A large synthetic feed: 3 current + 47 earlier notices over four months.
const many: UpdateRecord[] = [];
for (let i = 0; i < 47; i++) {
  const d = new Date(Date.UTC(2096, 10, 1) + i * 2 * 86_400_000).toISOString().slice(0, 10);
  many.push(ann(d, `Old notice ${i}`, { event: { kind: i % 3 === 0 ? "RESULT" : "OTHER" }, relevantUntil: "2096-12-31" }));
}
const big = buildFeed([job("test-r3-big-2097", "TEST R3 Big 2097", many), jobA, jobB], NOW);

test("R08 pagination: every earlier entry exactly once across the pages; Current only on page 1", () => {
  const p1 = feedPage(big, 1);
  assert.ok(p1.current.length > 0 && p1.pages === Math.ceil(p1.previousCount / PAGE_SIZE));
  const seen: string[] = [];
  for (let i = 1; i <= p1.pages; i++) {
    const p = feedPage(big, i);
    if (i > 1) assert.equal(p.current.length, 0);
    seen.push(...p.previous.map((e) => e.key));
  }
  assert.equal(seen.length, p1.previousCount);
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length + p1.currentCount, big.length);
});

test("R09 a page beyond the last shows the last page and says so", () => {
  const p = feedPage(big, 99);
  assert.equal(p.outOfRange, true);
  assert.equal(p.page, p.pages);
});

test("R10 filters combine: type, recruitment, month and status; an impossible combination is empty", () => {
  const results = filterFeed(big, { type: "result" });
  assert.ok(results.length > 0 && results.every((e) => e.type === "result"));
  const aOnly = filterFeed(big, { job: jobA.slug, status: "current" });
  assert.ok(aOnly.length > 0 && aOnly.every((e) => e.job.slug === jobA.slug && e.state === "CURRENT"));
  const month = filterFeed(big, { month: "2096-11" });
  assert.ok(month.length > 0 && month.every((e) => e.month === "2096-11"));
  assert.equal(filterFeed(big, { job: jobB.slug, type: "admit-card" }).length, 0);
});

test("R11 the address is checked: unknown or malformed values are ignored, never trusted", () => {
  const q = readFeedQuery({ type: "<script>", job: "no-such-job", month: "2097-13", status: "open", page: "-4" }, big);
  assert.deepEqual(q, { page: 1 });
  assert.equal(isFiltered(q), false);
  const ok = readFeedQuery({ type: "result", job: jobA.slug, month: "2097-02", status: "closed", page: ["3", "9"] }, big);
  assert.deepEqual(ok, { type: "result", job: jobA.slug, month: "2097-02", status: "closed", page: 3 });
  assert.equal(isFiltered(ok), true);
});

test("R12 addresses: page 1 has no page parameter; filters keep their order", () => {
  assert.equal(feedHref({ page: 1 }), "/updates");
  assert.equal(feedHref({ page: 2 }), "/updates?page=2");
  assert.equal(feedHref({ type: "result", month: "2097-02", page: 3 }), "/updates?type=result&month=2097-02&page=3");
});

test("R13 months group newest first; counts follow the other filters", () => {
  const groups = byMonth(feedPage(big, 1).previous);
  assert.ok(groups.length >= 2 && groups[0].month > groups[1].month && /\d{4}$/.test(groups[0].label));
  const counts = typeCounts(big, { job: jobA.slug });
  assert.equal(counts.all, filterFeed(big, { job: jobA.slug }).length);
  assert.equal(counts["admit-card"], 2);
});

suite("R3: Important now");

test("R14 one per job, urgent first, routine news never; empty means the strip is not drawn", () => {
  const top = importantNow(JOBS, FEED, NOW);
  assert.deepEqual(top.map((e) => e.title), ["Mains postponed", "Tier-II admit card released"]);
  assert.equal(new Set(top.map((e) => e.job.slug)).size, top.length);
  assert.equal(importantNow([jobC], buildFeed([jobC], NOW), NOW).length, 0);
  assert.equal(renderToStaticMarkup(<ImportantNow entries={[]} />), "");
  const html = renderToStaticMarkup(<ImportantNow entries={top} />);
  assert.ok(/data-important-now/.test(html) && /Download admit card/.test(html) && /rel="noopener noreferrer"/.test(html));
});

suite("R3: rows on the page");

const row = (e: FeedEntry) => renderToStaticMarkup(<ul><UpdateRow entry={e} /></ul>);

test("R15 a current row: linked title, its state written out, the official button opening safely", () => {
  const html = row(byTitle("Tier-II admit card released"));
  assert.ok(/data-state="current"/.test(html) && />Current</.test(html) && /href="\/jobs\/test-r3-a-exam-2097#updates-history"/.test(html));
  assert.ok(/data-update-action/.test(html) && /target="_blank"/.test(html) && /rel="noopener noreferrer"/.test(html));
});

test("R16 a closed row: never an active button", () => {
  const html = row(byTitle("Tier-I admit card released"));
  assert.ok(/data-state="closed"/.test(html) && />Closed</.test(html) && !/data-update-action/.test(html));
});

test("R17 a superseded row: no old text, no reason; the correct notice is linked", () => {
  const html = row(byTitle("Tier-II moved to 30 Mar"));
  assert.ok(/>Superseded</.test(html) && /Correct notice: Tier-II correct date notice/.test(html));
  assert.ok(!html.includes(SECRET) && !html.includes("Details from the notice"));
});

test("R18 a tentative date is written out, not shown by colour alone", () => {
  assert.ok(/>Tentative</.test(row(byTitle("Interview dates announced"))));
});

test("R19 category page section: current, previous and the link to the full list; an empty kind says so", () => {
  const html = renderToStaticMarkup(<PreviousUpdates entries={FEED} type="admit-card" noun="admit card" />);
  assert.ok(/Current/.test(html) && /Previous/.test(html) && /href="\/updates\?type=admit-card"/.test(html) && /All admit card notices \(2\)/.test(html));
  const none = renderToStaticMarkup(<PreviousUpdates entries={FEED} type="answer-key" noun="answer key" />);
  assert.ok(/No answer key notices recorded yet/.test(none));
});

test("R20 pager: the current page marked, newer and older links, nothing for a single page", () => {
  const html = renderToStaticMarkup(<Pager page={2} pages={5} hrefFor={(p) => feedHref({ page: p })} />);
  assert.ok(/aria-current="page"[^>]*>2</.test(html) && /rel="prev"/.test(html) && /rel="next"/.test(html) && /href="\/updates\?page=3"/.test(html));
  assert.equal(renderToStaticMarkup(<Pager page={1} pages={1} hrefFor={() => "/updates"} />), "");
  assert.ok(/<ol/.test(renderToStaticMarkup(<UpdateList entries={FEED.slice(0, 2)} />)));
});
