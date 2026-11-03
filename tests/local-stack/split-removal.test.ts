// ═══════════════════════════════════════════════════════════
// The AI's category split on a re-import, through the real import, on the
// in-memory test database. The AI is a stand-in that answers the whole-text
// reading with a split set per case; nothing reaches Google.
//
// A table built from the AI's split was never read as a table: it adds and
// changes, and never removes a row the job has. A table split differently
// from the job's (post-wise against bank-wise) changes nothing: the job's rows
// stand, and the document's figures are said in full, to be checked by hand.
// A table read in full by code from an official notice still offers the rows
// it no longer lists for removal, saying how many; a corrigendum removes
// nothing, as before.
//
// Declared checks (expectChecks): a check that does not run is a failure.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/split-removal.test.ts
// ═══════════════════════════════════════════════════════════

import { boot, check, expectChecks, section, summary } from "./boot";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; value: unknown; action: string; defaultTicked: boolean; conflict: boolean; flags: string[]; claims: Array<{ retrievalId: string }> };
type Brief = { at: J; total: number | null };
type Note = { from: string | null; removalsHeld?: number; problems?: string[];
  diff?: { added: number; changed: number; removed: number; same: number; untouchedPosts: string[]; removedRows: Brief[]; changedRows: Array<{ after: Brief }>; addedRows: Brief[]; held?: number; heldRows?: Array<Brief & { cells: J }> } };
type Proposal = { items: Item[]; warnings: string[]; meta: { sources: Array<{ declaredKind: string; vacancyTables: Note | null; refused?: Array<{ fieldPath: string; reason: string }> }> } };
type Split = Array<{ post: string; count: number; quote: string; categories: Array<{ category: string; count: number; quote: string }> }>;

// The stand-in's answer to the whole-text reading for the next preview: vacancy rows with category counts, or nothing.
let split: Split | null = null;
const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const prompt: string = body.contents?.[0]?.parts?.map((p: { text?: string }) => p.text ?? "").join("\n") ?? "";
  const answer = prompt.includes('"vacancyRows"') && split ? { vacancyRows: split } : {};
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

// A two-line column heading, as bank-wise tables print it, so the next page's table starts a table of its own.
const HEAD = (post: string) => `${post}\nSr. No. Name of the Bank SC ST OBC\nEWS UR Total`;
const OA = ["1 Delta Gramin Bank 2 1 3 1 4 11", "2 Epsilon Gramin Bank 1 1 2 1 3 8", "3 Theta Gramin Bank 1 0 2 1 2 6"];
const S1 = ["1 Delta Gramin Bank 1 1 1 1 2 6", "2 Epsilon Gramin Bank 1 0 1 1 1 4", "3 Theta Gramin Bank 0 1 1 0 2 4"];
const FRONT = "Institute of Banking Personnel Selection\nCommon Recruitment Process SPLIT\nLast date to apply online: 26.10.2097";
const page = (...p: string[]) => p.map((x, i) => `${x}\n\n-- ${i + 1} of ${p.length} --\n`).join("\n");
const FULL = page(FRONT, `${HEAD("OFFICE ASSISTANTS")}\n${OA.join("\n")}`, `${HEAD("OFFICER SCALE I")}\n${S1.join("\n")}`);
// Prose giving Office Assistants' figures by category, as articles and short notices do; no table for code to read.
const OA_LINE = "There are 25 vacancies for Office Assistants: SC 4, ST 2, OBC 7, EWS 3 and UR 9.";
const PROSE = `${FRONT}\n${OA_LINE}`;
const oaSplit: Split = [{ post: "Office Assistants", count: 25, quote: OA_LINE,
  categories: [["SC", 4], ["ST", 2], ["OBC", 7], ["EWS", 3], ["UR", 9]].map(([c, n]) => ({ category: String(c), count: Number(n), quote: OA_LINE })) }];
