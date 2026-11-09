// Smart intake corrections after the first live test (SBI Assistant Manager – Engineer (Fire) 2026), pure:
// values that mean the same are not a disagreement; real differences are kept, inside one source too; work
// experience is read in full by code and by the AI parser and shown on the public page; wording and registry.
// No database, no network, no AI request (the AI's reply is given as a stand-in).
//
//   npx tsx --tsconfig tsconfig.json tests/cms/intake-corrections.test.tsx

import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { canonicalForm, compatible, disagreement, groupByMeaning } from "@/lib/cms/importer/same-meaning";
import { classifyField, type ClaimView, type FieldState } from "@/lib/cms/importer/classify";
import { readLabelledLines } from "@/lib/cms/importer/prepared-fields";
import { selectionStageType } from "@/lib/cms/importer/extract";
import { judgeArticle, buildArticlePrompt } from "@/lib/cms/importer/article";
import { buildProposal } from "@/lib/cms/importer/proposal";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { projectForPreview } from "@/lib/cms/projector";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import { originFor } from "@/lib/cms/importer/trusted-domains";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { Opportunity } from "@/types";

const SBI = readFileSync("tests/fixtures/paste/sbi-fire-2026-part-a.txt", "utf8");
const EXPERIENCE = SBI.split("\n").find((l) => l.startsWith("Work Experience: "))!.slice("Work Experience: ".length).replace(/[.;]+$/, "").trim();
const POST = "Assistant Manager - Engineer (Fire)";

// The SBI field pairs as the code reader and the AI read them in production (one source).
const PAIRS: Record<string, [unknown, unknown]> = {
  age: [{ max: 40, min: 21, asOf: "2026-10-31", evidence: [{ page: null, about: "min", quote: "Age Limit: Minimum 21 years, Maximum 40 years as on 31 Oct 2026", value: "21" }] },
    { max: 40, min: 21, asOf: "2026-10-31", relaxations: [] }],
  examPattern: [[{ name: "Online Written Test", note: "No penalty for wrong answers (no negative marking)", sections: [{ marks: 50, subject: "English Language", questions: 50 }, { marks: 75, subject: "Professional Knowledge", questions: 75 }], totalMarks: 125, totalQuestions: 125, durationMinutes: 120 }],
    [{ name: "Online Written Test", sections: [{ marks: 50, subject: "English Language", questions: 50 }, { marks: 75, subject: "Professional Knowledge", questions: 75 }], totalMarks: 125, totalQuestions: 125, durationMinutes: 120, negativeMarking: "No penalty for wrong answers (no negative marking)" }]],
  selection: [{ stages: [{ name: "Online Written Test", type: "CBT", order: 1 }, { name: "Interview", type: "INTERVIEW", order: 2 }] },
    { stages: [{ name: "Online Written Test", type: "CBT", order: 1 }, { name: "Interview", type: "INTERVIEW", order: 2 }], finalMeritFormula: "Written test score normalized to 70 marks; interview score normalized to 30 marks; combined merit total 100 marks." }],
  howToApply: [["Open the SBI careers page and locate advertisement CRPD/SCO/2026-27/29.", "Read the recruitment advertisement and confirm eligibility and required experience."],
    ["Open the SBI careers page and locate advertisement CRPD/SCO/2026-27/29", "Read the recruitment advertisement and confirm eligibility and required experience"]],
  eligibility: [[{ post: POST, qualification: ["B.E. (Fire) from NFSC Nagpur", "B.E./B.Tech (Safety & Fire Engineering)"] }],
    [{ post: POST, qualification: ["B.E. (Fire) from NFSC Nagpur OR B.E./B.Tech (Safety & Fire Engineering)"] }]],
};

suite("Same meaning: forms of one value are one value; a real difference stays one");

test("C01 SBI: age (kept passage, empty list), exam pattern (note filed as negative marking), selection (one adds the merit formula), steps (full stops) are the same", () => {
  for (const f of ["age", "examPattern", "selection", "howToApply"]) assert.ok(compatible(f, PAIRS[f][0], PAIRS[f][1]), f);
});

test("C02 SBI: a qualification list split two ways is a real difference (an OR line is not the same as two lines)", () => {
  assert.ok(!compatible("eligibility", PAIRS.eligibility[0], PAIRS.eligibility[1]));
});

