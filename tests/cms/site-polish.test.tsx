// Public website polish (owner-approved, 11 Nov 2026): the homepage puts notices taking applications first and
// lists closed ones apart; /jobs?status=open; the jobs list is drawn in advance instead of a loading line; the
// channel strip fails safe; short month labels; the Coming soon tool cards. Pure: no browser, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/site-polish.test.tsx

import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { homeOpportunities, indiaToday } from "@/lib/home-priorities";
import { jobsUrlState, searchOpportunities, getDefaultFilterState } from "@/lib/filters";
import ToolsPage from "@/app/(main)/tools/page";
import type { Opportunity } from "@/types";
import type { RecruitmentRecord, ProvenanceField, FinancialInformation } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import { feeCategoriesNote, GENERAL_FEE_LABEL } from "@/lib/fee-labels";

const NOW = new Date("2026-11-11T12:00:00");
let n = 0;
/** A government notice with its own application dates; `updated` orders "newest first". */
const job = (title: string, openDate: string, closeDate: string, updated: string) => ({
  id: `j${++n}`, slug: title.toLowerCase().replace(/\W+/g, "-"), type: "government", title, organizationName: "Test Body",
  application: { openDate, closeDate }, lastUpdated: updated, postedDate: updated, publishedAt: updated, updatedAt: updated,
} as unknown as Opportunity);

const closedNew = job("Closed but newest", "2026-10-01", "2026-11-02", "2026-11-11");
const openOld = job("Open, older", "2026-10-20", "2026-12-20", "2026-10-25");
const closingSoon = job("Closing soon", "2026-10-15", "2026-11-14", "2026-11-05");
const upcoming = job("Opens next month", "2026-12-01", "2026-12-31", "2026-11-09");
const closedOld = job("Closed long ago", "2026-08-01", "2026-09-01", "2026-09-02");

suite("The homepage puts open applications first");
test("SP01 open and closing-soon notices lead, then upcoming; a closed notice is never featured, however new", () => {
  const p = homeOpportunities([closedNew, openOld, closingSoon, upcoming, closedOld], NOW);
  assert.deepEqual(p.open.map((j) => j.title).sort(), ["Closing soon", "Open, older"]);
  assert.deepEqual(p.featured.map((j) => j.title).slice(2), ["Opens next month"], "upcoming only after every open notice");
  assert.ok(!p.featured.some((j) => /Closed/.test(j.title)), "being newest to the site is not being open");
  assert.deepEqual(p.closed.map((j) => j.title), ["Closed but newest", "Closed long ago"], "closed notices kept, newest first");
});
test("SP02 the last day itself is still open; the day after is closed", () => {
  const lastDay = job("Last day today", "2026-10-01", "2026-11-11", "2026-11-01");
  const yesterday = job("Closed yesterday", "2026-10-01", "2026-11-10", "2026-11-01");
  const p = homeOpportunities([lastDay, yesterday], NOW);
  assert.deepEqual(p.featured.map((j) => j.title), ["Last day today"]);
  assert.deepEqual(p.closed.map((j) => j.title), ["Closed yesterday"]);
});
test("SP03 India's date, for the page drawn on the server", () => {
  assert.equal(indiaToday(Date.UTC(2026, 10, 10, 18, 29)), "2026-11-10", "23:59 IST");
  assert.equal(indiaToday(Date.UTC(2026, 10, 10, 18, 30)), "2026-11-11", "midnight IST");
});
test("SP04 the homepage source: Open for Applications, closed apart, the two quick actions", () => {
  const src = readFileSync("src/app/(main)/HomePageClient.tsx", "utf8");
  assert.match(src, /title="Open for Applications"/);
  assert.ok(!/title="Latest Opportunities"/.test(src));
  assert.match(src, /data-home-recently-closed/);
  assert.match(src, /href="\/jobs\?status=open"/);
  assert.match(src, /href="\/eligibility"/);
});

suite("/jobs");
test("SP05 /jobs?status=open shows only notices taking applications", () => {
  const state = jobsUrlState(new URLSearchParams("status=open"));
  assert.deepEqual(state.filters.applicationStatuses, ["OPEN", "CLOSING_SOON"]);
  const shown = searchOpportunities([closedNew, openOld, closingSoon, upcoming], "", "All India", state.filters, "latest", NOW).map((j) => j.title).sort();
  assert.deepEqual(shown, ["Closing soon", "Open, older"]);
  assert.deepEqual(jobsUrlState(new URLSearchParams("")).filters, getDefaultFilterState(), "no parameter: no filter");
});
test("SP06 the page drawn in advance is the unfiltered list, not a loading line", () => {
  const src = readFileSync("src/app/(main)/jobs/JobsPageClient.tsx", "utf8");
  assert.ok(!/Loading Jobs Marketplace/.test(src));
  assert.match(src, /<Suspense fallback=\{<JobsPageContent opportunities=\{opportunities\} searchParams=\{NO_PARAMS\} \/>\}>/);
});

