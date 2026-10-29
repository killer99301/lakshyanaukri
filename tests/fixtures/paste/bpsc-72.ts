// BPSC 72nd CCE's vacancy tables (सारणी I and II) as a job holds them after
// the paste route (tests/cms/bpsc-paste.test.ts): pasted in two parts, page 1
// then page 2, marked prepared outside, with an admin's decisions on each
// column's place in the total. Shared by the tests that start from that job.

import { readFileSync } from "node:fs";
import { buildRows, mergePasted, readPasted, suggestColumns, type ColumnRole } from "@/lib/vacancy-paste";
import type { VacancyTable } from "@/lib/vacancy-table";

export const BPSC_LINES = readFileSync("tests/fixtures/paste/bpsc-72-prepared.txt", "utf8").trim().split(/\r?\n/);
const HEADING = BPSC_LINES[0];
// Page 1 prints सारणी I posts 1-15; page 2 posts 16-22, its Total line, and सारणी II.
export const BPSC_PAGE1 = [HEADING, ...BPSC_LINES.slice(1, 16)].join("\n");
export const BPSC_PAGE2 = [HEADING, ...BPSC_LINES.slice(16)].join("\n");

export const BPSC_NOTES = {
  vertical: "notice pp.1-2: कुल पद is the seven reservation columns added (post 1: 40+10+16+01+18+12+03 = 100)",
  ff: "notice pp.1-2: not added into कुल पद (post 1: 100 without its 02)",
  women: "notice p.1: printed under “महिलाओं के लिए आरक्षित रिक्तियों की संख्या” (vacancies reserved for women), within each category",
  pwbd: "notice pp.1-2: दिव्यांग is not added into कुल पद",
};

/** The admin's decisions in the paste panel, each with how it is known. */
export function decideBpscColumns(roles: ColumnRole[]): ColumnRole[] {
  return roles.map((r) => {
    if (r.role !== "category" || r.kind !== "UNDETERMINED") return r;
    if (["ebc", "bc", "bc_women"].includes(r.key)) return { ...r, kind: "VERTICAL", note: BPSC_NOTES.vertical };
    if (r.key === "ff") return { ...r, kind: "HORIZONTAL", note: BPSC_NOTES.ff };
    if (r.key === "women" || r.partOf === "women") return { ...r, kind: "HORIZONTAL", note: BPSC_NOTES.women };
    if (r.partOf === "pwbd") return { ...r, kind: "HORIZONTAL", note: BPSC_NOTES.pwbd };
    return r;
  });
}

export function pasteBpsc(existing: VacancyTable | null, text: string, page: number, opts: { prepared?: boolean; decided?: boolean } = {}) {
  const grid = readPasted(text);
  const roles = opts.decided === false ? suggestColumns(grid) : decideBpscColumns(suggestColumns(grid));
  const built = buildRows(grid, roles, { page, prepared: opts.prepared ?? true, idPrefix: `p${page}-` });
  return { grid, roles, built, plan: mergePasted(existing, built, false) };
}

/** The whole job table: page 1 pasted, then page 2 added to it. */
export function bpscTable(opts: { prepared?: boolean; edit?: (s: string) => string } = {}): VacancyTable {
  const edit = opts.edit ?? ((s: string) => s);
  const one = pasteBpsc(null, edit(BPSC_PAGE1), 1, opts);
  return pasteBpsc(one.plan.table, edit(BPSC_PAGE2), 2, opts).plan.table;
}
