// ═══════════════════════════════════════════════════════════
// "Check for updates" and the AI usage cap
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP, no AI. The AI's answer is treated as untrusted
// input; these tests feed readProposals() the kinds of things it sends.
//
//  UC01  a changed date becomes a proposal; an unchanged one does not
//  UC02  dates that are malformed, impossible, or years away are dropped
//  UC03  a stage on the record is matched by name and only real changes are kept
//  UC04  a stage not on the record is proposed as new
//  UC05  a new link is proposed; one already on the record, or not a web address, is dropped
//  UC06  unknown fields, statuses, link types and shapeless input are dropped, never guessed
//  UC07  official means the job's own sites or a government domain; a look-alike is not
//  UC08  page mode: confirmed only when the evidence, or the link's address, is on the page
//  UC09  search mode: confirmed only when the search opened that site; links are never confirmed
//  UC10  only official, confirmed proposals are ticked by default
//  UC11  at most 12 proposals; a repeated proposal is kept once
//  UC12  accepted proposals become ordinary saves: dates one by one, stages as one list, links as one list
//  UC13  saving a stage date replaces a typed range and never touches other stages
//  UC14  the prompt states what is on record and, in page mode, forbids outside knowledge
//  UC15  JSON is dug out of an answer with prose or a code fence around it
//  UC16  a page becomes reading text that keeps each link's address
//  AU01  requests are counted per feature and per day (Indian time)
//  AU02  the cap refuses further requests and a refused request is not counted
//  AU03  the cap setting falls back to the default on nonsense
//  AU04  a failing store never blocks an AI request
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";
import {
  buildUpdatePrompt, hostOf, isOfficialHost, jsonFromAnswer, pageTextForCheck, readProposals, savesFor, tickedByDefault,
} from "@/lib/cms/update-check";
import { readAiUsage, recordAiFailure, reserveAiRequest, resolveDailyCap, usageDay, type UsageStore } from "@/lib/ai-usage";

const pending = <T,>(value: T): ProvenanceField<T> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });

