// The public vacancy display (stage A3), rendered to HTML: a summary per
// post, "At least" and what is missing for an incomplete total, the detail
// folded, "of which" never added, no word of verification, and jobs without
// a table exactly as before. Real IBPS, LIC HFL and BTSC figures.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/vacancy-public.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { VacancyTableSection } from "@/components/jobs/VacancyTableSection";
import { buildRows, readPasted, type ColumnRole } from "@/lib/vacancy-paste";
import type { VacancyTable } from "@/lib/vacancy-table";
import { buildJobAnnouncement } from "@/lib/telegram";
import { IBPS_OFFICER_I_ROWS, LIC_TABLE_E_ROWS } from "../fixtures/vacancy-tables";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const IBPS_ROLES: ColumnRole[] = [
  { role: "serial" }, { role: "dimension", key: "bank", label: "Bank" },
  ...(["sc", "st", "obc", "ews"].map((k) => ({ role: "category", key: k, label: k.toUpperCase(), kind: "VERTICAL" }) as ColumnRole)),
  { role: "category", key: "general", label: "General", kind: "VERTICAL" }, { role: "total" },
  ...(["hi", "oc", "vi", "id"].map((k) => ({ role: "category", key: `pwbd_${k}`, label: `PwBD ${k.toUpperCase()}`, kind: "HORIZONTAL", partOf: "pwbd", note: "PwBD (Out of Which), page 47" }) as ColumnRole)),
];
const ibpsBuilt = buildRows(readPasted(IBPS_OFFICER_I_ROWS.map((r) => r.line).join("\n")), IBPS_ROLES, { idPrefix: "o", page: 47, constants: [{ key: "post", label: "Post", value: "Officer Scale I" }] });
const ibps: VacancyTable = { dimensions: ibpsBuilt.dimensions, categories: ibpsBuilt.categories, rows: ibpsBuilt.rows, statedTotals: [] };
const ibpsComplete: VacancyTable = { ...ibps, rows: ibps.rows.map((r) => /TRIPURA/.test(r.at.bank)
  ? { ...r, status: "STATED", total: 10, cells: { sc: 2, st: 3, obc: 1, ews: 1, general: 3, pwbd_hi: 0, pwbd_oc: 1, pwbd_vi: 0, pwbd_id: 0 }, source: { retrievalId: "c", page: 2, line: "TRIPURA 2 3 1 1 3 10 0 1 0 0" } } : r) };
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
const render = (t: VacancyTable) => renderToStaticMarkup(<VacancyTableSection table={t} />);
const printedSum = IBPS_OFFICER_I_ROWS.filter((r) => r.figures[5] !== "NR").reduce((s, r) => s + Number(r.figures[5]), 0);

suite("IBPS CRP RRBs-XV: bank-wise");
test("PV01 as printed: 'At least', what is missing, and the 28 banks folded", () => {
  const html = render(ibps);
  const t = text(html);
  assert.ok(t.includes(`At least ${printedSum.toLocaleString("en-IN")}`), t.slice(0, 400));
  assert.match(t, /Calculated by adding the bank-wise figures given for this recruitment\./);
  assert.match(t, /This is a minimum, not the final total: 1 bank not reported yet \(TRIPURA TRIPURA GRAMIN BANK\)/);
  assert.match(t, /27 of 28 banks with figures · 1 not reported/);
  assert.match(t, /Show bank-wise vacancies \(28 banks\)/);
  assert.ok(/<details[^>]*>/.test(html) && !/<details[^>]*\bopen\b/.test(html), "folded by default");
  assert.match(t, /The category split is shown once every bank has given its figures/, "no incomplete category sums shown as final");
  assert.ok(!/verif/i.test(t), "nothing here claims verification");
});
test("PV02 every bank reported: the split, PwBD 'of which' and never added", () => {
  const t = text(render(ibpsComplete));
  assert.ok(!t.includes("At least"));
  for (const chip of ["SC 629", "ST 321", "OBC 1,140", "EWS 421", "General 1,755"]) assert.ok(t.includes(chip), chip);
  assert.match(t, /Of which \(already counted in the categories above\): PwBD 211/);
  assert.ok(t.includes((printedSum + 10).toLocaleString("en-IN")) && !t.includes((printedSum + 10 + 211).toLocaleString("en-IN")));
  assert.match(t, /Already counted in the categories; not added to the total/);
});

suite("LIC HFL Table E: state and city");
test("PV03 the notice's 232; the one city without a figure is named; 181 cities folded", () => {
  const t = text(render(lic));
  assert.match(t, /The total is as printed in the notification\./);
  assert.match(t, /1 city listed without a figure \(Andhra Pradesh, Ananthapur\)/);
  assert.match(t, /Show state and city-wise vacancies \(181 cities\)/);
  assert.match(t, /Apprentice 232 /, "the only post shows the notice's total, not a lower sum");
  assert.match(t, /The 180 cities listed with figures add up to 231\./);
  assert.ok(!t.includes("At least"));
});

suite("BTSC FSO: one post, category-wise");
test("PV04 the printed 105 with its whole split, nothing folded", () => {
  const html = render(btsc);
  const t = text(html);
  assert.match(t, /Food Safety Officer 105/);
  for (const chip of ["UR 41", "EWS 11", "SC 17", "ST 2", "EBC 18", "BC 12", "BC Women 4"]) assert.ok(t.includes(chip), chip);
  assert.ok(!html.includes("<details"), "a one-row post has nothing to fold");
  assert.ok(!t.includes("At least") && !t.includes("Of which"));
});

suite("Everything else reads the same figures");
test("PV05 Telegram says 'at least' for an incomplete total and nothing new otherwise", () => {
  const base = { slug: "x", title: "IBPS RRB", shortTitle: null, organizationName: "IBPS", dates: { applicationOpenDate: null, applicationCloseDate: null }, classification: {}, updates: [] };
  const incomplete = buildJobAnnouncement({ ...base, vacancies: { total: 4256, breakdown: null, totalComplete: false } } as never, "NEW");
  const complete = buildJobAnnouncement({ ...base, vacancies: { total: 4266, breakdown: null, totalComplete: true } } as never, "NEW");
  const legacy = buildJobAnnouncement({ ...base, vacancies: { total: 9000, breakdown: null } } as never, "NEW");
  assert.match(incomplete, /Posts: <b>at least 4,256<\/b>/);
  assert.match(complete, /Posts: <b>4,266<\/b>/);
  assert.match(legacy, /Posts: <b>9,000<\/b>/);
});
