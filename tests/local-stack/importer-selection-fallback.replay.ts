// ═══════════════════════════════════════════════════════════
// The selection fallback on the real IBPS notice (Stage C entry check 1)
// ═══════════════════════════════════════════════════════════
//
// The fallback of 38b5593 (a selection process built from the notice's own
// schedule when the reading gives none) has unit tests, but no real run gave
// it a reading without a selection process. This check takes it through the
// real path: the real IBPS CRP RRBs-XV PDF, the real page batches, merging,
// proposal, save and reopen, against the in-memory test database.
//
// No AI request is made. The model is replaced by the answers the real model
// (Gemini 3.5 Flash-Lite) gave in B2.6 round 2: its schedule entries, as
// printed on page 1, each given only to the batch whose text holds its quote.
// Three readings are replayed:
//   A. the schedule and no selection process (as the IBPS browser read gave
//      it): the fallback must build the process;
//   B. round 1's own selection process, which has the interview: it must be
//      kept exactly, nothing built or added;
//   C. round 2's own selection process, without the interview: it must be
//      kept, the interview only added to it (the B2.6 schedule check), never
//      replaced by the schedule's.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/importer-selection-fallback.replay.ts <sources dir>
//
// <sources dir> holds ibps-crp-rrb-xv.pdf, as for importer-gemini.acceptance.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boot, check, expectChecks, note, section, summary } from "./boot";

const [SRC] = process.argv.slice(2);
if (!SRC) { console.error("usage: … <sources dir>"); process.exit(2); }

type J = Record<string, unknown>;
type Stage = { name: string; type: string; order?: number; description?: string };

// Round 2's schedule entries (docs/acceptance-runs/round2-2026-10-31/gemini/ibps-pdf.json),
// each with its line as printed on page 1 of the notice.
const SCHEDULE: Array<{ name: string; dateText: string; quote: string }> = [
  ["Conduct of Pre-Exam Training (PET)", "November, 2026", "Conduct of Pre-Exam Training (PET) November, 2026"],
  ["Download of call letters for online examination – Preliminary (Officers/ OA)", "November / December, 2026", "Download of call letters for online examination – Preliminary (Officers/ OA) November / December, 2026"],
  ["Online Examination – Preliminary (Officers/OA)", "November / December, 2026", "Online Examination – Preliminary (Officers/OA) November / December, 2026"],
  ["Result of Online exam – Preliminary (Officers/ OA)", "December, 2026 / January, 2027", "Result of Online exam – Preliminary (Officers/ OA) December, 2026 / January, 2027"],
  ["Download of Call letter for Online exam – Main / Single (Officers/ OA)", "December 2026/ January, 2027", "Download of Call letter for Online exam – Main / Single (Officers/ OA) December 2026/ January, 2027"],
  ["Online Examination – Main / Single (Officers/OA)", "December, 2026/ February, 2027", "Online Examination – Main / Single (Officers/OA) December, 2026/ February, 2027"],
  ["Declaration of Result – Main/ Single (For Officers Scale I, II and III)", "January, 2027", "Declaration of Result – Main/ Single (For Officers Scale I, II and III) January, 2027"],
  ["Download of call letters for interview (For Officers Scale I, II and III)", "January, 2027", "Download of call letters for interview (For Officers Scale I, II and III) January, 2027"],
  ["Conduct of interview (For Officers Scale I, II and III)", "January/ February, 2027", "Conduct of interview (For Officers Scale I, II and III) January/ February, 2027"],
].map(([name, dateText, quote]) => ({ name, dateText, quote }));

// Round 1's selection process (with the interview) and round 2's (without it), with a line of page 3 or 21.
const ROUND1: Stage[] = [
  { name: "Online Preliminary Examination", type: "CBT" }, { name: "Online Main Examination", type: "CBT" },
  { name: "Single Online Examination", type: "CBT" }, { name: "Common Interview", type: "INTERVIEW" },
];
const ROUND1_QUOTE = "For the posts of Officers Scale I and Office Assistants (Multi-purpose) the examination will be two tier";
const ROUND2: Stage[] = [
  { name: "Preliminary Examination", type: "CBT" }, { name: "Main Examination", type: "CBT" }, { name: "Single level Examination", type: "CBT" },
];
const ROUND2_QUOTE = "Preliminary Examination (objective)";

const BUILT = [
  "1 CBT: Online Examination – Preliminary (Officers/OA)", "2 CBT: Online Examination – Main / Single (Officers/OA)",
  "3 INTERVIEW: Conduct of interview (For Officers Scale I, II and III)",
];

