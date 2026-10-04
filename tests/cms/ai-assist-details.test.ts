// ═══════════════════════════════════════════════════════════
// AI Assist — details (eligibility, age, selection, how to apply,
// pay scale) and official-link detection. Pure: no DB, mocked AI.
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import {
  buildEvidence,
  buildDetailSections,
  subjectTokens,
  judgeAge,
  judgeEligibility,
  judgeSelection,
  judgeHowToApply,
  judgePayScale,
  extractDetails,
  extractOfficialLinks,
} from "@/lib/cms/ai-assist-details";
import { describeAiValue } from "@/lib/cms/ai-assist-apply";

const SOURCE = [
  "Lower Division Clerk (LDC) / Junior Secretariat Assistant (JSA)",
  "Qualification: 12th Standard pass or equivalent from a recognized Board or University.",
  "Age Limit: 18 to 27 years as on 01-08-2026.",
  "Age relaxation: SC/ST 5 years, OBC 3 years, PwBD 10 years.",
  "Selection: Tier-I Computer Based Examination of 100 questions, 200 marks, 60 minutes.",
  "Tier-II Computer Based Examination in two sessions. Negative marking of 0.50 marks for each wrong answer.",
  "How to Apply: Complete One-Time Registration. Login and fill the form. Pay the fee of Rs. 100/- online.",
  "Pay Level-2 (Rs. 19,900-63,200).",
].join("\n");

const sections = [{ type: "other", heading: "Detail 1: Notice", text: SOURCE, rawHtml: "", tables: [], lists: [], links: [], paragraphs: [] }] as never;
const ev = buildEvidence(sections);

function aiFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status })) as unknown as typeof fetch;
}

suite("Details — age");

test("AG01 age limit accepted when the quote contains both numbers", () => {
  const out = judgeAge({ min: 18, max: 27, asOf: "2026-08-01", evidence: "Age Limit: 18 to 27 years as on 01-08-2026.", relaxations: [] }, ev);
  assert.equal(out.status, "accepted");
  if (out.status === "accepted") assert.deepEqual(out.value, { relaxations: [], min: 18, max: 27, asOf: "2026-08-01" });
});

test("AG02 age not in the quote, or quote not in the source → rejected", () => {
  assert.equal(judgeAge({ min: 18, max: 30, evidence: "Age Limit: 18 to 27 years as on 01-08-2026." }, ev).status, "rejected");
  assert.equal(judgeAge({ min: 18, max: 27, evidence: "Candidates must be 18 to 27 years old" }, ev).status, "rejected");
  assert.equal(judgeAge({ min: 30, max: 20, evidence: "Age Limit: 18 to 27 years as on 01-08-2026." }, ev).status, "rejected");
  assert.equal(judgeAge({}, ev).status, "not_stated");
});

test("AG03 reference date kept only when the quote states that exact date", () => {
  const out = judgeAge({ min: 18, max: 27, asOf: "2026-01-01", evidence: "Age Limit: 18 to 27 years as on 01-08-2026." }, ev);
  assert.equal(out.status, "accepted");
  if (out.status === "accepted") assert.equal(out.value.asOf, undefined);
});

test("AG04 relaxations: each needs its own quote containing the years; others are dropped and counted", () => {
  const out = judgeAge({
    min: 18, max: 27, evidence: "Age Limit: 18 to 27 years as on 01-08-2026.",
    relaxations: [
      { category: "SC/ST", years: 5, evidence: "SC/ST 5 years, OBC 3 years, PwBD 10 years." },
      { category: "OBC", years: 4, evidence: "SC/ST 5 years, OBC 3 years, PwBD 10 years." },
      { category: "Ex-Servicemen", years: 3, evidence: "Ex-Servicemen get 3 years" },
    ],
  }, ev);
  assert.equal(out.status, "accepted");
  if (out.status === "accepted") {
    assert.deepEqual(out.value.relaxations, [{ category: "SC/ST", years: 5 }]);
    assert.equal(out.dropped, 2);
  }
});

suite("Details — eligibility, selection, how to apply, pay");

test("EL01 a post must be named in the source and backed by a quote", () => {
  const out = judgeEligibility([
    { post: "Lower Division Clerk (LDC)", qualification: "12th Standard pass or equivalent", evidence: "Qualification: 12th Standard pass or equivalent from a recognized Board or University." },
    { post: "PGIMER Nursing Officer", qualification: "B.Sc. Nursing", evidence: "Qualification: 12th Standard pass or equivalent from a recognized Board or University." },
    { post: "Junior Secretariat Assistant", qualification: "Graduate with 55 percent marks", evidence: "Qualification: 12th Standard pass or equivalent from a recognized Board or University." },
    { post: "Lower Division Clerk", qualification: "12th pass", evidence: "invented quote that is not on the page" },
  ], ev);
  assert.equal(out.status, "accepted");
  if (out.status === "accepted") {
    assert.deepEqual(out.value, [{ post: "Lower Division Clerk (LDC)", qualification: ["12th Standard pass or equivalent"] }]);
    assert.equal(out.dropped, 3);
  }
  assert.equal(judgeEligibility([{ post: "X Officer", qualification: "Y", evidence: "none" }], ev).status, "rejected");
  assert.equal(judgeEligibility([], ev).status, "not_stated");
});

