"use client";

// The vacancy table Smart intake read, for review before saving: what each
// post adds up to, which tables and lines of the document were read, what
// changes in the job's table, what is missing or uncertain, and every row
// with its page and printed line. Figures here are read by code; totals are
// calculated by code; nothing is verified by being shown.

import { analyseVacancyTable, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";
import { C, badge } from "./ui";

type Brief = { at: Record<string, string>; status: string; total: number | null; page: number | null };
export interface VacancyTableNote {
  from: "tables" | "split" | null;
  coverage?: {
    pages: number | null;
    tables: Array<{ title: string; pages: number[]; rows: number; read: boolean; why?: string; columnsBy?: "CODE" | "AI"; columns?: string[] }>;
    unreadLines: Array<{ page: number | null; text: string }>;
  };
  problems?: string[];
  removalsHeld?: number;
  diff?: { added: number; changed: number; removed: number; same: number; untouchedPosts: string[]; addedRows: Brief[]; changedRows: Array<{ before: Brief; after: Brief }>; removedRows: Brief[] };
}

const n = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("en-IN") : "—");
/** A row's place in the table's own dimension order (post › state › bank). */
const whereIn = (dims: VacancyTable["dimensions"]) => (at: Record<string, string>) =>
  [...dims.map((d) => at[d.key]), ...Object.entries(at).filter(([k]) => !dims.some((d) => d.key === k)).map(([, v]) => v)].filter(Boolean).join(" › ");
const pageOf = (p: number | null | undefined) => (p ? `p. ${p}` : "no page");
const figureOf = (b: { status: string; total: number | null }) =>
  b.status === "NOT_REPORTED" ? "not reported" : b.status === "NO_FIGURE" ? "no figure" : b.status === "NIL" ? "nil" : n(b.total);
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

function cellsOf(row: VacancyTableRow, table: VacancyTable): string {
  return table.categories.filter((c) => typeof row.cells[c.key] === "number").map((c) => `${c.label} ${row.cells[c.key]}`).join(", ");
}

const box = (color: string) => ({ border: `1px solid ${color}55`, background: `${color}0f`, borderRadius: 8, padding: "8px 10px", display: "grid", gap: 4 } as const);
const small = { fontSize: 12, color: C.muted, lineHeight: 1.5 } as const;