function ibps(over: Partial<RecruitmentRecord> = {}): RecruitmentRecord {
  return {
    id: "rec-ibps",
    slug: "ibps-po-2026",
    draftState: "PUBLISHED",
    recordRevision: "abc",
    publishedAt: "2026-09-01T00:00:00Z",
    identity: { organizationId: "ibps", organizationName: "IBPS", recruitmentYear: 2026, title: pending("IBPS PO/MT CRP XVI 2026"), notificationNumber: pending("CRP PO/MT-XVI") },
    dates: { applicationCloseDate: pending<string | null>("2026-07-21"), resultDate: pending<string | null>(null) as ProvenanceField<string | null> },
    vacancies: {},
    financial: {},
    examStages: [
      { name: "Preliminary Examination", order: 1, status: "RESULT_DECLARED", dateIso: "2026-08-17" },
      { name: "Mains Examination", order: 2, status: "SCHEDULED", dateIso: "2026-10-04" },
      { name: "Interview", order: 3, status: "NOT_DECLARED", dateDisplay: "Nov–Dec 2026" },
    ] as ExamStage[],
    links: [
      { type: "OFFICIAL_WEBSITE", label: "IBPS", url: "https://www.ibps.in/", official: true },
      { type: "OTHER", label: "A portal", url: "https://jobportal.example/ibps", official: false },
    ],
    documents: [],
    lifecycle: { status: "UPCOMING", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const change = (c: Record<string, unknown>) => ({ summary: "s", changes: [c] });
const one = (c: Record<string, unknown>, ctx = {}) => readProposals(change(c), ibps(), ctx).proposals;

suite("Check for updates: reading the AI's answer");

test("UC01 a changed date becomes a proposal; an unchanged one does not", () => {
  const [p] = one({ type: "date", field: "resultDate", value: "2026-11-15", evidence: "Result of Main Examination will be declared on 15.11.2026", source: "ibps.in" });
  assert.equal(p.kind, "DATE");
  assert.equal(p.label, "Result date");
  assert.equal(p.oldText, "not set");
  assert.equal(p.newText, "15 Nov 2026");
  assert.deepEqual(p.date, { field: "resultDate", value: "2026-11-15" });
  assert.deepEqual(one({ type: "date", field: "applicationCloseDate", value: "2026-07-21", source: "ibps.in" }), []);
  assert.equal(one({ type: "date", field: "applicationCloseDate", value: "2026-07-28", source: "ibps.in" })[0].oldText, "21 Jul 2026");
});

test("UC02 dates that are malformed, impossible, or years away are dropped", () => {
  for (const value of ["15-11-2026", "2026-02-30", "2026-13-01", "November 2026", "", null, 20261115, "2019-11-15", "2031-01-01"]) {
    assert.deepEqual(one({ type: "date", field: "resultDate", value, source: "ibps.in" }), [], String(value));
  }
  assert.equal(one({ type: "date", field: "resultDate", value: "2027-01-10", source: "ibps.in" }).length, 1);
});

test("UC03 a stage on the record is matched by name and only real changes are kept", () => {
  const [p] = one({ type: "stage", stage: "mains  examination", status: "CONDUCTED", date: "", evidence: "Main Examination was held on 04.10.2026", source: "ibps.in" });
  assert.equal(p.label, "Mains Examination");
  assert.equal(p.oldText, "scheduled, 4 Oct 2026");
  assert.equal(p.newText, "held, 4 Oct 2026");
  assert.deepEqual(p.stage, { name: "Mains Examination", isNew: false, status: "CONDUCTED" });
  // Same status and same date as the record: nothing to propose.
  assert.deepEqual(one({ type: "stage", stage: "Mains Examination", status: "SCHEDULED", date: "2026-10-04", source: "ibps.in" }), []);
  const [moved] = one({ type: "stage", stage: "Mains Examination", status: "postponed", date: "2026-10-18", certainty: "tentative", source: "ibps.in" });
  assert.deepEqual(moved.stage, { name: "Mains Examination", isNew: false, status: "POSTPONED", dateIso: "2026-10-18", certainty: "TENTATIVE" });
  assert.equal(moved.newText, "postponed, 18 Oct 2026, tentative");
});

test("UC04 a stage not on the record is proposed as new", () => {
  const [p] = one({ type: "stage", stage: "Provisional Allotment", status: "SCHEDULED", date: "2027-01-20", source: "ibps.in" });
  assert.equal(p.label, "Provisional Allotment (new stage)");
  assert.equal(p.oldText, "not on record");
  assert.equal(p.stage?.isNew, true);
  assert.deepEqual(one({ type: "stage", stage: "Provisional Allotment", source: "ibps.in" }), []);
  // "Scheduled" with no date anywhere is not something the site can store.
  assert.deepEqual(one({ type: "stage", stage: "Provisional Allotment", status: "SCHEDULED", source: "ibps.in" }), []);
  assert.equal(one({ type: "stage", stage: "Provisional Allotment", status: "CONDUCTED", source: "ibps.in" }).length, 1);
  // The Interview on record has a typed month range, so it can be scheduled without a new date.
  assert.equal(one({ type: "stage", stage: "Interview", status: "SCHEDULED", source: "ibps.in" }).length, 1);
  assert.deepEqual(one({ type: "stage", stage: "", status: "CONDUCTED", source: "ibps.in" }), []);
});

test("UC05 a new link is proposed; one already on the record, or not a web address, is dropped", () => {
  const [p] = one({ type: "link", linkType: "admit_card", url: "https://www.ibps.in/crp-po-xvi-mains-call-letter", label: "Mains call letter", source: "news.example" });
  assert.equal(p.label, "Admit card link");
  assert.deepEqual(p.link, { type: "ADMIT_CARD", url: "https://www.ibps.in/crp-po-xvi-mains-call-letter", label: "Mains call letter" });
  // A link is judged by where it points, not by who mentioned it.
  assert.equal(p.sourceHost, "ibps.in");
  assert.equal(p.official, true);
  assert.deepEqual(one({ type: "link", linkType: "RESULT", url: "https://www.ibps.in", source: "ibps.in" }), []);
  for (const url of ["ibps.in/result", "javascript:alert(1)", "ftp://ibps.in/x", "https://", ""]) {
    assert.deepEqual(one({ type: "link", linkType: "RESULT", url, source: "ibps.in" }), [], url);
  }
  assert.equal(one({ type: "link", linkType: "RESULT", url: "https://ibps.in/result", source: "ibps.in" })[0].link?.label, "Result");
});

test("UC06 unknown fields, statuses, link types and shapeless input are dropped, never guessed", () => {
  assert.deepEqual(one({ type: "date", field: "examDate", value: "2026-11-15" }), []);
  assert.deepEqual(one({ type: "date", field: "__proto__", value: "2026-11-15" }), []);
  assert.deepEqual(one({ type: "stage", stage: "Mains Examination", status: "CANCELLED" }), []);
  assert.deepEqual(one({ type: "link", linkType: "APPLY_ONLINE", url: "https://ibps.in/apply" }), []);
  assert.deepEqual(one({ type: "vacancy", value: 9999 }), []);
  for (const raw of [null, undefined, "nothing new", 42, [], { changes: "none" }, { changes: [null, "x", 7] }]) {
    assert.deepEqual(readProposals(raw, ibps()).proposals, []);
  }
  assert.equal(readProposals({ changes: [null, "x"] }, ibps()).dropped, 2);
});

suite("Check for updates: where a proposal came from");

test("UC07 official means the job's own sites or a government domain; a look-alike is not", () => {
  const r = ibps();
  assert.equal(hostOf("https://WWW.IBPS.in/crp?x=1"), "ibps.in");
  assert.equal(hostOf("ibps.in"), "ibps.in");
  assert.equal(hostOf("not a host"), null);
  assert.equal(isOfficialHost("ibps.in", r), true);
  assert.equal(isOfficialHost("cgrs.ibps.in", r), true);
  assert.equal(isOfficialHost("ssc.gov.in", r), true);
  assert.equal(isOfficialHost("upsc.nic.in", r), true);
  assert.equal(isOfficialHost("ibps.in.example.com", r), false);
  assert.equal(isOfficialHost("fakeibps.in", r), false);
  assert.equal(isOfficialHost("gov.in.example.com", r), false);
  // A link on the record that is not marked official does not make its site official.
  assert.equal(isOfficialHost("jobportal.example", r), false);
  assert.equal(isOfficialHost(null, r), false);
});

const PAGE = { url: "https://www.ibps.in/notices", text: "Notice: Result of Main Examination will be declared on 15.11.2026.\nMains call letter [https://www.ibps.in/call-letter]" };

test("UC08 page mode: confirmed only when the evidence, or the link's address, is on the page", () => {
  const ok = one({ type: "date", field: "resultDate", value: "2026-11-15", evidence: "Result of Main Examination will be declared on 15.11.2026", source: "somewhere-else.example" }, { source: PAGE });
  assert.equal(ok[0].confirmed, true);
  // The page that was read is the source, whatever the AI names.
  assert.equal(ok[0].sourceHost, "ibps.in");
  assert.equal(ok[0].official, true);
  assert.equal(one({ type: "date", field: "resultDate", value: "2026-11-20", evidence: "Result will be out on 20 November", source: "ibps.in" }, { source: PAGE })[0].confirmed, false);
  assert.equal(one({ type: "date", field: "resultDate", value: "2026-11-15", evidence: "", source: "ibps.in" }, { source: PAGE })[0].confirmed, false);
  assert.equal(one({ type: "link", linkType: "ADMIT_CARD", url: "https://www.ibps.in/call-letter" }, { source: PAGE })[0].confirmed, true);
  assert.equal(one({ type: "link", linkType: "ADMIT_CARD", url: "https://www.ibps.in/made-up" }, { source: PAGE })[0].confirmed, false);
});

test("UC09 search mode: confirmed only when the search opened that site; links are never confirmed", () => {
  const ctx = { groundedHosts: ["ibps.in", "coaching.example"] };
  const date = { type: "date", field: "resultDate", value: "2026-11-15", evidence: "declared on 15.11.2026" };
  assert.equal(one({ ...date, source: "https://www.ibps.in/notices" }, ctx)[0].confirmed, true);
  assert.equal(one({ ...date, source: "ssc.gov.in" }, ctx)[0].confirmed, false);
  assert.equal(one({ ...date, source: "" }, ctx)[0].confirmed, false);
  assert.equal(one({ ...date, source: "ibps.in" }, {})[0].confirmed, false);
  const coaching = one({ ...date, source: "coaching.example" }, ctx)[0];
  assert.equal(coaching.confirmed, true);
  assert.equal(coaching.official, false);
  assert.equal(one({ type: "link", linkType: "RESULT", url: "https://www.ibps.in/result-xvi", source: "ibps.in" }, ctx)[0].confirmed, false);
});

test("UC10 only official, confirmed proposals are ticked by default", () => {
  const ctx = { groundedHosts: ["ibps.in", "coaching.example"] };
  const date = { type: "date", field: "resultDate", value: "2026-11-15", evidence: "x" };
  assert.equal(tickedByDefault(one({ ...date, source: "ibps.in" }, ctx)[0]), true);
  assert.equal(tickedByDefault(one({ ...date, source: "coaching.example" }, ctx)[0]), false);
  assert.equal(tickedByDefault(one({ ...date, source: "ssc.gov.in" }, ctx)[0]), false);
  assert.equal(tickedByDefault(one({ type: "link", linkType: "RESULT", url: "https://www.ibps.in/r", source: "ibps.in" }, ctx)[0]), false);
});

test("UC11 at most 12 proposals; a repeated proposal is kept once", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ type: "link", linkType: "EXAM_NOTICE", url: `https://www.ibps.in/notice-${i}` }));
  assert.equal(readProposals({ changes: many }, ibps()).proposals.length, 12);
  const twice = [{ type: "date", field: "resultDate", value: "2026-11-15" }, { type: "date", field: "resultDate", value: "2026-11-16" }];
  const read = readProposals({ changes: twice }, ibps());
  assert.equal(read.proposals.length, 1);
  assert.equal(read.proposals[0].date?.value, "2026-11-15");
  assert.equal(read.dropped, 1);
});