suite("The channel strip fails safe");
test("SP07 hidden until the page is known to have no Apply button on screen, on every page", () => {
  const src = readFileSync("src/components/layout/ChannelStrip.tsx", "utf8");
  assert.match(src, /useState<"unknown" \| "inView" \| "clear">\("unknown"\)/, "starts unknown");
  assert.match(src, /const stepAside = applyState !== "clear";/, "only a known-clear page shows it");
  assert.match(src, /setApplyState\("unknown"\)/, "unknown again when leaving a page");
  assert.match(src, /querySelectorAll\("\[data-apply-kind\], \[data-keep-clear\]"\)/, "Apply buttons and marked controls");
  assert.match(readFileSync("src/app/(main)/HomePageClient.tsx", "utf8"), /data-home-quick-actions data-keep-clear/, "the homepage's two main buttons are kept clear");
});

suite("Application Tools");
test("SP08 Coming soon cards are plainly unavailable and come after the working tools", () => {
  const html = renderToStaticMarkup(<ToolsPage />);
  const order = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(order, ["Photo &amp; Signature", "Age &amp; Eligibility", "PDF Utilities", "Document Checker"]);
  assert.equal((html.match(/data-tool-coming-soon/g) ?? []).length, 2);
  assert.equal((html.match(/Not available yet\. It will open here when it is ready\./g) ?? []).length, 2);
  assert.ok(!/href="\/tools\/pdf|href="\/tools\/document/.test(html), "never linked");
});

suite("Fees: General (UR) only, the rest pointed to the notice");
const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const feeJob = (financial: FinancialInformation) => snapshotToGovernmentRecruitment(projectForPreview({
  id: "rec-fee", slug: "test-fee-2099", draftState: "DRAFT", recordRevision: "r1",
  identity: { organizationId: "test-board", organizationName: "Test Board", recruitmentYear: 2099, title: pending("TEST FEE 2099") },
  dates: {}, vacancies: {}, financial, links: [], documents: [], updates: [],
  lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2099-01-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
  createdAt: "2099-01-01T00:00:00Z", updatedAt: "2099-01-01T00:00:00Z",
} as RecruitmentRecord)) as unknown as Opportunity & { fee?: { rows: Array<{ category: string; amount: number | null; note?: string }> } };
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/₹/g, "₹").replace(/\s+/g, " ");

test("SP09 SBI Fire's saved ₹750 is shown as General (UR) only; EWS and OBC are pointed to the notice", () => {
  const job = feeJob({ feeGeneral: pending(750) });
  assert.deepEqual(job.fee?.rows, [{ category: "General (UR)", amount: 750 }], "the saved amount, unchanged");
  assert.equal(GENERAL_FEE_LABEL, "General (UR)");
  const html = text(renderToStaticMarkup(<JobDetailSections job={job} />));
  assert.match(html, /General \(UR\) ₹750/);
  assert.ok(!/General \/ OBC|General \/ EWS/.test(html), "no category claimed that the record does not hold");
  assert.match(html, /Fees for EWS, OBC, SC, ST and PwBD candidates are not listed separately here\. Check the official notification for them\./);
});
test("SP10 a notice where EWS and OBC pay less than General: nothing implies they pay the General amount", () => {
  // e.g. General ₹1,000; EWS / OBC ₹800; SC / ST / PwBD nil. The CMS holds the General and SC / ST / PwBD amounts.
  const job = feeJob({ feeGeneral: pending(1000), feeSCST: pending(0) });
  assert.deepEqual(job.fee?.rows.map((r) => [r.category, r.amount]), [["General (UR)", 1000], ["SC / ST / PwBD", 0]]);
  const html = text(renderToStaticMarkup(<JobDetailSections job={job} />));
  assert.match(html, /General \(UR\) ₹1,000/);
  assert.ok(!/EWS[^.]*₹1,000|OBC[^.]*₹1,000/.test(html), "the General amount is never given to EWS or OBC");
  assert.match(html, /Fees for EWS and OBC candidates are not listed separately here\. Check the official notification for them\./);
  assert.ok(!/₹800/.test(html), "no amount is inferred for them");
});
test("SP11 the note names only the categories without a row; no table, no note", () => {
  assert.equal(feeCategoriesNote([]), null);
  assert.match(feeCategoriesNote([{ category: "General (UR)" }])!, /EWS, OBC, SC, ST and PwBD/);
  assert.match(feeCategoriesNote([{ category: "General (UR)" }, { category: "SC / ST / PwBD" }])!, /^Fees for EWS and OBC candidates/);
  const notSaid = feeJob({ feeGeneral: { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true } });
  assert.deepEqual(notSaid.fee?.rows, [{ category: "General (UR)", amount: null, note: "Not specified in the notice" }], "a blank General fee stays blank, as before");
});
