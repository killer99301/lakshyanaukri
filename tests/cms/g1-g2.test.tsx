// G1 + G2: the listing-page Grab on the collector's Stage 1 rules and matching, eligibility exams, truthful public
// labels, and the check form started from stored official evidence. Pure: stand-in fetches, no database, no AI,
// no network. The database side (held-only save, decisions, publishing) is tests/local-stack/g1g2-grab-verify.test.ts.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/g1-g2.test.tsx

import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { discoverFromPage } from "@/lib/cms/importer/discover";
import { classifyLink } from "@/lib/cms/discovery/link-rules";
import { isEligibilityExam } from "@/lib/cms/discovery/eligibility-exam";
import { parseHtmlLinks } from "@/intelligence/multi-source/adapters/html-link-adapter";
import type { MultiSourceConfig } from "@/intelligence/multi-source/types";
import type { FetchedSource } from "@/lib/cms/importer/fetch-source";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { Opportunity } from "@/types";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment, sourceStanding } from "@/lib/cms/adapter";
import { getProvenanceSummary } from "@/lib/lifecycle";
import { OfficialNotificationCard } from "@/components/jobs/OfficialNotificationCard";
import { fieldEvidence, writtenForms, type EvidenceDoc } from "@/lib/cms/importer/field-evidence";
import type { FieldState } from "@/lib/cms/importer/classify";
import { DecisionForm } from "@/app/admin/cms/[id]/ImportChecksPanel";
import { classify, attention } from "@/app/admin/cms/discovery/lead-view";
import type { Lead } from "@/lib/cms/discovery/repository";

const html = (u: string, body: string, type = "text/html"): FetchedSource => ({ ok: true, finalUrl: u, contentType: type, bytes: Buffer.from(body) });
const grab = (url: string, body: string, jobs: Parameters<typeof discoverFromPage>[0]["jobs"] = []) =>
  discoverFromPage({ url, jobs, fetchSourceFn: async (u) => (u.endsWith("/robots.txt") ? { ok: false as const, error: "none" } : html(url, body)) });
const config = (url: string): MultiSourceConfig => ({ id: "t", name: "t", type: "HTML_LINKS", url, tier: 5, enabled: true } as unknown as MultiSourceConfig);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");

suite("G1: the listing-page Grab uses the collector's Stage 1 rules");

