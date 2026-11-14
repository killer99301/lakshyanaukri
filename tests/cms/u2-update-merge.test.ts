// CMS 2.0 step U2: an LN Update merged into the job item by item, through the ordinary Smart Intake proposal.
// Everything here is SYNTHETIC (the repository is public): invented organisations, titles, dates and addresses.
// Nothing is saved: the proposal and the save payload are built in memory only.
//   npx tsx --tsconfig tsconfig.json tests/cms/u2-update-merge.test.ts
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import type { ProvenanceField, RecruitmentRecord, SyllabusSubject, ExamPatternPaper, FeeRow, CmsRecruitmentPost } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";
import { readUpdateText, type JobIdentity } from "@/lib/cms/importer/update-format";
import { mergeUpdate, annotateProposal, type UpdateMerge } from "@/lib/cms/importer/update-merge";
import { buildProposal, type Proposal, type RetrievalSummary } from "@/lib/cms/importer/proposal";
import { readFeeLines, legacyFees } from "@/lib/cms/importer/fee-table";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";

// apply-build reaches the database module through the repository; nothing here queries it. A placeholder
// address (never connected to) lets the module load.
process.env.DATABASE_URL ??= "postgresql://placeholder:placeholder@127.0.0.1:1/none";

const pf = <T,>(value: T, status: ProvenanceField<T>["status"] = "VERIFIED"): ProvenanceField<T> => ({ value, status, evidenceIds: [], conflict: false, manuallyEdited: true });
const ORG = "tsc";

function job(over: Partial<RecruitmentRecord> = {}): RecruitmentRecord {
  const stages: ExamStage[] = [
    { name: "Tier-I (Computer Based Test)", order: 1, status: "CONDUCTED", kind: "SELECTION", dateIso: "2026-09-30", dateEndIso: "2026-10-28", dateDisplay: "30 Sep – 28 Oct 2026", certainty: "CONFIRMED" },
    { name: "Tier-II (Computer Based Test)", order: 2, status: "NOT_DECLARED", kind: "SELECTION" },
    { name: "Document Verification", order: 3, status: "NOT_DECLARED", kind: "SELECTION" },
  ];
  const pattern: ExamPatternPaper[] = [{ name: "Tier-I (Computer Based Test)", mode: "Computer Based", durationMinutes: 60, sections: [
    { subject: "English Comprehension", questions: 25, marks: 50 }, { subject: "General Intelligence and Reasoning", questions: 25, marks: 50 },
    { subject: "Quantitative Aptitude", questions: 25, marks: 50 }, { subject: "General Awareness", questions: 25, marks: 50 }], totalQuestions: 100, totalMarks: 200 }];
  const syllabus: SyllabusSubject[] = [
    { paper: "Tier-I (Computer Based Test)", subject: "English Comprehension", topics: ["Spot the error", "Synonyms"] },
    { paper: "Tier-I (Computer Based Test)", subject: "General Intelligence and Reasoning", topics: ["Analogy", "Classification"] },
    { paper: "Tier-I (Computer Based Test)", subject: "Quantitative Aptitude", topics: ["Percentage", "Ratio and proportion"] },
    { paper: "Tier-I (Computer Based Test)", subject: "General Awareness", topics: ["History", "Geography"] },
  ];
  const posts: CmsRecruitmentPost[] = [{ post: "Assistant Section Officer", qualification: ["Graduate"] }, { post: "Inspector", qualification: ["Graduate"] }];
  return {
    id: "00000000-0000-4000-8000-0000000000ee", slug: "test-cgl-2026", draftState: "DRAFT", recordRevision: "r1",
    identity: { organizationId: ORG, organizationName: "Test Selection Commission", recruitmentYear: 2026, title: pf("TSC CGL 2026 (Combined Graduate Level Examination)"), notificationNumber: pf("HQ-T11018/5/2026-T-1") },
    dates: { applicationCloseDate: pf("2026-07-04") }, vacancies: {}, financial: { feeGeneral: pf<number | null>(100), feeSCST: pf<number | null>(0) },
    eligibility: pf(posts), age: pf({ min: 18, max: 32, asOf: "2026-08-01", relaxations: [{ category: "OBC", years: 3 }] } as RecruitmentRecord["age"] extends ProvenanceField<infer A> | undefined ? A : never),
    selection: pf({ stages: [{ name: "Tier-I (Computer Based Test)", order: 1, type: "CBT" }, { name: "Tier-II (Computer Based Test)", order: 2, type: "CBT" }, { name: "Document Verification", order: 3, type: "DOCUMENT_VERIFICATION" }] }),
    examPattern: pf(pattern), syllabus: pf(syllabus), examStages: stages,
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] }, provenance: { status: "VERIFIED" } as RecruitmentRecord["provenance"],
    links: [{ type: "APPLY_ONLINE", label: "Apply Online", url: "https://tsc.example.gov.in/apply", official: true }, { type: "OFFICIAL_NOTIFICATION", label: "Notification", url: "https://tsc.example.gov.in/notice.pdf", official: true }],
    documents: [], updates: [], createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
    ...over,
  } as RecruitmentRecord;
}
const identity = (r: RecruitmentRecord): JobIdentity => ({ title: r.identity.title.value!, organizationName: r.identity.organizationName, organizationId: r.identity.organizationId, notificationNumber: r.identity.notificationNumber?.value ?? null });
const HEAD = "LN Update v1\nJob: TSC CGL 2026 (Combined Graduate Level Examination)\nOrganisation: Test Selection Commission\nUpdate type: New information\nSource: Test notice, dated 20 Dec 2026\n\n";
const merge = (body: string, r: RecruitmentRecord | null = job()) => mergeUpdate({ record: r, reading: readUpdateText(HEAD + body, { job: r ? identity(r) : undefined }), organizationId: ORG });
const val = <T,>(m: UpdateMerge, path: string) => m.values.find((v) => v.fieldPath === path)?.value as T | undefined;

