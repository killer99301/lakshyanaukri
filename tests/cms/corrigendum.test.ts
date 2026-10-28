// An update applied to an existing job (B2.6): SSC CGL 2026's reopening
// notice as an official corrigendum against the job made from the notice.
// What it changes is offered ticked, with the values it supersedes; what it
// leaves alone stays; a verified value is never replaced without the admin;
// its own file number is not the recruitment's notification number. No AI.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/corrigendum.test.ts

import { suite, test, assert } from "../intelligence/suite";
import { buildProposal, type CurrentField, type ExistingClaim, type RetrievalSummary } from "@/lib/cms/importer/proposal";

const reopen: RetrievalSummary = { id: "r-reopen", declaredKind: "OFFICIAL_CORRIGENDUM", authenticity: "ATTESTED", originRole: "NONE", originPurposes: [], label: "ssc.gov.in — corrigendum" };
// What the reopening notice states, with its own words (page 1).
const values = [
  { fieldPath: "dates.applicationCloseDate", value: "2026-06-25", quote: "re-open the window for submission of online applications for the Combined Graduate Level Examination, 2026 for two days i.e. from 23.06.2026 (23:00 hours) to 25.06.2026", page: 1 },
  { fieldPath: "dates.feePaymentCloseDate", value: "2026-06-26", quote: "The last date for making the online fee payment will be 26.06.2026", page: 1 },
  { fieldPath: "dates.correctionWindowEnd", value: "2026-07-03", quote: "from 01.07.2026 to 03.07.2026 (23:00 hours)", page: 1 },
  { fieldPath: "dates.applicationOpenDate", value: "2026-05-21", quote: "the online application window was kept open from 21.05.2026 to 22.06.2026", page: 1 },
  { fieldPath: "identity.notificationNumber", value: "F. No. HQ-C11018/1/2026-C-1", quote: "F. No. HQ-C11018/1/2026-C-1", page: 1 },
];
// The job as the notice filled it: Pending, nobody has verified anything yet.
const job: Record<string, CurrentField> = {
  "dates.applicationCloseDate": { value: "2026-06-22", verified: false },
  "dates.feePaymentCloseDate": { value: "2026-06-23", verified: false },
  "dates.correctionWindowEnd": { value: "2026-07-01", verified: false },
  "dates.applicationOpenDate": { value: "2026-05-21", verified: false },
};
const claims: ExistingClaim[] = [
  { id: "c-close", fieldPath: "dates.applicationCloseDate", value: "2026-06-22", superseded: false },
  { id: "c-fee", fieldPath: "dates.feePaymentCloseDate", value: "2026-06-23", superseded: false },
  { id: "c-corr", fieldPath: "dates.correctionWindowEnd", value: "2026-07-01", superseded: false },
  { id: "c-open", fieldPath: "dates.applicationOpenDate", value: "2026-05-21", superseded: false },
];
const proposal = (current: Record<string, CurrentField>) => buildProposal({ extractions: [{ retrieval: reopen, values, links: [] }], current: (p) => current[p], existingClaims: claims });
const item = (p: ReturnType<typeof proposal>, path: string) => p.items.find((i) => i.fieldPath === path);

suite("A corrigendum against the job it amends");

test("CG01 SSC CGL reopened: the new last date, fee deadline and correction window are offered ticked, each superseding the notice's value", () => {
  const p = proposal(job);
  for (const [path, was] of [["dates.applicationCloseDate", "c-close"], ["dates.feePaymentCloseDate", "c-fee"], ["dates.correctionWindowEnd", "c-corr"]] as const) {
    const i = item(p, path)!;
    assert.deepEqual([i.action, i.defaultTicked, i.supersedes, i.conflict], ["REPLACE", true, [was], false], path);
    assert.equal(i.claims[0].page, 1);
  }
  assert.equal(item(p, "dates.applicationCloseDate")!.value, "2026-06-25");
});
test("CG02 what the corrigendum restates unchanged matches, and supersedes nothing", () => {
  const i = item(proposal(job), "dates.applicationOpenDate")!;
  assert.deepEqual([i.action, i.defaultTicked, i.supersedes], ["MATCHES", true, []]);
});
test("CG03 a value an admin has verified is not replaced without them: offered, unticked", () => {
  const i = item(proposal({ ...job, "dates.applicationCloseDate": { value: "2026-06-22", verified: true } }), "dates.applicationCloseDate")!;
  assert.deepEqual([i.action, i.defaultTicked], ["REPLACE_VERIFIED", false]);
});
test("CG04 the corrigendum's own file number is not taken as the recruitment's notification number", () => {
  assert.equal(item(proposal(job), "identity.notificationNumber"), undefined);
});

