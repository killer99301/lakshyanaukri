// ═══════════════════════════════════════════════════════════
// Total vacancies: a year, a date, a fee or a notice number is never the count (F1–F5)
//
// Found in the I5 browser check: research text ending a line with
// "…30.06.2099" before a "Vacancy table:" line was offered "Total vacancies:
// 2099", ticked, with no quote. A ticked wrong total could then be verified by
// citing any official line holding 2099 ("Recruitment of Clerks 2099").
//
//   A  the reader, in pasted text, a web page and PDF text (F1)
//   B  the words that state a figure as the count (F2, F5)
//   C  the real preview: quotes, ticks, conflicts, research, tables (F2–F4)
//   D  save → reopen → public preview → verification → publish gate (F5)
//
// Through the real preview, apply, decision and database functions on the
// in-memory test database, the AI off (no key; a fetch that counts requests).
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/vacancy-total-integrity.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";

type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; conflict: boolean; flags: string[]; claims: Array<{ retrievalId: string; quote?: string }> };
type Proposal = { items: Item[]; warnings: string[] };

const FRONT = "Test Public Service Commission\nRecruitment of Clerks 2099\nLast date to apply online: 30.06.2099";
// The I5 browser check's research text: its FF table is held, and nothing in it is a total.
const LIVE_RESEARCH = `${FRONT}\nVacancy table:\n| Post | UR | FF | Total |\n| Assistant | 10 | 1 | 11 |\n| Typist | 4 | 0 | 4 |`;

// [name, text, the total expected (null: none)]
const READER: Array<[string, string, number | null]> = [
  ["the I5 browser check's research text", LIVE_RESEARCH, null],
  ["a year ending a line, “Vacancies” starting the next", "Recruitment of Clerks 2099\nVacancies are given in the annexure.", null],
  ["a year ending a line, “Posts” starting the next", "Recruitment of Clerks 2099\nPosts are given in the annexure.", null],
  ["a deadline beside a vacancy heading", "Last date to apply: 30.06.2099\nVacancy details", null],
  ["a deadline with the word on the same line", "Vacancy notice — last date 30.06.2099", null],
  ["a fee beside a post heading", "Application fee Rs. 600\nPosts are listed below.", null],
  ["a fee with the word on the same line", "Fee ₹600 posts", null],
  ["a notice number holding a year", "Advt. No. 05/2099\nVacancy notice for Clerks", null],
  ["a notice number starting with a year", "Notice No. 2099/05\nVacancies for Clerks", null],
  ["a title with a year and no count", "TPSC Clerk Recruitment 2099 Notification Out\nApply for TPSC Clerk posts.", null],
  ["a year beside the word on one line, unlabelled", "Recruitment of Clerks 2099 Vacancy details", null],
  ["a heading year with the count after it", "Total Vacancies 2026: 500", null],
  ["“Total Vacancies: 70”", "Recruitment of Clerks 2099\nLast date 30.06.2099\nTotal Vacancies: 70", 70],
  ["“Total Vacancies: 2030”", "Recruitment of Clerks\nTotal Vacancies: 2030", 2030],
  ["“Total Vacancies: 2099”", "Recruitment of Clerks\nTotal Vacancies: 2099", 2099],
  ["“70 Posts”", "Recruitment of Clerks 2099\n70 Posts", 70],
  ["“Total No. of Posts: 1,205”", "Recruitment of Officers\nTotal No. of Posts: 1,205", 1205],
  ["“No. of vacancies - 45”", "Recruitment of Clerks\nNo. of vacancies - 45", 45],
];