const RETRIEVAL: RetrievalSummary = { id: "11111111-1111-4111-8111-111111111111", declaredKind: "RESEARCH", authenticity: "NOT_APPLICABLE", originRole: "NONE", originPurposes: [], label: "Pasted LN Update", prepared: true };
function proposalFor(m: UpdateMerge, r: RecruitmentRecord | null, verified: string[] = []): Proposal {
  const fieldValueOf = (rec: RecruitmentRecord, path: string): unknown => {
    if (path === "examStages") return rec.examStages ?? null;
    const [ns, key] = path.split(".");
    const at = (o: unknown, k: string) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
    const f = key ? at(at(rec, ns), key) : at(rec, path);
    return f && typeof f === "object" && "status" in (f as object) ? (f as { value: unknown }).value : f;
  };
  const p = buildProposal({ extractions: [{ retrieval: RETRIEVAL, values: m.values, links: m.links }],
    current: (path) => (r ? { value: fieldValueOf(r, path), verified: verified.includes(path) } : undefined), currentLinks: r?.links ?? [] });
  annotateProposal(p, m, RETRIEVAL.id);
  return p;
}

suite("U2: partial syllabus versus explicit replacement");

test("M01 only Quantitative Aptitude given: two topics added to it; every other subject and topic kept", () => {
  const m = merge("Syllabus:\nStage: Tier-I (Computer Based Test)\nSubject: Quantitative Aptitude: Percentage; Time and work; Mensuration\n");
  const s = val<SyllabusSubject[]>(m, "syllabus")!;
  assert.equal(s.length, 4);
  assert.deepEqual(s.find((x) => x.subject === "Quantitative Aptitude")!.topics, ["Percentage", "Ratio and proportion", "Time and work", "Mensuration"]);
  assert.deepEqual(s.find((x) => x.subject === "English Comprehension")!.topics, ["Spot the error", "Synonyms"]);
  assert.equal(m.changes.filter((c) => c.fieldPath === "syllabus" && c.kind !== "NOTED").length, 1);
});

