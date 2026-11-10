// What visitors see for fields a person recorded as not applicable or not stated
//   npx tsx --tsconfig tsconfig.json tests/cms/importer-public.test.ts
import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";

const record = {
  id: "00000000-0000-0000-0000-000000000001", slug: "lic-hfl-apprentice-2026", draftState: "DRAFT", recordRevision: "r1",
  identity: {
    organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", recruitmentYear: 2026,
    title: { value: "LIC HFL Apprentice Recruitment 2026", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true },
  },
  dates: {}, vacancies: {}, financial: {}, links: [], documents: [], updates: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-25", primarySourceType: "NOT_VERIFIED" },
  createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z",
} as unknown as RecruitmentRecord;
const plain = projectForPreview(record);

suite("Public page: not applicable and not stated");
test("IP01 a job never imported, and a snapshot published before this change, look exactly as before", () => {
  const job = snapshotToGovernmentRecruitment(plain);
  assert.equal(job.vacanciesDisplay, "Vacancies TBC");
  assert.equal(job.noticeNotes, undefined);
  assert.equal(job.fee, undefined);
  assert.ok(!("notApplicable" in plain) && !("notStated" in plain));
});
test("IP02 a fee recorded not applicable shows the notice's words, never a blank", () => {
  const job = snapshotToGovernmentRecruitment({ ...plain, notApplicable: { "financial.feeGeneral": "No application fee" }, notStated: {} });
  assert.deepEqual(job.fee?.rows, [{ category: "General (UR)", amount: null, note: "No application fee" }]);
  assert.deepEqual(job.noticeNotes, [{ label: "Fee (General (UR))", text: "No application fee" }]);
});
test("IP03 not applicable without wording still says so", () => {
  const job = snapshotToGovernmentRecruitment({ ...plain, notApplicable: { "financial.feeSCST": "" }, notStated: {} });
  assert.equal(job.fee?.rows[0].note, "Not applicable, as per the official notification");
});
test("IP04 vacancies not stated: the header box and the notes say so, with the public wording", () => {
  const job = snapshotToGovernmentRecruitment({ ...plain, notApplicable: {}, notStated: { "vacancies.total": "Vacancies will be notified later" } });
  assert.equal(job.vacanciesDisplay, "Not stated in the notice");
  assert.deepEqual(job.noticeNotes, [{ label: "Total vacancies", text: "Not stated in the official notification — Vacancies will be notified later" }]);
});
test("IP05 not applicable and not stated are told apart", () => {
  const job = snapshotToGovernmentRecruitment({ ...plain, notApplicable: { "financial.feeGeneral": "No application fee" }, notStated: { "financial.feeSCST": "" } });
  assert.deepEqual(job.fee!.rows.map((r) => `${r.category}: ${r.note}`), ["General (UR): No application fee", "SC / ST / PwBD: Not stated in the official notification"]);
});
test("IP06 the public page data carries only the field name and its public words", () => {
  const job = snapshotToGovernmentRecruitment({ ...plain, notApplicable: { "links#APPLY_ONLINE": "Apply through the NATS portal" }, notStated: { "vacancies.total": "" } });
  const text = JSON.stringify(job);
  for (const secret of ["retrieval", "justification", "quote", "review_scope", "claim", "evidence", "research"]) assert.ok(!text.toLowerCase().includes(secret), secret);
});

suite("Public page: category-wise vacancies");
test("IP07 no post with a category split → no table; the page looks as before", async () => {
  const { vacancyCategoryTable } = await import("@/lib/vacancy-categories");
  assert.equal(vacancyCategoryTable(undefined), null);
  assert.equal(vacancyCategoryTable([]), null);
  assert.equal(vacancyCategoryTable([{ post: "Clerk", count: 120, payScale: "Level 2" }]), null);
  assert.equal(vacancyCategoryTable([{ post: "Clerk", count: 120, breakdown: {} }]), null, "an empty split is no split");
});
test("IP08 a BTSC-style split: usual columns first in a fixed order, the notice's own columns kept by name, women last", async () => {
  const { vacancyCategoryTable } = await import("@/lib/vacancy-categories");
  const t = vacancyCategoryTable([
    { post: "Food Safety Officer", count: 105, breakdown: { sc: 17, ur: 42, "EBC": 19, "BC": 12, ews: 10, st: 1, "Backward Class Women": 3, women: 37 } as never },
    { post: "Analyst", count: 4 },
  ])!;
  assert.deepEqual(t.columns.map((c) => c.label), ["UR", "EWS", "SC", "ST", "EBC", "BC", "Backward Class Women", "Women"]);
  assert.equal(t.rows.length, 1, "a post with no split is left out of this table");
  assert.deepEqual(t.rows[0].cells, [42, 10, 17, 1, 19, 12, 3, 37]);
  assert.equal(t.hasHorizontal, true);
});
test("IP09 different posts with different columns: a missing number stays empty, never 0", async () => {
  const { vacancyCategoryTable } = await import("@/lib/vacancy-categories");
  const t = vacancyCategoryTable([
    { post: "Assistant", count: 50, breakdown: { ur: 25, obc: 13, sc: 7, st: 4, ews: 1 } },
    { post: "Steno", count: 6, breakdown: { ur: 6, pwbd: { vi: 1, hi: 1 }, exsm: 0, other: { "Sports quota": 2 } } },
  ])!;
  assert.deepEqual(t.columns.map((c) => c.label), ["UR", "EWS", "OBC", "SC", "ST", "Sports quota", "Ex-Servicemen", "PwBD"]);
  assert.deepEqual(t.rows[0].cells, [25, 1, 13, 7, 4, null, null, null]);
  assert.deepEqual(t.rows[1].cells, [6, null, null, null, null, 2, 0, 2], "PwBD is the sum of its parts; a real 0 is kept");
});
test("IP10 bad values in a stored split are skipped, not shown", async () => {
  const { vacancyCategoryTable } = await import("@/lib/vacancy-categories");
  const t = vacancyCategoryTable([{ post: "Clerk", count: 9, breakdown: { ur: 5, sc: "four", st: -1, obc: Number.NaN, ews: null } as never }])!;
  assert.deepEqual(t.columns.map((c) => c.key), ["ur"]);
  assert.equal(t.hasHorizontal, false);
});
test("IP11 a published snapshot's breakdown reaches the page data unchanged", () => {
  const rows = [{ post: "FSO", count: 105, breakdown: { ur: 42, women: 37 } }];
  const job = snapshotToGovernmentRecruitment({ ...plain, vacancies: { ...plain.vacancies, breakdown: rows } } as never);
  assert.deepEqual(job.vacancyBreakdown, rows);
});
