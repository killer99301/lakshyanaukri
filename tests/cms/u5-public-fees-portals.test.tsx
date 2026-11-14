// CMS 2.0 U5: the category fee table and every Apply Online portal, shown to applicants exactly as saved, on the
// public page and the editor's preview alike (same snapshot → same page data → same components).
// SYNTHETIC data only: invented boards and posts. The two portal hosts are the public apprenticeship portals,
// used as a synthetic regression of the SAIL case (graduate/diploma on one portal, ITI trades on the other).
//   npx tsx --tsconfig tsconfig.json tests/cms/u5-public-fees-portals.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { Opportunity } from "@/types";
import type { CmsRecruitmentLink, FeeRow, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import { notShownPublicly } from "@/lib/cms/public-parity";
import { assembleReview } from "@/lib/cms/publication-review";
import { liveChanges } from "@/lib/cms/live-changes";
import { feeOverlaps } from "@/lib/cms/importer/fee-table";

const ADMIN = "0a0a0a0a-1111-4222-8333-444455556666";
const SECRET = "INTERNAL-REASON-never-public";
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const link = (type: CmsRecruitmentLink["type"], url: string, label: string, appliesTo?: string): CmsRecruitmentLink => ({ type, label, url, official: true, ...(appliesTo ? { appliesTo } : {}) });
const NATS = link("APPLY_ONLINE", "https://nats.education.gov.in/", "NATS portal", "Graduate and Diploma apprentices");
const ITI = link("APPLY_ONLINE", "https://www.apprenticeshipindia.gov.in/", "Apprenticeship portal", "ITI apprentices");
const ALL: FeeRow[] = [
  { category: "General/EWS/OBC", groups: ["general", "ews", "obc"], amount: 750 },
  { category: "SC/ST/PwBD", groups: ["sc", "st", "pwbd"], amount: 0, exempt: true },
  { category: "Women", groups: ["women"], amount: 0, exempt: true },
  { category: "Ex-Servicemen", groups: ["esm"], amount: 0, exempt: true, note: "Only for the first attempt" },
];
const POSTWISE: FeeRow[] = [
  { category: "General", groups: ["general"], amount: 750, post: "Assistant Manager" },
  { category: "General", groups: ["general"], amount: 500, post: "Junior Assistant" },
  { category: "SC/ST/PwBD", groups: ["sc", "st", "pwbd"], amount: 0, exempt: true },
];

function record(over: { feeTable?: FeeRow[]; links?: CmsRecruitmentLink[]; open?: string; close?: string; updates?: unknown[] } = {}): RecruitmentRecord {
  return {
    id: "rec-u5", slug: "test-u5-apprentice-2097", draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: "test-steel", organizationName: "Test Steel Plant", recruitmentYear: 2097, title: pf("TEST U5 Apprentice Recruitment 2097") },
    dates: { applicationOpenDate: pf(over.open ?? "2097-01-01"), applicationCloseDate: pf(over.close ?? "2097-12-31") }, vacancies: {},
    financial: { feeGeneral: pf<number | null>(750), feeSCST: pf<number | null>(0), ...(over.feeTable ? { feeTable: pf(over.feeTable) } : {}) },
    links: over.links ?? [NATS], documents: [], updates: over.updates ?? [],
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] }, provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2097-01-01", primarySourceType: "NOT_VERIFIED" },
    createdAt: "2097-01-01T00:00:00Z", updatedAt: "2097-01-01T00:00:00Z", createdBy: ADMIN, updatedBy: ADMIN,
  } as unknown as RecruitmentRecord;
}
const page = (r: RecruitmentRecord) => snapshotToGovernmentRecruitment(projectForPreview(r)) as unknown as Opportunity & { feeTable?: unknown[]; applyPortals?: Array<{ url: string; appliesTo?: string }> };
const NOW = new Date("2097-06-01T06:00:00Z");
const html = (r: RecruitmentRecord) => renderToStaticMarkup(<><JobDetailHeader job={page(r)} now={NOW} /><JobDetailSections job={page(r)} now={NOW} /></>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

suite("U5: category-wise fees");

test("F01 an older job without a fee table keeps its two summary fees exactly as before", () => {
  const h = html(record());
  assert.ok(!h.includes("data-fee-table"));
  assert.ok(text(h).includes("General (UR)") && text(h).includes("₹750"));
});

test("F02 every category in the table is shown, exemptions written out, and the summary rows are not shown twice", () => {
  const t = text(html(record({ feeTable: ALL })));
  for (const s of ["General/EWS/OBC", "₹750", "SC/ST/PwBD", "Women", "Ex-Servicemen", "Only for the first attempt"]) assert.ok(t.includes(s), s);
  assert.equal((t.match(/No fee \(exempt\)/g) ?? []).length, 3);
  assert.ok(!t.includes("General (UR)"), "no duplicate summary row beside the table");
});

test("F03 post-wise fees are grouped under their post; rows for every post come first", () => {
  const t = text(html(record({ feeTable: POSTWISE })));
  const all = t.indexOf("For all posts"), am = t.indexOf("For Assistant Manager"), ja = t.indexOf("For Junior Assistant");
  assert.ok(all >= 0 && am > all && ja > am, t.slice(t.indexOf("Application Fee"), t.indexOf("Application Fee") + 400));
  assert.ok(t.includes("₹500") && t.includes("₹750"));
});

test("F04 nothing is inferred: a category the table does not list is not invented, and the reader is pointed to the notice", () => {
  const t = text(html(record({ feeTable: [ALL[0]] })));
  assert.ok(!t.includes("SC/ST") && !t.includes("No fee"), "no exemption shown that the table does not give");
  assert.ok(t.includes("A category not listed here is not covered by this table: check the notice."));
});

suite("U5: several Apply Online portals");

test("P01 the SAIL case: both portals, each with who it is for; the header leads to the list", () => {
  const h = html(record({ links: [NATS, ITI] }));
  const t = text(h);
  assert.equal((h.match(/data-apply-portal /g) ?? h.match(/data-apply-portal=/g) ?? h.match(/data-apply-portal\b/g) ?? []).length >= 2, true);
  assert.ok(t.includes("For: Graduate and Diploma apprentices") && t.includes("For: ITI apprentices"));
  assert.ok(t.includes("nats.education.gov.in") && t.includes("apprenticeshipindia.gov.in"));
  assert.ok(h.includes('href="#apply-portals"') && t.includes("Apply Online · 2 portals"));
  assert.equal((h.match(/data-portal-action/g) ?? []).length, 2, "two live Apply buttons while open");
});

test("P02 the same portal saved twice (www, trailing slash) is shown once, keeping who it is for", () => {
  const p = page(record({ links: [NATS, link("APPLY_ONLINE", "https://www.nats.education.gov.in", "NATS again"), ITI] }));
  assert.equal(p.applyPortals?.length, 2);
  assert.equal(p.applyPortals?.[0].appliesTo, "Graduate and Diploma apprentices");
});

test("P03 applications closed: no live Apply action anywhere; each portal kept for reference, its site named", () => {
  const h = html(record({ links: [NATS, ITI], open: "2097-01-01", close: "2097-02-01" }));
  const t = text(h);
  assert.ok(!h.includes("data-portal-action") && !h.includes('href="#apply-portals"'));
  assert.ok(t.includes("Where applications were taken") && t.includes("listed for reference only") && (h.match(/data-portal-closed/g) ?? []).length === 2);
  assert.ok(!h.includes('href="https://nats.education.gov.in/"'), "a closed portal is not a link to apply");
  assert.ok(t.includes("Applications Closed"), "the header says closed, as before");
});

test("P04 not open yet: no live Apply action; the opening date is said", () => {
  const h = html(record({ links: [NATS, ITI], open: "2097-08-01", close: "2097-09-01" }));
  assert.ok(!h.includes("data-portal-action") && text(h).includes("Not open yet") && text(h).includes("Applications open on"));
});

test("P05 a portal whose audience is not saved says so, never guesses", () => {
  const t = text(html(record({ links: [NATS, link("APPLY_ONLINE", "https://apply.example.gov.in/", "Second portal")] })));
  assert.ok(t.includes("Who it is for is not stated here: check the notice"));
});

test("P06 one portal without an audience: the page is exactly as before (no list)", () => {
  const h = html(record({ links: [link("APPLY_ONLINE", "https://apply.example.gov.in/", "Apply")] }));
  assert.ok(!h.includes("data-apply-portals") && h.includes('data-apply-kind="apply"'));
});

test("P07 an aggregator page is never an Apply portal, and the publication review still says so", () => {
  const r = record({ links: [NATS, ITI, link("APPLY_ONLINE", "https://www.sarkariresult.com/x", "Aggregator")] });
  assert.equal(page(r).applyPortals?.length, 2);
  assert.ok(notShownPublicly(r).some((s) => /aggregator page is never shown/.test(s)));
});

suite("U5: preview parity, warnings, privacy, mobile");

test("W01 what is now shown is no longer warned about; the review warns only for what the page leaves out", () => {
  assert.deepEqual(notShownPublicly(record({ feeTable: [...ALL, ...POSTWISE], links: [NATS, ITI] })), []);
  const base = { today: "2097-06-01", imported: false, freshness: { recordRevision: "r1", claimSeq: 0, retrievals: 0 }, standings: {}, conflictValues: {}, officialDocuments: 0, duplicates: [], filled: [] };
  const r = assembleReview({ ...base, record: record({ feeTable: ALL, links: [NATS, ITI] }) } as never);
  assert.ok(!r.warnings.some((w) => w.code === "NOT_SHOWN_PUBLICLY"));
});

test("W02 'Publishing will change' lists the fee table and who each portal is for", () => {
  const live = projectForPreview(record({ links: [{ ...NATS, appliesTo: undefined }] }));
  const next = projectForPreview(record({ feeTable: ALL, links: [NATS] }));
  const lines = liveChanges(live, next).map((l) => `${l.label}: ${l.after}`);
  assert.ok(lines.some((l) => l.startsWith("Fees by category:") && l.includes("Women: no fee")));
  assert.ok(lines.some((l) => l.includes("for whom: Graduate and Diploma apprentices")));
});

test("W03 the page data carries no internal note, admin id, evidence or fee-group codes", () => {
  const r = record({ feeTable: ALL, links: [NATS, ITI], updates: [{ id: "u1", date: "2097-02-01", type: "GENERAL_NOTICE", title: "Old", description: "x", superseded: { on: "2097-02-02", by: ADMIN, reason: SECRET } }] });
  const data = JSON.stringify(page(r));
  assert.ok(!data.includes(SECRET) && !data.includes(ADMIN));
  assert.ok(!/"(by|reason|createdBy|updatedBy|evidenceIds|groups|claims)"\s*:/.test(data));
  const h = html(r);
  assert.ok(!h.includes(SECRET) && !h.includes(ADMIN));
});

test("W04 phone layout: the fee table scrolls inside its box; portal rows stack with full-width buttons", () => {
  const h = html(record({ feeTable: ALL, links: [NATS, ITI] }));
  assert.match(h, /data-fee-table[\s\S]*?class="overflow-x-auto/);
  assert.match(h, /data-apply-portal[^>]*class="flex flex-col sm:flex-row/);
  assert.match(h, /data-portal-action[^>]*class="[^"]*w-full sm:w-auto/);
});

test("W05 the editor's preview and the live page are built by the same functions from the same snapshot", async () => {
  const { readFileSync } = await import("node:fs");
  const admin = readFileSync("src/app/admin/cms/[id]/page.tsx", "utf8");
  assert.match(admin, /snapshotToGovernmentRecruitment\(snapshot\)/);
  assert.match(admin, /<JobDetailSections job=\{previewJob\} \/>/);
});

suite("U5: fee rows that disagree are flagged, never settled");


test("F05 a fee for all posts and a different one for a post, for the same candidates: flagged on the page and before publishing", () => {
  const rows: FeeRow[] = [ALL[0], { category: "General", groups: ["general"], amount: 500, post: "Trade Apprentice (ITI)" }];
  const t = text(html(record({ feeTable: rows })));
  assert.ok(t.includes("Check the notice:") && t.includes("General/EWS/OBC (all posts): ₹750 and General (Trade Apprentice (ITI)): ₹500"), t.slice(t.indexOf("Application Fee"), t.indexOf("Application Fee") + 500));
  const base = { today: "2097-06-01", imported: false, freshness: { recordRevision: "r1", claimSeq: 0, retrievals: 0 }, standings: {}, conflictValues: {}, officialDocuments: 0, duplicates: [], filled: [] };
  const r = assembleReview({ ...base, record: record({ feeTable: rows }) } as never);
  assert.ok(r.warnings.some((w) => w.code === "FEE_ROWS_OVERLAP"));
  assert.ok(!r.hardRules.some((h) => h.code === "FEE_ROWS_OVERLAP"), "advice, not a block");
});

test("F06 not flagged: separate categories (an exemption beside a fee), separate posts, or the same fee twice", () => {
  assert.deepEqual(feeOverlaps(ALL), [], "Women/SC/ST exempt beside General ₹750");
  assert.deepEqual(feeOverlaps(POSTWISE.filter((r) => r.post)), [], "two posts, two fees");
  assert.deepEqual(feeOverlaps([ALL[0], { ...ALL[0], post: "Clerk" }]), [], "the same fee for a post as for all posts");
  assert.ok(!text(html(record({ feeTable: ALL }))).includes("Check the notice:"));
});

test("F07 flagged: the same post given two fees, and a row for all candidates that disagrees", () => {
  assert.equal(feeOverlaps([{ category: "General", groups: ["general"], amount: 500, post: "Clerk" }, { category: "General/OBC", groups: ["general", "obc"], amount: 600, post: "clerk" }]).length, 1);
  assert.equal(feeOverlaps([{ category: "All candidates", groups: ["all"], amount: 100 }, ALL[1]]).length, 1);
});

test("F08 preview and live page carry the same caution (one page builder), and no internal codes reach the page", () => {
  const p = page(record({ feeTable: [ALL[0], { category: "General", groups: ["general"], amount: 500, post: "ITI" }] })) as unknown as { feeTableOverlaps?: string[] };
  assert.equal(p.feeTableOverlaps?.length, 1);
  assert.ok(!JSON.stringify(p).includes('"groups"'));
});