test("M02 'Complete list' for Tier-I replaces Quant's topics and drops Tier-I subjects not listed; held unticked", () => {
  const m = merge("Syllabus:\nStage: Tier-I (Computer Based Test) | Complete list\nSubject: Quantitative Aptitude: Algebra\nSubject: English Comprehension: Spot the error; Synonyms\n");
  const s = val<SyllabusSubject[]>(m, "syllabus")!;
  assert.deepEqual(s.map((x) => x.subject).sort(), ["English Comprehension", "Quantitative Aptitude"]);
  assert.deepEqual(s.find((x) => x.subject === "Quantitative Aptitude")!.topics, ["Algebra"]);
  assert.ok((m.holds.syllabus ?? []).some((h) => /leaves out “General Awareness”/.test(h)));
  const item = proposalFor(m, job()).items.find((i) => i.fieldPath === "syllabus")!;
  assert.equal(item.defaultTicked, false);
});

test("M03 'Syllabus: Not specified in the notice' changes nothing; a later notice about dates only never clears it", () => {
  for (const body of ["Syllabus: Not specified in the notice\n", "Exam Stages:\nStage: Tier-II (Computer Based Test) | Status: Scheduled | Date: 18 Jan 2027 | Tentative\n"]) {
    const m = merge(body);
    assert.equal(val(m, "syllabus"), undefined, body);
    assert.equal(val(m, "examPattern"), undefined);
  }
});

test("M04 a new Tier-II syllabus with its paper is added beside Tier-I's, which is untouched; additions alone start ticked", () => {
  const m = merge("Syllabus:\nStage: Tier-II (Computer Based Test) | Paper: Paper-I\nSubject: Mathematical Abilities: Number systems; Algebra\n");
  const s = val<SyllabusSubject[]>(m, "syllabus")!;
  assert.equal(s.length, 5);
  assert.deepEqual(s[4], { paper: "Paper-I", subject: "Mathematical Abilities", topics: ["Number systems", "Algebra"] });
  const item = proposalFor(m, job(), []).items.find((i) => i.fieldPath === "syllabus")!;
  assert.equal(item.action, "REPLACE");
  assert.equal(item.defaultTicked, true);
  assert.ok(item.flags.some((f) => /^＋ New: Tier-II/.test(f)));
});

test("M05 a verified syllabus is protected: even a pure addition is not ticked and needs the separate confirmation", () => {
  const m = merge("Syllabus:\nStage: Tier-II (Computer Based Test) | Paper: Paper-I\nSubject: Mathematical Abilities: Number systems\n");
  const item = proposalFor(m, job(), ["syllabus"]).items.find((i) => i.fieldPath === "syllabus")!;
  assert.equal(item.action, "REPLACE_VERIFIED");
  assert.equal(item.defaultTicked, false);
});

test("M06 a job whose syllabus names no stage, updated for one stage: read as that stage's, and held to be checked", () => {
  const r = job({ syllabus: pf([{ subject: "Quantitative Aptitude", topics: ["Percentage"] }]) });
  const m = merge("Syllabus:\nStage: Tier-I (Computer Based Test)\nSubject: Quantitative Aptitude: Algebra\n", r);
  assert.deepEqual(val<SyllabusSubject[]>(m, "syllabus"), [{ subject: "Quantitative Aptitude", topics: ["Percentage", "Algebra"] }]);
  assert.ok((m.holds.syllabus ?? []).some((h) => /names no stage/.test(h)));
});

suite("U2: stage, paper and post context");