test("CG05 a corrigendum's notes do not replace the job's list of conditions by default; its total does replace the total", () => {
  const corr: RetrievalSummary = { ...reopen, id: "r-bpsc" };
  const p = buildProposal({
    extractions: [{ retrieval: corr, values: [
      { fieldPath: "conditions", value: ["44 posts of Sugarcane Officer are deleted."], quote: "44 posts of Sugarcane Officer are deleted.", page: 1 },
      { fieldPath: "vacancies.total", value: 1186, quote: "1230-44 = 1186", page: 1 },
    ], links: [] }],
    current: (path) => ({ conditions: { value: ["Ten times the vacancies are called for the main examination."], verified: false }, "vacancies.total": { value: 1230, verified: false } } as Record<string, CurrentField>)[path],
  });
  assert.deepEqual(p.items.filter((i) => i.fieldPath !== "vacancies.total" || true).map((i) => [i.fieldPath, i.action, i.defaultTicked]), [["conditions", "REPLACE", false], ["vacancies.total", "REPLACE", true]]);
});
test("CG06 posts that do not add up to the stated total: both flagged and left unticked (BPSC: 18 posts making 1205, total 1077)", () => {
  const notice: RetrievalSummary = { ...reopen, id: "r-n", declaredKind: "OFFICIAL_NOTIFICATION" };
  const p = buildProposal({ extractions: [{ retrieval: notice, values: [
    { fieldPath: "vacancies.total", value: 1077, quote: "Total 1077", page: 2 },
    { fieldPath: "vacancies.breakdown", value: [{ post: "A", count: 1000 }, { post: "B", count: 205 }], quote: "A 1000", page: 1 },
  ], links: [] }], current: () => undefined });
  for (const path of ["vacancies.total", "vacancies.breakdown"]) {
    const i = p.items.find((x) => x.fieldPath === path)!;
    assert.equal(i.defaultTicked, false, path);
    assert.ok(i.flags.includes("the posts add up to 1205, the total says 1077 — check both against the notice"), i.flags);
  }
});

test("CG07 BPSC: the corrigendum's one-post 'breakdown' (the deleted Sugarcane Officer, 44) is never saved by default; its new total 1186 is", () => {
  const corr: RetrievalSummary = { ...reopen, id: "r-bpsc" };
  const p = buildProposal({
    extractions: [{ retrieval: corr, values: [
      { fieldPath: "vacancies.breakdown", value: [{ post: "ईख पदाधिकारी (गन्ना उद्योग विभाग)", count: 44 }], quote: "ईख पदाधिकारी (गन्ना उद्योग विभाग) का कोटिवार कुल 44 पद", page: 1 },
      { fieldPath: "vacancies.total", value: 1186, quote: "1230-44 = 1186", page: 1 },
    ], links: [] }],
    current: (path) => (path === "vacancies.total" ? { value: 1230, verified: false } : undefined),
  });
  const b = p.items.find((i) => i.fieldPath === "vacancies.breakdown")!;
  const t = p.items.find((i) => i.fieldPath === "vacancies.total")!;
  assert.equal(b.defaultTicked, false);
  assert.ok(b.flags.some((f) => /lists only the posts it adds, changes or deletes/.test(f)), b.flags);
  assert.deepEqual([t.action, t.defaultTicked, t.flags.some((f) => /add up to/.test(f))], ["REPLACE", true, false]);
});