suite("Check for updates: applying what was accepted");

test("UC12 accepted proposals become ordinary saves: dates one by one, stages as one list, links as one list", () => {
  const r = ibps();
  const { proposals } = readProposals({ changes: [
    { type: "link", linkType: "RESULT", url: "https://www.ibps.in/result-xvi", label: "Mains result", source: "ibps.in" },
    { type: "stage", stage: "Mains Examination", status: "CONDUCTED", source: "ibps.in" },
    { type: "date", field: "resultDate", value: "2026-11-15", source: "ibps.in" },
    { type: "stage", stage: "Provisional Allotment", status: "SCHEDULED", date: "2027-01-20", source: "ibps.in" },
    { type: "date", field: "admitCardDate", value: "2026-09-25", source: "coaching.example" },
  ] }, r);
  const saves = savesFor(r, proposals);
  assert.deepEqual(saves.map((s) => s.fieldPath), ["dates.resultDate", "dates.admitCardDate", "examStages", "links"]);
  assert.equal(saves[0].value, "2026-11-15");
  assert.match(saves[0].reason, /^Check for updates: Result date not set → 15 Nov 2026 \(source: ibps\.in\)$/);
  const stages = saves[2].value as ExamStage[];
  assert.deepEqual(stages.map((s) => `${s.order} ${s.name} ${s.status}`), [
    "1 Preliminary Examination RESULT_DECLARED", "2 Mains Examination CONDUCTED", "3 Interview NOT_DECLARED", "4 Provisional Allotment SCHEDULED",
  ]);
  const links = saves[3].value as RecruitmentRecord["links"];
  assert.equal(links.length, 3);
  assert.deepEqual(links[2], { type: "RESULT", label: "Mains result", url: "https://www.ibps.in/result-xvi", official: true });
  // Only what was accepted is saved.
  assert.deepEqual(savesFor(r, proposals.filter((p) => p.kind === "DATE" && p.date?.field === "resultDate")).map((s) => s.fieldPath), ["dates.resultDate"]);
  assert.deepEqual(savesFor(r, []), []);
  // The record handed in is never changed.
  assert.equal(r.examStages?.[1].status, "SCHEDULED");
  assert.equal(r.links.length, 2);
});