const POSTWISE = (): RecruitmentRecord => job({
  examPattern: pf<ExamPatternPaper[]>([
    { name: "Mains – IT Officer", stage: "Mains", post: "IT Officer", sections: [{ subject: "Professional Knowledge", questions: 60, marks: 60 }] },
    { name: "Mains – Law Officer", stage: "Mains", post: "Law Officer", sections: [{ subject: "Professional Knowledge", questions: 60, marks: 60 }] }]),
  syllabus: pf<SyllabusSubject[]>([
    { paper: "Mains – IT Officer", stage: "Mains", post: "IT Officer", subject: "Professional Knowledge", topics: ["Networking"] },
    { paper: "Mains – Law Officer", stage: "Mains", post: "Law Officer", subject: "Professional Knowledge", topics: ["Contract law"] }]),
});

test("M07 the right post's paper and subject change; the other post's are untouched", () => {
  const m = merge("Exam Pattern:\nStage: Mains | Post: Law Officer | Duration: 45 minutes\n\nSyllabus:\nStage: Mains | Post: Law Officer\nSubject: Professional Knowledge: Banking regulation\n", POSTWISE());
  const p = val<ExamPatternPaper[]>(m, "examPattern")!;
  assert.equal(p.find((x) => x.post === "Law Officer")!.durationMinutes, 45);
  assert.equal(p.find((x) => x.post === "IT Officer")!.durationMinutes, undefined);
  const s = val<SyllabusSubject[]>(m, "syllabus")!;
  assert.deepEqual(s.find((x) => x.post === "Law Officer")!.topics, ["Contract law", "Banking regulation"]);
  assert.deepEqual(s.find((x) => x.post === "IT Officer")!.topics, ["Networking"]);
});

test("M08 the stage alone, or a post the job does not have for it: held, nothing applied", () => {
  for (const body of ["Syllabus:\nStage: Mains\nSubject: Professional Knowledge: Banking regulation\n", "Syllabus:\nStage: Mains | Post: HR Officer\nSubject: Professional Knowledge: Labour law\n", "Exam Pattern:\nStage: Mains | Duration: 50 minutes\n"]) {
    const m = merge(body, POSTWISE());
    assert.equal(val(m, "syllabus"), undefined, body);
    assert.equal(val(m, "examPattern"), undefined, body);
    assert.ok(Object.values(m.holds).flat().some((h) => /post/.test(h)), body);
  }
});

suite("U2: exam stages and selection");

test("M09 Tier-I status only; Tier-II gets its window; Document Verification untouched; a new stage is added", () => {
  const m = merge("Exam Stages:\nStage: Tier-I (Computer Based Test) | Status: Result declared\nStage: Tier-II (Computer Based Test) | Status: Scheduled | From: 18 Jan 2027 | Until: 20 Jan 2027 | Tentative\nStage: Skill Test | Status: Not declared\n");
  const s = val<ExamStage[]>(m, "examStages")!;
  const [t1, t2, dv, skill] = s;
  assert.deepEqual([t1.status, t1.dateIso, t1.dateEndIso, t1.dateDisplay], ["RESULT_DECLARED", "2026-09-30", "2026-10-28", "30 Sep – 28 Oct 2026"], "Tier-I keeps its dates");
  assert.deepEqual([t2.status, t2.dateIso, t2.dateEndIso, t2.certainty, t2.dateProvenance], ["SCHEDULED", "2027-01-18", "2027-01-20", "TENTATIVE", "Test notice, dated 20 Dec 2026"]);
  assert.deepEqual([dv.name, dv.status], ["Document Verification", "NOT_DECLARED"]);
  assert.deepEqual([skill.name, skill.order], ["Skill Test", 4]);
});

test("M10 a new single date replaces a window as a whole (no stale last day or old wording)", () => {
  const m = merge("Exam Stages:\nStage: Tier-I (Computer Based Test) | Date: 5 Oct 2026\n");
  const t1 = val<ExamStage[]>(m, "examStages")![0];
  assert.deepEqual([t1.dateIso, t1.dateEndIso, t1.dateDisplay], ["2026-10-05", undefined, undefined]);
});

