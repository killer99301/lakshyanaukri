// Public vacancy data (Nov 2026): job pages send browsers only the vacancy fields visitors need. A row's source
// (the pasted or printed line, the document's retrieval id, its page, how it was read), suggested spellings, printed
// names and reviewer notes stay in the stored record. What visitors see is unchanged: the vacancy section renders
// byte-for-byte the same from the public copy as from the full table. Real IBPS, LIC HFL and BTSC figures plus a
// synthetic table carrying every internal field.
//   npx tsx --tsconfig tsconfig.json tests/cms/public-vacancies.test.tsx
import React from "react";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { VacancyTableSection } from "@/components/jobs/VacancyTableSection";
import { buildRows, readPasted, type ColumnRole } from "@/lib/vacancy-paste";
import { analyseVacancyTable, type VacancyTable } from "@/lib/vacancy-table";
import { vacancyCategoryTable } from "@/lib/vacancy-categories";
import { toPublicVacancyTable, toPublicVacancyBreakdown, PUBLIC_DOCUMENT } from "@/lib/cms/public-vacancies";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import type { VacancyRow } from "@/types";
import { IBPS_OFFICER_I_ROWS, LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

// ── Fixtures (as in vacancy-public.test.tsx) ─────────────────
const IBPS_ROLES: ColumnRole[] = [
  { role: "serial" }, { role: "dimension", key: "bank", label: "Bank" },
  ...(["sc", "st", "obc", "ews"].map((k) => ({ role: "category", key: k, label: k.toUpperCase(), kind: "VERTICAL" }) as ColumnRole)),
  { role: "category", key: "general", label: "General", kind: "VERTICAL" }, { role: "total" },
  ...(["hi", "oc", "vi", "id"].map((k) => ({ role: "category", key: `pwbd_${k}`, label: `PwBD ${k.toUpperCase()}`, kind: "HORIZONTAL", partOf: "pwbd", note: "PwBD (Out of Which), page 47" }) as ColumnRole)),
];
const ibpsBuilt = buildRows(readPasted(IBPS_OFFICER_I_ROWS.map((r) => r.line).join("\n")), IBPS_ROLES, { idPrefix: "o", page: 47, constants: [{ key: "post", label: "Post", value: "Officer Scale I" }] });
const ibps: VacancyTable = { dimensions: ibpsBuilt.dimensions, categories: ibpsBuilt.categories, rows: ibpsBuilt.rows, statedTotals: [] };
const lic: VacancyTable = {
  dimensions: [{ key: "post", label: "Post" }, { key: "state", label: "State" }, { key: "city", label: "City" }], categories: [],
  rows: LIC_TABLE_E_ROWS.map((r, i) => ({ id: `l${i}`, at: { post: "Apprentice", state: r.state, city: r.city }, status: r.n === null ? "NO_FIGURE" as const : "STATED" as const,
    ...(r.n === null ? {} : { total: r.n }), cells: {}, source: { retrievalId: null, page: r.page, line: r.line } })),
  statedTotals: [{ at: {}, total: 232, source: { retrievalId: null, page: 9, line: "Grand Total 232" } }],
};
const btsc: VacancyTable = {
  dimensions: [{ key: "post", label: "Post" }],
  categories: ["UR", "EWS", "SC", "ST"].map((l) => ({ key: l.toLowerCase(), label: l, kind: "VERTICAL" as const }))
    .concat([{ key: "ebc", label: "EBC", kind: "UNDETERMINED" as never }, { key: "bc", label: "BC", kind: "UNDETERMINED" as never }, { key: "bcw", label: "BC Women", kind: "UNDETERMINED" as never }]),
  rows: [{ id: "f", at: { post: "Food Safety Officer" }, status: "STATED", total: 105, cells: { ur: 41, ews: 11, sc: 17, st: 2, ebc: 18, bc: 12, bcw: 4 },
    source: { retrievalId: "notice", page: 4, line: "Food Safety Officer 41 11 17 2 18 12 4 105" } }],
  statedTotals: [],
};

// Synthetic: every internal field, every way a row can be read, an unreadable figure, stated totals.
const SECRET_ID = "3f4e3968-0d57-42b6-9a6f-8f16aa4fafaf";
const mixed: VacancyTable = {
  dimensions: [{ key: "post", label: "Post" }, { key: "bank", label: "Bank" }],
  categories: [
    ...["ur", "ews", "obc", "sc", "st"].map((k) => ({ key: k, label: k.toUpperCase(), kind: "VERTICAL" as const })),
    { key: "pwbd_vi", label: "PwBD VI", kind: "HORIZONTAL", partOf: "pwbd", established: { by: "ADMIN", note: "REVIEWER-NOTE: checked with the board by phone" } },
    { key: "exsm", label: "Ex-Servicemen", kind: "HORIZONTAL", established: { by: "SOURCE", note: "the printed totals do not include this column" } },
  ],
  rows: [
    { id: "m1", at: { post: "Clerk", bank: "Bank of Baroda" }, status: "STATED", total: 100, cells: { ur: 40, ews: 10, obc: 27, sc: 15, st: 8, pwbd_vi: 4, exsm: 10 },
      source: { retrievalId: SECRET_ID, page: null, line: "PASTED-LINE Bank of Baroda 40 10 27 15 8 100", readBy: "PREPARED" } },
    { id: "m2", at: { post: "Clerk", bank: "Bank of India" }, status: "STATED", total: 50, cells: { ur: 20, ews: 5, obc: 13, sc: 8, st: 4, pwbd_vi: 2, exsm: 5 },
      source: { retrievalId: "retrieval-image-0002", page: 12, line: "IMAGE-LINE Bank of India 20 5 13 8 4 50", readBy: "AI_IMAGE" },
      suggested: { bank: "Bank Of India" }, printedAt: { bank: "BANK OF INDIA" } },
    { id: "m3", at: { post: "Clerk", bank: "Canara Bank" }, status: "STATED", total: 30, cells: { ur: 12, ews: 3, sc: 5, st: 2 }, unclear: ["obc"],
      source: { retrievalId: null, page: null, line: "TYPED-BY-HAND 12 3 ? 5 2 30" } },
    { id: "m4", at: { post: "Officer", bank: "Indian Bank" }, status: "NOT_REPORTED", cells: {}, source: { retrievalId: "r-9", page: 3, line: "Indian Bank NR" } },
    { id: "m5", at: { post: "Officer", bank: "UCO Bank" }, status: "STATED", total: 20, cells: { ur: 8, ews: 2, obc: 5, sc: 3, st: 2 }, source: { retrievalId: "r-9", page: 3, line: "UCO 8 2 5 3 2 20" } },
  ],
  statedTotals: [
    { at: {}, total: 200, source: { retrievalId: SECRET_ID, page: 2, line: "GRAND-LINE Total 200", readBy: "PREPARED" } },
    { at: { post: "Officer" }, total: 20, source: { retrievalId: null, page: null, line: "entered by hand" } },
  ],
};
const TABLES: Array<[string, VacancyTable]> = [["IBPS Officer I", ibps], ["LIC HFL", lic], ["BTSC", btsc], ["synthetic mixed", mixed]];

const ROW_KEYS = new Set(["id", "at", "status", "total", "cells", "unclear", "source"]);
const SOURCE_KEYS = ["line", "page", "retrievalId"];
const CATEGORY_KEYS = new Set(["key", "label", "kind", "partOf"]);
const render = (t: VacancyTable) => renderToStaticMarkup(<VacancyTableSection table={t} />);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

suite("Public vacancy data: only what visitors need reaches the browser");

test("PV01 public table: only allowlisted fields at every level", () => {
  for (const [name, t] of TABLES) {
    const p = toPublicVacancyTable(t);
    assert.deepEqual(Object.keys(p).sort(), ["categories", "dimensions", "rows", "statedTotals"], name);
    for (const d of p.dimensions) assert.deepEqual(Object.keys(d).sort(), ["key", "label"], name);
    for (const c of p.categories) assert.ok(Object.keys(c).every((k) => CATEGORY_KEYS.has(k)), `${name}: category ${Object.keys(c)}`);
    for (const r of p.rows) {
      assert.ok(Object.keys(r).every((k) => ROW_KEYS.has(k)), `${name}: row ${Object.keys(r)}`);
      assert.deepEqual(Object.keys(r.source).sort(), SOURCE_KEYS, name);
      assert.equal(r.source.line, ""); assert.equal(r.source.page, null);
      assert.ok(r.source.retrievalId === null || r.source.retrievalId === PUBLIC_DOCUMENT, `${name}: ${r.source.retrievalId}`);
    }
    for (const s of p.statedTotals) {
      assert.ok(Object.keys(s).every((k) => ["at", "total", "cells", "source"].includes(k)), name);
      assert.deepEqual(s.source, { retrievalId: s.source.retrievalId, page: null, line: "" }, name);
    }
  }
});

test("PV02 nothing internal survives anywhere in the public copy", () => {
  const json = JSON.stringify(toPublicVacancyTable(mixed));
  for (const bad of [SECRET_ID, "retrieval-image-0002", "r-9", "PASTED-LINE", "IMAGE-LINE", "TYPED-BY-HAND", "GRAND-LINE", "REVIEWER-NOTE",
    "readBy", "PREPARED", "AI_IMAGE", "suggested", "printedAt", "BANK OF INDIA", "Bank Of India", "established", "\"page\":12", "\"page\":3", "\"page\":2"]) {
    assert.ok(!json.includes(bad), bad);
  }
  // Backed figures keep only the marker; hand-entered ones stay unbacked.
  const p = toPublicVacancyTable(mixed);
  assert.deepEqual(p.rows.map((r) => r.source.retrievalId), [PUBLIC_DOCUMENT, PUBLIC_DOCUMENT, null, PUBLIC_DOCUMENT, PUBLIC_DOCUMENT]);
  assert.deepEqual(p.statedTotals.map((s) => s.source.retrievalId), [PUBLIC_DOCUMENT, null]);
  assert.deepEqual(p.rows[2].unclear, ["obc"]);
});

test("PV03 the stored table is never changed (the CMS keeps all its evidence)", () => {
  for (const [name, t] of TABLES) {
    const before = clone(t);
    toPublicVacancyTable(t);
    assert.deepEqual(t, before, name);
  }
  assert.equal(mixed.rows[0].source.line, "PASTED-LINE Bank of Baroda 40 10 27 15 8 100");
  assert.equal(mixed.rows[1].suggested?.bank, "Bank Of India");
  assert.equal(mixed.categories[5].established?.note, "REVIEWER-NOTE: checked with the board by phone");
});

test("PV04 visitors see exactly the same vacancy section from the public copy", () => {
  for (const [name, t] of TABLES) assert.equal(render(toPublicVacancyTable(t)), render(t), name);
});

test("PV05 the same figures: every total, its basis and completeness are unchanged", () => {
  const strip = (f: { value: number; basis: string; complete: boolean } | null) => f && { value: f.value, basis: f.basis, complete: f.complete };
  for (const [name, t] of TABLES) {
    const a = analyseVacancyTable(t), b = analyseVacancyTable(toPublicVacancyTable(t));
    assert.deepEqual(strip(b.grandTotal), strip(a.grandTotal), `${name} grand total`);
    assert.deepEqual(b.groups.map((g) => [g.name, strip(g.total), g.reported, g.notReported, g.noFigure]), a.groups.map((g) => [g.name, strip(g.total), g.reported, g.notReported, g.noFigure]), `${name} groups`);
    assert.deepEqual(b.categories.map((c) => [c.key, c.kind]), a.categories.map((c) => [c.key, c.kind]), `${name} categories`);
  }
});

const breakdown: VacancyRow[] = [
  { post: "Junior Engineer", count: 600, payScale: "Level 6", eligibility: "B.E. Civil", breakdown: { ur: 240, ews: 60, obc: 162, sc: 90, st: 48, women: 180, exsm: 60, pwbd: { vi: 6, hi: 6, oc: 12 }, other: { EBC: 18, "BC Women": 4 } } },
  { post: "Section Officer", count: 400 },
];
const dirtyBreakdown = [
  { ...breakdown[0], sourceLine: "SECRET-ROW-LINE", evidenceIds: ["e-77"], breakdown: { ...breakdown[0].breakdown, note: "REVIEWER-NOTE", pwbd: { vi: 6, hi: 6, oc: 12, remark: "x" }, other: { EBC: 18, "BC Women": 4, why: "y" } } },
  { ...breakdown[1], retrievalId: SECRET_ID },
] as unknown as VacancyRow[];

test("PV06 post-wise rows: only post, count, pay, eligibility and numeric category figures", () => {
  const p = toPublicVacancyBreakdown(dirtyBreakdown);
  const json = JSON.stringify(p);
  for (const bad of ["SECRET-ROW-LINE", "evidenceIds", "e-77", "REVIEWER-NOTE", "remark", "why", SECRET_ID, "retrievalId", "sourceLine"]) assert.ok(!json.includes(bad), bad);
  assert.deepEqual(p, breakdown);
  // the category table visitors see is identical
  assert.deepEqual(vacancyCategoryTable(p), vacancyCategoryTable(breakdown));
  const before = clone(dirtyBreakdown); toPublicVacancyBreakdown(dirtyBreakdown); assert.deepEqual(dirtyBreakdown, before);
});

const pf = <T,>(value: T): ProvenanceField<T> => ({ value, status: "VERIFIED", evidenceIds: ["e1"], conflict: false, manuallyEdited: false });
function makeRecord(): RecruitmentRecord {
  return {
    id: randomUUID(), slug: "pv-test-2026", draftState: "DRAFT", recordRevision: "abc",
    identity: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2026, title: pf("TEST PV Clerk 2026") },
    dates: { applicationCloseDate: pf<string | null>("2026-12-07") },
    vacancies: { total: pf<number | null>(200), table: pf(mixed), breakdown: pf(dirtyBreakdown) } as RecruitmentRecord["vacancies"],
    financial: {}, links: [{ type: "OFFICIAL_NOTIFICATION", label: "Notice", url: "https://ibps.in/n.pdf", official: true }], documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

test("PV07 the public job built from a record carries no vacancy evidence; the record keeps it", () => {
  const record = makeRecord();
  const before = clone(record);
  const job = snapshotToGovernmentRecruitment(projectForPreview(record));
  const json = JSON.stringify(job);
  for (const bad of [SECRET_ID, "retrieval-image-0002", "PASTED-LINE", "IMAGE-LINE", "GRAND-LINE", "REVIEWER-NOTE", "SECRET-ROW-LINE", "readBy", "suggested", "printedAt", "established", "evidenceIds\":[\"e-77"]) {
    assert.ok(!json.includes(bad), bad);
  }
  assert.ok(job.vacancyTable, "the table is still there");
  assert.equal(render(job.vacancyTable!), render(mixed), "and shows the same");
  assert.deepEqual(job.vacancyBreakdown, breakdown);
  assert.deepEqual(record, before, "record untouched");
});