const S = { A: "A: the reader, three formats", B: "B: words that state the count", C: "C: the real preview", D: "D: save, reopen, public preview, verification, gate" };
expectChecks(S.A, READER.map(([name]) => `A ${name}`));
expectChecks(S.B, [
  "B “Recruitment of Clerks 2099” does not state 2099",
  "B “Recruitment 2099 — 70 vacancies” states 70, not 2099",
  "B “Total Vacancies: 2030” states 2030",
  "B printed-total lines accepted by Stage C state their total",
  "B dates, notice numbers and fees do not state their figure",
  "B an age, a limit, a level or marks beside a vacancy word do not state their figure",
  "B the usual count formats still state their figure",
]);
expectChecks(S.C, [
  "C1 the I5 browser check's sources: no total is offered",
  "C2 an official total is quoted from its own line and ticked",
  "C3 research printing its total: offered with its quote, not ticked",
  "C4 two sources with different totals: both shown, neither ticked",
  "C5 rows added up: the total keeps its usual tick, said as worked out, no quote made up",
  "C5b one post row: its figure keeps its usual tick, said, no quote made up",
  "C5c a category-wise table (SBI style): its added-up total keeps its usual tick",
  "C5d a post row whose figure could be a year: the total is in doubt, not ticked",
  "C5e a figure no line states as the count (an age): said, not ticked",
  "C6 a clean pasted table: its total is worked out from the table when saved",
  "C7 a held table: no total is offered from it",
  "C8 an existing verified total: research offers no replacement, and default ticks keep it",
  "C9 no AI request was made",
]);
expectChecks(S.D, [
  "D1 saved Pending, reopened, the public preview shows the read total",
  "D2 the gate blocks the unverified total",
  "D3 verifying with no quote: a clear refusal, not a database error",
  "D4 verifying 70 citing “Recruitment of Clerks 2099”: refused",
  "D5 verifying 70 citing its own line “Recruitment 2099 — 70 vacancies”: accepted, the gate counts it verified",
  "D6 a total changed to 2099: “Recruitment of Clerks 2099” and “Recruitment 2099 — 70 vacancies” do not verify it",
  "D7 “Total Vacancies: 2030” read, saved and verified with its line",
  "D8 words not in the document still do not verify a total",
  "D9 verifying 35 citing “Posts upto 35 years”: refused",
]);