test("M11 selection: a new stage added, one marked qualifying, the rest kept; a post-wise stage goes under its post", () => {
  const m = merge("Selection Process:\nStage: Document Verification | Qualifying\nStage: Skill Test | Qualifying\nStage: Physical Test | Post: Inspector\n");
  const sel = val<{ stages: Array<{ name: string; qualifying?: boolean; order: number }> }>(m, "selection")!;
  assert.deepEqual(sel.stages.map((s) => [s.name, s.qualifying ?? false, s.order]), [["Tier-I (Computer Based Test)", false, 1], ["Tier-II (Computer Based Test)", false, 2], ["Document Verification", true, 3], ["Skill Test", true, 4]]);
  const posts = val<CmsRecruitmentPost[]>(m, "eligibility")!;
  assert.deepEqual(posts.find((p) => p.post === "Inspector")!.selectionStages, ["Physical Test"]);
  assert.equal(posts.find((p) => p.post === "Assistant Section Officer")!.selectionStages, undefined);
});

test("M12 'Remove: Stage' removes it from the schedule and the selection list; held unticked", () => {
  const m = merge("Remove: Stage: Document Verification\n");
  assert.ok(!val<ExamStage[]>(m, "examStages")!.some((s) => s.name === "Document Verification"));
  assert.ok(!val<{ stages: Array<{ name: string }> }>(m, "selection")!.stages.some((s) => s.name === "Document Verification"));
  const p = proposalFor(m, job());
  for (const path of ["examStages", "selection"]) assert.equal(p.items.find((i) => i.fieldPath === path)!.defaultTicked, false, path);
});

suite("U2: exam pattern");

test("M13 a new Tier-II paper beside Tier-I; Tier-I's figures changed only where given; stale totals held", () => {
  const m = merge("Exam Pattern:\nStage: Tier-II (Computer Based Test) | Paper: Paper-I | Duration: 150 minutes\nSubject: Mathematical Abilities: 30 Questions, 90 Marks\n\nStage: Tier-I (Computer Based Test)\nSubject: English Comprehension: 30 Questions, 60 Marks\n");
  const p = val<ExamPatternPaper[]>(m, "examPattern")!;
  assert.equal(p.length, 2);
  const t1 = p[0];
  assert.deepEqual(t1.sections.map((s) => [s.subject, s.questions]), [["English Comprehension", 30], ["General Intelligence and Reasoning", 25], ["Quantitative Aptitude", 25], ["General Awareness", 25]]);
  assert.equal(t1.totalQuestions, 100, "printed totals are never worked out");
  assert.ok((m.holds.examPattern ?? []).some((h) => /no longer match/.test(h)));
  assert.deepEqual([p[1].name, p[1].stage, p[1].durationMinutes], ["Paper-I", "Tier-II (Computer Based Test)", 150]);
});

suite("U2: fees by category");

test("M14 the fee table read category by category, with exemptions; the two summary fees follow it", () => {
  const m = merge("Application Fee: General/EWS/OBC Rs. 750, SC/ST/PwBD/Women/Ex-Servicemen Nil\n");
  const t = val<FeeRow[]>(m, "financial.feeTable")!;
  assert.deepEqual(t.map((r) => [r.category, r.groups, r.amount, r.exempt ?? false]), [["General/EWS/OBC", ["general", "obc", "ews"], 750, false], ["SC/ST/PwBD/Women/Ex-Servicemen", ["sc", "st", "pwbd", "women", "esm"], 0, true]]);
  assert.equal(val(m, "financial.feeGeneral"), 750);
  assert.equal(val(m, "financial.feeSCST"), undefined, "SC/ST/PwBD already 0 on the job: nothing to change");
});