/** A post-wise split: [post, total, SC, UR] each, all quoted from one line. */
const splitOf = (line: string, posts: Array<[string, number, number, number]>): Split => posts.map(([post, count, sc, ur]) => ({ post, count, quote: line,
  categories: [{ category: "SC", count: sc, quote: line }, { category: "UR", count: ur, quote: line }] }));
const THREE: Array<[string, number, number, number]> = [["Office Assistants", 25, 4, 9], ["Officer Scale I", 18, 3, 7], ["Officer Scale II", 9, 1, 4]];
const lineOf = (posts: Array<[string, number, number, number]>) => `Vacancies: ${posts.map(([p, n, sc, ur]) => `${p} ${n} (SC ${sc}, UR ${ur})`).join("; ")}.`;

const S = { U: "U: removals an AI split must not propose", L: "L: what must still work", R: "R: a genuine change of the table's split" };
expectChecks(S.U, [
  "U1 a one-post bank-wise job, an official re-issue with only the AI's split: no table offered, no row removed",
  "U1 …nothing refused by the editor, and the figures are said in full to check by hand",
  "U2 the same from research: no official row offered for removal",
  "U2 …the research figures are said, to check",
  "U3 a two-post bank-wise job and a split for one post: nothing refused, every bank row kept",
  "U3 …the split's figures are said, naming the different split",
  "U4 research only onto the two-post job: nothing offered, nothing removed",
  "U6 a corrigendum with only the AI's split: nothing removed, nothing refused, its figures said",
  "U the jobs are as they were",
]);
expectChecks(S.L, [
  "L1 a complete official re-issue read by code: Theta offered for removal, unticked",
  "L1 …the item says it proposes removing 1 row",
  "L1 …applied when ticked: Theta goes, the rest stays",
  "L2 read by code, a change and a removal: both offered, the count said",
  "L3 a corrigendum read by code: one change, nothing removed, no removal count",
  "L4 a split naming fewer posts keeps the post it leaves out",
  "L5 a split adding a post to a post-wise job: offered as an addition, nothing removed",
  "L6 a split correcting one figure: offered as a change, the other posts untouched",
  "L6 …applied: the figure changes, every other post stays",
  "L7 code reads a table: the AI's split is not used",
  "L8 no table and no split: nothing offered",
  "L8b an official table read by code beside research with a split: the official item, with its count; the research held and said",
]);
expectChecks(S.R, [
  "R1 a post-wise job, then an official bank-wise table read by code: the job's rows stand, nothing refused",
  "R1 …all six bank rows are said with their figures and pages, to rebuild the table by hand",
]);

