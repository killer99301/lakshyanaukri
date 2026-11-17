// React #418 fix (Nov 2026): one India-date model and one "today" per render.
//   - Every recruitment date is an India calendar day; "today" is India's date, whatever the machine's time zone.
//   - Components drawn on the server and hydrated in the browser read the page's own date (TodayProvider), so the
//     first browser render matches the HTML; the visitor's current India date takes over right after (browser-tested).
// Run in two process time zones to show the results do not depend on the machine's zone:
//   npx tsx --tsconfig tsconfig.json tests/cms/india-dates.test.tsx
//   TZ=UTC npx tsx --tsconfig tsconfig.json tests/cms/india-dates.test.tsx
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import {
  indiaDay, dayOf, daysBetween, nextIndiaMidnight, noonInIndia, getDaysRemaining, deriveApplicationStatus,
  getOpportunityApplicationStatus, deriveStatusBadge, isFreshUpdate, currentExamStage, isUnderWay, diffCalendarDays,
} from "@/lib/lifecycle";
import { getDeadlineUrgency } from "@/lib/urgency";
import { buildTimeline } from "@/lib/timeline";
import { dateBadgeParts, formatDate } from "@/lib/utils";
import { getFilterCounts, sortOpportunities } from "@/lib/filters";
import { homeOpportunities } from "@/lib/home-priorities";
import { TodayProvider } from "@/lib/india-today";
import { JobCard } from "@/components/jobs/JobCard";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { GovernmentRecruitment, Opportunity } from "@/types";

const at = (iso: string) => new Date(iso);
// 17 Nov 2026 at 00:01 IST is 16 Nov 18:31 UTC: the 5½ hours when the UTC date and India's differ.
const IST_0001_17 = at("2026-11-16T18:31:00Z");
const IST_2359_17 = at("2026-11-17T18:29:00Z");
const IST_0001_18 = at("2026-11-17T18:31:00Z");
const IST_0529_18 = at("2026-11-17T23:59:00Z"); // still 17 Nov in UTC
const label = (deadline: string, now: Date) => getDeadlineUrgency(getDaysRemaining(deadline, now), true).label;

// A synthetic published job, built exactly as the site builds public jobs (projector → adapter).
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["e1"], conflict: false, manuallyEdited: false });
const gov = snapshotToGovernmentRecruitment(projectForPreview({
  id: "00000000-0000-4000-8000-000000000418", slug: "test-india-dates-2026", draftState: "DRAFT", recordRevision: "r",
  identity: { organizationId: "test", organizationName: "Test Recruitment Board", recruitmentYear: 2026, title: pf("TEST India Dates Recruitment 2026") },
  dates: { applicationOpenDate: pf<string | null>("2026-11-01"), applicationCloseDate: pf<string | null>("2026-11-25") },
  vacancies: { total: pf<number | null>(100) } as RecruitmentRecord["vacancies"], financial: {},
  links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://example.gov.in/n.pdf", official: true }], documents: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-11-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
  updates: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
} as RecruitmentRecord)) as GovernmentRecruitment;
const job = (application: Partial<GovernmentRecruitment["application"]>, extra: Partial<GovernmentRecruitment> = {}): GovernmentRecruitment => ({
  ...gov, ...extra, examStages: extra.examStages ?? [], updates: extra.updates ?? [],
  application: { ...gov.application, extendedCloseDate: undefined, ...application },
});

