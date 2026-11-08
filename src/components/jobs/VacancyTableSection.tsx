"use client";

// ═══════════════════════════════════════════════════════════
// Public job page: vacancies from a vacancy table
// ═══════════════════════════════════════════════════════════
//
// For a job whose vacancies are kept as the notice prints them (by post,
// bank, state, city…). A summary first: each post's total and category split,
// worked out by src/lib/vacancy-table.ts from the published figures. Then, for
// posts split further, the detail folded: readers open it when they need it.
//
// Wording rules (owner's decisions): a calculated total says it was added up,
// never that it was printed; an incomplete total says "At least" and what is
// missing; seats counted within the others (PwBD, ex-servicemen…) are shown
// as "of which" and never added; nothing here says "verified".

import React, { useMemo } from "react";
import { analyseVacancyTable, type Figure, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";

const fmt = (n: number) => n.toLocaleString("en-IN");
const plural = (n: number, one: string, many = /[^aeiou]y$/.test(one) ? `${one.slice(0, -1)}ies` : `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const lower = (s: string) => s.toLowerCase();

function figureText(f: Figure | null): string {
  if (!f) return "Not given";
  return `${f.complete ? "" : "At least "}${fmt(f.value)}`;
}

/** How a figure was obtained, in words a reader understands; nothing for a figure simply entered. */
function basisText(f: Figure | null, detail: string): string | null {
  if (!f) return null;
  if (f.basis === "CALCULATED") return `Calculated by adding the ${detail} figures given for this recruitment.`;
  // The printed total of the source the table came from, which may be a research source: never said to be the notification.
  if (f.basis === "STATED") return "The total is as printed in the source this table was taken from, not added up here.";
  return null;
}

export function VacancyTableSection({ table }: { table: VacancyTable }) {
  const a = useMemo(() => analyseVacancyTable(table), [table]);
  const groupDim = table.dimensions[0]?.key ?? "post";
  const detailDims = table.dimensions.slice(1);
  const detailWords = detailDims.map((d) => lower(d.label)).join(" and ");
  const vertical = a.categories.filter((c) => c.kind === "VERTICAL");
  const horizontal = a.categories.filter((c) => c.kind === "HORIZONTAL");
  // A part shown once under its heading (PwBD HI, OC, VI, ID): its total is "PwBD".
  const horizontalGroups = [...new Set(horizontal.map((c) => c.partOf ?? c.key))];
  const groupLabel = (g: string) => (g === "pwbd" ? "PwBD" : horizontal.find((c) => (c.partOf ?? c.key) === g)?.label ?? g);

  const missing = table.rows.filter((r) => r.status === "NOT_REPORTED" || r.status === "NO_FIGURE");
  const unitWord = detailDims.length ? lower(detailDims[detailDims.length - 1].label) : lower(table.dimensions[0]?.label ?? "post");
  const nameOf = (r: VacancyTableRow) => (detailDims.length ? detailDims : table.dimensions).map((d) => r.at[d.key]).filter(Boolean).join(", ");

  return (
    <div data-public-vacancy-table className="space-y-4">
      {/* How the total was obtained, and what it lacks */}
      {(a.grandTotal || missing.length > 0) && (
        <div className="text-xs font-medium text-slate-600 leading-relaxed space-y-1">
          {basisText(a.grandTotal, detailWords ? `${detailWords}-wise` : "post-wise") && <p>{basisText(a.grandTotal, detailWords ? `${detailWords}-wise` : "post-wise")}</p>}
          {missing.length > 0 && (
            <p className="text-amber-800">
              {a.grandTotal && !a.grandTotal.complete ? "This is a minimum, not the final total: " : "In the detailed figures, "}
              {[
                missing.filter((r) => r.status === "NOT_REPORTED").length > 0 && `${plural(missing.filter((r) => r.status === "NOT_REPORTED").length, unitWord)} not reported yet`,
                missing.filter((r) => r.status === "NO_FIGURE").length > 0 && `${plural(missing.filter((r) => r.status === "NO_FIGURE").length, unitWord)} listed without a figure`,
              ].filter(Boolean).join(", ")}
              {missing.length > 0 && missing.length <= 3 && ` (${missing.map(nameOf).join("; ")})`}.
            </p>
          )}
        </div>
      )}

      {/* One summary per post */}
      <div className="space-y-3">
        {a.groups.map((g) => {
          const rows = table.rows.filter((r) => (r.at[groupDim] ?? "") === g.name);
          // One post whose total the notice prints: the card shows that total,
          // and says what the listed rows add up to when that differs.
          const onlyPost = a.groups.length === 1 && a.grandTotal?.basis === "STATED" && a.grandTotal.complete;
          const shown = onlyPost ? a.grandTotal : g.total;
          const rowsSum = onlyPost && g.calculatedTotal !== null && g.calculatedTotal !== a.grandTotal!.value ? g.calculatedTotal : null;
          const split = vertical.filter((c) => g.categories[c.key]?.complete);
          const ofWhich = horizontalGroups.map((hg) => {
            const parts = horizontal.filter((c) => (c.partOf ?? c.key) === hg).map((c) => g.categories[c.key]);
            if (parts.length === 0 || parts.some((p) => !p || !p.complete)) return null;
            return { label: groupLabel(hg), value: parts.reduce((s, p) => s + p!.value, 0) };
          }).filter((x): x is { label: string; value: number } => x !== null);
          const groupMissing = g.notReported + g.noFigure;
          return (
            <div key={g.name} data-public-vacancy-post={g.name} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-extrabold text-[#0F172A] [overflow-wrap:anywhere]">{g.name}</span>
                <span className="text-base font-black text-purple-700 whitespace-nowrap">{figureText(shown)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
                {shown && !shown.complete && <span className="text-amber-700">Incomplete</span>}
                {detailDims.length > 0 && rows.length > 1 && (
                  <span>
                    {fmt(g.reported)} of {plural(rows.length, unitWord)} with figures
                    {g.notReported > 0 && ` · ${fmt(g.notReported)} not reported`}
                    {g.noFigure > 0 && ` · ${fmt(g.noFigure)} without a figure`}
                  </span>
                )}
                {shown?.basis === "CALCULATED" && rows.length > 1 && <span>Calculated</span>}
              </div>
              {rowsSum !== null && (
                <p className="mt-1 text-[11px] font-medium text-slate-500">The {plural(g.reported, unitWord)} listed with figures add up to {fmt(rowsSum)}.</p>
              )}
              {split.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {split.map((c) => (
                    <span key={c.key} className="rounded-lg bg-slate-50 border border-slate-100 px-2 py-1 text-[11px] font-bold text-[#334155]">
                      {c.label} <span className="tabular-nums text-[#0F172A]">{fmt(g.categories[c.key].value)}</span>
                    </span>
                  ))}
                </div>
              )}
              {ofWhich.length > 0 && (
                <p className="mt-2 text-[11px] font-medium text-slate-500">
                  Of which (already counted in the categories above): {ofWhich.map((o) => `${o.label} ${fmt(o.value)}`).join(" · ")}
                </p>
              )}
              {groupMissing > 0 && split.length === 0 && vertical.length > 0 && (
                <p className="mt-2 text-[11px] font-medium text-slate-500">The category split is shown once every {unitWord} has given its figures.</p>
              )}

              {detailDims.length > 0 && rows.length > 1 && (
                <details className="mt-3 group">
                  <summary className="cursor-pointer select-none text-xs font-bold text-purple-700 hover:text-purple-900">
                    Show {detailWords}-wise vacancies ({plural(rows.length, unitWord)})
                  </summary>
                  <div className="mt-2 overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-[11px] sm:text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-[#475569]">
                          {detailDims.map((d, i) => <th key={d.key} className={`py-2 px-3 font-extrabold whitespace-nowrap ${i === 0 ? "sticky left-0 z-10 bg-slate-50" : ""}`}>{d.label}</th>)}
                          {vertical.map((c) => <th key={c.key} className="py-2 px-2 font-extrabold text-center whitespace-nowrap">{c.label}</th>)}
                          <th className="py-2 px-2 font-extrabold text-center">Total</th>
                          {horizontal.map((c) => <th key={c.key} className="py-2 px-2 font-semibold text-center text-slate-400 whitespace-nowrap" title="Already counted in the categories">{c.label}*</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r) => {
                          const off = r.status === "NOT_REPORTED" ? "Not reported" : r.status === "NO_FIGURE" ? "Not given" : null;
                          const total = r.status === "NIL" ? 0 : r.total ?? (vertical.every((c) => typeof r.cells[c.key] === "number") && vertical.length ? vertical.reduce((s, c) => s + r.cells[c.key], 0) : null);
                          return (
                            <tr key={r.id} className="text-[#0F172A]">
                              {detailDims.map((d, i) => (
                                // The name stays in view while the figures scroll sideways on a phone.
                                <td key={d.key} className={`py-1.5 px-3 font-semibold min-w-[8.5rem] sm:min-w-[12rem] [overflow-wrap:anywhere] ${i === 0 ? "sticky left-0 z-10 bg-white" : ""}`}>{r.at[d.key]}</td>
                              ))}
                              {off ? (
                                <td colSpan={vertical.length + 1 + horizontal.length} className="py-1.5 px-2 text-center italic text-slate-500">{off}</td>
                              ) : (
                                <>
                                  {vertical.map((c) => <td key={c.key} className="py-1.5 px-2 text-center tabular-nums">{typeof r.cells[c.key] === "number" ? fmt(r.cells[c.key]) : "–"}</td>)}
                                  <td className="py-1.5 px-2 text-center font-bold tabular-nums">{total === null ? "–" : fmt(total)}</td>
                                  {horizontal.map((c) => <td key={c.key} className="py-1.5 px-2 text-center tabular-nums text-slate-500">{typeof r.cells[c.key] === "number" ? fmt(r.cells[c.key]) : "–"}</td>)}
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {horizontal.length > 0 && <p className="mt-1 text-[11px] text-slate-500">* Already counted in the categories; not added to the total.</p>}
                </details>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] font-medium text-slate-500">– means not given. Please check the official notification before applying.</p>
    </div>
  );
}