test("UC13 saving a stage date replaces a typed range and never touches other stages", () => {
  const r = ibps();
  const { proposals } = readProposals(change({ type: "stage", stage: "Interview", status: "SCHEDULED", date: "2026-12-02", source: "ibps.in" }), r);
  const stages = savesFor(r, proposals)[0].value as ExamStage[];
  assert.deepEqual(stages[2], { name: "Interview", order: 3, status: "SCHEDULED", dateIso: "2026-12-02", certainty: "TENTATIVE" });
  // Only an explicit "confirmed" from the source makes a date confirmed.
  const sure = readProposals(change({ type: "stage", stage: "Interview", status: "SCHEDULED", date: "2026-12-02", certainty: "confirmed", source: "ibps.in" }), r);
  assert.equal((savesFor(r, sure.proposals)[0].value as ExamStage[])[2].certainty, "CONFIRMED");
  const odd = readProposals(change({ type: "stage", stage: "Interview", status: "SCHEDULED", date: "2026-12-02", certainty: "TBA", source: "ibps.in" }), r);
  assert.equal((savesFor(r, odd.proposals)[0].value as ExamStage[])[2].certainty, "TENTATIVE");
  assert.deepEqual(stages[0], r.examStages?.[0]);
  assert.deepEqual(stages[1], r.examStages?.[1]);
});

