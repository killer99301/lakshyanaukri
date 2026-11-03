// I4: the notice's own number, and honest words when a section is not read.
// Pure: the number readers on real and test texts, and the section readers
// with a stand-in fetch that counts requests (none may reach a model).
//
//   npx tsx --tsconfig tsconfig.json tests/cms/i4-numbers-messages.test.ts

import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import {
  AI_NOT_USED, NO_PASSAGE, buildAiSections, buildAssistCandidates, extractWithAi, mergeAiNotificationNumber, type DateOutcome,
} from "@/lib/cms/ai-assist";
import { extractDetails } from "@/lib/cms/ai-assist-details";
import { combineReading, skippedSection } from "@/lib/cms/importer/extract";
import { stripNoticeLabel, isCitedNumber } from "@/intelligence/intake";
import { reserveAiRequest, resetMemoryUsage, capReachedMessage } from "@/lib/ai-usage";

const SSC = readFileSync("tests/fixtures/notice-text/ssc-cgl-2026-pages-1-8.txt", "utf8");
const UPSC = readFileSync("tests/fixtures/notice-text/upsc-cse-2026-age-excerpt.txt", "utf8");
const number = (text: string, url = "https://example.gov.in/notice.pdf") => {
  const c = buildAssistCandidates(text, text.includes("<") ? "html" : "pdf", url).candidates.find((x) => x.fieldPath === "identity.notificationNumber");
  return { value: c?.value ?? null, doubt: c?.doubt ?? null };
};
const withAi = (text: string, ai: string) => {
  const merged = mergeAiNotificationNumber(buildAssistCandidates(text, text.includes("<") ? "html" : "pdf", "https://example.gov.in/n.pdf"),
    { status: "accepted", value: ai, quote: ai } as DateOutcome);
  const c = merged.candidates.find((x) => x.fieldPath === "identity.notificationNumber");
  return { value: c?.value ?? null, doubt: c?.doubt ?? null, flagged: merged.flagged.filter((f) => f.label === "Notification Number").map((f) => f.reason) };
};
const page = (body: string) => `<html><body><h1>Test State Board — Clerk Recruitment 2097</h1>${body}<p>Online applications from 01.03.2097 to 31.03.2097.</p></body></html>`;

suite("I4: the notice's own number");