export function VacancyTableReview({ table, note }: { table: VacancyTable; note: VacancyTableNote | null }) {
  const an = analyseVacancyTable(table);
  const where = whereIn(table.dimensions);
  const cov = note?.coverage;
  const diff = note?.diff;
  const notRead = cov?.tables.filter((t) => !t.read) ?? [];
  const byAi = cov?.tables.filter((t) => t.columnsBy === "AI") ?? [];
  const undetermined = an.categories.filter((c) => c.kind === "UNDETERMINED");
  const errors = an.issues.filter((i) => i.severity === "ERROR");
  // Rows without a figure and undecided columns are listed once below, not again as warnings.
  const warnings = an.issues.filter((i) => i.severity === "WARNING" && i.code !== "NOT_REPORTED" && i.code !== "NO_FIGURE" && i.code !== "UNDETERMINED_COLUMN");
  const missing = table.rows.filter((r) => r.status === "NOT_REPORTED" || r.status === "NO_FIGURE");
  const existing = !!diff && (diff.changed > 0 || diff.same > 0 || diff.removed > 0 || diff.untouchedPosts.length > 0 || (note?.removalsHeld ?? 0) > 0);

  return (
    <div data-vacancy-review style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {/* What it adds up to */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
        <span style={badge(C.accent)}>{plural(table.rows.length, "row")}</span>
        <span style={badge(C.accent)}>{plural(an.groups.length, "post")}</span>
        {an.grandTotal && <span data-vacancy-total style={badge(an.grandTotal.complete ? C.green : C.amber)}>
          {an.grandTotal.complete ? "" : "at least "}{n(an.grandTotal.value)} vacancies ({an.grandTotal.basis === "STATED" ? "as printed" : "calculated"})
        </span>}
        {note?.from === "split" && <span style={badge(C.orange)}>from the whole-text reading&apos;s quoted split</span>}
      </div>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead><tr style={{ color: C.muted, textAlign: "left" }}><th style={{ padding: "2px 6px 2px 0" }}>Post</th><th>Rows</th><th>Total</th><th>Missing</th></tr></thead>
        <tbody>
          {an.groups.map((g) => (
            <tr key={g.name} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "3px 6px 3px 0", color: C.text }}>{g.name}</td>
              <td>{g.rowIds.length}</td>
              <td style={{ color: g.total?.complete ? C.text : C.amber }}>{g.total ? `${g.total.complete ? "" : "≥ "}${n(g.total.value)}` : "—"}{g.total?.basis === "STATED" ? " (printed)" : ""}</td>
              <td style={{ color: g.notReported + g.noFigure > 0 ? C.amber : C.muted }}>{g.notReported + g.noFigure || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={small}>Totals are calculated by code from the rows; a figure marked “printed” is the document&apos;s own total. Nothing here is verified yet.</div>

      {/* Needs a look */}
      {(errors.length > 0 || missing.length > 0 || (note?.problems?.length ?? 0) > 0) && (
        <div data-vacancy-attention style={box(C.amber)}>
          <strong style={{ color: C.amber, fontSize: 12 }}>Missing or conflicting</strong>
          {(note?.problems ?? []).map((p) => <div key={p} style={{ fontSize: 12 }}>• {p}</div>)}
          {errors.map((i, k) => <div key={k} style={{ fontSize: 12 }}>• {i.message}</div>)}
          {missing.length > 0 && <div style={{ fontSize: 12 }}>• {plural(missing.length, "row")} the document marks not reported (NR) or gives no figure for — kept as such, never filled in: {missing.slice(0, 8).map((r) => `${where(r.at)} (${pageOf(r.source.page)})`).join("; ")}{missing.length > 8 ? ` and ${missing.length - 8} more` : ""}</div>}
        </div>
      )}
      {(byAi.length > 0 || undetermined.length > 0 || warnings.length > 0) && (
        <div data-vacancy-uncertain style={box(C.orange)}>
          <strong style={{ color: C.orange, fontSize: 12 }}>Uncertain — check against the document</strong>
          {byAi.map((t) => <div key={t.title + t.pages.join()} style={{ fontSize: 12 }}>• {t.title} ({t.pages.map((p) => `p. ${p}`).join(", ")}): code could not match the columns to the heading; the AI read them as {t.columns?.join(", ")}. The figures are as printed.</div>)}
          {undetermined.map((c) => <div key={c.key} style={{ fontSize: 12 }}>• Column {c.label}: not known whether it counts towards the total or is within the others. Decide it in the job editor.</div>)}
          {warnings.map((i, k) => <div key={k} style={{ fontSize: 12 }}>• {i.message}</div>)}
        </div>
      )}

      {/* Against the job's table */}
      {existing && diff && (
        <div data-vacancy-diff style={box(C.accent)}>
          <strong style={{ fontSize: 12, color: C.text }}>Against the job&apos;s table: {diff.added} new, {diff.changed} changed, {diff.removed} removed, {diff.same} unchanged</strong>
          {diff.changedRows.map((c, k) => (
            <div key={`c${k}`} style={{ fontSize: 12 }}>Changed: {where(c.after.at)} — {figureOf(c.before)} → <strong>{figureOf(c.after)}</strong> ({pageOf(c.after.page)})</div>
          ))}
          {diff.addedRows.length > 0 && diff.addedRows.length < table.rows.length && diff.addedRows.map((r, k) => (
            <div key={`a${k}`} style={{ fontSize: 12 }}>New: {where(r.at)} — {figureOf(r)} ({pageOf(r.page)})</div>
          ))}
          {diff.removedRows.map((r, k) => (
            <div key={`r${k}`} style={{ fontSize: 12, color: C.red }}>Removed (the document gives this post&apos;s table in full and no longer lists it): {where(r.at)} — was {figureOf(r)}</div>
          ))}
          {(note?.removalsHeld ?? 0) > 0 && <div style={{ fontSize: 12, color: C.amber }}>{plural(note!.removalsHeld!, "row")} the document does not list are kept, because some of its table lines could not be read.</div>}
          {diff.untouchedPosts.length > 0 && <div style={small}>Kept as they are (not in this document): {diff.untouchedPosts.join(", ")}</div>}
        </div>
      )}

      {/* What was read */}
      {cov && cov.tables.length > 0 && (
        <details data-vacancy-coverage style={{ fontSize: 12, color: C.muted }} open={notRead.length > 0 || cov.unreadLines.length > 0}>
          <summary style={{ cursor: "pointer" }}>
            What was read: {cov.tables.length - notRead.length} of {plural(cov.tables.length, "table")}{cov.pages ? ` in ${cov.pages} pages` : ""}
            {cov.unreadLines.length > 0 ? `, ${plural(cov.unreadLines.length, "line")} not read` : ""}
          </summary>
          <div style={{ display: "grid", gap: 2, marginTop: 4 }}>
            {cov.tables.map((t, k) => (
              <div key={k} style={{ color: t.read ? C.muted : C.amber }}>
                {t.read ? "✓" : "✗"} {t.title} — {t.pages.map((p) => `p. ${p}`).join(", ")}, {plural(t.rows, "row")}{t.read ? "" : `: not read (${t.why}); enter it in the job editor`}
              </div>
            ))}
            {cov.unreadLines.map((l, k) => <div key={`u${k}`} style={{ color: C.amber, overflowWrap: "anywhere" }}>Not read, {pageOf(l.page)}: “{l.text.slice(0, 160)}”</div>)}
          </div>
        </details>
      )}

      {/* Every row with its evidence */}
      <details data-vacancy-rows style={{ fontSize: 12, color: C.muted }}>
        <summary style={{ cursor: "pointer" }}>Every row with its page and printed line</summary>
        <div style={{ maxHeight: 360, overflow: "auto", marginTop: 4 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: "top" }}>
                  <td style={{ padding: "3px 6px 3px 0", color: C.text }}>{where(r.at)}</td>
                  <td style={{ padding: "3px 6px", whiteSpace: "nowrap", color: r.status === "STATED" || r.status === "NIL" ? C.text : C.amber }}>{figureOf({ status: r.status, total: r.total ?? null })}</td>
                  <td style={{ padding: "3px 6px" }}>{cellsOf(r, table)}</td>
                  <td style={{ padding: "3px 6px", whiteSpace: "nowrap" }}>{pageOf(r.source.page)}</td>
                  <td style={{ padding: "3px 0", fontStyle: "italic", overflowWrap: "anywhere" }}>“{r.source.line.slice(0, 200)}”</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