for (const [file, url] of [["sarkariresult-latest.html", "https://www.sarkariresult.com/latestjob.php"], ["govtjobguru-home.html", "https://www.govtjobguru.in/"]] as const) {
  test(`G101 ${file}: the Grab list is the collector's list (same titles, kinds, order), within its display limit`, async () => {
    const body = readFileSync(`tests/fixtures/discovery/${file}`, "utf8");
    const out = await grab(url, body);
    assert.ok(out.ok);
    if (!out.ok) return;
    const seen = new Set<string>();
    const collector = parseHtmlLinks(config(url), body, { keepUnknownOrg: true, keepUpdates: true })
      .filter((d) => { const k = d.href.replace(/#.*/, ""); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((d) => `${d.kind}:${d.title}`);
    assert.deepEqual(out.found.map((f) => `${f.kind}:${f.title}`), collector.slice(0, 60));
    for (const f of out.found) assert.equal(f.official, false, `${f.title}: a portal's page is research`);
  });
}

test("G102 menu, section and shop links are not offered (no menu-link regression)", async () => {
  const page = `<ul>
    <li><a href="https://www.sarkariresult.com/admitcard/">Admit Card</a></li>
    <li><a href="https://www.sarkariresult.com/">SARKARI RESULT®</a></li>
    <li><a href="https://www.sarkariresult.com/latestjob/">Latest Jobs</a></li>
    <li><a href="https://www.sarkariresult.com/answerkey/">Answer Key</a></li>
    <li><a href="https://www.sarkariresult.com/">HOME RECRUITMENT EXAMS</a></li>
    <li><a href="https://www.ibps.in/advertisement/">IBPS Advertisement</a></li>
    <li><a href="https://shop.example/ssc-cgl-2026-mahapack">SSC CGL 2026 Mahapack Test Series</a></li>
    <li><a href="https://www.sarkariresult.com/bank/ibps-rrb-xv/">IBPS RRB XV</a></li>
    <li><a href="https://www.sarkariresult.com/ssc/ssc-cgl-2026/">SSC CGL 2026 Online Form | Last Date : 30/11/2026</a></li>
  </ul>`;
  const out = await grab("https://www.sarkariresult.com/latestjob/", page);
  assert.ok(out.ok);
  if (!out.ok) return;
  // "IBPS RRB XV" alone is no menu link (A7) but has no recruitment wording: the collector does not keep it either.
  assert.deepEqual(out.found.map((f) => f.title), ["SSC CGL 2026 Online Form | Last Date : 30/11/2026"]);
  assert.deepEqual(classifyLink("IBPS RRB XV", "https://x.example/ibps-rrb-xv/"), { skip: "no recruitment or update wording", title: "IBPS RRB XV" }, "not skipped as a menu link");
  for (const t of ["Admit Card", "SARKARI RESULT®", "Latest Jobs", "Answer Key", "HOME RECRUITMENT EXAMS", "IBPS Advertisement"]) {
    assert.ok("skip" in classifyLink(t, "https://www.sarkariresult.com/admitcard/"), `${t} is a menu link to the collector too`);
  }
});

test("G103 a Food Safety Extension Officer job is a new job, not an update (the collector's rule, now in the Grab)", async () => {
  const out = await grab("https://portal.example/jobs/", `<a href="/x/">BTSC Food Safety Extension Officer Recruitment 2026 Apply Online for 105 Posts</a>`);
  assert.ok(out.ok && out.found.length === 1 && out.found[0].kind === "NEW", out.ok ? out.found : out);
});

suite("G1: eligibility exams");

const ELIGIBILITY = [
  "UGC NET December 2026 Notification Out, Apply Online", "CSIR NET June 2026 Exam Date", "CTET February 2027 Online Form",
  "Bihar STET 2026 Result", "HTET 2026 Admit Card", "MH SET 2026 Apply Online", "KSET 2026 Notification", "GATE 2027 Online Form",
  "Bihar SLET Notification 2026 Apply Online Last Date Extended", "Teacher Eligibility Test 2026 Online Form", "UPTET 2026 Answer Key",
];
const RECRUITMENT = [
  "KVS PRT Recruitment 2026 – CTET Qualified Candidates", "NTPC Executive Trainee Recruitment through GATE 2026",
  "Assistant Professor 120 Posts 2026 (NET/SET qualified)", "Bihar BPSC TRE 4.0 Teacher Recruitment 2026 (STET pass)",
  "UP Super TET 2026 Notification", "SSC CGL 2026 Online Form", "IBPS PO 2026 Apply Online for 5208 Posts", "Gate Keeper Recruitment 2026",
  "Asset Manager Online Form 2026", "Data Entry Operator Jobs 2026 (Set of 40 posts)",
];
test("G104 standalone eligibility exams are told from recruitments that only ask for one", () => {
  for (const t of ELIGIBILITY) assert.equal(isEligibilityExam(t), true, `eligibility exam: ${t}`);
  for (const t of RECRUITMENT) assert.equal(isEligibilityExam(t), false, `recruitment: ${t}`);
});
test("G105 the Grab keeps an eligibility exam, with its kind and source, marked as no recruitment", async () => {
  const out = await grab("https://portal.example/jobs/", `<a href="/ugc-net/">UGC NET December 2026 Notification Out, Apply Online</a>
    <a href="/kvs-prt/">KVS PRT Recruitment 2026 – CTET Qualified Candidates, 1200 Posts</a>
    <a href="/ctet-result/">CTET July 2026 Result Declared</a>`);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.found.map((f) => [f.kind, f.eligibilityExam === true, f.url.replace("https://portal.example", "")]), [
    ["NEW", true, "/ugc-net/"], ["NEW", false, "/kvs-prt/"], ["UPDATE", true, "/ctet-result/"],
  ]);
});
test("G106 New Jobs Found says the same, keeps the lead and its actions (nothing dismissed)", () => {
  const lead = { id: "l", kind: "NEW", title: "UGC NET December 2026 Notification Out", organizationId: null, notificationNumber: null, status: "NEW",
    match: { kind: "UNRESOLVED", recruitmentId: null, reason: null, confidence: null, candidates: [] }, relatedLeads: [], sources: [{ official: false }] } as unknown as Lead;
  assert.deepEqual(classify(lead), { label: "Eligibility exam — not a recruitment", tone: "muted" });
  assert.ok(attention(lead)[0].startsWith("A standalone eligibility exam"));
  assert.equal(lead.status, "NEW");
  const job = { ...lead, title: "KVS PRT Recruitment 2026 – CTET Qualified" } as Lead;
  assert.notEqual(classify(job).label, "Eligibility exam — not a recruitment");
});

suite("G1: the Grab's matching is the collector's");

test("G107 the same notice number as a job of the same organisation: already in the CMS; another body's job with a like title: not suggested", async () => {
  const jobs = [
    { id: "cgl", title: "SSC Combined Graduate Level Examination 2026", organizationId: "ssc", organizationName: "Staff Selection Commission", notificationNumber: "05/2026", year: 2026 },
    { id: "aiims", title: "AIIMS Patna Junior Resident Recruitment 2026", organizationId: "aiims-patna", organizationName: "AIIMS Patna", notificationNumber: null, year: 2026 },
  ];
  const out = await grab("https://portal.example/jobs/", `<a href="/cgl/">SSC CGL 2026 Online Form (Advt No. 05/2026)</a>
    <a href="/ibps-po/">IBPS PO MT XVI Recruitment 2026 Apply Online for 5208 Posts</a>`, jobs);
  assert.ok(out.ok);
  if (!out.ok) return;
  const [cgl, po] = out.found;
  assert.equal(cgl.organizationId, "ssc");
  assert.equal(cgl.match, "DUPLICATE", JSON.stringify(cgl));
  assert.deepEqual(cgl.maybe.map((m) => m.id), ["cgl"]);
  assert.ok(/same notice number/.test(cgl.matchReason ?? ""), cgl.matchReason ?? "");
  assert.deepEqual(po.maybe, [], "an IBPS lead is not an AIIMS job");
});

suite("G1: what the public page says about its sources");

const record = (over: Partial<RecruitmentRecord> = {}) => ({
  id: "00000000-0000-0000-0000-0000000000g1", slug: "test-g1", draftState: "DRAFT", recordRevision: "r1",
  identity: { organizationId: "sbi", organizationName: "State Bank of India", recruitmentYear: 2026,
    title: { value: "SBI Assistant Manager Engineer (Fire) 2026", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  dates: {}, vacancies: {}, financial: {}, links: [], documents: [], updates: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-11-04", primarySourceType: "NOT_VERIFIED" },
  createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z", ...over,
} as unknown as RecruitmentRecord);
const link = (type: string, url: string, official: boolean) => ({ type, label: type, url, official });

test("G108 nobody checked it: no check date (not the build time); the page's own date is kept apart", () => {
  const snap = projectForPreview(record());
  const job = snapshotToGovernmentRecruitment(snap);
  assert.equal(job.provenance.lastVerifiedAt, "");
  assert.equal(job.provenance.pageUpdatedAt, snap.projectedAt);
  assert.equal(getProvenanceSummary(job as unknown as Opportunity).lastVerifiedLabel, "Not yet checked against the official notice");
});
test("G109 the standing is what the links show: official notice, official website, research, none", () => {
  const std = (links: ReturnType<typeof link>[]) => sourceStanding({ ...projectForPreview(record({ links } as never)) });
  assert.equal(std([link("OFFICIAL_NOTIFICATION", "https://sbi.bank.in/n.pdf", true)]), "OFFICIAL_NOTIFICATION");
  assert.equal(std([link("OFFICIAL_WEBSITE", "https://sbi.bank.in/web/careers", true)]), "OFFICIAL_WEBSITE");
  assert.equal(std([link("OFFICIAL_NOTIFICATION", "https://govtjobguru.in/sbi", false)]), "SECONDARY_SOURCE", "a link not marked official is no official source");
  assert.equal(std([]), "NOT_VERIFIED");
});
test("G110 a careers page is never the Apply Online link", () => {
  const job = snapshotToGovernmentRecruitment(projectForPreview(record({ links: [link("OFFICIAL_WEBSITE", "https://sbi.bank.in/web/careers/current-openings", true)] } as never)));
  assert.equal(job.links.apply, "");
  assert.equal(job.links.website, "https://sbi.bank.in/web/careers/current-openings");
  const withApply = snapshotToGovernmentRecruitment(projectForPreview(record({ links: [link("OFFICIAL_WEBSITE", "https://sbi.bank.in/", true), link("APPLY_ONLINE", "https://ibpsreg.ibps.in/sbiamfire/", true)] } as never)));
  assert.equal(withApply.links.apply, "https://ibpsreg.ibps.in/sbiamfire/");
});
test("G111 checked: imported jobs carry the day of the checks in force; a legacy verified record its own verified day", () => {
  const snap = projectForPreview(record());
  const imported = snapshotToGovernmentRecruitment({ ...snap, keyDetailsChecked: true, keyDetailsCheckedOn: "2026-11-06" });
  assert.equal(imported.provenance.lastVerifiedAt, "2026-11-06");
  assert.ok(getProvenanceSummary(imported as unknown as Opportunity).lastVerifiedLabel.startsWith("Key details checked: "));
  const legacy = snapshotToGovernmentRecruitment(projectForPreview(record({ provenance: { status: "VERIFIED", lastVerifiedAt: "2026-09-01", primarySourceType: "OFFICIAL_NOTIFICATION" } } as never)));
  assert.equal(legacy.provenance.lastVerifiedAt, "2026-09-01");
  const oldSnapshot = snapshotToGovernmentRecruitment({ ...snap, keyDetailsChecked: true });
  assert.equal(oldSnapshot.provenance.lastVerifiedAt, "", "a snapshot published before the date was kept shows no invented date");
});
test("G112 the notice card: no “Direct Official Source”; research says so; “Checked” only with a real date", () => {
  const card = (p: React.ComponentProps<typeof OfficialNotificationCard>) => text(renderToStaticMarkup(<OfficialNotificationCard {...p} />));
  const none = card({ sourceType: "SECONDARY_SOURCE" });
  assert.ok(!/Direct Official Source|government portal servers/.test(none), none);
  assert.ok(none.includes("Not from an official source") && none.includes("Details not yet checked against the official notice") && !none.includes("Checked:"), none);
  const official = card({ sourceType: "OFFICIAL_NOTIFICATION", notificationPdfUrl: "https://sbi.bank.in/n.pdf" });
  assert.ok(official.includes("Official notice link") && official.includes("Details not yet checked"), official);
  const checked = card({ sourceType: "OFFICIAL_NOTIFICATION", verifiedAt: "2026-11-06", keyDetailsChecked: true });
  assert.ok(checked.includes("Key details checked against the official notice"), checked);
});

suite("G2: what each source said, and the evidence the check form starts from");

const DOCS: EvidenceDoc[] = [
  { id: "pdf", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "CONFIRMED", originRole: "AUTHORITY", originPurposes: ["all"], originHost: "ibps.in", contentKind: "PDF", name: "ibps.in — notification, PDF" },
  { id: "web", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "ATTESTED", originRole: "AUTHORITY", originPurposes: ["all"], originHost: "ibps.in", contentKind: "HTML", name: "ibps.in — notification, web page" },
  { id: "res", declaredKind: "RESEARCH", authenticity: "NOT_APPLICABLE", originRole: "NONE", originPurposes: [], originHost: null, contentKind: "TEXT", name: "pasted — research, text" },
  { id: "unc", declaredKind: "OFFICIAL_NOTIFICATION", authenticity: "UNCONFIRMED", originRole: "UNLISTED", originPurposes: [], originHost: "portal.example", contentKind: "TEXT", name: "portal.example — notification, text" },
];
const TEXTS = new Map([
  ["pdf", "IBPS CRP TEST\nApplication Fee: Rs. 850 for General\n-- 1 of 2 --\nLast date for online registration: 21.07.2099\n-- 2 of 2 --"],
  ["web", "Online registration closes on 21 July 2099."],
  ["res", "Last date to apply: 25.07.2099"],
  ["unc", "Last date 21.07.2099"],
]);
const claim = (id: string, value: unknown, retrievalId: string, quote: string | null, page: number | null, extra = {}) =>
  ({ id, seq: 1, kind: "EXTRACTED" as const, value, retrievalId, quote, page, ...extra });
const stateOf = (value: unknown, claims: ReturnType<typeof claim>[], fieldPath = "dates.applicationCloseDate"): FieldState =>
  ({ fieldPath, hasValue: value !== null, value, latestRevisionId: "rev", latestRevisionAt: null, claims });

test("G201 a stored official passage with its page and words: prefilled", () => {
  const ev = fieldEvidence(stateOf("2099-07-21", [claim("c1", "2099-07-21", "pdf", "Last date for online registration: 21.07.2099", 2)]), "application", DOCS, TEXTS);
  assert.deepEqual(ev.prefill, { retrievalId: "pdf", page: 2, quote: "Last date for online registration: 21.07.2099", claimId: "c1" });
  assert.equal(ev.items[0].standing, "OFFICIAL");
  assert.equal(ev.items[0].location, "page 2");
});
test("G202 research, an unconfirmed paste, words not in the document, a PDF passage with no page, another value: never prefilled", () => {
  const research = fieldEvidence(stateOf("2099-07-25", [claim("r", "2099-07-25", "res", "Last date to apply: 25.07.2099", null)]), "application", DOCS, TEXTS);
  assert.equal(research.prefill, null);
  assert.equal(research.items[0].standing, "RESEARCH");
  assert.deepEqual(research.suggestions, [], "research is not searched for suggestions either");
  const unconfirmed = fieldEvidence(stateOf("2099-07-21", [claim("u", "2099-07-21", "unc", "Last date 21.07.2099", null)]), "application", DOCS, TEXTS);
  assert.equal(unconfirmed.items[0].standing, "UNCONFIRMED");
  assert.equal(unconfirmed.items[0].usable, false);
  const wrongWords = fieldEvidence(stateOf("2099-07-21", [claim("w", "2099-07-21", "pdf", "Last date: 21.07.2099 (changed)", 2)]), "application", DOCS, TEXTS);
  assert.equal(wrongWords.items[0].quoteFound, false);
  assert.equal(wrongWords.prefill, null);
  const noPage = fieldEvidence(stateOf("2099-07-21", [claim("n", "2099-07-21", "pdf", "Last date for online registration: 21.07.2099", null)]), "application", DOCS, TEXTS);
  assert.equal(noPage.prefill, null);
  assert.ok(/page/.test(noPage.items[0].notUsable ?? ""));
  const other = fieldEvidence(stateOf("2099-07-30", [claim("o", "2099-07-21", "pdf", "Last date for online registration: 21.07.2099", 2)]), "application", DOCS, TEXTS);
  assert.equal(other.items[0].matchesCurrent, false);
  assert.equal(other.prefill, null, "a passage for another value never confirms this one");
});
test("G203 a web page's passage needs no page: it is web text", () => {
  const ev = fieldEvidence(stateOf("2099-07-21", [claim("w1", "2099-07-21", "web", "Online registration closes on 21 July 2099.", 3)]), "application", DOCS, TEXTS);
  assert.deepEqual(ev.prefill, { retrievalId: "web", page: null, quote: "Online registration closes on 21 July 2099.", claimId: "w1" });
  assert.equal(ev.items[0].location, "web text (no pages)");
});
test("G204 sources that disagree are shown, with their documents (7.83 against 7.85 stays visible)", () => {
  const ev = fieldEvidence(stateOf("Rs. 7.83 lakh per annum", [
    claim("a", "Rs. 7.83 lakh per annum", "res", "Total CTC Rs. 7.83 lakh per annum", null),
    claim("b", "Rs. 7.85 lakh per annum", "res", "Total CTC Rs. 7.85 lakh per annum", null, { seq: 2 }),
  ], "financial.payScale"), "general", DOCS, TEXTS);
  assert.equal(ev.conflicts.length, 2);
  assert.deepEqual(ev.conflicts.map((c) => c.value), ["Rs. 7.83 lakh per annum", "Rs. 7.85 lakh per annum"]);
});
test("G205 no stored words (a code-read date): lines of the official documents holding the value are suggested, not prefilled", () => {
  const ev = fieldEvidence(stateOf("2099-07-21", [claim("d", "2099-07-21", "pdf", null, null)]), "application", DOCS, TEXTS);
  assert.equal(ev.prefill, null);
  assert.deepEqual(ev.suggestions.map((s) => [s.retrievalId, s.page, s.quote]), [
    ["pdf", 2, "Last date for online registration: 21.07.2099"], ["web", null, "Online registration closes on 21 July 2099."],
  ], "never the research or the unconfirmed text");
});
test("G206 a value's written forms: dates as notices write them, figures with Indian commas, never part of a longer number", () => {
  const [num] = writtenForms(1230);
  assert.ok(num.test("Total 1,230 posts") && num.test("Total 1230") && !num.test("11230") && !num.test("1230.5"));
  const date = writtenForms("2099-07-01");
  for (const t of ["01.07.2099", "1/7/2099", "01-07-2099", "1st July 2099", "July 1, 2099", "01 Jul 2099"]) assert.ok(date.some((r) => r.test(t)), t);
  assert.ok(!date.some((r) => r.test("11.07.2099")) && !date.some((r) => r.test("01.07.20991")));
});

suite("G2: the check form");

const docs = [
  { id: "pdf", declaredKind: "OFFICIAL_NOTIFICATION", versionLabel: null, originHost: "ibps.in", originRole: "AUTHORITY", authenticity: "CONFIRMED", contentKind: "PDF", pageCount: 2 },
  { id: "res", declaredKind: "RESEARCH", versionLabel: null, originHost: null, originRole: "NONE", authenticity: "NOT_APPLICABLE", contentKind: "TEXT", pageCount: null },
];
const row = { fieldPath: "dates.applicationCloseDate", label: "Last date to apply", cls: "SUPPORTED", reason: "", tier: "A" as const, value: "2099-07-21", latestRevisionId: "rev" };
const noop = () => {};
test("G207 Confirm opens with the stored passage in the form: document, page and words; the person still records it", () => {
  const evidence = fieldEvidence(stateOf("2099-07-21", [claim("c1", "2099-07-21", "pdf", "Last date for online registration: 21.07.2099", 2)]), "application", DOCS, TEXTS);
  const h = renderToStaticMarkup(<DecisionForm recordId="j" row={{ ...row, evidence }} kind="ADMIN_VERIFIED" retrievals={docs} onDone={noop} onCancel={noop} />);
  assert.ok(h.includes("data-prefilled") && h.includes(">Last date for online registration: 21.07.2099</textarea>") && /value="2"/.test(h), h);
  assert.ok(text(h).includes("Proposed value:") && text(h).includes("Confirm against the official document") && /<button[^>]*>Confirm<\/button>/.test(h));
  assert.ok(!/<option[^>]*value="res"/.test(h), "research is not offered as a document");
});
test("G208 nothing stored: the found lines are offered to pick, the words stay empty, and entering them by hand stays possible", () => {
  const evidence = fieldEvidence(stateOf("2099-07-21", [claim("d", "2099-07-21", "pdf", null, null)]), "application", DOCS, TEXTS);
  const h = renderToStaticMarkup(<DecisionForm recordId="j" row={{ ...row, evidence }} kind="ADMIN_VERIFIED" retrievals={docs} onDone={noop} onCancel={noop} />);
  assert.ok(h.includes("data-suggestions") && h.includes("data-suggestion-use") && h.includes("data-manual-evidence") && !h.includes("data-prefilled"), h);
  assert.ok(/<textarea[^>]*><\/textarea>/.test(h), "the words are not filled in by themselves");
});
test("G209 the printed-total route and Not stated are as before: nothing prefilled", () => {
  const evidence = fieldEvidence(stateOf(30, [claim("t", 30, "pdf", "Total 30", 2)], "vacancies.total"), "recruitment_rules", DOCS, new Map([["pdf", "Total 30\n-- 1 of 1 --"]]));
  const printed = renderToStaticMarkup(<DecisionForm recordId="j" row={{ ...row, fieldPath: "vacancies.total", value: 30, evidence: { ...evidence, prefill: null, suggestions: [] } }} kind="ADMIN_VERIFIED" retrievals={docs} onDone={noop} onCancel={noop} printedLine={{ line: "Total 30", page: 2 }} />);
  assert.ok(!printed.includes("data-prefilled") && /<textarea[^>]*><\/textarea>/.test(printed));
  const notStated = renderToStaticMarkup(<DecisionForm recordId="j" row={{ ...row, evidence }} kind="ADMIN_NOT_STATED" retrievals={docs} onDone={noop} onCancel={noop} />);
  assert.ok(!notStated.includes("data-prefilled") && !notStated.includes("data-evidence"));
});