test("C03 never the same: another number, date, name, step order or missing step", () => {
  assert.ok(!compatible("financial.feeGeneral", 850, 800));
  assert.ok(!compatible("dates.applicationCloseDate", "2098-07-26", "2098-07-28"));
  assert.ok(!compatible("age", { min: 20, max: 30 }, { min: 20, max: 32 }));
  assert.ok(!compatible("howToApply", ["Register", "Pay the fee"], ["Pay the fee", "Register"]));
  assert.ok(!compatible("howToApply", ["Register", "Pay the fee"], ["Register"]));
  assert.ok(!compatible("selection", { stages: [{ name: "Written", order: 1 }] }, { stages: [{ name: "Interview", order: 1 }] }));
  assert.equal(JSON.stringify(canonicalForm("financial.payScale", " Rs. 48480-85920 . ")), JSON.stringify("Rs. 48480-85920"));
});

suite("Disagreements: between sources, inside one source, or none");

const c = (value: unknown, retrievalId: string) => ({ value, retrievalId });

test("C04 one source, formatting only (the SBI age, exam pattern, selection, steps): no disagreement", () => {
  for (const f of ["age", "examPattern", "selection", "howToApply"]) assert.equal(disagreement(f, [c(PAIRS[f][0], "r1"), c(PAIRS[f][1], "r1")]), null, f);
});

test("C05 one source read two different ways, or giving two figures: kept, as READINGS (never hidden)", () => {
  assert.equal(disagreement("eligibility", [c(PAIRS.eligibility[0], "r1"), c(PAIRS.eligibility[1], "r1")]), "READINGS");
  assert.equal(disagreement("financial.feeGeneral", [c(850, "r1"), c(800, "r1")]), "READINGS", "a document stating two fees");
});

test("C06 two sources that disagree: SOURCES; two that agree (in any form): none; an agreeing source beside a misread: READINGS", () => {
  assert.equal(disagreement("financial.feeGeneral", [c(850, "a"), c(800, "b")]), "SOURCES");
  assert.equal(disagreement("age", [c(PAIRS.age[0], "a"), c(PAIRS.age[1], "b")]), null);
  assert.equal(disagreement("financial.feeGeneral", [c(850, "a"), c(800, "a"), c(850, "b")]), "READINGS");
});

const claim = (id: string, value: unknown, retrievalId: string, seq = 1): ClaimView => ({
  id, seq, kind: "EXTRACTED", value, retrievalId, superseded: false,
  retrieval: { authenticity: "NOT_APPLICABLE", originRole: "NONE", originPurposes: [], declaredKind: "RESEARCH" },
} as ClaimView);
const state = (fieldPath: string, value: unknown, claims: ClaimView[]): FieldState =>
  ({ fieldPath, value, hasValue: true, latestRevisionId: "rev", latestRevisionAt: "2026-11-09T00:00:00Z", claims } as FieldState);

test("C07 the field's class: SBI forms of one value read as research (not CONFLICTING); real ones are CONFLICTING with their kind", () => {
  for (const f of ["age", "examPattern", "selection", "howToApply"]) {
    const v = classifyField(state(f, PAIRS[f][1], [claim("x", PAIRS[f][0], "r1"), claim("y", PAIRS[f][1], "r1")]), "2026-11-01T00:00:00Z");
    assert.equal(v.cls, "RESEARCH_ONLY", f);
  }
  const elig = classifyField(state("eligibility", PAIRS.eligibility[1], [claim("x", PAIRS.eligibility[0], "r1"), claim("y", PAIRS.eligibility[1], "r1")]), null);
  assert.ok(elig.cls === "CONFLICTING" && elig.conflictKind === "READINGS", JSON.stringify(elig));
  const two = classifyField(state("financial.feeGeneral", 850, [claim("x", 850, "a"), claim("y", 800, "b")]), null);
  assert.ok(two.cls === "CONFLICTING" && two.conflictKind === "SOURCES");
});

test("C08 grouping keeps the fuller value and every member", () => {
  const g = groupByMeaning("selection", [{ value: PAIRS.selection[0], id: 1 }, { value: PAIRS.selection[1], id: 2 }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].members.length, 2);
  assert.ok(JSON.stringify(g[0].value).includes("finalMeritFormula"));
});

