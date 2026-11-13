// Public pages must never receive a superseded announcement's internal reason, its author's admin id, or its old
// wording (13 Nov 2026: all three were in the SSC CGL page source, though never displayed). The job page, the job
// lists and the eligibility finder all get their data from snapshotToGovernmentRecruitment, and Next.js serializes
// what it returns into the page for the browser components, so the whole serialized object is checked here.
// Synthetic values only.
//   npx tsx --tsconfig tsconfig.json tests/cms/public-announcements-privacy.test.ts
import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { UpdateRecord } from "@/types";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { toPublicUpdates } from "@/lib/cms/announcements";
import { getLatestUpdate, getUpdatesSortedByDate, getSupersededUpdates } from "@/lib/lifecycle";
import type { Opportunity } from "@/types";

const ADMIN = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const REASON = "PRIVATE-REASON-zq81 the earlier notice was wrong";
const OLD_BODY = "OLD-WORDING-k77 The exam is on 30 Sep only.";
const OLD_VALUE = "OLD-VALUE-p42";
const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: [], conflict: false, manuallyEdited: true });
const updates: UpdateRecord[] = [
  { id: "u-old-1", date: "2026-10-12", type: "EXAM_NOTICE", title: "Old admit card notice", description: OLD_BODY, field: "Tier-I", previousValue: OLD_VALUE, newValue: OLD_VALUE,
    superseded: { on: "2026-11-13", by: ADMIN, reason: REASON, replacedBy: "u-new" } },
  { id: "u-old-2", date: "2026-10-24", type: "RESCHEDULE", title: "Old reschedule", description: OLD_BODY,
    superseded: { on: "2026-11-13", by: ADMIN, reason: REASON, sourceUrl: "https://official.example.gov.in/notice.pdf" } },
  { id: "u-new", date: "2026-11-04", type: "EXAM_NOTICE", title: "Tier-I held 30 Sep – 28 Oct", description: "Current wording, shown in full.", sourceUrl: "https://official.example.gov.in/n4.pdf", field: "Tier-I", previousValue: "Admit card released", newValue: "Held" },
];
const record: RecruitmentRecord = {
  id: "00000000-0000-4000-8000-0000000000cc", slug: "test-privacy", draftState: "PUBLISHED", recordRevision: "r1", publishedAt: "2026-10-01T00:00:00Z",
  identity: { organizationId: "ssc", organizationName: "Staff Selection Commission", recruitmentYear: 2026, title: pf("Test Exam 2026") },
  dates: { applicationCloseDate: pf("2026-06-25") }, vacancies: {}, financial: {}, lifecycle: { status: "UPCOMING", conflicts: [], events: [] },
  provenance: { status: "VERIFIED" } as RecruitmentRecord["provenance"], links: [], documents: [], updates,
  createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-11-13T00:00:00Z",
};
const publicJob = () => snapshotToGovernmentRecruitment(projectForPreview(record)) as unknown as Opportunity;

suite("Public pages never receive internal announcement data");

test("PP-01 the whole object handed to the public page holds no internal reason, admin id or old wording", () => {
  const serialized = JSON.stringify(publicJob());
  for (const secret of [ADMIN, REASON, "PRIVATE-REASON", OLD_BODY, "OLD-WORDING", OLD_VALUE]) {
    assert.ok(!serialized.includes(secret), `must not contain: ${secret}`);
  }
  assert.ok(!/"reason"\s*:/.test(serialized) && !/"by"\s*:/.test(serialized), "no reason or by keys at all");
});

test("PP-02 what the public page needs is still there: titles, dates, the replacement and official link, the current notice in full", () => {
  const job = publicJob();
  assert.equal(getLatestUpdate(job)?.id, "u-new");
  assert.equal(getUpdatesSortedByDate(job).length, 1);
  const current = getUpdatesSortedByDate(job)[0];
  assert.equal(current.description, "Current wording, shown in full.");
  assert.equal(current.sourceUrl, "https://official.example.gov.in/n4.pdf");
  assert.equal(current.previousValue, "Admit card released");
  const old = getSupersededUpdates(job);
  assert.deepEqual(old.map((u) => [u.id, u.date, u.title]), [["u-old-2", "2026-10-24", "Old reschedule"], ["u-old-1", "2026-10-12", "Old admit card notice"]]);
  assert.deepEqual(old.find((u) => u.id === "u-old-1")!.superseded, { on: "2026-11-13", replacedBy: "u-new" });
  assert.deepEqual(old.find((u) => u.id === "u-old-2")!.superseded, { on: "2026-11-13", sourceUrl: "https://official.example.gov.in/notice.pdf" });
});

test("PP-03 an allowlist, not a blocklist: a field added to announcements later stays out of public pages", () => {
  const withExtra = [{ ...updates[2], internalNote: "FUTURE-PRIVATE-FIELD" } as UpdateRecord & { internalNote: string }];
  assert.ok(!JSON.stringify(toPublicUpdates(withExtra)).includes("FUTURE-PRIVATE-FIELD"));
  const withExtraNote = [{ ...updates[0], superseded: { ...updates[0].superseded!, reviewer: "FUTURE-PRIVATE-NOTE" } } as UpdateRecord];
  assert.ok(!JSON.stringify(toPublicUpdates(withExtraNote)).includes("FUTURE-PRIVATE-NOTE"));
});

test("PP-04 jobs without superseded announcements get exactly the public fields they had before", () => {
  const plain: UpdateRecord[] = [{ id: "p1", date: "2026-10-01", type: "CORRIGENDUM", title: "Corrigendum", description: "Posts revised.", sourceUrl: "https://x.gov.in/c.pdf", field: "totalVacancies", previousValue: "1,230", newValue: "1,186" }];
  assert.deepEqual(toPublicUpdates(plain), plain);
  assert.deepEqual(toPublicUpdates(undefined), []);
});

test("PP-05 the stored record is untouched: the editor and history still have the reason, author and old wording", () => {
  publicJob();
  assert.equal(record.updates[0].superseded?.reason, REASON);
  assert.equal(record.updates[0].superseded?.by, ADMIN);
  assert.equal(record.updates[0].description, OLD_BODY);
});
