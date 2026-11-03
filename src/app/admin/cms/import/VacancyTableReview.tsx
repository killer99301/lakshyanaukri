"use client";

// The vacancy table Smart intake read, for review before saving: what each
// post adds up to, which tables and lines of the document were read, what
// changes in the job's table, what is missing or uncertain, and every row
// with its page and printed line. Figures here are read by code; totals are
// calculated by code; nothing is verified by being shown.

import { analyseVacancyTable, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";
import { useState } from "react";
import { C, badge, quietBtn } from "./ui";
import { ScanPageImage } from "./ScanPage";

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
  /** Posts a corrigendum deletes, as matched against the job's table (P2.3). */
  removal?: {
    removals: Array<{
      post: string; count: number; printedCount: number | null; serial: string | null; table: string | null; readAs?: string;
      quotes: Array<{ text: string; page: number | null }>;
      rows: Array<{ at: Record<string, string>; total: number | null; page: number | null; line: string; prepared: boolean; cells: Array<{ label: string; value: number; within: boolean }> }>;
    }>;
    total: { before: number; removed: number; after: number; quote: string; page: number | null } | null;
    droppedTotals: Array<{ at: Record<string, string>; total: number; page: number | null }>;
    refused: Array<{ quote: string; reason: string }>;
  };
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

export function VacancyTableReview({ table, note, pageImageUrl, research = false }: {
  table: VacancyTable; note: VacancyTableNote | null;
  /** Where a scanned page's image can be seen, when it is kept (stage B2.4). */
  pageImageUrl?: (page: number) => string | null;
  /** The document is research: its own figures are written in the research, never "printed" in the notice. */
  research?: boolean;
}) {
  const stated = research ? "in the research" : "printed";
  const [shownPage, setShownPage] = useState<number | null>(null);
  const an = analyseVacancyTable(table);
  const fromImage = table.rows.filter((r) => r.source.readBy === "AI_IMAGE");
  const imagePages = [...new Set(fromImage.map((r) => r.source.page).filter((p): p is number => p != null))].sort((a, b) => a - b);
  const shownUrl = shownPage !== null ? pageImageUrl?.(shownPage) ?? null : null;
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
          {an.grandTotal.complete ? "" : "at least "}{n(an.grandTotal.value)} vacancies ({an.grandTotal.basis === "STATED" ? (research ? "as written in the research" : "as printed") : "calculated"})
        </span>}
        {note?.from === "split" && <span style={badge(C.orange)}>from the whole-text reading&apos;s quoted split</span>}
        {fromImage.length > 0 && <span data-vacancy-ai-image style={badge(C.orange)}>{plural(fromImage.length, "row")} read from scanned page images by AI</span>}
      </div>
      {fromImage.length > 0 && (
        <div data-vacancy-image-note style={box(C.orange)}>
          <strong style={{ color: C.orange, fontSize: 12 }}>Read from image by AI — human verification required</strong>
          <div style={{ fontSize: 12 }}>
            {plural(fromImage.length, "row")} on {imagePages.length === 1 ? "page" : "pages"} {imagePages.join(", ")} had no text: the AI wrote them out from the page {imagePages.length === 1 ? "image" : "images"}, and code read the table from that.
            Every such figure stays to be checked against its page. The totals adding up does not prove the reading.
          </div>
          {pageImageUrl && imagePages.some((p) => pageImageUrl(p)) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {imagePages.filter((p) => pageImageUrl(p)).map((p) => (
                <button key={p} onClick={() => setShownPage(shownPage === p ? null : p)} style={{ ...quietBtn, padding: "2px 8px", fontSize: 12 }} aria-pressed={shownPage === p}>Page {p}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <thead><tr style={{ color: C.muted, textAlign: "left" }}><th style={{ padding: "2px 6px 2px 0" }}>Post</th><th>Rows</th><th>Total</th><th>Missing</th></tr></thead>
        <tbody>
          {an.groups.map((g) => (
            <tr key={g.name} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "3px 6px 3px 0", color: C.text }}>{g.name}</td>
              <td>{g.rowIds.length}</td>
              <td style={{ color: g.total?.complete ? C.text : C.amber }}>{g.total ? `${g.total.complete ? "" : "≥ "}${n(g.total.value)}` : "—"}{g.total?.basis === "STATED" ? ` (${stated})` : ""}</td>
              <td style={{ color: g.notReported + g.noFigure > 0 ? C.amber : C.muted }}>{g.notReported + g.noFigure || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={small}>{research
        ? <>Totals are calculated by code from the rows; a figure marked “in the research” is the research&apos;s own figure, not the notice&apos;s. Nothing here is verified yet.</>
        : <>Totals are calculated by code from the rows; a figure marked “printed” is the document&apos;s own total. Nothing here is verified yet.</>}</div>

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

      {/* What a corrigendum deletes: exactly the rows and figures that go, with its words */}
      {note?.removal && note.removal.removals.length > 0 && (
        <div data-vacancy-removal style={box(C.red)}>
          <strong style={{ fontSize: 12, color: C.red }}>The corrigendum deletes {plural(note.removal.removals.length, "post")}. Ticked, these rows leave the job&apos;s table:</strong>
          {note.removal.removals.map((x) => (
            <div key={x.post} style={{ display: "grid", gap: 3, fontSize: 12 }}>
              <div style={{ color: C.text }}>
                <strong>{x.post}</strong>{x.table ? `, table ${x.table}` : ""}{x.serial ? `, serial ${x.serial}` : ""}: {n(x.count)} posts in the job&apos;s table{x.printedCount !== null ? `, ${n(x.printedCount)} as the corrigendum prints them` : "; the corrigendum prints no count"}.
              </div>
              {x.readAs && <div style={{ paddingLeft: 10, color: C.amber }}>The corrigendum&apos;s name for it was read as “{x.readAs}”: taken as this post because its serial, table and count all match. Check the name on the page.</div>}
              {x.rows.map((r, k) => (
                <div key={k} style={{ paddingLeft: 10 }}>
                  Row ({pageOf(r.page)}{r.prepared ? ", prepared outside" : ""}): total {n(r.total)} — {r.cells.map((c) => `${c.label} ${n(c.value)}${c.within ? " (within)" : ""}`).join(", ")}
                </div>
              ))}
              <div style={{ paddingLeft: 10, color: C.muted }}>Every figure in {x.rows.length === 1 ? "this row goes with it" : "these rows goes with them"}. A share marked “within” (women, PwBD) is part of the {n(x.count)}: it is not taken away again.</div>
              {x.quotes.map((q, k) => <div key={`q${k}`} style={{ paddingLeft: 10, fontStyle: "italic", overflowWrap: "anywhere" }}>“{q.text}” ({pageOf(q.page)})</div>)}
            </div>
          ))}
          {note.removal.total
            ? <div style={{ fontSize: 12 }}>Total: the job&apos;s table adds up to {n(note.removal.total.before)}; less {n(note.removal.total.removed)} is <strong>{n(note.removal.total.after)}</strong>, as the corrigendum prints it (“{note.removal.total.quote}”, {pageOf(note.removal.total.page)}).</div>
            : <div style={{ fontSize: 12, color: C.amber }}>The corrigendum prints no revised total: the job&apos;s total is worked out again from the rows that stay.</div>}
          {note.removal.droppedTotals.map((d, k) => <div key={`d${k}`} style={{ fontSize: 12 }}>The printed total for {Object.values(d.at).join(", ") || "the whole table"} ({n(d.total)}, {pageOf(d.page)}) included {note.removal!.removals.length === 1 ? "this post" : "these posts"}: set aside with it.</div>)}
          <div style={small}>Left unticked: nothing is removed until you tick it. Every other post and figure stays as it is; the table before is kept in the job&apos;s history and can be restored in one click.</div>
        </div>
      )}
      {note?.removal && note.removal.removals.length === 0 && note.removal.refused.length > 0 && (
        <div data-vacancy-removal-refused style={box(C.amber)}>
          <strong style={{ fontSize: 12, color: C.amber }}>The corrigendum deletes something, but nothing is removed</strong>
          {note.removal.refused.map((x, k) => <div key={k} style={{ fontSize: 12 }}>• {x.reason} (“{x.quote.slice(0, 200)}”)</div>)}
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
          {(note?.removalsHeld ?? 0) > 0 && <div style={{ fontSize: 12, color: C.amber }}>{plural(note!.removalsHeld!, "row")} the document does not list are kept, because {note!.from === "split" ? "its figures come from the AI's reading of the categories, not from a table read in full" : "some of its table lines could not be read"}.</div>}
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

      {/* Every row with its evidence; a scanned page beside its rows */}
      <details data-vacancy-rows style={{ fontSize: 12, color: C.muted }} open={shownPage !== null}>
        <summary style={{ cursor: "pointer" }}>Every row with its page and printed line</summary>
        <div style={{ display: "grid", gridTemplateColumns: shownUrl ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr", gap: 8, marginTop: 4 }}>
          <div style={{ maxHeight: 640, overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {table.rows.filter((r) => shownPage === null || r.source.page === shownPage).map((r) => (
                  <tr key={r.id} data-row-from-image={r.source.readBy === "AI_IMAGE" ? "true" : undefined} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: "top" }}>
                    <td style={{ padding: "3px 6px 3px 0", color: C.text }}>{where(r.at)}</td>
                    <td style={{ padding: "3px 6px", whiteSpace: "nowrap", color: r.status === "STATED" || r.status === "NIL" ? C.text : C.amber }}>{figureOf({ status: r.status, total: r.total ?? null })}</td>
                    <td style={{ padding: "3px 6px" }}>{cellsOf(r, table)}{r.unclear?.length ? <span style={{ color: C.red }}> · unreadable: {r.unclear.map((k) => (k === "total" ? "Total" : table.categories.find((c) => c.key === k)?.label ?? k)).join(", ")}</span> : null}</td>
                    <td style={{ padding: "3px 6px", whiteSpace: "nowrap" }}>
                      {r.source.readBy === "AI_IMAGE" && r.source.page != null && pageImageUrl?.(r.source.page)
                        ? <button onClick={() => setShownPage(r.source.page)} style={{ ...quietBtn, padding: "0 6px", fontSize: 11 }}>{pageOf(r.source.page)}</button>
                        : pageOf(r.source.page)}
                    </td>
                    <td style={{ padding: "3px 0", fontStyle: "italic", overflowWrap: "anywhere" }}>
                      {r.source.readBy === "AI_IMAGE" && <span style={{ ...badge(C.orange), fontStyle: "normal", marginRight: 4 }}>AI-read from image</span>}
                      “{r.source.line.slice(0, 200)}”
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shownUrl && shownPage !== null && <ScanPageImage key={shownUrl} url={shownUrl} page={shownPage} onClose={() => setShownPage(null)} />}
        </div>
      </details>
    </div>
  );
}