test("C09 the preview: same-meaning readings become one item with both readings' claims; a real one-source difference is marked READINGS", () => {
  const retrieval = { id: "r1", declaredKind: "RESEARCH" as const, authenticity: "NOT_APPLICABLE" as const, originRole: "NONE" as const, originPurposes: [], label: "pasted text — research" };
  const p = buildProposal({
    extractions: [
      { retrieval, values: [{ fieldPath: "age", value: PAIRS.age[0], quote: "Age Limit: Minimum 21 years" }, { fieldPath: "eligibility", value: PAIRS.eligibility[0], quote: "Qualification" }], links: [] },
      { retrieval, values: [{ fieldPath: "age", value: PAIRS.age[1], quote: "Age Limit: Minimum 21 years" }, { fieldPath: "eligibility", value: PAIRS.eligibility[1], quote: "Qualification" }], links: [] },
    ] as never,
    current: () => undefined,
  });
  const age = p.items.filter((i) => i.fieldPath === "age");
  assert.ok(age.length === 1 && !age[0].conflict && age[0].claims.length === 2 && age[0].defaultTicked, JSON.stringify(age.map((i) => [i.conflict, i.claims.length])));
  const elig = p.items.filter((i) => i.fieldPath === "eligibility");
  assert.ok(elig.length === 2 && elig.every((i) => i.conflict && i.conflictKind === "READINGS" && !i.defaultTicked));
});

suite("Work experience: read in full, alternatives kept, shown publicly");

const read = (t: string) => readLabelledLines(t, { stageType: selectionStageType });

test("C10 the code reader keeps SBI's 399-character experience line whole, with both pathways, under its post", () => {
  assert.equal(EXPERIENCE.length > 300, true, "the line that was dropped before");
  const e = read(SBI).values.find((v) => v.fieldPath === "eligibility");
  const post = (e?.value as Array<{ post: string; experience?: string[] }>)[0];
  assert.equal(post.post, POST);
  assert.deepEqual(post.experience, [EXPERIENCE]);
  assert.ok(post.experience![0].includes("Minimum 2 years") && post.experience![0].includes("OR minimum 3 years as Station Officer"));
});

test("C11 a longer line than the reader takes is said for the editor, never dropped silently", () => {
  const long = `Post Name: Engineer\nQualification: B.E. (Fire)\nWork Experience: ${"Minimum 2 years in fire safety at a large industrial site; ".repeat(12)}`;
  const r = read(long);
  assert.ok(r.refused.some((x) => x.fieldPath === "eligibility" && /experience line is too long/.test(x.reason)), JSON.stringify(r.refused));
});

