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
  assert.deepEqual(job.fee?.rows, [{ category: "General / OBC", amount: null, note: "No application fee" }]);
  assert.deepEqual(job.noticeNotes, [{ label: "Fee (General / OBC)", text: "No application fee" }]);
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
  assert.deepEqual(job.fee!.rows.map((r) => `${r.category}: ${r.note}`), ["General / OBC: No application fee", "SC / ST / PwBD: Not stated in the official notification"]);
});
test("IP06 the public page data carries only the field name and its public words", () => {
  const job = snapshotToGovernmentRecruitment({ ...plain, notApplicable: { "links#APPLY_ONLINE": "Apply through the NATS portal" }, notStated: { "vacancies.total": "" } });
  const text = JSON.stringify(job);
  for (const secret of ["retrieval", "justification", "quote", "review_scope", "claim", "evidence", "research"]) assert.ok(!text.toLowerCase().includes(secret), secret);
});
