// CMS 2.0 U5 correction (14 Nov 2026): a general fee with EXPLICITLY STATED exceptions is not a contradiction;
// real clashes and unstated precedence are still flagged. Found by the competitor investigation: a portal writes
// "All candidates (except categories below) Rs. 500/-" then "SC, ST, … Rs. 250/-", ordinary notice wording that the
// U5 overlap check flagged. SYNTHETIC lines only (no portal's text).
//   npx tsx --tsconfig tsconfig.json tests/cms/u5-fee-exceptions.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { FeeRow, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { readFeeLines, feeOverlaps, legacyFees } from "@/lib/cms/importer/fee-table";
import { cleanFeeTable } from "@/lib/cms/record-ops";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import type { Opportunity } from "@/types";

const read = (...texts: string[]) => readFeeLines(texts.map((text, i) => ({ line: i + 1, text })));
const rowsOf = (...texts: string[]) => read(...texts).rows.map(({ line, quote, ...r }) => { void line; void quote; return r as FeeRow; });

suite("U5 correction: stated exceptions are not contradictions");

test("E01 a general fee with exceptions listed below it (the reported case): no overlap", () => {
  const rows = rowsOf("Application Fee:", "All candidates (except categories below): Rs. 500/-", "SC, ST, Ex-Servicemen, Female, Transgender: Rs. 250/-");
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.deepEqual(feeOverlaps(rows), [], JSON.stringify(rows));
});

test("E02 the same on one line: 'All candidates Rs. 500, except SC/ST/Female Rs. 250': no overlap", () => {
  const rows = rowsOf("Application Fee: All candidates Rs. 500, except SC/ST/Female Rs. 250");
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.deepEqual(feeOverlaps(rows), [], JSON.stringify(rows));
});

test("E03 'All candidates except SC/ST Rs. 500': the excepted categories are NOT given ₹500", () => {
  const rows = rowsOf("Application Fee: All candidates except SC/ST Rs. 500");
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].groups.includes("sc") && !rows[0].groups.includes("st"), JSON.stringify(rows[0]));
  const legacy = legacyFees(rows);
  assert.equal(legacy.feeGeneral, 500);
  assert.equal(legacy.feeSCST, undefined, "SC/ST pay no stated fee here; never ₹500");
  const withNil = rowsOf("Application Fee: All candidates except SC/ST Rs. 500", "SC/ST: Nil");
  assert.deepEqual(feeOverlaps(withNil), []);
  assert.equal(legacyFees(withNil).feeSCST, 0);
});

test("E04 an exception that is not one of those stated still clashes: 'except SC/ST ₹500' beside 'Women ₹250' is flagged", () => {
  const rows = rowsOf("Application Fee: All candidates except SC/ST Rs. 500", "Women: Rs. 250");
  assert.equal(feeOverlaps(rows).length, 1, JSON.stringify(rows));
});

suite("U5 correction: what must stay as before");

test("E05 distinct category fees: no overlap", () => {
  assert.deepEqual(feeOverlaps(rowsOf("Application Fee: General/EWS/OBC Rs. 750, SC/ST Rs. 250")), []);
});

test("E06 distinct post-wise fees: no overlap", () => {
  assert.deepEqual(feeOverlaps(rowsOf("Application Fee (Assistant Manager): General Rs. 750", "Application Fee (Clerk): General Rs. 500")), []);
});

test("E07 a fee for all posts and a different one for an ITI post, with no stated precedence: flagged", () => {
  assert.equal(feeOverlaps(rowsOf("Application Fee: General/EWS/OBC Rs. 750, SC/ST Nil", "Application Fee (Trade Apprentice ITI): General Rs. 500")).length, 1);
  // A category exception is not a post exception: still flagged.
  assert.equal(feeOverlaps(rowsOf("Application Fee:", "All candidates (except categories below): Rs. 500/-", "SC, ST: Rs. 250/-", "Application Fee (Trade Apprentice ITI): General Rs. 300")).length >= 1, true);
});

test("E08 a plain 'all candidates' fee beside a different category fee, with NO stated exception: still flagged (no precedence invented)", () => {
  assert.equal(feeOverlaps(rowsOf("Application Fee: All candidates Rs. 500", "SC/ST: Rs. 250")).length, 1);
});

test("E09 two incompatible fees for the same post and category: flagged; the reader offers neither for an exact repeat", () => {
  assert.equal(feeOverlaps([{ category: "General", groups: ["general"], amount: 500, post: "Clerk" }, { category: "General/OBC", groups: ["general", "obc"], amount: 600, post: "clerk" }]).length, 1);
  const r = read("Application Fee: General Rs. 500", "General: Rs. 600");
  assert.equal(r.rows.length, 0);
  assert.ok(r.problems.some((p) => /two different fees/.test(p.message)));
});

test("E10 a fee not stated in the notice gives no row and never ₹0", () => {
  const r = read("Application Fee: Not specified in the notice");
  assert.equal(r.rows.length, 0);
  assert.equal(legacyFees([]).feeGeneral, undefined);
});

suite("U5 correction: saved, shown and reviewed the same way");

const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
const page = (feeTable: FeeRow[]) => snapshotToGovernmentRecruitment(projectForPreview({
  id: "rec-e", slug: "test-e-2097", draftState: "DRAFT", recordRevision: "r1",
  identity: { organizationId: "test-board", organizationName: "Test Board", recruitmentYear: 2097, title: pf("TEST E 2097") },
  dates: {}, vacancies: {}, financial: { feeTable: pf(cleanFeeTable(feeTable)) }, links: [], documents: [], updates: [],
  lifecycle: { status: "UPCOMING", conflicts: [], events: [] }, provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2097-01-01", primarySourceType: "NOT_VERIFIED" },
  createdAt: "2097-01-01T00:00:00Z", updatedAt: "2097-01-01T00:00:00Z",
} as unknown as RecruitmentRecord)) as unknown as Opportunity & { feeTableOverlaps?: string[] };
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("E11 the editor keeps the stated exception, and the public page shows it without a caution box", () => {
  const rows = rowsOf("Application Fee:", "All candidates (except categories below): Rs. 500/-", "SC, ST, Female: Rs. 250/-");
  const saved = cleanFeeTable(rows);
  assert.deepEqual(saved.map((r) => [r.residual === true, r.exceptGroups ?? null]), rows.map((r) => [r.residual === true, r.exceptGroups ?? null]));
  const p = page(rows);
  assert.equal(p.feeTableOverlaps, undefined);
  const t = text(renderToStaticMarkup(<JobDetailSections job={p} />));
  assert.ok(t.includes("All candidates (except") && !t.includes("Check the notice:"), t.slice(t.indexOf("Application Fee"), t.indexOf("Application Fee") + 300));
});

test("E12 the unstated-precedence case still shows the caution box on the page", () => {
  const p = page(rowsOf("Application Fee: General/EWS/OBC Rs. 750, SC/ST Nil", "Application Fee (Trade Apprentice ITI): General Rs. 500"));
  assert.equal(p.feeTableOverlaps?.length, 1);
  assert.ok(text(renderToStaticMarkup(<JobDetailSections job={p} />)).includes("Check the notice:"));
});