suite("Check for updates: the question and the answer text");

test("UC14 the prompt states what is on record and, in page mode, forbids outside knowledge", () => {
  const search = buildUpdatePrompt(ibps(), "2026-10-10", null);
  assert.match(search, /Today is 2026-10-10\./);
  assert.match(search, /Recruitment: IBPS PO\/MT CRP XVI 2026/);
  assert.match(search, /- Mains Examination: status SCHEDULED, date 2026-10-04/);
  assert.match(search, /- resultDate: not set/);
  assert.match(search, /Search the web\. Prefer the recruiting body's own website \(ibps\.in\)/);
  assert.ok(!search.includes("PAGE TEXT"));
  const page = buildUpdatePrompt(ibps(), "2026-10-10", PAGE);
  assert.match(page, /Use ONLY the page text given below \(from https:\/\/www\.ibps\.in\/notices\)/);
  assert.ok(page.endsWith(PAGE.text));
});

test("UC15 JSON is dug out of an answer with prose or a code fence around it", () => {
  assert.deepEqual(jsonFromAnswer('Here is what I found:\n```json\n{"summary":"x","changes":[]}\n```\nLet me know.'), { summary: "x", changes: [] });
  assert.deepEqual(jsonFromAnswer('{"changes":[{"type":"date"}]}'), { changes: [{ type: "date" }] });
  assert.equal(jsonFromAnswer("Nothing new was found."), null);
  assert.equal(jsonFromAnswer('{"changes": [oops]}'), null);
  assert.equal(jsonFromAnswer(""), null);
});

test("UC16 a page becomes reading text that keeps each link's address", () => {
  const html = `<html><head><title>T</title><style>.a{}</style></head><body><script>var x = "<a href='/no'>no</a>";</script>
    <h1>Notices</h1><p>Result on 15.11.2026 &amp; later.</p>
    <ul><li><a class="x" href="/call-letter">Mains call letter</a></li><li><a href="https://other.example/a.pdf">PDF</a></li>
    <li><a href="javascript:void(0)">Menu</a></li><li><a href="#top">Top</a></li></ul></body></html>`;
  const out = pageTextForCheck(html, "https://www.ibps.in/notices", 5000);
  assert.match(out, /Notices\nResult on 15\.11\.2026 & later\./);
  assert.match(out, /Mains call letter \[https:\/\/www\.ibps\.in\/call-letter\]/);
  assert.match(out, /PDF \[https:\/\/other\.example\/a\.pdf\]/);
  assert.ok(!out.includes("var x") && !out.includes(".a{}") && !out.includes("javascript:") && !out.includes("<"));
  assert.equal(pageTextForCheck(html, "https://www.ibps.in/notices", 10).length, 10);
});

suite("AI usage count and daily cap");

const NOW = new Date("2026-10-10T06:00:00Z");

// Each test counts into its own store, so tests cannot disturb one another.
function freshStore(): UsageStore {
  const days = new Map<string, Record<string, number>>();
  return {
    async increment(day, field, by) {
      const row = days.get(day) ?? {};
      row[field] = (row[field] ?? 0) + by;
      days.set(day, row);
      return row[field];
    },
    async read(day) {
      return { ...(days.get(day) ?? {}) };
    },
  };
}

test("AU01 requests are counted per feature and per day (Indian time)", async () => {
  const store = freshStore();
  assert.equal(usageDay(new Date("2026-10-10T18:29:00Z")), "2026-10-10");
  assert.equal(usageDay(new Date("2026-10-10T18:30:00Z")), "2026-10-11");
  await reserveAiRequest("assist", { store, now: NOW });
  await reserveAiRequest("assist", { store, now: NOW });
  const third = await reserveAiRequest("update-check", { store, now: NOW });
  assert.deepEqual(third, { allowed: true, usedToday: 3, cap: 150 });
  await recordAiFailure("update-check", { store, now: NOW });
  await reserveAiRequest("assist", { store, now: new Date("2026-10-09T06:00:00Z") });
  const [today, yesterday, before] = await readAiUsage(3, { store, now: NOW });
  assert.deepEqual(today, { day: "2026-10-10", total: 3, failed: 1, refused: 0, byFeature: { assist: 2, "update-check": 1, "job-search": 0 } });
  assert.equal(yesterday.total, 1);
  assert.equal(before.total, 0);
});

test("AU02 the cap refuses further requests and a refused request is not counted", async () => {
  const store = freshStore();
  const opts = { store, now: NOW, cap: 2 };
  assert.equal((await reserveAiRequest("assist", opts)).allowed, true);
  assert.equal((await reserveAiRequest("update-check", opts)).allowed, true);
  assert.deepEqual(await reserveAiRequest("update-check", opts), { allowed: false, usedToday: 2, cap: 2 });
  assert.equal((await reserveAiRequest("assist", opts)).allowed, false);
  const [today] = await readAiUsage(1, { store, now: NOW });
  assert.equal(today.total, 2);
  assert.equal(today.refused, 2);
  assert.deepEqual(today.byFeature, { assist: 1, "update-check": 1, "job-search": 0 });
  // The next day starts from zero.
  assert.equal((await reserveAiRequest("assist", { ...opts, now: new Date("2026-10-11T06:00:00Z") })).allowed, true);
});

test("AU03 the cap setting falls back to the default on nonsense", () => {
  assert.equal(resolveDailyCap(undefined), 150);
  assert.equal(resolveDailyCap("300"), 300);
  for (const bad of ["", "0", "-5", "abc", "12.5", "999999"]) assert.equal(resolveDailyCap(bad), 150, bad);
});

test("AU04 a failing store never blocks an AI request", async () => {
  const broken: UsageStore = {
    increment: async () => { throw new Error("redis down"); },
    read: async () => { throw new Error("redis down"); },
  };
  assert.deepEqual(await reserveAiRequest("assist", { store: broken, now: NOW }), { allowed: true, usedToday: 0, cap: 150 });
  await recordAiFailure("assist", { store: broken, now: NOW });
  assert.equal((await readAiUsage(2, { store: broken, now: NOW }))[0].total, 0);
});