test("SE01 stages need a quote; a summary with unsupported numbers is left out, not the stage", () => {
  const out = judgeSelection({
    stages: [
      { name: "Tier-I", type: "CBT", summary: "100 questions, 200 marks, 60 minutes", evidence: "Tier-I Computer Based Examination of 100 questions, 200 marks, 60 minutes." },
      { name: "Tier-II", type: "CBT", summary: "150 questions", evidence: "Tier-II Computer Based Examination in two sessions." },
      { name: "Interview", type: "INTERVIEW", evidence: "followed by an interview" },
      { name: "Typing", type: "NOT_A_TYPE", evidence: "Tier-II Computer Based Examination in two sessions." },
    ],
    negativeMarking: { value: "0.50 marks for each wrong answer", evidence: "Negative marking of 0.50 marks for each wrong answer." },
  }, ev);
  assert.equal(out.status, "accepted");
  if (out.status === "accepted") {
    assert.deepEqual(out.value.stages, [
      { name: "Tier-I", order: 1, type: "CBT", description: "100 questions, 200 marks, 60 minutes" },
      { name: "Tier-II", order: 2, type: "CBT" },
      { name: "Typing", order: 3, type: "OTHER" },
    ]);
    assert.equal(out.value.negativeMarking, "0.50 marks for each wrong answer");
    assert.equal(out.dropped, 1);
  }
  const wrongNeg = judgeSelection({ negativeMarking: { value: "0.25 marks per wrong answer", evidence: "Negative marking of 0.50 marks for each wrong answer." } }, ev);
  assert.equal(wrongNeg.status, "not_stated");
});

test("HW01 how to apply: needs a quote and at least two steps", () => {
  const ok = judgeHowToApply({ steps: ["Complete One-Time Registration", "Log in and fill the form", "Pay the fee online"], evidence: "Complete One-Time Registration. Login and fill the form." }, ev);
  assert.equal(ok.status, "accepted");
  assert.equal(judgeHowToApply({ steps: ["Apply online"], evidence: "Complete One-Time Registration. Login and fill the form." }, ev).status, "rejected");
  assert.equal(judgeHowToApply({ steps: ["A step", "Another step"], evidence: "text that is not on the page" }, ev).status, "rejected");
  assert.equal(judgeHowToApply(undefined, ev).status, "not_stated");
});

test("PY01 pay scale: every number must be in the source", () => {
  assert.equal(judgePayScale({ value: "Pay Level-2 (Rs. 19,900 – 63,200)", evidence: "Pay Level-2 (Rs. 19,900-63,200)." }, ev).status, "accepted");
  assert.equal(judgePayScale({ value: "Pay Level-4 (Rs. 25,500 – 81,100)", evidence: "Pay Level-2 (Rs. 19,900-63,200)." }, ev).status, "rejected");
  assert.equal(judgePayScale({ value: "Pay Level-2", evidence: "not on the page at all" }, ev).status, "rejected");
});

suite("Details — passages and the AI call");

const PAGE = `<html><body>
<h1>SSC CHSL Recruitment 2026</h1>
<h2>SSC CHSL Post-wise Eligibility</h2><p>Lower Division Clerk: 12th Standard pass.</p>
<h2>SSC CHSL Age Relaxation</h2><p>SC/ST 5 years.</p>
<h2>How to Apply for SSC CHSL 2026?</h2><p>Complete One-Time Registration. Login and fill the form.</p>
<h2>SSC CHSL Tier 1 Previous Year Cut-off (2025)</h2><p>Eligibility cut-off was 150 marks.</p>
<h2>SSC CHSL Syllabus 2026</h2><p>Selection topics: reasoning.</p>
<h2>PGIMER Nursing Officer Recruitment 2026 – Apply Online for 243 Posts</h2><p>Eligibility: B.Sc. Nursing with qualification.</p>
<table>
<tr><td>Apply Online</td><td><a href="https://ssc.gov.in/login">Click Here</a></td></tr>
<tr><td>Download Official Notification</td><td><a href="https://ssc.gov.in/uploads/Notice_of_adv_chsl_2026.pdf">Click Here</a></td></tr>
<tr><td>SSC Official Website</td><td><a href="https://ssc.gov.in/">Click Here</a></td></tr>
<tr><td>Join Telegram for Latest Notification</td><td><a href="https://t.me/somechannel">Click Here</a></td></tr>
<tr><td>Download Notification (mirror)</td><td><a href="https://www.example-aggregator.com/files/notice.pdf">Click Here</a></td></tr>
</table>
<p>Read the official notification on <a href="https://ssc.gov.in/">the SSC site</a> before you apply online.</p>
</body></html>`;
const SUBJECT = "SSC CHSL (Combined Higher Secondary Level) Examination 2026 — Staff Selection Commission";