test("C12 the AI is asked for experience as written, and its reply is kept only when the words are in the text", () => {
  assert.match(buildArticlePrompt(SBI, "SBI"), /"experience"\?: \[ each experience requirement copied from the text as written/);
  const quote = SBI.split("\n").find((l) => l.startsWith("Qualification: "))!;
  const ok = judgeArticle({ eligibility: [{ post: POST, qualifications: ["B.E. (Fire) from NFSC Nagpur"], experience: [EXPERIENCE], quote }] }, SBI);
  const e = ok.values.find((v) => v.fieldPath === "eligibility")?.value as Array<{ experience?: string[] }>;
  assert.deepEqual(e?.[0].experience, [EXPERIENCE]);
  const made = judgeArticle({ eligibility: [{ post: POST, qualifications: ["B.E. (Fire) from NFSC Nagpur"], experience: ["Minimum 5 years in any field"], quote }] }, SBI);
  const m = made.values.find((v) => v.fieldPath === "eligibility")?.value as Array<{ experience?: string[] }>;
  assert.equal(m?.[0].experience, undefined, "words not in the text are not kept");
});

test("C13 the public page shows the experience under its post, in the box named for it; a job without experience is unchanged", () => {
  const record = (posts: unknown) => ({
    id: "00000000-0000-4000-8000-0000000000c1", slug: "test-exp", draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: "sbi", organizationName: "State Bank of India", recruitmentYear: 2026, govType: "PSU",
      title: { value: "TEST EXPERIENCE 2026", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
    dates: {}, vacancies: {}, financial: {}, links: [], documents: [], updates: [],
    eligibility: { value: posts, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true },
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "", primarySourceType: "NOT_VERIFIED" },
    createdAt: "2026-11-09T00:00:00Z", updatedAt: "2026-11-09T00:00:00Z",
  } as unknown as RecruitmentRecord);
  const html = (posts: unknown) => renderToStaticMarkup(<JobDetailSections job={snapshotToGovernmentRecruitment(projectForPreview(record(posts))) as unknown as Opportunity} />)
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  const withExp = html([{ post: POST, qualification: ["B.E. (Fire) from NFSC Nagpur"], experience: [EXPERIENCE] }]);
  assert.ok(withExp.includes("Qualification & Experience"), "box named for it");
  assert.ok(withExp.includes(`Experience: ${EXPERIENCE}`), "the experience, whole");
  assert.ok(withExp.indexOf(POST) < withExp.indexOf("Experience: "), "under its post");
  const without = html([{ post: POST, qualification: ["B.E. (Fire) from NFSC Nagpur"] }]);
  assert.ok(without.includes("Educational Qualification") && !without.includes("Experience:"));
});

suite("Registry");

test("C14 sbi.bank.in is SBI's own site; the IBPS registration site is not listed for SBI", () => {
  assert.equal(originFor("sbi", "sbi.bank.in").role, "AUTHORITY");
  assert.equal(originFor("sbi", "ibpsreg.ibps.in").role, "UNLISTED");
  assert.equal(originFor("sbi", "sbi.co.in").role, "UNLISTED", "other names wait for confirmation");
});

suite("Saved value against what the source states (directional)");

// The SBI requirement as the source states it, and saved values that leave parts out.
const QUAL = "B.E. (Fire) from NFSC Nagpur OR B.E./B.Tech (Safety & Fire Engineering)";
const FULL = [{ post: POST, qualification: [QUAL], experience: [EXPERIENCE] }];
const QUAL_ONLY = [{ post: POST, qualification: [QUAL] }];
const ONE_PATHWAY = [{ post: POST, qualification: [QUAL], experience: [EXPERIENCE.split("; OR")[0]] }];

test("C15 (case 1) the complete requirement saved, the source states the same: accepted", () => {
  const v = classifyField(state("eligibility", FULL, [claim("a", FULL, "r1")]), null);
  assert.equal(v.cls, "RESEARCH_ONLY", JSON.stringify(v));
});

test("C16 (case 2) qualification saved, the source states qualification and both experience pathways: flagged OMITTED", () => {
  const v = classifyField(state("eligibility", QUAL_ONLY, [claim("a", FULL, "r1")]), null);
  assert.ok(v.cls === "CONFLICTING" && v.conflictKind === "OMITTED" && /leaves out part of what the source says/.test(v.reason), JSON.stringify(v));
  const both = classifyField(state("eligibility", QUAL_ONLY, [claim("a", FULL, "r1"), claim("b", QUAL_ONLY, "r1")]), null);
  assert.ok(both.cls === "CONFLICTING" && both.conflictKind === "OMITTED", "a shorter reading beside it does not hide the omission");
});

test("C17 (case 3) one of two experience pathways saved: flagged OMITTED", () => {
  const v = classifyField(state("eligibility", ONE_PATHWAY, [claim("a", FULL, "r1")]), null);
  assert.ok(v.cls === "CONFLICTING" && v.conflictKind === "OMITTED", JSON.stringify(v));
});

test("C18 (case 4) the complete requirement saved, a shorter reading of the same source beside it: no warning", () => {
  const v = classifyField(state("eligibility", FULL, [claim("a", FULL, "r1"), claim("b", QUAL_ONLY, "r1")]), null);
  assert.equal(v.cls, "RESEARCH_ONLY", JSON.stringify(v));
  const shorterOnly = classifyField(state("eligibility", FULL, [claim("b", QUAL_ONLY, "r1")]), null);
  assert.notEqual(shorterOnly.conflictKind, "OMITTED", "a source that says less is never an omission");
});

test("C19 forms of the same value are not an omission; a different value is not called one", () => {
  for (const f of ["age", "examPattern", "selection", "howToApply"]) {
    for (const [saved, src] of [[PAIRS[f][1], PAIRS[f][0]], [PAIRS[f][0], PAIRS[f][1]]] as const) {
      const v = classifyField(state(f, saved, [claim("a", src, "r1")]), null);
      // The selection read without the merit formula, saved, while the source gives the formula: that one is an omission.
      if (f === "selection" && saved === PAIRS.selection[0]) assert.equal(v.conflictKind, "OMITTED", f);
      else assert.notEqual(v.cls, "CONFLICTING", `${f}: ${JSON.stringify(v)}`);
    }
  }
  const differs = classifyField(state("financial.feeGeneral", 800, [claim("a", 850, "r1")]), null);
  assert.equal(differs.cls, "UNSUPPORTED", "another figure: differs from the source, as before");
});