test("N1 a web page: “Advertisement No. TSB/CLK/01/2097” is read whole (before: “CLK/01/2097”)", () => {
  assert.deepEqual(number(page("<p>Advertisement No. TSB/CLK/01/2097</p>"), "https://tsb.example.gov.in/clerk.html"), { value: "TSB/CLK/01/2097", doubt: null });
  assert.deepEqual(number("Test State Board\nAdvertisement No. TSB/CLK/01/2097\nOnline applications from 01.03.2097 to 31.03.2097."), { value: "TSB/CLK/01/2097", doubt: null }, "plain text, as before");
});
test("N1 a label is not part of the number: “Advt. No. 05/2097” is 05/2097; “F. No.” is kept", () => {
  assert.equal(number(page("<p>Advt. No. 05/2097</p>")).value, "05/2097");
  assert.deepEqual(["Advt. No. 05/2097", "Advertisement No.: CEN 05/2026", "Notification No - 12/2026", "F. No. HQ-C11018/1/2026-C-1", "SSC/CGL/01/2026"].map(stripNoticeLabel),
    ["05/2097", "CEN 05/2026", "12/2026", "F. No. HQ-C11018/1/2026-C-1", "SSC/CGL/01/2026"]);
});
test("N2 SSC CGL 2026: its own F. No., never the DoPT notification it cites (before: 38-16/2020-DD-III, ticked)", () => {
  assert.deepEqual(number(SSC, "https://ssc.gov.in/notice.pdf"), { value: "F. No. HQ-C11018/1/2026-C-1", doubt: null });
});
test("N2 …with the AI reading the same F. No.: agreed, nothing to resolve (before: the cited number won silently)", () => {
  assert.deepEqual(withAi(SSC, "F. No. HQ-C11018/1/2026-C-1"), { value: "F. No. HQ-C11018/1/2026-C-1", doubt: null, flagged: [] });
});
test("N2 a notice whose only labelled number is a cited one, and no file number: no number is proposed", () => {
  const text = `Test State Board\nRecruitment of Clerks 2097\n${"Applications are invited from graduates. ".repeat(4)}\nReservation will be in accordance with Notification No. 12/2011-Estt. dated 01.01.2011 of the Department of Personnel.`;
  assert.deepEqual(number(text), { value: null, doubt: null });
});
test("N2 the citation signs: before the label, or “dated … of the Department” after the number", () => {
  const t1 = "in accordance with Notification No. 38-16/2020-DD-III";
  assert.ok(isCitedNumber(t1, t1.indexOf("Notification"), "Notification No. 38-16/2020-DD-III".length));
  const t2 = "Notification No. 3/2011 dated 01.01.2011 issued by the Ministry of Home Affairs";
  assert.ok(isCitedNumber(t2, 0, "Notification No. 3/2011".length));
  const own = "Advertisement No. 07/2097\nThe Board invites applications.";
  assert.ok(!isCitedNumber(own, 0, "Advertisement No. 07/2097".length));
});
test("N3 code doubts its number and the AI gives a file number: the disagreement is shown, nothing chosen", () => {
  // A labelled number deep in the text, a file number in the opening: which is the notice's own cannot be told safely.
  for (const opening of ["F. No. HQ-1/2/2097-C", "Test Commission"]) {
    const d = withAi(`${opening}\n${"The Commission will hold the examination. ".repeat(80)}\nNotification No. 44/2097 is attached.`, "F. No. HQ-1/2/2097-C");
    assert.equal(d.value, null, opening);
    assert.match(d.flagged.join(" "), /44\/2097 or F\. No\. HQ-1\/2\/2097-C|two extraction methods disagree/, opening);
  }
  // UPSC, before and after: a labelled notice number in the opening still stands over the AI's file number (UN02).
  assert.deepEqual(withAi(UPSC, "F.No. 1/2/2025-E.I(B)").value, "05/2026-CSE");
});
test("N4 competing labelled numbers: the one taken carries its doubt (offered unticked)", () => {
  const r = number("Test Board\nAdvertisement No. 07/2097\nThe Board invites applications for Clerk posts.\nAdvertisement No. 09/2097 for Typists is published separately.");
  assert.equal(r.value, "07/2097");
  assert.match(r.doubt ?? "", /the notice also gives 09\/2097 — check which number is this notice's own/);
});
test("N4 a labelled number away from the notice's opening carries its doubt", () => {
  const r = number(`Test Board\n${"The Board invites applications for Clerk posts. ".repeat(80)}\nAdvertisement No. 07/2097`);
  assert.equal(r.value, "07/2097");
  assert.match(r.doubt ?? "", /not in the notice's opening/);
});
test("N4 …the AI reading the same number settles the doubt", () => {
  assert.deepEqual(withAi(`Test Board\n${"The Board invites applications for Clerk posts. ".repeat(80)}\nAdvertisement No. 07/2097`, "07/2097"), { value: "07/2097", doubt: null, flagged: [] });
});
test("N5 the formats read before are read the same (UPSC, IBPS, BCECEB, CEN, colon codes)", () => {
  assert.deepEqual(number(UPSC, "https://upsc.gov.in/notice.pdf"), { value: "05/2026-CSE", doubt: null }, "UPSC: the examination notice number over its F. No.");
  assert.equal(number("Institute of Banking Personnel Selection\nCOMMON RECRUITMENT PROCESS FOR RRBs (CRP-RRBs-XV)\nOnline registration 01.09.2026", "https://www.ibps.in/notice.pdf").value, "CRP-RRBs-XV");
  assert.equal(number("Bihar Combined Entrance Competitive Examination Board\nAdvt. No. BCECEB(BSFC)-2026/01\nOnline applications open").value, "BCECEB(BSFC)-2026/01");
  assert.equal(number("Railway Recruitment Boards\nCentralised Employment Notice CEN-01/2026\nApply online").value, "CEN-01/2026");
  assert.equal(number(page("<p>Advt No. HO:HRM:REC:AO:1:2026</p>")).value, "HO:HRM:REC:AO:1:2026");
});

suite("I4: what is said when a section is not read");

const counting = () => { const calls: unknown[] = []; const fetchFn = (async (...a: unknown[]) => { calls.push(a); throw new Error("no model in this test"); }) as unknown as typeof fetch; return { calls, fetchFn }; };
const FEES = "Application fee: General / OBC Rs. 600; SC / ST / PwBD Rs. 150. Last date to apply online: 09.02.2097.";

test("M1 no key: “the AI was not used”, not “nothing relevant found”; no request", async () => {
  const { calls, fetchFn } = counting();
  const r = await extractWithAi({ sections: buildAiSections(FEES, "pdf", ""), url: "", apiKey: undefined, fetchFn });
  assert.deepEqual([r.fees.general, calls.length], [{ status: "skipped", reason: AI_NOT_USED }, 0]);
  const d = await extractDetails({ sections: [], url: "", apiKey: undefined, fetchFn });
  assert.deepEqual(d.age, { status: "skipped", reason: AI_NOT_USED });
});
test("M2 a key but no passage found: “the AI was not asked”; no request", async () => {
  const { calls, fetchFn } = counting();
  const r = await extractWithAi({ sections: [], url: "", apiKey: "test-key", fetchFn });
  const d = await extractDetails({ sections: [], url: "", apiKey: "test-key", fetchFn });
  assert.deepEqual([r.fees.general, d.selection, calls.length], [{ status: "skipped", reason: NO_PASSAGE }, { status: "skipped", reason: NO_PASSAGE }, 0]);
});
test("M3 today's allowance used up: said as such; no request reaches a model", async () => {
  const before = process.env.AI_DAILY_CAP;
  process.env.AI_DAILY_CAP = "1";
  resetMemoryUsage();
  try {
    await reserveAiRequest("import");
    const { calls, fetchFn } = counting();
    const r = await extractWithAi({ sections: buildAiSections(FEES, "pdf", ""), url: "", apiKey: "test-key", fetchFn });
    assert.deepEqual([r.fees.general, calls.length], [{ status: "skipped", reason: capReachedMessage(1) }, 0]);
  } finally { if (before === undefined) delete process.env.AI_DAILY_CAP; else process.env.AI_DAILY_CAP = before; resetMemoryUsage(); }
});
test("M4 the AI failed: its own reason is kept", async () => {
  resetMemoryUsage();
  const fetchFn = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
  const r = await extractWithAi({ sections: buildAiSections(FEES, "pdf", ""), url: "", apiKey: "test-key", fetchFn });
  assert.deepEqual(r.fees.general, { status: "skipped", reason: "AI service unavailable" });
});
test("M5 the AI answered with nothing for a field: “the AI found nothing about it”", () => {
  const ai = { fees: { general: { status: "not_stated" }, scst: { status: "not_stated" } }, notificationNumber: { status: "not_stated" },
    dates: { applicationOpenDate: { status: "not_stated" }, applicationCloseDate: { status: "not_stated" }, feePaymentCloseDate: { status: "not_stated" }, correctionWindowEnd: { status: "not_stated" } } };
  const r = combineReading({ content: FEES, kind: "pdf", url: "", organizationId: "x", ai: ai as never, details: skippedSection("details", NO_PASSAGE), pattern: skippedSection("pattern", NO_PASSAGE),
    article: { values: [], refused: [], links: [] } as never });
  assert.ok(r.notFound.includes("Application fee (General/OBC) (the AI found nothing about it)"), r.notFound.join(" | "));
});
test("M6 pasted text with fees, age and eligibility written in it, no AI: never said to be absent", () => {
  const ai = skippedSection("ai", AI_NOT_USED), details = skippedSection("details", AI_NOT_USED), pattern = skippedSection("pattern", AI_NOT_USED);
  const text = `${FEES}\nAge limit: 21 to 37 years as on 01.01.2097\nEligibility: Bachelor's degree in any discipline`;
  const r = combineReading({ content: text, kind: "html", url: "", organizationId: "x", ai, details, pattern, article: { values: [], refused: [], links: [] } as never });
  assert.ok(r.notFound.some((n) => /^Age Limit \(not read: the AI was not used/.test(n)) && r.notFound.some((n) => /^Application fee \(General\/OBC\) \(not read: the AI was not used/.test(n)), r.notFound.join(" | "));
  assert.ok(!r.notFound.some((n) => /nothing relevant found/.test(n)), r.notFound.join(" | "));
});
