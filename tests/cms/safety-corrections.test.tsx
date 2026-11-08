// End-to-end safety corrections (8 Nov 2026): the Grab hand-off, the page check of PDF quotes, and truthful public
// labels. Pure: no database, no AI, no network. The database side (decisions on a real two-page PDF, empty sources,
// stored documents) is tests/local-stack/safety-corrections.test.ts.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/safety-corrections.test.tsx

import { suite, test, assert } from "../intelligence/suite";
import { cleanLeadTitle, emptyNewJob, handoffJob } from "@/app/admin/cms/import/handoff";
import { quoteOnPage } from "@/lib/cms/importer/evidence-text";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import type { RecruitmentRecord } from "@/types/recruitment-record";

const NOW = new Date("2026-11-08T00:00:00Z");

suite("Grab hand-off: fresh details from the chosen job only");

test("S101 an empty new job: no organisation, no government type chosen, this year", () => {
  assert.deepEqual(emptyNewJob(NOW), { organizationId: "", organizationName: "", recruitmentYear: "2026", title: "", govType: "", notificationNumber: "" });
});

test("S102 RRB NTPC, then Indian Bank Apprentice: nothing of Railway Recruitment Boards is kept", () => {
  const rrb = handoffJob({ title: "RRB NTPC Recruitment 2026 Notification Out For 8850 Posts, Apply Online | Last Date 30 Nov 2026", organizationId: "rrb", organizationName: "Railway Recruitment Boards", notificationNumber: "CEN No. 06/2026" }, NOW);
  assert.equal(rrb.organizationId, "rrb");
  assert.equal(rrb.organizationName, "Railway Recruitment Boards");
  assert.equal(rrb.govType, "Central Govt");
  assert.equal(rrb.notificationNumber, "CEN No. 06/2026", "a CEN number is kept as printed");
  assert.equal(rrb.title, "RRB NTPC Recruitment 2026");
  // The next pick has no recognised organisation: every identity field is empty, never the previous job's.
  const bank = handoffJob({ title: "Indian Bank Apprentice Recruitment 2026 | Last Date 15.12.2026" }, NOW);
  assert.equal(bank.organizationId, "");
  assert.equal(bank.organizationName, "");
  assert.equal(bank.govType, "", "the government type is chosen by the admin, never guessed");
  assert.equal(bank.notificationNumber, "");
  assert.equal(bank.title, "Indian Bank Apprentice Recruitment 2026");
  assert.ok(!JSON.stringify(bank).includes("Railway"), JSON.stringify(bank));
});

test("S103 a recognised organisation's name and type come from the registry when the lead gives only its ID", () => {
  const j = handoffJob({ title: "IBPS PO MT XVI Recruitment 2027 Apply Online for 5208 Posts", organizationId: "ibps", notificationNumber: "Advt No. CRP PO/MT-XVI" }, NOW);
  assert.equal(j.organizationName, "Institute of Banking Personnel Selection");
  assert.equal(j.govType, "PSU");
  assert.equal(j.recruitmentYear, "2027");
  assert.equal(j.notificationNumber, "CRP PO/MT-XVI");
});

test("S104 portal date suffixes leave the title; a title naming two years keeps this year", () => {
  assert.equal(cleanLeadTitle("SSC GD Constable 2026 | Last Date: 31.12.2026"), "SSC GD Constable 2026");
  assert.equal(cleanLeadTitle("BTSC FSO Recruitment 2026 Notification Out For 105 Posts, Apply Online"), "BTSC FSO Recruitment 2026");
  assert.equal(cleanLeadTitle("UPSC CSE 2026 – Closing Date 20 Feb"), "UPSC CSE 2026");
  assert.equal(cleanLeadTitle("Last Date"), "Last Date", "a title that is only the suffix is kept as it is");
  assert.equal(handoffJob({ title: "NHM Recruitment 2025-2026" }, NOW).recruitmentYear, "2026");
  assert.equal(handoffJob({ title: "Session 2025 to 2027 admissions" }, NOW).recruitmentYear, "2026");
});

suite("PDF quotes are checked on the page they cite");

const PDF_TEXT = "Institute of Banking Personnel Selection\nCRP TEST\n-- 1 of 2 --\nApplication Fee: Rs. 175 for SC/ST/PwBD\nLast date: 21.12.2099\n-- 2 of 2 --\n";

test("S201 the words on page 2 cited with page 2: accepted", () => {
  assert.deepEqual(quoteOnPage(PDF_TEXT, "Application Fee: Rs. 175 for SC/ST/PwBD", 2), { ok: true });
});

test("S202 the words on page 2 cited with page 1: refused, saying where they are", () => {
  const r = quoteOnPage(PDF_TEXT, "Application Fee: Rs. 175 for SC/ST/PwBD", 1);
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.reason, "OTHER_PAGE"); assert.equal(r.foundOn, 2); }
});

test("S203 a page the PDF does not have; words across two pages; text without page markers", () => {
  const none = quoteOnPage(PDF_TEXT, "Last date: 21.12.2099", 3);
  assert.ok(!none.ok && none.reason === "NO_SUCH_PAGE" && none.pages === 2, JSON.stringify(none));
  const across = quoteOnPage(PDF_TEXT, "CRP TEST Application Fee", 1);
  assert.ok(!across.ok && across.reason === "NOT_ON_ONE_PAGE", JSON.stringify(across));
  const pageless = quoteOnPage("Application Fee: Rs. 175", "Application Fee: Rs. 175", 1);
  assert.ok(!pageless.ok && pageless.reason === "NO_PAGES", "a page is never taken as checked without the reader's markers");
});

test("S204 page batches keep the document's own page numbers", () => {
  const part = "Vacancies table\n-- 23 of 76 --\nGrand Total 4455\n-- 24 of 76 --\n";
  assert.deepEqual(quoteOnPage(part, "Grand Total 4455", 24), { ok: true });
  const r = quoteOnPage(part, "Grand Total 4455", 23);
  assert.ok(!r.ok && r.reason === "OTHER_PAGE" && r.foundOn === 24);
  const missing = quoteOnPage(part, "Grand Total 4455", 5);
  assert.ok(!missing.ok && missing.reason === "NO_SUCH_PAGE", "a page not in what was read is not checked");
});

suite("Truthful public labels");

const record = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-0000-0000-0000000000s1", slug: "test-s1", draftState: "DRAFT", recordRevision: "r1", govType: "PSU",
  identity: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, govType: "PSU",
    title: { value: "IBPS RRB XV 2026", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  dates: {}, vacancies: {}, financial: {}, links: [], documents: [], updates: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-11-04", primarySourceType: "NOT_VERIFIED" },
  createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z", ...over,
} as unknown as RecruitmentRecord);

test("S301 IBPS (a PSU body, not a bank) is shown as PSU; a bank as PSU Bank", () => {
  assert.equal(snapshotToGovernmentRecruitment(projectForPreview(record())).govType, "PSU");
  const sbi = record({ identity: { organizationId: "sbi", organizationName: "State Bank of India", recruitmentYear: 2026, govType: "PSU",
    title: { value: "SBI PO 2026", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } } });
  assert.equal(snapshotToGovernmentRecruitment(projectForPreview(sbi)).govType, "PSU Bank");
});

// The printed-total wording on the public page is tested in tests/cms/vacancy-public.test.tsx (PV03).
