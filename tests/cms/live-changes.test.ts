// What republishing would change on the live page
//   npx tsx --tsconfig tsconfig.json tests/cms/live-changes.test.ts
import { suite, test, assert } from "../intelligence/suite";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import { liveChanges } from "@/lib/cms/live-changes";

const base = {
  title: "X Clerk 2026", shortTitle: null, notificationNumber: "01/2026", advertisementNumber: null,
  dates: { applicationCloseDate: "2026-10-20" }, vacancies: { total: 500, breakdown: null },
  financial: { feeGeneral: 500, feeSCST: 250, payScale: null, paymentModes: [] },
  examStages: [{ name: "Tier 1", order: 1, status: "NOT_DECLARED" }], eligibility: null, age: null, selection: null,
  howToApply: [], links: [], documents: [], classification: { shortDescription: null, category: null, state: null, qualification: null }, updates: [],
} as unknown as PublishedRecruitmentSnapshot;

suite("Live page against the edit");
test("LV01 nothing changed: nothing listed", () => assert.deepEqual(liveChanges(base, base), []));
test("LV02 dates, vacancies and a stage are spelled out", () => {
  const next = { ...base, dates: { applicationCloseDate: "2026-10-26" }, vacancies: { total: 650, breakdown: null },
    examStages: [{ name: "Tier 1", order: 1, status: "SCHEDULED", dateIso: "2026-12-15", certainty: "CONFIRMED" }] } as unknown as PublishedRecruitmentSnapshot;
  const c = liveChanges(base, next).map((x) => `${x.label}: ${x.before} → ${x.after}`);
  assert.ok(c.includes("Last date: 20 Oct 2026 → 26 Oct 2026"));
  assert.ok(c.includes("Vacancies: 500 → 650"));
  assert.ok(c.includes("Exam stage “Tier 1”: Not declared → Scheduled, 15 Dec 2026"));
  assert.equal(c.length, 3);
});
test("LV02b a change in a field with its own editor names that field, so the link can go straight to it", () => {
  const next = { ...base, dates: { applicationCloseDate: "2026-10-26" }, financial: { ...base.financial, feeGeneral: 600 },
    examStages: [{ name: "Tier 1", order: 1, status: "SCHEDULED" }] } as unknown as PublishedRecruitmentSnapshot;
  const at = Object.fromEntries(liveChanges(base, next).map((x) => [x.label, x.fieldPath]));
  assert.equal(at["Last date"], "dates.applicationCloseDate");
  assert.equal(at["Fee (General / OBC)"], "financial.feeGeneral");
  assert.equal(at["Exam stage “Tier 1”"], undefined);
});
