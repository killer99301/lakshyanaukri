// ═══════════════════════════════════════════════════════════
// Checks before publishing: values that contradict each other
//
//   npx tsx --tsconfig tsconfig.json tests/cms/prepublish-checks.test.ts
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { prepublishChecks } from "@/lib/cms/prepublish-checks";

const pf = <T>(value: T) => ({ value, status: "PENDING" as const, evidenceIds: [], conflict: false, manuallyEdited: true });
const TODAY = "2026-10-20";

function record(over: Partial<Record<string, unknown>> = {}): RecruitmentRecord {
  const base = {
    identity: { organizationId: "x", organizationName: "X Board", recruitmentYear: 2026, title: pf("X Board Clerk Recruitment 2026") },
    dates: { notificationDate: pf("2026-10-01"), applicationOpenDate: pf("2026-10-05"), applicationCloseDate: pf("2026-11-05"), feePaymentCloseDate: pf("2026-11-06") },
    vacancies: { total: pf(100), breakdown: pf([{ post: "Clerk", count: 60 }, { post: "Typist", count: 40 }]) },
    age: pf({ min: 18, max: 40, asOf: "2026-11-05", relaxations: [] }),
    financial: { feeGeneral: pf(500), feeSCST: pf(250) },
    links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://x.gov.in/n.pdf", official: true }, { type: "APPLY_ONLINE", label: "Apply", url: "https://x.gov.in/apply", official: true }],
    classification: { qualification: "12th Pass", category: "government", state: "Bihar" },
    examStages: [{ name: "Written Exam", order: 1, status: "SCHEDULED", dateIso: "2026-12-14", certainty: "TENTATIVE" }],
    updates: [],
  };
  return { ...base, ...over } as unknown as RecruitmentRecord;
}
const texts = (r: RecruitmentRecord) => prepublishChecks(r, TODAY).map((c) => `${c.level}: ${c.text}`);

suite("Checks before publishing");

test("PC01 a record that hangs together has nothing to look at", () => {
  assert.deepEqual(texts(record()), []);
});

test("PC02 dates out of order", () => {
  const r = record({ dates: { notificationDate: pf("2026-10-10"), applicationOpenDate: pf("2026-10-05"), applicationCloseDate: pf("2026-10-01"), feePaymentCloseDate: pf("2026-10-02"), correctionWindowEnd: pf("2026-09-30") } });
  const t = texts(r);
  assert.ok(t.includes("contradiction: The last date (1 Oct 2026) is before the opening date (5 Oct 2026)."));
  assert.ok(t.includes("contradiction: The fee deadline (2 Oct 2026) is before applications open (5 Oct 2026)."));
  assert.ok(t.includes("warning: Applications open (5 Oct 2026) before the notification date (10 Oct 2026)."));
  assert.ok(t.includes("warning: The correction window ends (30 Sep 2026) before applications close (1 Oct 2026)."));
  assert.ok(t.includes("warning: The last date (1 Oct 2026) has already passed. The job will show as closed."));
  // Contradictions come first.
  assert.match(t[0], /^contradiction/);
});

test("PC03 vacancies that do not add up, an exam before the last date, an age with no counting date", () => {
  const r = record({
    vacancies: { total: pf(120), breakdown: pf([{ post: "Clerk", count: 60 }, { post: "Typist", count: 40 }]) },
    examStages: [{ name: "Written Exam", order: 1, status: "SCHEDULED", dateIso: "2026-10-25", certainty: "TENTATIVE" }],
    age: pf({ min: 42, max: 40, relaxations: [] }),
  });
  const t = texts(r);
  assert.ok(t.includes("warning: The posts in the breakdown add up to 100, but the total says 120."));
  assert.ok(t.includes("warning: “Written Exam” is dated 25 Oct 2026, before applications close (5 Nov 2026)."));
  assert.ok(t.includes("contradiction: The minimum age (42) is above the maximum (40)."));
  assert.ok(t.some((x) => /No date is given for when age is counted/.test(x)));
});

test("PC04 last cycle's age date, odd fees, no apply link, empty listing details, a title from another year", () => {
  const r = record({
    age: pf({ min: 18, max: 40, asOf: "2025-01-01", relaxations: [] }),
    financial: { feeGeneral: pf(100), feeSCST: pf(500) },
    links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://x.gov.in/n.pdf", official: true }],
    classification: { qualification: "12th Pass" },
    identity: { organizationId: "x", organizationName: "X Board", recruitmentYear: 2026, title: pf("X Board Clerk Recruitment 2023") },
  });
  const t = texts(r);
  assert.ok(t.includes("warning: Age is counted on 1 Jan 2025, more than a year from the application dates. Check it is this cycle's date."));
  assert.ok(t.includes("warning: The fee for SC/ST/PwBD (₹500) is higher than for General/OBC (₹100)."));
  assert.ok(t.includes("warning: There is no “Apply Online” link while applications are open."));
  assert.ok(t.includes("warning: Listing details have no category, state, so the job will not appear under those filters."));
  assert.ok(t.includes("warning: The title says 2023 but the recruitment year is 2026."));
});

test("PC05 a missing qualification also says the finder cannot judge the job; each check names its section", () => {
  const checks = prepublishChecks(record({ classification: { category: "government", state: "Bihar" } }), TODAY);
  assert.equal(checks.length, 1);
  assert.match(checks[0].text, /no qualification, so the job will not appear under that filter and the eligibility finder cannot judge it/);
  assert.equal(checks[0].section, "Identity");
});