test("M15 a partial fee update changes only its rows; post-wise fees give no summary fee", () => {
  const r = job({ financial: { feeGeneral: pf<number | null>(750), feeSCST: pf<number | null>(0), feeTable: pf<FeeRow[]>([
    { category: "General/EWS/OBC", groups: ["general", "obc", "ews"], amount: 750 }, { category: "SC/ST/PwBD", groups: ["sc", "st", "pwbd"], amount: 0, exempt: true }]) } });
  const m = merge("Application Fee:\nWomen: Exempted\n", r);
  const t = val<FeeRow[]>(m, "financial.feeTable")!;
  assert.equal(t.length, 3);
  assert.equal(t[0].amount, 750);
  const pw = merge("Application Fee (Assistant Section Officer): General Rs. 500\nApplication Fee (Inspector): General Rs. 300\n");
  assert.equal(val<FeeRow[]>(pw, "financial.feeTable")!.length, 2);
  assert.equal(val(pw, "financial.feeGeneral"), undefined);
  assert.ok(pw.warnings.some((w) => /differ by post/.test(w)));
});

test("M16 two different fees for the same categories: neither offered, said", () => {
  const f = readFeeLines([{ line: 1, text: "Application Fee: General Rs. 500" }, { line: 2, text: "Application Fee: General Rs. 600" }]);
  assert.equal(f.rows.length, 0);
  assert.match(f.problems[0].message, /two different fees/);
  assert.deepEqual(legacyFees([{ category: "All candidates", groups: ["all"], amount: 200 }]), { feeGeneral: 200, feeSCST: 200 });
});

test("M17 the fee table is saved by the editor's own validator, and refused when it is wrong", () => {
  const ok = routeFieldUpdate(job(), "financial.feeTable", pf<unknown>([{ category: "General", groups: ["general"], amount: 750 }], "PENDING"), "a", "t");
  assert.equal(ok.record.financial.feeTable?.value?.[0].amount, 750);
  assert.equal(ok.record.financial.feeGeneral?.value, 100, "the older fee fields are not touched by saving the table");
  assert.throws(() => routeFieldUpdate(job(), "financial.feeTable", pf<unknown>([{ category: "General", groups: ["general"], amount: 5, exempt: true }], "PENDING"), "a", "t"), /exempt/);
  assert.throws(() => routeFieldUpdate(job(), "financial.feeTable", pf<unknown>([{ category: "General", groups: ["general"], amount: 5 }, { category: "Gen", groups: ["general"], amount: 6 }], "PENDING"), "a", "t"), /two fees/);
});

suite("U2: links, eligibility, age");

test("M18 two Apply portals with who each is for; the job's own apply link is not offered again", () => {
  const m = merge("Important Links:\nApply Online: Portal A | https://a.example.gov.in/ | For: Graduate apprentices\nApply Online: Portal B | https://b.example.gov.in/ | For: ITI trade apprentices\nApply Online: Apply Online | https://tsc.example.gov.in/apply\n");
  const p = proposalFor(m, job());
  const apply = p.items.filter((i) => i.fieldPath === "links#APPLY_ONLINE");
  assert.deepEqual(apply.map((i) => [(i.value as { url: string }).url, (i.value as { appliesTo?: string }).appliesTo ?? null, i.action]).sort(), [
    ["https://a.example.gov.in/", "Graduate apprentices", "FILL"], ["https://b.example.gov.in/", "ITI trade apprentices", "FILL"], ["https://tsc.example.gov.in/apply", null, "MATCHES"]]);
  const iti = apply.find((i) => (i.value as { appliesTo?: string }).appliesTo === "ITI trade apprentices")!;
  const saved = routeFieldUpdate(job(), "links", pf<unknown>([...job().links, iti.value]), "a", "t");
  assert.equal(saved.record.links[2].appliesTo, "ITI trade apprentices", "the editor's validator keeps who a link is for");
});

test("M19 'Remove: Link' and 'Remove: Post': offered unticked, with a warning; nothing else removed", () => {
  const m = merge("Remove: Link: https://tsc.example.gov.in/notice.pdf\nRemove: Post: Inspector\n");
  assert.deepEqual(val<Array<{ url: string }>>(m, "links")!.map((l) => l.url), ["https://tsc.example.gov.in/apply"]);
  assert.deepEqual(val<CmsRecruitmentPost[]>(m, "eligibility")!.map((x) => x.post), ["Assistant Section Officer"]);
  const p = proposalFor(m, job());
  for (const path of ["links", "eligibility"]) { const i = p.items.find((x) => x.fieldPath === path)!; assert.equal(i.defaultTicked, false, path); assert.ok(i.flags.some((f) => /^✕ Removed/.test(f))); }
});