(async () => {
  const { adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  await setImporterEnabled(true);
  let year = 2300;
  const preview = async (args: J, answer: Split | null) => {
    split = answer;
    const p = await service.previewImport({ adminId, apiKey: "stand-in-not-a-key", fetchFn, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }), ...args } as never);
    return { importId: p.importId, proposal: p.proposal as unknown as Proposal };
  };
  const apply = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: null });
  const newJob = () => ({ mode: "NEW", newJob: { organizationId: `split-removal-${year}`, organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year++, title: "TEST RECORD split removal", govType: "PSU" } });
  const official = (text: string, kind = "OFFICIAL_NOTIFICATION") => ({ declaredKind: kind, method: "paste", text, url: "https://www.ibps.in/notice.pdf", attestation: "Downloaded from ibps.in on 3 Nov 2026 (test)" });
  const research = (text: string) => ({ declaredKind: "RESEARCH", method: "paste", text });
  const makeJob = async (sources: J[], answer: Split | null) => {
    const p = await preview({ ...newJob(), sources }, answer);
    const r = await apply(p.importId, p.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id));
    return r.recruitmentId as string;
  };
  const rowsOf = async (id: string) => ((await getRecruitmentById(id))!.vacancies.table?.value?.rows ?? []).map((x) => `${Object.values(x.at).join(" › ")}:${x.total}`).sort();
  const reimport = (jobId: string, sources: J[], answer: Split | null) => preview({ mode: "EXISTING", recruitmentId: jobId, sources }, answer);
  const tableItems = (p: Proposal) => p.items.filter((i) => i.fieldPath === "vacancies.table");
  const refused = (p: Proposal) => p.meta.sources.flatMap((x) => (x.refused ?? []).filter((f) => f.fieldPath === "vacancies.table"));
  const notes = (p: Proposal) => p.meta.sources.map((x) => x.vacancyTables);
  const heldWarning = (p: Proposal) => p.warnings.find((w) => /The job's table is split by/.test(w)) ?? "";
  const countFlag = (i: Item | undefined) => i?.flags.find((f) => /^Proposes removing/.test(f)) ?? null;
  const noRemoval = (p: Proposal) => notes(p).every((n) => (n?.diff?.removed ?? 0) === 0);

  // Jobs to re-import into.
  const twoPostJob = await makeJob([official(FULL)], null);                                            // bank-wise: 2 posts × 3 banks, read by code
  const onePostJob = await makeJob([official(page(FRONT, `${HEAD("OFFICE ASSISTANTS")}\n${OA.join("\n")}`))], null); // bank-wise: 1 post × 3 banks
  const before2 = await rowsOf(twoPostJob), before1 = await rowsOf(onePostJob);

  section(S.U);
  {
    const p = (await reimport(onePostJob, [official(PROSE)], oaSplit)).proposal;
    check("U1 a one-post bank-wise job, an official re-issue with only the AI's split: no table offered, no row removed",
      tableItems(p).length === 0 && noRemoval(p) && notes(p)[0]?.from === "split" && notes(p)[0]?.diff?.held === 1, [tableItems(p), notes(p)]);
    const w = heldWarning(p);
    check("U1 …nothing refused by the editor, and the figures are said in full to check by hand",
      refused(p).length === 0 && /Office Assistants — 25/.test(w) && /SC 4/.test(w) && /UR 9/.test(w) && /check it by hand in the vacancy editor/.test(w), [refused(p), w]);
  }
  {
    const p = (await reimport(onePostJob, [research(PROSE)], oaSplit)).proposal;
    check("U2 the same from research: no official row offered for removal", tableItems(p).length === 0 && noRemoval(p), [tableItems(p), notes(p)]);
    check("U2 …the research figures are said, to check", /Office Assistants — 25/.test(heldWarning(p)) && refused(p).length === 0, p.warnings);
  }
  {
    const p = (await reimport(twoPostJob, [official(PROSE)], oaSplit)).proposal;
    check("U3 a two-post bank-wise job and a split for one post: nothing refused, every bank row kept",
      refused(p).length === 0 && tableItems(p).length === 0 && noRemoval(p), [refused(p), tableItems(p)]);
    check("U3 …the split's figures are said, naming the different split", /split by Post › Bank; this document by Post/.test(heldWarning(p)), p.warnings);
  }
  {
    const p = (await reimport(twoPostJob, [research(PROSE)], oaSplit)).proposal;
    check("U4 research only onto the two-post job: nothing offered, nothing removed", tableItems(p).length === 0 && noRemoval(p) && refused(p).length === 0, [tableItems(p), refused(p)]);
  }
  {
    const p = (await reimport(twoPostJob, [official(PROSE, "OFFICIAL_CORRIGENDUM")], oaSplit)).proposal;
    check("U6 a corrigendum with only the AI's split: nothing removed, nothing refused, its figures said",
      noRemoval(p) && refused(p).length === 0 && /Office Assistants — 25/.test(heldWarning(p)), [notes(p), refused(p), p.warnings]);
  }
  check("U the jobs are as they were", JSON.stringify(await rowsOf(twoPostJob)) === JSON.stringify(before2) && JSON.stringify(await rowsOf(onePostJob)) === JSON.stringify(before1));

  section(S.L);
  {
    const r = await reimport(twoPostJob, [official(page(FRONT, `${HEAD("OFFICE ASSISTANTS")}\n${OA.slice(0, 2).join("\n")}`, `${HEAD("OFFICER SCALE I")}\n${S1.join("\n")}`))], null);
    const item = tableItems(r.proposal)[0];
    const n = notes(r.proposal)[0];
    check("L1 a complete official re-issue read by code: Theta offered for removal, unticked",
      !!item && !item.defaultTicked && n?.from === "tables" && n.diff?.removed === 1 && (n.diff.removedRows[0].at as J).bank === "Theta Gramin Bank", [item, n]);
    check("L1 …the item says it proposes removing 1 row", /^Proposes removing 1 row the job has now/.test(countFlag(item) ?? ""), item?.flags);
    const a = await apply(r.importId, [item!.id]);
    const after = await rowsOf(twoPostJob);
    check("L1 …applied when ticked: Theta goes, the rest stays", !!a.recruitmentId && after.length === 5 && !after.includes("Theta Gramin Bank › Office Assistants:6") && after.includes("Theta Gramin Bank › Officer Scale I:4"), after);
  }
  {
    const job = await makeJob([official(FULL)], null);
    const r = await reimport(job, [official(page(FRONT, `${HEAD("OFFICE ASSISTANTS")}\n1 Delta Gramin Bank 2 1 3 1 5 12\n${OA[1]}`, `${HEAD("OFFICER SCALE I")}\n${S1.join("\n")}`))], null);
    const n = notes(r.proposal)[0];
    check("L2 read by code, a change and a removal: both offered, the count said", n?.diff?.changed === 1 && n.diff.removed === 1 && !!countFlag(tableItems(r.proposal)[0]), [n, tableItems(r.proposal)]);
    const c = await reimport(job, [official(page(`Corrigendum\n${HEAD("OFFICE ASSISTANTS")}\n1 Delta Gramin Bank 2 1 3 1 6 13`), "OFFICIAL_CORRIGENDUM")], null);
    const cn = notes(c.proposal)[0];
    check("L3 a corrigendum read by code: one change, nothing removed, no removal count",
      cn?.diff?.changed === 1 && cn.diff.removed === 0 && tableItems(c.proposal).length === 1 && countFlag(tableItems(c.proposal)[0]) === null, [cn, tableItems(c.proposal)]);
  }
  const postJob = await makeJob([official(`${FRONT}\n${lineOf(THREE)}`)], splitOf(lineOf(THREE), THREE)); // post-wise, from a split: 3 posts
  {
    const two = THREE.slice(0, 2);
    const p = (await reimport(postJob, [official(`${FRONT}\n${lineOf(two)}`)], splitOf(lineOf(two), two))).proposal;
    const n = notes(p)[0];
    check("L4 a split naming fewer posts keeps the post it leaves out", noRemoval(p) && JSON.stringify(n?.diff?.untouchedPosts) === JSON.stringify(["Officer Scale II"]), n);
  }
  {
    const four: Array<[string, number, number, number]> = [...THREE, ["Officer Scale III", 4, 1, 3]];
    const p = (await reimport(postJob, [official(`${FRONT}\n${lineOf(four)}`)], splitOf(lineOf(four), four))).proposal;
    const n = notes(p)[0];
    check("L5 a split adding a post to a post-wise job: offered as an addition, nothing removed",
      tableItems(p).length === 1 && n?.diff?.added === 1 && (n.diff.addedRows[0].at as J).post === "Officer Scale III" && n.diff.removed === 0 && countFlag(tableItems(p)[0]) === null, [n, tableItems(p)]);
  }
  {
    const fixed: Array<[string, number, number, number]> = [["Officer Scale I", 20, 3, 9]];
    const r = await reimport(postJob, [official(`${FRONT}\n${lineOf(fixed)}`)], splitOf(lineOf(fixed), fixed));
    const n = notes(r.proposal)[0];
    const item = tableItems(r.proposal)[0];
    check("L6 a split correcting one figure: offered as a change, the other posts untouched",
      !!item && n?.diff?.changed === 1 && n.diff.removed === 0 && JSON.stringify([...n.diff.untouchedPosts].sort()) === JSON.stringify(["Office Assistants", "Officer Scale II"]) && countFlag(item) === null, [n, item]);
    await apply(r.importId, [item!.id]);
    check("L6 …applied: the figure changes, every other post stays",
      JSON.stringify(await rowsOf(postJob)) === JSON.stringify(["Office Assistants:25", "Officer Scale I:20", "Officer Scale II:9"]), await rowsOf(postJob));
  }
  {
    const job = await makeJob([official(FULL)], null);
    const S1_LINE = "There are 14 vacancies for Officer Scale I: SC 3, UR 7.";
    const p = (await reimport(job, [official(page(FRONT, `${HEAD("OFFICE ASSISTANTS")}\n${OA.join("\n")}`, S1_LINE))],
      [{ post: "Officer Scale I", count: 14, quote: S1_LINE, categories: [{ category: "SC", count: 3, quote: S1_LINE }, { category: "UR", count: 7, quote: S1_LINE }] }])).proposal;
    const n = notes(p)[0];
    check("L7 code reads a table: the AI's split is not used", n?.from === "tables" && noRemoval(p) && !heldWarning(p) && (n.diff?.untouchedPosts ?? []).some((x) => /^officer scale i$/i.test(x)), [n, p.warnings]);
    const none = (await reimport(job, [official(`${FRONT}\nThe vacancies will be notified later.`)], null)).proposal;
    check("L8 no table and no split: nothing offered", tableItems(none).length === 0 && !heldWarning(none), tableItems(none));
    const both = (await reimport(job, [official(page(FRONT, `${HEAD("OFFICE ASSISTANTS")}\n${OA.slice(0, 2).join("\n")}`, `${HEAD("OFFICER SCALE I")}\n${S1.join("\n")}`)), research(PROSE)], oaSplit)).proposal;
    const items = tableItems(both);
    check("L8b an official table read by code beside research with a split: the official item, with its count; the research held and said",
      items.length === 1 && !items[0].conflict && !items[0].defaultTicked && /^Proposes removing 1 row/.test(countFlag(items[0]) ?? "") && refused(both).length === 0
      && notes(both)[1]?.diff?.removed === 0 && /Office Assistants — 25/.test(heldWarning(both)), [items, notes(both), both.warnings]);
  }

  section(S.R);
  {
    const job = await makeJob([official(`${FRONT}\n${lineOf(THREE.slice(0, 2))}`)], splitOf(lineOf(THREE.slice(0, 2)), THREE.slice(0, 2))); // post-wise: 2 posts
    const before = await rowsOf(job);
    const p = (await reimport(job, [official(FULL)], null)).proposal;
    const n = notes(p)[0];
    check("R1 a post-wise job, then an official bank-wise table read by code: the job's rows stand, nothing refused",
      n?.from === "tables" && tableItems(p).length === 0 && refused(p).length === 0 && noRemoval(p) && JSON.stringify(await rowsOf(job)) === JSON.stringify(before), [n, tableItems(p), refused(p)]);
    const w = heldWarning(p);
    check("R1 …all six bank rows are said with their figures and pages, to rebuild the table by hand",
      n?.diff?.held === 6 && (n.diff.heldRows ?? []).every((r) => typeof r.total === "number") && /split by Post; this document by Post › Bank/.test(w)
      && /Office Assistants › Theta Gramin Bank — 6 \(SC 1, ST 0, OBC 2, EWS 1, UR 2\), page 2/.test(w) && /6 rows are not brought in/.test(w), [w, n?.diff]);
  }

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