suite(`India dates (process time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

test("ID01 India's day at an instant; the UTC date differs between 00:00 and 05:30 IST", () => {
  assert.equal(indiaDay(IST_0001_17), "2026-11-17");
  assert.equal(IST_0001_17.toISOString().slice(0, 10), "2026-11-16");
  assert.equal(indiaDay(IST_2359_17), "2026-11-17");
  assert.equal(indiaDay(IST_0001_18), "2026-11-18");
  assert.equal(indiaDay(IST_0529_18), "2026-11-18");
  assert.equal(indiaDay(new Date(NaN)), "");
});

test("ID02 stored dates: date-only is the day as written; a zoned time is India's day of that instant; bad dates are empty", () => {
  assert.equal(dayOf("2026-11-17"), "2026-11-17");
  assert.equal(dayOf("2026-11-17T23:59"), "2026-11-17", "no zone: India's own wall-clock time");
  assert.equal(dayOf("2026-11-17T23:59:00+05:30"), "2026-11-17");
  assert.equal(dayOf("2026-11-17T20:00:00Z"), "2026-11-18", "20:00 UTC is 01:30 IST the next day");
  assert.equal(dayOf("2026-11-17T17:00:00-05:00"), "2026-11-18");
  for (const bad of ["", "2026-02-30", "17/11/2026", "December 2026", null, undefined]) assert.equal(dayOf(bad as never), "", String(bad));
  assert.equal(daysBetween("2026-11-17", "2026-11-18"), 1);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.ok(Number.isNaN(daysBetween("", "2026-11-18")));
  assert.equal(diffCalendarDays(IST_0001_17, IST_2359_17), 0, "same India day");
});

test("ID03 India's midnight and the noon stand-in", () => {
  assert.equal(nextIndiaMidnight(at("2026-11-17T10:00:00Z")).toISOString(), "2026-11-17T18:30:00.000Z");
  assert.equal(nextIndiaMidnight(IST_0001_17).toISOString(), "2026-11-17T18:30:00.000Z");
  assert.equal(nextIndiaMidnight(at("2026-12-31T19:00:00Z")).toISOString(), "2027-01-01T18:30:00.000Z");
  assert.equal(indiaDay(noonInIndia("2026-11-17")), "2026-11-17");
  assert.equal(noonInIndia("2026-11-17").toISOString(), "2026-11-17T06:30:00.000Z");
});

test("ID04 countdown labels across midnight IST: final day, then the first day after closing", () => {
  assert.equal(label("2026-11-17", at("2026-11-16T18:29:00Z")), "1 day left", "23:59 IST on 16 Nov");
  assert.equal(label("2026-11-17", IST_0001_17), "Last day today", "00:01 IST on 17 Nov (UTC still 16 Nov)");
  assert.equal(label("2026-11-17", IST_2359_17), "Last day today");
  assert.equal(label("2026-11-17", IST_0001_18), "Applications Closed", "00:01 IST on 18 Nov");
  assert.equal(label("2026-11-17", IST_0529_18), "Applications Closed", "05:29 IST on 18 Nov (UTC still 17 Nov)");
  assert.equal(label("2026-11-25", IST_0001_17), "8 days left");
});

test("ID05 explicit times keep their own day; nothing is extended or shortened within the day", () => {
  // A notice closing at 23:59 IST on 17 Nov is open all of 17 Nov (India), closed on 18 Nov.
  assert.equal(label("2026-11-17T23:59:00+05:30", IST_2359_17), "Last day today");
  assert.equal(label("2026-11-17T23:59:00+05:30", IST_0001_18), "Applications Closed");
  // Same calendar-day rule as date-only deadlines (an intra-day closing hour is not enforced: unchanged rule).
  assert.equal(label("2026-11-17T17:00:00+05:30", at("2026-11-17T12:00:00Z")), "Last day today", "17:30 IST, after the 17:00 hour");
});

test("ID06 status classes by India day: Upcoming, Open, Closing Soon (≤7 days), Closed; an unreadable date is never decided", () => {
  const w = (openDate: string, closeDate: string) => ({ openDate, closeDate } as GovernmentRecruitment["application"]);
  assert.equal(deriveApplicationStatus(w("2026-11-18", "2026-12-31"), IST_2359_17), "UPCOMING");
  assert.equal(deriveApplicationStatus(w("2026-11-18", "2026-12-31"), IST_0001_18), "OPEN");
  assert.equal(deriveApplicationStatus(w("2026-11-01", "2026-11-25"), IST_0001_18), "CLOSING_SOON", "7 days left");
  assert.equal(deriveApplicationStatus(w("2026-11-01", "2026-11-26"), IST_0001_18), "OPEN", "8 days left");
  assert.equal(deriveApplicationStatus(w("2026-11-01", "2026-11-17"), IST_2359_17), "CLOSING_SOON", "last day");
  assert.equal(deriveApplicationStatus(w("2026-11-01", "2026-11-17"), IST_0001_18), "APPLICATIONS_CLOSED");
  assert.equal(deriveApplicationStatus({ openDate: "2026-11-01", closeDate: "2026-11-17", extendedCloseDate: "2026-11-24" } as never, IST_0001_18), "CLOSING_SOON", "extension counts");
  assert.equal(deriveApplicationStatus(w("", ""), IST_0001_18), "OPEN", "no dates: as before");
  assert.equal(getOpportunityApplicationStatus(job({ openDate: "2026-11-01", closeDate: "2026-11-17" }), IST_0529_18), "APPLICATIONS_CLOSED");
});

test("ID07 Newly Announced (7 days) and the NEW mark on updates (3 days) count India days", () => {
  const posted = (postDate: string) => deriveStatusBadge(job({ openDate: "2026-11-01", closeDate: "2027-01-31" }, { postDate }), IST_0001_18).label;
  assert.equal(posted("2026-11-11"), "Newly Announced");
  assert.equal(posted("2026-11-10"), "Active");
  assert.equal(isFreshUpdate({ date: "2026-11-15" }, IST_0001_18), true);
  assert.equal(isFreshUpdate({ date: "2026-11-14" }, IST_0001_18), false);
  assert.equal(isFreshUpdate({ date: "2026-11-19" }, IST_0001_18), false, "future");
  assert.equal(isFreshUpdate({ date: "not a date" }, IST_0001_18), false);
});

test("ID08 exam stages and the timeline use India's day (not the server's UTC date)", () => {
  const stage = { name: "Tier-I", order: 1, status: "SCHEDULED", kind: "SELECTION", dateIso: "2026-11-17", dateEndIso: "2026-11-19" } as never;
  assert.equal(isUnderWay(stage, IST_0001_17), true, "00:01 IST on its first day");
  assert.equal(currentExamStage([stage], IST_0529_18)?.name, "Tier-I");
  const t = buildTimeline(job({ openDate: "2026-11-01", closeDate: "2026-11-16" }), IST_0001_17);
  assert.equal(t.find((e) => e.kind === "application" && e.dateIso === "2026-11-16")?.state, "done", "closed yesterday in India");
});

test("ID09 lists: counts, the 'closing soon' order and the home split follow India's day", () => {
  const a = job({ openDate: "2026-11-01", closeDate: "2026-11-17" }, { id: "a", slug: "a", title: "A closes 17 Nov" });
  const b = job({ openDate: "2026-11-01", closeDate: "2026-11-30" }, { id: "b", slug: "b", title: "B closes 30 Nov" });
  const list = [a, b] as Opportunity[];
  const on17 = getFilterCounts(list, IST_0001_17), on18 = getFilterCounts(list, IST_0001_18);
  assert.equal(on17.byAppStatus.APPLICATIONS_CLOSED ?? 0, 0);
  assert.equal(on18.byAppStatus.APPLICATIONS_CLOSED ?? 0, 1, "A closed from 00:01 IST on 18 Nov");
  assert.deepEqual(sortOpportunities(list, "deadline", IST_0001_17).map((o) => o.id), ["a", "b"]);
  const home17 = homeOpportunities(list, IST_0001_17), home18 = homeOpportunities(list, IST_0001_18);
  assert.ok(JSON.stringify(home17).includes("A closes 17 Nov"));
  assert.notDeepEqual(home18, home17);
});

test("ID10 calendar badges read the date as written (the same in every time zone)", () => {
  assert.deepEqual(dateBadgeParts("2026-08-21"), { month: "AUG", day: "21" });
  assert.deepEqual(dateBadgeParts("2026-01-05T10:00:00Z"), { month: "JAN", day: "5" });
  for (const bad of [undefined, "", "TBA", "2026-13-01"]) assert.deepEqual(dateBadgeParts(bad), { month: "TBA", day: "—" }, String(bad));
  assert.equal(formatDate("2026-11-17"), "17 Nov 2026");
});

test("ID11 server render and first browser render use the page's own date (TodayProvider), not the clock", () => {
  const closing = job({ openDate: "2026-11-01", closeDate: "2026-11-25" });
  const drawn = (renderedOn: string) => renderToStaticMarkup(<TodayProvider renderedOn={renderedOn}><JobCard job={closing} /></TodayProvider>);
  assert.match(drawn("2026-11-17"), /8 days left/);
  assert.match(drawn("2026-11-18"), /7 days left/);
  assert.match(drawn("2026-11-25"), /Last day today/);
  assert.match(drawn("2026-11-26"), /Applications Closed/);
  // an explicit `now` still wins (callers that pass one keep their behaviour)
  assert.match(renderToStaticMarkup(<TodayProvider renderedOn="2026-11-17"><JobCard job={closing} now={IST_0001_18} /></TodayProvider>), /7 days left/);
});

test("ID12 no component works out 'today' from the machine's clock or calendar any more; nothing hides a mismatch", () => {
  const files = ["src/components/jobs/JobCard.tsx", "src/components/jobs/MarketplaceJobCard.tsx", "src/components/jobs/JobDetailHeader.tsx",
    "src/components/jobs/JobDetailSections.tsx", "src/components/jobs/JobFiltersSidebar.tsx", "src/components/jobs/RecruitmentTimeline.tsx",
    "src/components/common/Ticker.tsx", "src/components/discovery/CareerOrbitCenterpiece.tsx", "src/components/organizations/PopularOrganizationsBento.tsx",
    "src/components/jobs/MuhuratCard.tsx", "src/components/tools/PrepareToApply.tsx", "src/app/(main)/HomePageClient.tsx",
    "src/app/(main)/jobs/JobsPageClient.tsx", "src/app/(main)/eligibility/EligibilityFinderClient.tsx",
    "src/components/exams/UpcomingExamCard.tsx", "src/components/exams/UpcomingExamsTimeline.tsx"];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/new Date\(\)/.test(s), `${f}: no new Date()`);
    assert.ok(!/getFullYear\(\)|getMonth\(\)|getDate\(\)/.test(s), `${f}: no local-calendar parts`);
    assert.ok(!/suppressHydrationWarning/.test(s), `${f}: no suppressed mismatch`);
  }
  const lifecycle = readFileSync("src/lib/lifecycle.ts", "utf8");
  assert.ok(!/getFullYear\(\)|getMonth\(\)|getDate\(\)/.test(lifecycle), "lifecycle: no local-calendar parts");
  assert.ok(!/toISOString\(\)\.slice\(0, 10\)/.test(readFileSync("src/lib/timeline.ts", "utf8").replace("indiaDay", "")), "timeline: no UTC day");
  const layout = readFileSync("src/app/(main)/layout.tsx", "utf8");
  assert.match(layout, /<TodayProvider renderedOn=\{renderedOn\}>/);
});