test("M20 one post's qualification changes; the other post is kept as it is", () => {
  const m = merge("Post Name: Inspector\nEducational Qualification: Bachelor's degree in any discipline\n");
  const posts = val<CmsRecruitmentPost[]>(m, "eligibility")!;
  assert.deepEqual(posts.map((p) => [p.post, p.qualification]), [["Assistant Section Officer", ["Graduate"]], ["Inspector", ["Bachelor's degree in any discipline"]]]);
});

test("M21 an age line with only a new maximum keeps the job's relaxations; a relaxation alone is refused and said, never applied to nothing", () => {
  const m = merge("Age Limit: Minimum 18 years, Maximum 35 years as on 1 Aug 2026\n");
  const age = val<{ min?: number; max?: number; asOf?: string; relaxations: unknown[] }>(m, "age")!;
  assert.deepEqual([age.min, age.max, age.asOf], [18, 35, "2026-08-01"]);
  assert.equal(age.relaxations.length, 1, "the job's OBC relaxation is kept");
  const r = merge("Age Relaxation: SC/ST 5 years, OBC 3 years, PwBD 10 years\n");
  assert.equal(val(r, "age"), undefined);
  assert.ok(r.refusedValues.some((x) => x.fieldPath === "age" && /no age limit was read/.test(x.reason)));
});

suite("U2: safety and the whole path");

test("M22 text about another job: refused, nothing offered", () => {
  const m = mergeUpdate({ record: job(), reading: readUpdateText(HEAD.replace("TSC CGL 2026 (Combined Graduate Level Examination)", "TSC CHSL 2026 (Combined Higher Secondary Level Examination)") + "Exam Stages:\nStage: Tier-I | Status: Conducted\n", { job: identity(job()) }), organizationId: ORG });
  assert.ok(m.refused);
  assert.equal(m.values.length + m.links.length, 0);
});

test("M23 an update about one thing offers one field; every other field is left alone", () => {
  const m = merge("Exam Stages:\nStage: Tier-II (Computer Based Test) | Status: Scheduled | Date: 18 Jan 2027 | Tentative\n");
  assert.deepEqual(m.values.map((v) => v.fieldPath), ["examStages"]);
});

test("M23b a date with no 'Confirmed' or 'Tentative' is not applied, nor anything else of that stage (never guessed)", () => {
  const m = merge("Exam Stages:\nStage: Tier-II (Computer Based Test) | Status: Scheduled | Date: 18 Jan 2027\n");
  assert.equal(val(m, "examStages"), undefined);
  assert.ok((m.holds.examStages ?? []).some((h) => /confirmed or tentative/.test(h)));
  assert.ok(m.warnings.some((w) => /confirmed or tentative/.test(w)), "said for the owner even though no stage item is offered");
});

test("M24 the same text applied twice: the second time nothing changes", async () => {
  const body = "Exam Stages:\nStage: Tier-II (Computer Based Test) | Status: Scheduled | From: 18 Jan 2027 | Until: 20 Jan 2027 | Tentative\n\nSyllabus:\nStage: Tier-I (Computer Based Test)\nSubject: Quantitative Aptitude: Algebra\n\nApplication Fee: General/EWS/OBC Rs. 750, SC/ST/PwBD Nil\n";
  const first = merge(body);
  let r = job();
  for (const v of first.values) r = routeFieldUpdate(r, v.fieldPath, pf<unknown>(v.value, "PENDING"), "a", "t").record;
  const again = merge(body, r);
  assert.deepEqual(again.values.map((v) => v.fieldPath), [], JSON.stringify(again.changes.filter((c) => c.kind !== "NOTED")));
});