const REQUIRED: Record<string, string[]> = {
  "A: no selection process in the reading": [
    "A: the reading has no selection process of its own (the replay is the case it claims)",
    "A: one selection process, built from the schedule's three selection stages as printed, in order",
    "A: no announcement, call letter, result or training among them",
    "A: it says it was built from the notice's schedule, with the page, on the review item",
    "A: its evidence is the schedule's own quote and page 1",
    "A: the quote is in the notice's stored text",
    "A: no longer listed as not found",
    "A: saved: the job's selection process is the built one",
    "A: saved as Pending, not verified (SUPPORTED, not yet checked by a person)",
    "A: saved with its evidence: one extracted claim with the schedule's quote and page 1, and no verification",
    "A: reopened: the same process and its note",
  ],
  "B: the reading's own process, with the interview": [
    "B: kept exactly as read (round 1's four stages)",
    "B: nothing built from the schedule, nothing added, nothing said",
    "B: saved as read, Pending",
  ],
  "C: the reading's own process, without the interview": [
    "C: the reading's three stages kept, as read, in order",
    "C: only the officers' interview added from the schedule, and said",
    "C: never replaced by the schedule's process",
  ],
};
for (const [s, names] of Object.entries(REQUIRED)) expectChecks(s, names);

const squash = (s: string) => s.replace(/\s+/g, " ");
const brief = (st: Stage[]) => st.map((s, i) => `${s.order ?? i + 1} ${s.type}: ${s.name}`);

