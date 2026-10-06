// ═══════════════════════════════════════════════════════════
// Post-wise vacancies, and AI Assist reading an uploaded PDF
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  VB01  rows are tidied and saved with a revision; the total is left alone
//  VB02  a row without a post name or a whole number is rejected
//  VB03  category split and eligibility on a row survive; junk keys are dropped
//  VB04  an empty list clears the breakdown; more than 200 rows is rejected
//  UP01  an uploaded PDF's text is read through the supplied reader, never fetched
//  UP02  an uploaded PDF with no text gives the scanned-PDF message
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import { cleanVacancyBreakdown } from "@/lib/cms/record-ops";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { resolveSourceContent } from "@/lib/cms/ai-assist";

const ADMIN = randomUUID();
const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });

function makeRecord(): RecruitmentRecord {
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "DRAFT",
    recordRevision: "abc",
    identity: { organizationId: "kea", organizationName: "KEA", recruitmentYear: 2026, title: pending("Test 2026") },
    dates: {},
    vacancies: { total: pending<number | null>(869) },
    financial: {},
    links: [],
    documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

suite("Post-wise vacancies");

test("VB01 rows are tidied and saved with a revision; the total is left alone", () => {
  const record = makeRecord();
  const rows = [{ post: "  Warder   (RPC) ", count: 560 }, { post: "Jailor", count: 5, payScale: " ₹61,300 – ₹1,12,900 " }];
  const { record: updated, revision } = routeFieldUpdate(record, "vacancies.breakdown", pending(rows), ADMIN, "Edited post-wise vacancies");
  assert.deepEqual(updated.vacancies.breakdown?.value, [
    { post: "Warder (RPC)", count: 560 },
    { post: "Jailor", count: 5, payScale: "₹61,300 – ₹1,12,900" },
  ]);
  assert.equal(updated.vacancies.breakdown?.status, "PENDING");
  assert.deepEqual(updated.vacancies.total, record.vacancies.total);
  assert.equal(revision.fieldPath, "vacancies.breakdown");
});

test("VB02 a row without a post name or a whole number is rejected", () => {
  assert.throws(() => cleanVacancyBreakdown([{ post: " ", count: 5 }]), /needs a post name/);
  assert.throws(() => cleanVacancyBreakdown([{ post: "Warder", count: 0 }]), /whole number/);
  assert.throws(() => cleanVacancyBreakdown([{ post: "Warder", count: 5.5 }]), /whole number/);
  assert.throws(() => cleanVacancyBreakdown([{ post: "Warder", count: "560" }]), /whole number/);
  assert.throws(() => cleanVacancyBreakdown("Warder 560"), /list of posts/);
});

test("VB03 category split and eligibility on a row survive; junk keys are dropped", () => {
  const [row] = cleanVacancyBreakdown([
    { post: "Clerk", count: 10, eligibility: "Graduate", breakdown: { ur: 6, sc: 4, note: "x", st: -1 }, extra: "drop me" },
  ]);
  assert.deepEqual(row, { post: "Clerk", count: 10, eligibility: "Graduate", breakdown: { ur: 6, sc: 4 } });
});

test("VB04 an empty list clears the breakdown; more than 200 rows is rejected", () => {
  assert.deepEqual(cleanVacancyBreakdown([]), []);
  const many = Array.from({ length: 201 }, (_, i) => ({ post: `Post ${i}`, count: 1 }));
  assert.throws(() => cleanVacancyBreakdown(many), /at most 200/);
});

suite("AI Assist: uploaded PDF");

const PDF_TEXT = "CENTRALISED EMPLOYMENT NOTICE (CEN) No. 05/2026. Closing date for Submission of Online Application 14.10.2026.";

test("UP01 an uploaded PDF's text is read through the supplied reader, never fetched", async () => {
  let asked = "";
  const source = await resolveSourceContent(
    { ok: true, contentType: "application/pdf", htmlContent: null },
    "https://www.rrbapply.gov.in/assets/forms/CEN_05_2026_PM.pdf",
    async (url) => { asked = url; return { ok: true, text: PDF_TEXT }; },
  );
  assert.equal(source.ok, true);
  if (source.ok) {
    assert.equal(source.kind, "pdf");
    assert.equal(source.content, PDF_TEXT);
  }
  assert.equal(asked, "https://www.rrbapply.gov.in/assets/forms/CEN_05_2026_PM.pdf");
});

test("UP02 an uploaded PDF with no text gives the scanned-PDF message", async () => {
  const source = await resolveSourceContent(
    { ok: true, contentType: "application/pdf", htmlContent: null },
    "https://example.gov.in/page-without-pdf-ending",
    async () => ({ ok: true, text: "   " }),
  );
  assert.equal(source.ok, false);
  if (!source.ok) assert.match(source.error, /scanned|could not be read/i);
});
