// React #418 follow-up (Nov 2026): the "New" badge on job cards counts India calendar days, like every other badge.
// New on the India day a job went live (day 0) through day 7; not from day 8; never for a missing, unreadable or
// future date; never for a closed job. Before this, the badge compared exact hours with the page's stand-in "now"
// (noon in India), so a job published after 12:00 IST showed no badge for the rest of its first day.
// Run in two process time zones (results must not depend on the machine's zone):
//   npx tsx --tsconfig tsconfig.json tests/cms/new-badge.test.tsx
//   TZ=UTC npx tsx --tsconfig tsconfig.json tests/cms/new-badge.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { isNewlyAdded } from "@/lib/filters";
import { noonInIndia } from "@/lib/lifecycle";
import { TodayProvider } from "@/lib/india-today";
import { MarketplaceJobCard } from "@/components/jobs/MarketplaceJobCard";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { GovernmentRecruitment } from "@/types";

// A synthetic job built exactly as the site builds public jobs (projector → adapter); open until 31 Dec 2026.
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["e1"], conflict: false, manuallyEdited: false });
const base = snapshotToGovernmentRecruitment(projectForPreview({
  id: "00000000-0000-4000-8000-0000000000ae", slug: "test-new-badge-2026", draftState: "DRAFT", recordRevision: "r",
  identity: { organizationId: "test", organizationName: "Test Recruitment Board", recruitmentYear: 2026, title: pf("TEST New Badge Recruitment 2026") },
  dates: { applicationOpenDate: pf<string | null>("2026-11-01"), applicationCloseDate: pf<string | null>("2026-12-31") },
  vacancies: { total: pf<number | null>(100) } as RecruitmentRecord["vacancies"], financial: {},
  links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://example.gov.in/n.pdf", official: true }], documents: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-11-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
  updates: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
} as RecruitmentRecord)) as GovernmentRecruitment;
const job = (addedAt: string | undefined, closeDate = "2026-12-31"): GovernmentRecruitment =>
  ({ ...base, addedAt, application: { ...base.application, closeDate, extendedCloseDate: undefined } });
// IST moments as UTC instants: IST = UTC + 5:30
const ist = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00+05:30`));

suite(`"New" badge by India calendar day (process time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

test("NB01 published 09:00 IST, viewed 16:00 IST the same day: New", () => {
  assert.equal(isNewlyAdded(job(ist("2026-11-17", "09:00").toISOString()), ist("2026-11-17", "16:00")), true);
});

test("NB02 published 15:00 IST (after noon), viewed 16:00 IST the same day: New (the regression)", () => {
  const added = ist("2026-11-17", "15:00").toISOString();
  assert.equal(isNewlyAdded(job(added), ist("2026-11-17", "16:00")), true);
  // also with the page's stand-in "now" (noon in India), which cards receive while hydrating
  assert.equal(isNewlyAdded(job(added), noonInIndia("2026-11-17")), true);
});

test("NB03 published 23:59 IST: New that day and the next; the India day is used, not the UTC date", () => {
  const added = ist("2026-11-17", "23:59").toISOString(); // 18:29 UTC on 17 Nov
  assert.equal(added.slice(0, 10), "2026-11-17");
  assert.equal(isNewlyAdded(job(added), ist("2026-11-17", "23:59")), true, "same minute");
  assert.equal(isNewlyAdded(job(added), ist("2026-11-18", "00:01")), true, "day 1");
  // published 00:01 IST on 18 Nov = 18:31 UTC on 17 Nov: day 0 is 18 Nov in India
  const justAfter = ist("2026-11-18", "00:01").toISOString();
  assert.equal(justAfter.slice(0, 10), "2026-11-17", "UTC still 17 Nov");
  assert.equal(isNewlyAdded(job(justAfter), ist("2026-11-17", "23:59")), false, "before it went live (India day 17 < 18)");
  assert.equal(isNewlyAdded(job(justAfter), ist("2026-11-18", "00:02")), true);
});

test("NB04 day 0 and day 7 are New; day 8 is not (whatever the hour)", () => {
  const added = ist("2026-11-10", "18:00").toISOString();
  assert.equal(isNewlyAdded(job(added), ist("2026-11-10", "18:01")), true, "day 0");
  assert.equal(isNewlyAdded(job(added), ist("2026-11-17", "00:01")), true, "day 7, early");
  assert.equal(isNewlyAdded(job(added), ist("2026-11-17", "23:59")), true, "day 7, late");
  assert.equal(isNewlyAdded(job(added), ist("2026-11-18", "00:00")), false, "day 8");
  assert.equal(isNewlyAdded(job("2026-11-10"), ist("2026-11-17", "12:00")), true, "date-only value, day 7");
  assert.equal(isNewlyAdded(job("2026-11-10"), ist("2026-11-18", "12:00")), false, "date-only value, day 8");
});

test("NB05 missing, unreadable or future dates are never New; a closed job is never New", () => {
  const now = ist("2026-11-17", "16:00");
  for (const bad of [undefined, "", "not a date", "2026-02-30T10:00:00Z"]) assert.equal(isNewlyAdded(job(bad), now), false, String(bad));
  assert.equal(isNewlyAdded(job(ist("2026-11-18", "09:00").toISOString()), now), false, "future (tomorrow in India)");
  assert.equal(isNewlyAdded(job(ist("2026-11-17", "09:00").toISOString(), "2026-11-16"), now), false, "closed yesterday");
});

test("NB06 the same instant gives the same answer whatever the machine's time zone (pure India-day arithmetic)", () => {
  // The function reads only instants and India days; in browsers, cards receive "today" from TodayProvider.
  const added = ist("2026-11-17", "15:00").toISOString();
  const answers = ["2026-11-17T10:30:00Z", "2026-11-17T18:29:00Z", "2026-11-17T18:31:00Z", "2026-11-25T18:31:00Z"]
    .map((m) => isNewlyAdded(job(added), new Date(m)));
  assert.deepEqual(answers, [true, true, true, false], "16:00 IST, 23:59 IST, 00:01 IST next day, day 9");
});

test("NB07 the card shows the badge from the page's India date while drawn and hydrated (no #418 from the badge)", () => {
  const card = (renderedOn: string, addedAt: string) =>
    renderToStaticMarkup(<TodayProvider renderedOn={renderedOn}><MarketplaceJobCard job={job(addedAt)} /></TodayProvider>);
  const pill = /bg-gradient-to-r from-\[#EA580C\][^>]*>[\s\S]*?New<\/span>/;
  const afternoon = ist("2026-11-17", "15:00").toISOString();
  assert.match(card("2026-11-17", afternoon), pill, "published after noon: New on its own day");
  assert.match(card("2026-11-24", afternoon), pill, "day 7");
  assert.doesNotMatch(card("2026-11-25", afternoon), pill, "day 8");
  assert.doesNotMatch(card("2026-11-16", afternoon), pill, "page drawn before it went live");
});