(async () => {
  const { adminId, pg } = await boot();
  process.env.GEMINI_API_KEY = "replay-key-not-real";
  const service = await import("@/lib/cms/importer/service");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const pdf = readFileSync(join(SRC, "ibps-crp-rrb-xv.pdf"));
  const IBPS_URL = "https://www.ibps.in/wp-content/uploads/CRP-RRBs-XV-notification.pdf";

  // The stand-in for the model: only the whole-text (page batch) reading answers, and only with
  // what the batch's own text holds; the section readers answer nothing.
  let reading: { stages: Stage[]; quote: string } | null = null;
  let requests = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
    requests++;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = body.contents?.[0]?.parts?.map((p: { text?: string }) => p.text ?? "").join("\n") ?? "";
    const text = squash(prompt);
    const out: J = {};
    if (prompt.includes('"vacancyRows"')) {
      const entries = SCHEDULE.filter((e) => text.includes(squash(e.quote)));
      if (entries.length) out.examStages = entries.map((e) => ({ name: e.name, date: null, dateText: e.dateText, quote: e.quote }));
      if (reading && text.includes(squash(reading.quote))) out.selectionStages = reading.stages.map((s) => ({ name: s.name, type: s.type, quote: reading!.quote }));
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  type Preview = Awaited<ReturnType<typeof service.previewImport>>;
  type Item = Preview["proposal"]["items"][number];
  // IBPS each time (its official domain is what makes the notice official), a different year per replay so that
  // each save is a new job and not refused as a duplicate of the last.
  const preview = async (title: string, recruitmentYear: number) => service.previewImport({
    adminId, mode: "NEW", apiKey: process.env.GEMINI_API_KEY,
    newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear, title, govType: "PSU" },
    sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: pdf, url: IBPS_URL, attestation: `Downloaded from ${IBPS_URL} on 26 Oct 2026` }],
  } as never);
  const sel = (p: Preview) => p.proposal.items.filter((i) => i.fieldPath === "selection");
  const stagesOf = (i: Item | undefined) => ((i?.value as { stages?: Stage[] } | undefined)?.stages ?? []);
  const meta = (p: Preview) => (p.proposal as unknown as { meta: { sources: Array<{ notFound?: string[] }> } }).meta.sources[0];
  const save = async (p: Preview) => {
    const r = await service.applyImportFlow({ importId: p.importId, adminId, selected: sel(p).map((i) => i.id), confirmReplaceVerified: false, override: null });
    const rec = (await getRecruitmentById(r.recruitmentId))!;
    const claims = await pg.query("SELECT quote, page, kind FROM recruitment_field_claims WHERE recruitment_id = $1 AND field_path = 'selection'", [rec.id]);
    return { rec, checks: await service.checksFor(rec), claims: claims.rows as Array<{ quote: string | null; page: number | null; kind: string }> };
  };

  // ── A ──
  section("A: no selection process in the reading");
  reading = null;
  const before = requests;
  const a = await preview("IBPS RRB CRP-XV (replay A)", 2026);
  note(`replayed requests: ${requests - before} (no network, no key)`);
  const aSel = sel(a);
  const aItem = aSel[0];
  note(`selection: ${JSON.stringify(brief(stagesOf(aItem)))}; flags: ${aItem?.flags.join(" / ")}`);
  note(`claims: ${JSON.stringify(aItem?.claims.map((c) => ({ quote: c.quote, page: c.page })))}`);
  const sched = a.proposal.items.find((i) => i.fieldPath === "examStages");
  note(`schedule: ${((sched?.value ?? []) as Array<{ name: string; kind?: string }>).map((s) => `${s.name} [${s.kind}]`).join(" | ")}`);
  check("A: the reading has no selection process of its own (the replay is the case it claims)", !!sched && aSel.every((i) => i.flags.some((f) => /^built from the notice's schedule/.test(f))), aSel.map((i) => i.flags));
  check("A: one selection process, built from the schedule's three selection stages as printed, in order", aSel.length === 1 && JSON.stringify(brief(stagesOf(aItem))) === JSON.stringify(BUILT), brief(stagesOf(aItem)));
  check("A: no announcement, call letter, result or training among them", stagesOf(aItem).every((s) => !/call letter|result|training|allotment/i.test(s.name)));
  check("A: it says it was built from the notice's schedule, with the page, on the review item",
    !!aItem && aItem.flags.includes("built from the notice's schedule (page 1): the reading gave no selection process, so its 3 selection stages are the schedule's own entries, as printed — check them against the notice"), aItem?.flags);
  const claim = aItem?.claims[0];
  check("A: its evidence is the schedule's own quote and page 1", !!claim && SCHEDULE.some((e) => e.quote === claim.quote) && claim.page === 1, claim);
  const stored = await pg.query("SELECT s.text FROM recruitment_source_retrievals r JOIN recruitment_sources s ON s.id = r.source_id WHERE r.import_id = $1", [a.importId]);
  const all = squash((stored.rows as Array<{ text: string }>).map((r) => r.text).join("\n"));
  check("A: the quote is in the notice's stored text", !!claim?.quote && all.includes(squash(claim.quote)));
  check("A: no longer listed as not found", !(meta(a).notFound ?? []).some((l) => /^Selection/i.test(l)), meta(a).notFound);
  const aSaved = await save(a);
  const recSel = aSaved.rec.selection as { value: { stages: Stage[] } | null; status: string } | undefined;
  note(`saved: status ${recSel?.status}, class ${aSaved.checks.fields.selection}, claims ${JSON.stringify(aSaved.claims)}`);
  check("A: saved: the job's selection process is the built one", JSON.stringify(brief(recSel?.value?.stages ?? [])) === JSON.stringify(BUILT), brief(recSel?.value?.stages ?? []));
  check("A: saved as Pending, not verified (SUPPORTED, not yet checked by a person)",
    recSel?.status === "PENDING" && aSaved.checks.fields.selection === "SUPPORTED", [recSel?.status, aSaved.checks.fields.selection]);
  check("A: saved with its evidence: one extracted claim with the schedule's quote and page 1, and no verification",
    aSaved.claims.length === 1 && aSaved.claims[0].kind === "EXTRACTED" && aSaved.claims[0].quote === claim?.quote && aSaved.claims[0].page === 1, aSaved.claims);
  const reopened = await service.getImport(a.importId);
  const rItem = (reopened?.proposal as unknown as { items: Item[] } | undefined)?.items.find((i) => i.fieldPath === "selection");
  check("A: reopened: the same process and its note", JSON.stringify(brief(stagesOf(rItem))) === JSON.stringify(BUILT) && JSON.stringify(rItem?.flags) === JSON.stringify(aItem?.flags), rItem?.flags);

  // ── B ──
  section("B: the reading's own process, with the interview");
  reading = { stages: ROUND1, quote: ROUND1_QUOTE };
  const b = await preview("IBPS RRB CRP-XV (replay B)", 2027);
  const bItem = sel(b)[0];
  note(`selection: ${JSON.stringify(brief(stagesOf(bItem)))}; flags: ${bItem?.flags.join(" / ") || "none"}`);
  check("B: kept exactly as read (round 1's four stages)", sel(b).length === 1 && JSON.stringify(stagesOf(bItem).map((s) => `${s.type}: ${s.name}`)) === JSON.stringify(ROUND1.map((s) => `${s.type}: ${s.name}`)), brief(stagesOf(bItem)));
  check("B: nothing built from the schedule, nothing added, nothing said", !!bItem && !bItem.flags.some((f) => /schedule/.test(f)) && bItem.claims[0]?.page !== 1, bItem?.flags);
  const bSaved = await save(b);
  const bRec = bSaved.rec.selection as { value: { stages: Stage[] } | null; status: string } | undefined;
  check("B: saved as read, Pending", bRec?.status === "PENDING" && (bRec.value?.stages ?? []).length === 4 && bSaved.checks.fields.selection === "SUPPORTED", [bRec?.status, bSaved.checks.fields.selection]);

  // ── C ──
  section("C: the reading's own process, without the interview");
  reading = { stages: ROUND2, quote: ROUND2_QUOTE };
  const c = await preview("IBPS RRB CRP-XV (replay C)", 2028);
  const cItem = sel(c)[0];
  note(`selection: ${JSON.stringify(brief(stagesOf(cItem)))}; flags: ${cItem?.flags.join(" / ") || "none"}`);
  const cNames = stagesOf(cItem).map((s) => `${s.type}: ${s.name}`);
  check("C: the reading's three stages kept, as read, in order", sel(c).length === 1 && JSON.stringify(cNames.slice(0, 3)) === JSON.stringify(ROUND2.map((s) => `${s.type}: ${s.name}`)), cNames);
  check("C: only the officers' interview added from the schedule, and said",
    cNames.length === 4 && cNames[3] === "INTERVIEW: Conduct of interview (For Officers Scale I, II and III)"
    && !!cItem && cItem.flags.some((f) => /added from the notice's schedule/.test(f)), [cNames, cItem?.flags]);
  check("C: never replaced by the schedule's process", !!cItem && !cItem.flags.some((f) => /^built from the notice's schedule/.test(f)) && cItem.claims[0]?.page !== 1, cItem?.claims.map((x) => x.page));

  note(`replayed requests in all: ${requests}`);
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