test("M25 every merged value passes the editor's validators; saved through the ordinary payload, English is still there", async () => {
  const { buildApplyPayload, editorValue } = await import("@/lib/cms/importer/apply-build");
  const m = merge("Exam Stages:\nStage: Tier-II (Computer Based Test) | Status: Scheduled | Date: 18 Jan 2027 | Confirmed\n\nSyllabus:\nStage: Tier-I (Computer Based Test)\nSubject: Quantitative Aptitude: Algebra\n\nApplication Fee: General/EWS/OBC Rs. 750, SC/ST/PwBD Nil\n");
  for (const v of m.values) assert.ok(editorValue(v.fieldPath, v.value).ok, v.fieldPath);
  const p = proposalFor(m, job());
  const payload = buildApplyPayload({ record: job(), proposal: p, selected: p.items.map((i) => i.id), confirmReplaceVerified: true, adminId: "00000000-0000-4000-8000-000000000001", sourceLabel: "test" });
  const saved = payload.record as { syllabus: ProvenanceField<SyllabusSubject[]>; exam_stages?: ExamStage[]; examStages?: ExamStage[] };
  const syl = (saved.syllabus ?? (payload.record as Record<string, ProvenanceField<SyllabusSubject[]>>)["syllabus"]).value!;
  assert.deepEqual(syl.find((s) => s.subject === "English Comprehension")!.topics, ["Spot the error", "Synonyms"]);
  assert.ok(syl.find((s) => s.subject === "Quantitative Aptitude")!.topics.includes("Algebra"));
  assert.deepEqual(payload.revisions.map((r) => r.fieldPath).sort(), ["examStages", "financial.feeGeneral", "financial.feeTable", "syllabus"]);
});

test("M26 Add New Job uses the same engine: every item is new, nothing to compare", () => {
  const m = merge("Exam Stages:\nStage: Tier-I | Status: Scheduled | Date: 5 Jan 2027 | Confirmed\n\nSyllabus:\nStage: Tier-I\nSubject: English: Grammar\n", null);
  assert.deepEqual(m.values.map((v) => v.fieldPath).sort(), ["examStages", "syllabus"]);
  assert.ok(m.changes.filter((c) => c.kind !== "NOTED").every((c) => c.kind === "ADDED"));
});

test("M27 announcements and supersessions are not field values (U3 offers them separately); the lines the text could not read are said", () => {
  const m = merge("Announcement:\nTitle: Tier-II dates\nText: Announced.\n\nSupersede:\n12 Oct 2026 – Old notice | Reason: replaced\n\nExam Stages:\nTier-II probably in January\n");
  assert.equal(m.values.length, 0);
  assert.ok(!m.warnings.some((w) => /U3/.test(w)));
  assert.ok(m.warnings.some((w) => /Not read from the text \(line \d+\): “Tier-II probably in January”/.test(w)));
});

test("M28 the import reads an LN Update by code only: no AI reader runs for it; its tables come only from its vacancy section", () => {
  const src = readFileSync("src/lib/cms/importer/service.ts", "utf8");
  assert.match(src, /if \(obtained\.method === "PASTED" && updateVersion\(obtained\.text\) !== null\) \{\s*return \{ input, reading: \{ values: \[\], links: \[\], notFound: \[\], refused: \[\], summary: null, lnUpdate: true \}, obtained \};/);
  assert.match(src, /const tableText = updateMerges\.get\(s\.retrieval\.id\)\?\.vacancyText \?\? s\.retrieval\.source\.text;/);
  const merged = readFileSync("src/lib/cms/importer/update-merge.ts", "utf8").replace(/\/\/.*$/gm, "");
  for (const forbidden of [/from\s+["']@\/lib\/db/, /\bfetch\(/, /gemini/i, /telegram/i, /repository/]) assert.ok(!forbidden.test(merged), String(forbidden));
});