(async () => {
  const { adminId, token, pg } = await boot();
  delete process.env.GEMINI_API_KEY;
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  const { retrievalsFor } = await import("@/lib/cms/importer/repository");
  const { buildAssistCandidates } = await import("@/lib/cms/ai-assist");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  await setImporterEnabled(true);
  let calls = 0;
  const noAi = (async () => { calls++; throw new Error("no AI in this test"); }) as unknown as typeof fetch;

  // ── A ──
  section(S.A);
  const html = (t: string) => `<html><body>${t.split("\n").map((l) => `<p>${l}</p>`).join("")}</body></html>`;
  for (const [name, text, want] of READER) {
    const got = [
      buildAssistCandidates(text, "html", "https://tpsc.example.gov.in/notice").candidates,
      buildAssistCandidates(html(text), "html", "https://tpsc.example.gov.in/notice").candidates,
      buildAssistCandidates(text, "pdf", "https://tpsc.example.gov.in/notice.pdf").candidates,
    ].map((cs) => cs.find((c) => c.fieldPath === "vacancies.total")?.value ?? null);
    check(`A ${name}`, got.every((v) => v === want), { want, pastedText: got[0], webPage: got[1], pdfText: got[2] });
  }

  // ── B ──
  section(S.B);
  let states: (text: string, n: number) => boolean = () => { throw new Error("no rule for the words that state a count"); };
  try { states = (await import("@/lib/cms/importer/vacancy-count")).statesVacancyCount; } catch { /* before F2: the checks below fail */ }
  const safe = (t: string, n: number) => { try { return states(t, n); } catch { return null; } };
  check("B “Recruitment of Clerks 2099” does not state 2099", safe("Recruitment of Clerks 2099", 2099) === false);
  check("B “Recruitment 2099 — 70 vacancies” states 70, not 2099", safe("Recruitment 2099 — 70 vacancies", 70) === true && safe("Recruitment 2099 — 70 vacancies", 2099) === false);
  check("B “Total Vacancies: 2030” states 2030", safe("Total Vacancies: 2030", 2030) === true);
  const printed: Array<[string, number]> = [["Total 5 3 8 3 11 30", 30], ["Grand Total 232", 232], ["Total: 259", 259], ["Total Number of Vacancies 225", 225], ["70 Posts", 70], ["कुल पद: 45", 45]];
  check("B printed-total lines accepted by Stage C state their total", printed.every(([t, n]) => safe(t, n) === true), printed.map(([t, n]) => [t, safe(t, n)]));
  const not: Array<[string, number]> = [["Last date to apply: 30.06.2099", 2099], ["Advt. No. 05/2099 for posts", 2099], ["Advt. No. 05/2099 for posts", 5], ["Application fee for posts: Rs. 600", 600], ["Posts 2099 notification", 2099], ["Total Vacancies 2026: 500", 2026], ["Recruitment of Clerks 2099 Vacancy details", 2099]];
  check("B dates, notice numbers and fees do not state their figure", not.every(([t, n]) => safe(t, n) === false), not.map(([t, n]) => [t, safe(t, n)]));
  const measures: Array<[string, number]> = [["Posts upto 35 years", 35], ["Age limit for the posts: 35 years", 35], ["Posts: upto 35", 35], ["posts in Pay Level 7", 7], ["Vacancies — maximum age 40", 40],
    ["Posts: 60 marks", 60], ["Posts — 10 lakh", 10], ["Vacancies: 18 to 35 years", 35], ["Posts reserved: 10%", 10], ["पद हेतु आयु 35 वर्ष", 35], ["Post code 05", 5], ["Vacancies — last date 30", 30]];
  check("B an age, a limit, a level or marks beside a vacancy word do not state their figure", measures.every(([t, n]) => safe(t, n) === false), measures.map(([t, n]) => [t, safe(t, n)]));
  const counts: Array<[string, number]> = [["70 Posts", 70], ["Total Vacancies: 2030", 2030], ["Total Vacancies (All categories): 1,205", 1205], ["No. of vacancies - 45", 45], ["Number of posts: 12", 12],
    ["70 (Seventy) vacancies", 70], ["कुल पद: 45", 45], ["45 पद", 45], ["Recruitment of 35 Posts for candidates aged 18–35 years", 35], ["Grand Total 232", 232]];
  check("B the usual count formats still state their figure", counts.every(([t, n]) => safe(t, n) === true), counts.map(([t, n]) => [t, safe(t, n)]));

  // ── C ──
  section(S.C);
  let year = 2800;
  const preview = async (args: Record<string, unknown>) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, fetchFn: noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const newJob = (org = `vt-${year}`) => ({ mode: "NEW", newJob: { organizationId: org, organizationName: org === "ssc" ? "Staff Selection Commission" : "Test Public Service Commission", recruitmentYear: year++, title: "TEST RECORD vacancy total", govType: "State Govt" } });
  const research = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text, prepared: true });
  const official = (text: string, url = "https://ssc.gov.in/notice") => ({ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text, url, attestation: "Copied from the notice (vacancy-total test)" });
  const totals = (p: { proposal: Proposal }) => p.proposal.items.filter((i) => i.fieldPath === "vacancies.total");
  const ticked = (p: { proposal: Proposal }) => p.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id);
  const apply = (p: { importId: string }, selected: string[]) => service.applyImportFlow({ importId: p.importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const POST_BANK = `${FRONT}\n\n-- 1 of 2 --\n\nVacancies\nName of Post Name of the Bank UR SC Total\nClerk Delta Gramin Bank 1 2 3\nClerk Epsilon Gramin Bank 2 1 3\n\n-- 2 of 2 --\n`;

  const c1 = await preview({ ...newJob(), sources: [official(POST_BANK, "https://tpsc.example.gov.in/notice.pdf"), research(LIVE_RESEARCH)] });
  check("C1 the I5 browser check's sources: no total is offered", totals(c1).length === 0, totals(c1));

  const OFFICIAL_70 = "Staff Selection Commission\nRecruitment of Clerks 2099\nRecruitment 2099 — 70 vacancies\nLast date to apply online: 30.06.2099";
  const c2 = await preview({ ...newJob("ssc"), sources: [official(OFFICIAL_70)] });
  const t2 = totals(c2);
  check("C2 an official total is quoted from its own line and ticked",
    t2.length === 1 && t2[0].value === 70 && t2[0].defaultTicked && t2[0].claims[0].quote === "Recruitment 2099 — 70 vacancies", t2);

  const c3 = await preview({ ...newJob(), sources: [research(`${FRONT}\nTotal Vacancies: 15`)] });
  const t3 = totals(c3);
  check("C3 research printing its total: offered with its quote, not ticked",
    t3.length === 1 && t3[0].value === 15 && !t3[0].defaultTicked && t3[0].claims[0].quote === "Total Vacancies: 15" && t3[0].flags.some((f) => /research/.test(f)), t3);

  const c4 = await preview({ ...newJob("ssc"), sources: [official(OFFICIAL_70), research(`${FRONT}\nTotal Vacancies: 75`)] });
  const t4 = totals(c4);
  check("C4 two sources with different totals: both shown, neither ticked",
    t4.length === 2 && t4.every((t) => t.conflict && !t.defaultTicked) && t4.every((t) => !!t.claims[0].quote), t4.map((t) => ({ value: t.value, conflict: t.conflict, ticked: t.defaultTicked })));

  const ROWS = "Staff Selection Commission\nRecruitment of Officers 2099\nLast date to apply online: 30.06.2099\n1. Vacancies:\nAssistant Engineer (Civil) 12\nAssistant Engineer (Electrical) 18\n2. Eligibility: degree";
  const c5 = await preview({ ...newJob("ssc"), sources: [official(ROWS)] });
  const t5 = totals(c5);
  check("C5 rows added up: the total keeps its usual tick, said as worked out, no quote made up",
    t5.length === 1 && t5[0].value === 30 && t5[0].defaultTicked && !t5[0].claims[0].quote && t5[0].flags.some((f) => /worked out by adding the 2 posts read/.test(f)), t5);
  const SEC = (rows: string) => `Staff Selection Commission\nRecruitment of Officers\nLast date to apply online: 30.06.2098\n1. Vacancies:\n${rows}\n2. Eligibility: degree`;
  const t5b = totals(await preview({ ...newJob("ssc"), sources: [official(SEC("Assistant Engineer (Civil) 12"))] }));
  check("C5b one post row: its figure keeps its usual tick, said, no quote made up",
    t5b.length === 1 && t5b[0].value === 12 && t5b[0].defaultTicked && !t5b[0].claims[0].quote && t5b[0].flags.some((f) => /the figure of the one post read/.test(f)), t5b);
  const SBI = "Staff Selection Commission\nRecruitment of Officers\nLast date to apply online: 30.06.2098\nCATEGORY WISE VACANCIES\nNAME OF THE POST: Manager\nUR TOTAL PwBD\nTotal 10 10 1\nNAME OF THE POST: Deputy Manager\nUR TOTAL PwBD\nTotal 15 15 2\n@ - Horizontal vacancy Reservation is horizontal";
  const t5c = totals(await preview({ ...newJob("ssc"), sources: [official(SBI)] }));
  check("C5c a category-wise table (SBI style): its added-up total keeps its usual tick", t5c.length === 1 && t5c[0].value === 25 && t5c[0].defaultTicked, t5c);
  const t5d = totals(await preview({ ...newJob("ssc"), sources: [official(SEC("Recruitment of Clerks 2099"))] }));
  check("C5d a post row whose figure could be a year: the total is in doubt, not ticked",
    t5d.length === 1 && !t5d[0].defaultTicked && t5d[0].flags.some((f) => /could be a year/.test(f)), t5d);
  const AGE = `<html><body><p>Staff Selection Commission</p><p>Recruitment of Officers</p><p>Last date to apply online: 30.06.2098</p><p>Posts upto 35 years of age may apply.</p></body></html>`;
  const t5e = totals(await preview({ ...newJob("ssc"), sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: AGE, url: "https://ssc.gov.in/notice", attestation: "vacancy-total test" }] }));
  check("C5e a figure no line states as the count (an age): said, not ticked",
    t5e.length === 1 && t5e[0].value === 35 && t5e.every((t) => !t.defaultTicked &&t.flags.some((f) => /no line of this source states/.test(f))), t5e);

  const c6 = await preview({ ...newJob(), sources: [research(`${FRONT}\nVacancy table:\n| Post | UR | SC | Total |\n| Assistant | 10 | 1 | 11 |\n| Typist | 4 | 0 | 4 |`)] });
  const s6 = await apply(c6, ticked(c6));
  const r6 = (await getRecruitmentById(s6.recruitmentId))!;
  check("C6 a clean pasted table: its total is worked out from the table when saved",
    totals(c6).length === 0 && r6.vacancies.total?.value === 15 && (r6.vacancies.total as { derived?: { from?: string } }).derived?.from === "vacancies.table", { offered: totals(c6), saved: r6.vacancies.total });

  const c7 = await preview({ ...newJob(), sources: [research(LIVE_RESEARCH)] });
  check("C7 a held table: no total is offered from it", totals(c7).length === 0 && c7.proposal.warnings.some((w) => /not offered/.test(w)), totals(c7));

  // An existing total of 70, verified against its own line; then research.
  const s8 = await apply(c2, ticked(c2));
  const rowOf = async (id: string) => (await service.checksFor((await getRecruitmentById(id))!)).rows.find((r) => r.fieldPath === "vacancies.total")!;
  const officialDoc = async (id: string) => (await retrievalsFor(id)).find((d) => d.declaredKind === "OFFICIAL_NOTIFICATION")!.id;
  const verify = async (id: string, quote: string | null) => {
    const row = await rowOf(id);
    try {
      await service.decide({ recruitmentId: id, adminId, fieldPath: "vacancies.total", kind: "ADMIN_VERIFIED", retrievalId: await officialDoc(id), page: null, quote, tableCell: null, reviewScope: null, justification: null, publicNote: null,
        seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null } });
      return "accepted";
    } catch (e) { return `refused: ${(e as Error).message}`; }
  };

  // ── D (on the job saved from C2) ──
  section(S.D);
  const rec = (await getRecruitmentById(s8.recruitmentId))!;
  const shown = JSON.stringify(projectForPreview(rec));
  check("D1 saved Pending, reopened, the public preview shows the read total",
    rec.vacancies.total?.value === 70 && rec.vacancies.total?.status === "PENDING" && /"total":70\b/.test(shown), rec.vacancies.total);
  const gate1 = await service.publishGateFor(rec);
  check("D2 the gate blocks the unverified total", gate1.gated && gate1.blockers.some((b) => b.fieldPath === "vacancies.total"), gate1.verdicts.find((v) => v.fieldPath === "vacancies.total"));
  const noQuote = await verify(s8.recruitmentId, null);
  check("D3 verifying with no quote: a clear refusal, not a database error", /^refused: Cite the line of the notice that gives 70/.test(noQuote), noQuote);
  const yearOnly = await verify(s8.recruitmentId, "Recruitment of Clerks 2099");
  check("D4 verifying 70 citing “Recruitment of Clerks 2099”: refused", /^refused: Those words do not state 70/.test(yearOnly), yearOnly);
  const notInDoc = await verify(s8.recruitmentId, "Total Vacancies: 70");
  const own = await verify(s8.recruitmentId, "Recruitment 2099 — 70 vacancies");
  const gate2 = await service.publishGateFor((await getRecruitmentById(s8.recruitmentId))!);
  check("D5 verifying 70 citing its own line “Recruitment 2099 — 70 vacancies”: accepted, the gate counts it verified",
    own === "accepted" && gate2.verdicts.find((v) => v.fieldPath === "vacancies.total")?.cls === "VERIFIED", { own, verdict: gate2.verdicts.find((v) => v.fieldPath === "vacancies.total") });
  check("D8 words not in the document still do not verify a total", /^refused: Those words are not in the document/.test(notInDoc), notInDoc);

  // C8: research after the verified total.
  const c8 = await preview({ mode: "EXISTING", recruitmentId: s8.recruitmentId, sources: [research(LIVE_RESEARCH)] });
  await apply(c8, ticked(c8));
  const after8 = (await getRecruitmentById(s8.recruitmentId))!;
  section(S.C);
  check("C8 an existing verified total: research offers no replacement, and default ticks keep it", totals(c8).length === 0 && after8.vacancies.total?.value === 70, { offered: totals(c8), now: after8.vacancies.total?.value });
  check("C9 no AI request was made", calls === 0, calls);

  // D6: another job whose total an admin changed to 2099 in the editor.
  section(S.D);
  const c9 = await preview({ ...newJob("ssc"), sources: [official(OFFICIAL_70)] });
  const s9 = await apply(c9, ticked(c9));
  const recRev = (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [s9.recruitmentId])).rows[0].record_revision as string;
  const req = new NextRequest(`${ORIGIN}/api/admin/cms/records/${s9.recruitmentId}/fields`, { method: "PATCH", headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` },
    body: JSON.stringify({ fieldPath: "vacancies.total", field: { value: 2099, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: recRev, reason: "vacancy-total test: a wrong figure typed in" }) });
  const edited = await fields.PATCH(req, { params: Promise.resolve({ id: s9.recruitmentId }) });
  const v1 = await verify(s9.recruitmentId, "Recruitment of Clerks 2099");
  const v2 = await verify(s9.recruitmentId, "Recruitment 2099 — 70 vacancies");
  const gate3 = await service.publishGateFor((await getRecruitmentById(s9.recruitmentId))!);
  check("D6 a total changed to 2099: “Recruitment of Clerks 2099” and “Recruitment 2099 — 70 vacancies” do not verify it",
    edited.status === 200 && (await getRecruitmentById(s9.recruitmentId))!.vacancies.total?.value === 2099 && /^refused: Those words do not state 2099/.test(v1) && /^refused: Those words do not state 2099/.test(v2)
    && gate3.verdicts.find((v) => v.fieldPath === "vacancies.total")?.cls !== "VERIFIED", { edited: edited.status, v1, v2, verdict: gate3.verdicts.find((v) => v.fieldPath === "vacancies.total")?.cls });

  const c10 = await preview({ ...newJob("ssc"), sources: [official("Staff Selection Commission\nRecruitment of Clerks 2099\nLast date to apply online: 30.06.2099\nTotal Vacancies: 2030")] });
  const t10 = totals(c10);
  const s10 = await apply(c10, ticked(c10));
  const v10 = await verify(s10.recruitmentId, "Total Vacancies: 2030");
  check("D7 “Total Vacancies: 2030” read, saved and verified with its line",
    t10.length === 1 && t10[0].value === 2030 && t10[0].defaultTicked && t10[0].claims[0].quote === "Total Vacancies: 2030"
    && (await getRecruitmentById(s10.recruitmentId))!.vacancies.total?.value === 2030 && v10 === "accepted", { offered: t10, v10 });

  const c11 = await preview({ ...newJob("ssc"), sources: [official("Staff Selection Commission\nRecruitment of Clerks 2099\nLast date to apply online: 30.06.2099\nTotal Vacancies: 35\nPosts upto 35 years of age may apply.")] });
  const s11 = await apply(c11, ticked(c11));
  const v11a = await verify(s11.recruitmentId, "Posts upto 35 years");
  const v11b = await verify(s11.recruitmentId, "Total Vacancies: 35");
  check("D9 verifying 35 citing “Posts upto 35 years”: refused",
    (await getRecruitmentById(s11.recruitmentId))!.vacancies.total?.value === 35 && /^refused: Those words do not state 35/.test(v11a) && v11b === "accepted", { v11a, v11b });

  summary();
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error(e); process.exit(1); });