test("PS01 passages exclude other recruitments, cut-offs and syllabus", () => {
  const picked = buildDetailSections(PAGE, "html", "https://example.com/job", SUBJECT).map((s) => s.heading).join(" | ");
  assert.match(picked, /Post-wise Eligibility/);
  assert.match(picked, /Age Relaxation/);
  assert.match(picked, /How to Apply/);
  assert.equal(/PGIMER/.test(picked), false);
  assert.equal(/Cut-off/.test(picked), false);
  assert.equal(/Syllabus/.test(picked), false);
  assert.ok(subjectTokens(SUBJECT).includes("chsl") && subjectTokens(SUBJECT).includes("ssc"));
  assert.equal(subjectTokens(SUBJECT).includes("recruitment"), false);
});

test("PS02 one AI request; accepted and rejected blocks reported separately; failure is contained", async () => {
  let calls = 0;
  const inner = aiFetch({
    age: { min: 18, max: 27, evidence: "Age Limit: 18 to 27 years as on 01-08-2026." },
    payScale: { value: "Pay Level-9 (Rs. 99,999)", evidence: "Pay Level-2 (Rs. 19,900-63,200)." },
  });
  const fetchFn = (async (i: RequestInfo | URL, init?: RequestInit) => { calls++; return inner(i, init); }) as typeof fetch;
  const d = await extractDetails({ sections, url: "https://example.com/job", apiKey: "test-key", fetchFn, subject: SUBJECT });
  assert.equal(calls, 1);
  assert.equal(d.age.status, "accepted");
  assert.equal(d.payScale.status, "rejected");
  assert.equal(d.eligibility.status, "not_stated");

  const down = await extractDetails({ sections, url: "https://example.com/job", apiKey: "secret-test-key", fetchFn: aiFetch({}, 429) });
  assert.equal(down.age.status, "skipped");
  if (down.age.status === "skipped") {
    assert.match(down.age.reason, /rate limit/i);
    assert.equal(down.age.reason.includes("secret-test-key"), false);
  }
  const none = await extractDetails({ sections: [], url: "https://example.com/job", apiKey: "test-key", fetchFn });
  assert.equal(none.age.status, "skipped");
  assert.equal(calls, 1);
});

suite("Official links");

test("LN01 only links on official domains, labelled by their table row; the PDF wins for the notification", () => {
  const links = extractOfficialLinks(PAGE, "https://example.com/job");
  assert.deepEqual(links.map((l) => `${l.type} ${l.url}`), [
    "OFFICIAL_NOTIFICATION https://ssc.gov.in/uploads/Notice_of_adv_chsl_2026.pdf",
    "APPLY_ONLINE https://ssc.gov.in/login",
    "OFFICIAL_WEBSITE https://ssc.gov.in/",
  ]);
  assert.ok(links.every((l) => l.host === "ssc.gov.in" && l.official === true));
  assert.equal(links.some((l) => /t\.me|example-aggregator/.test(l.url)), false);
});

test("LN02 links already on the record are not suggested again", () => {
  const links = extractOfficialLinks(PAGE, "https://example.com/job", ["https://ssc.gov.in/login", "https://ssc.gov.in"]);
  assert.deepEqual(links.map((l) => l.type), ["OFFICIAL_NOTIFICATION"]);
});

test("LN03 a page with no official links suggests nothing", () => {
  assert.deepEqual(extractOfficialLinks(`<a href="https://www.example-aggregator.com/apply">Apply Online</a>`, "https://example.com/job"), []);
});

suite("Readable values in the editor");

test("DV01 describeAiValue formats each kind of value", () => {
  assert.equal(describeAiValue(3500), "3500");
  assert.equal(describeAiValue(["Register", "Pay"]), "1. Register\n2. Pay");
  assert.equal(describeAiValue([{ post: "LDC", qualification: ["12th pass"] }]), "LDC: 12th pass");
  assert.equal(describeAiValue({ min: 18, max: 27, asOf: "2026-08-01", relaxations: [{ category: "OBC", years: 3 }] }), "18 to 27 years (as of 2026-08-01)\nRelaxation — OBC: 3 years");
  assert.equal(describeAiValue({ stages: [{ name: "Tier-I", description: "100 questions" }], negativeMarking: "0.50 per wrong answer" }), "1. Tier-I — 100 questions\nNegative marking: 0.50 per wrong answer");
  assert.equal(describeAiValue(null), "—");
});
