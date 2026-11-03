"use client";

// ═══════════════════════════════════════════════════════════
// Admin: the vacancy table, inside the job's Vacancies section
// ═══════════════════════════════════════════════════════════
//
// The figures as the notice prints them (by post, bank, state, city…), edited
// in place or pasted from a PDF, a web page, Excel or Google Sheets. Totals,
// category sums and every check are worked out in the browser as you type
// (src/lib/vacancy-table.ts) and again on the server when the table is saved,
// where Total Vacancies and the post-wise breakdown are saved with it and get
// new revisions, so their checks reopen. Nothing pasted is kept until Save,
// and a pasted row never replaces a saved one unless that is ticked.

import { useMemo, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import {
  analyseVacancyTable, hasEvidence, initialCategoryKind, tableFromLegacy, vacancyTableShapeErrors,
  type CategoryKind, type Figure, type RowStatus, type VacancyCategory, type VacancyTable, type VacancyTableRow,
} from "@/lib/vacancy-table";
import { buildRows, mergePasted, readPasted, suggestColumns, type ColumnRole, type PastedGrid } from "@/lib/vacancy-paste";

const C = {
  bg: "#070b16", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", green: "#3fb950", amber: "#d29922", red: "#f85149",
};
const input: React.CSSProperties = {
  width: "100%", padding: "5px 7px", background: C.bg, border: "1px solid #2b3a5c",
  borderRadius: 5, color: C.text, fontSize: 12, boxSizing: "border-box", fontFamily: "inherit",
};
const label: React.CSSProperties = { display: "block", fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 500 };
const quiet: React.CSSProperties = { background: "none", border: `1px solid ${C.border}`, color: C.accent, borderRadius: 5, padding: "4px 10px", fontSize: 12, cursor: "pointer" };
const primary: React.CSSProperties = { padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const chip = (color: string): React.CSSProperties => ({ display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: `${color}18`, border: `1px solid ${color}44`, marginLeft: 6, whiteSpace: "nowrap" });

const KIND_WORDS: Record<CategoryKind, string> = { VERTICAL: "part of the total", HORIZONTAL: "counted within (of which)", UNDETERMINED: "not decided" };
const STATUS_WORDS: Record<RowStatus, string> = { STATED: "Figures", NIL: "Nil (0)", NOT_REPORTED: "Not reported", NO_FIGURE: "No figure" };
const fmt = (n: number) => n.toLocaleString("en-IN");
let idCounter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** How a figure's basis is said, beside its badge: a figure written in research is never "printed in the notice". */
const methodWords = (f: Figure, research: boolean) => (research && f.basis === "STATED" ? "as written in the research, not the notice" : f.method);

function FigureBadges({ f, research = false }: { f: Figure; research?: boolean }) {
  // A figure from rows prepared outside the notice, or from a document brought in as research, is research until
  // checked: never shown as printed in the notice.
  const prepared = f.basis === "STATED" && f.method.startsWith("prepared outside");
  const fromResearch = f.basis === "STATED" && research && !prepared;
  return (
    <>
      <span data-figure-basis style={chip(prepared || fromResearch || f.basis === "ENTERED" ? C.amber : f.basis === "STATED" ? C.accent : C.green)} title={methodWords(f, research)}>
        {prepared ? "Prepared outside, to check" : fromResearch ? "From research, to check" : f.basis === "STATED" ? "Printed in the notice" : f.basis === "ENTERED" ? "Entered by hand" : "Calculated"}
      </span>
      {!f.complete && <span style={chip(C.amber)} title="Some rows it depends on are not reported, have no figure, or a column's place is not decided.">Incomplete</span>}
    </>
  );
}

// ─── Paste: read, map columns, preview, add ────────────────

function PastePanel({ table, onAdd, onClose }: { table: VacancyTable | null; onAdd: (t: VacancyTable, summary: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [grid, setGrid] = useState<PastedGrid | null>(null);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [headerLines, setHeaderLines] = useState(0);
  const [fixed, setFixed] = useState<Record<string, string>>({});
  const [page, setPage] = useState("");
  const [replace, setReplace] = useState(false);
  // Where the pasted rows come from: copied from the notice itself, or prepared outside it (research, to be checked).
  const [prepared, setPrepared] = useState(false);

  const read = () => {
    const g = readPasted(text);
    setGrid(g);
    setHeaderLines(g.headerLines);
    setRoles(suggestColumns(g));
  };
  // The table's dimensions (or Post, for a new table) that no pasted column
  // gives get a box for one value used on every pasted row; this follows the
  // column choices as they change.
  const constants = useMemo(() => {
    const covered = new Set(roles.filter((r) => r.role === "dimension").map((r) => (r as { key: string }).key));
    const dims = table?.dimensions ?? [{ key: "post", label: "Post" }];
    return dims.filter((d) => !covered.has(d.key)).map((d) => ({ key: d.key, label: d.label, value: fixed[d.key] ?? "" }));
  }, [roles, table, fixed]);
  const effectiveGrid = useMemo(() => {
    if (!grid) return null;
    const headers = Array.from({ length: grid.lines[0]?.length ?? 0 }, (_, i) =>
      grid.lines.slice(0, headerLines).map((l) => l[i] ?? "").filter(Boolean).join(" ").trim());
    return { ...grid, headerLines, headers };
  }, [grid, headerLines]);
  const built = useMemo(() => effectiveGrid
    ? buildRows(effectiveGrid, roles, { constants, page: page ? Number(page) : null, prepared, idPrefix: newId("p") + "-" })
    : null, [effectiveGrid, roles, constants, page, prepared]);
  // The table's own dimension order: fixed values and pasted columns arranged to match it.
  const ordered = useMemo(() => {
    if (!built || !table) return built;
    const order = table.dimensions.map((d) => d.key);
    if (built.dimensions.length !== order.length || !order.every((k) => built.dimensions.some((d) => d.key === k))) return built;
    return { ...built, dimensions: table.dimensions };
  }, [built, table]);
  const plan = useMemo(() => ordered && ordered.errors.length === 0 ? mergePasted(table, ordered, replace) : null, [ordered, table, replace]);

  const setRole = (i: number, r: ColumnRole) => setRoles((all) => all.map((x, j) => (j === i ? r : x)));
  const roleValue = (r: ColumnRole) => r.role;
  const preview = effectiveGrid?.lines.slice(0, Math.min(effectiveGrid.lines.length, headerLines + 8)) ?? [];

  return (
    <div data-vacancy-paste style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Paste a vacancy table</strong>
        <button onClick={onClose} style={{ ...quiet, color: C.muted }}>Close</button>
      </div>
      <label style={label} htmlFor="vacancy-paste-text">Rows copied from a PDF, a web page, Excel or Google Sheets (headings too, if you have them)</label>
      <textarea id="vacancy-paste-text" value={text} onChange={(e) => { setText(e.target.value); setGrid(null); }} rows={6}
        style={{ ...input, fontFamily: "ui-monospace, monospace", resize: "vertical" }}
        placeholder={"Post\tUR\tEWS\tSC\tST\tTotal\nFood Safety Officer\t41\t11\t17\t2\t105"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button onClick={read} disabled={!text.trim()} style={quiet}>Read the pasted text</button>
        {grid && <span style={{ fontSize: 12, color: C.muted }}>Read as {grid.format === "tabs" ? "a spreadsheet (tabs)" : grid.format === "pdf" ? "lines from a PDF" : grid.format === "pipes" ? "a table with | between cells" : grid.format === "commas" ? "comma-separated" : "columns with wide gaps"}: {grid.lines.length} lines.</span>}
      </div>

      {effectiveGrid && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
            <label style={{ fontSize: 12 }}><span style={label}>Heading lines at the top</span>
              <input type="number" min={0} max={3} value={headerLines} onChange={(e) => setHeaderLines(Math.max(0, Math.min(3, Number(e.target.value) || 0)))} style={{ ...input, width: 70 }} />
            </label>
            <label style={{ fontSize: 12 }}><span style={label}>Page of the notice these rows are on</span>
              <input value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="e.g. 47" style={{ ...input, width: 110 }} />
            </label>
            {constants.map((c) => (
              <label key={c.key} style={{ fontSize: 12 }}><span style={label}>{c.label} for every pasted row</span>
                <input value={c.value} onChange={(e) => setFixed((all) => ({ ...all, [c.key]: e.target.value }))} placeholder={c.key === "post" ? "e.g. Officer Scale I" : ""} style={{ ...input, width: 220 }} />
              </label>
            ))}
          </div>
          {!page && <div style={{ fontSize: 11, color: C.amber, marginTop: 6 }}>Without a page, these rows are marked “entered by hand” and cannot count as checked against the notice.</div>}
          <fieldset data-paste-origin style={{ border: "none", padding: 0, margin: "8px 0 0", fontSize: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <legend style={{ ...label, padding: 0 }}>Where are these rows from?</legend>
            <label><input type="radio" name="paste-origin" checked={!prepared} onChange={() => setPrepared(false)} /> Copied from the official notice</label>
            <label><input type="radio" name="paste-origin" checked={prepared} onChange={() => setPrepared(true)} /> Prepared outside it (by an AI, a person or another website)</label>
          </fieldset>
          {prepared && <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>Marked “prepared outside”: research, not the notice. The table cannot be published as checked until every row is compared with the notice’s pages.</div>}

          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {roles.map((r, i) => (
                    <th key={i} style={{ padding: 4, verticalAlign: "top", minWidth: 130 }}>
                      <select aria-label={`Column ${i + 1} is`} value={roleValue(r)} style={input} onChange={(e) => {
                        const v = e.target.value;
                        const head = effectiveGrid.headers[i] || `Column ${i + 1}`;
                        setRole(i, v === "dimension" ? { role: "dimension", key: i === 0 ? "post" : `dim${i}`, label: head }
                          : v === "category" ? { role: "category", key: head.toLowerCase().slice(0, 60), label: head, kind: initialCategoryKind(head.toLowerCase()) }
                          : { role: v } as ColumnRole);
                      }}>
                        <option value="dimension">Names (post, bank, state…)</option>
                        <option value="category">Category figures</option>
                        <option value="total">Total</option>
                        <option value="serial">Serial number (skip)</option>
                        <option value="ignore">Skip this column</option>
                      </select>
                      {r.role === "dimension" && (
                        <div style={{ display: "grid", gap: 3, marginTop: 3 }}>
                          <select aria-label={`Column ${i + 1} names`} value={r.key} style={input}
                            onChange={(e) => { const k = e.target.value; const known: Record<string, string> = { post: "Post", bank: "Bank", state: "State", city: "City", district: "District", zone: "Zone", department: "Department" }; setRole(i, { ...r, key: k, label: known[k] ?? r.label }); }}>
                            {[...new Set(["post", "bank", "state", "city", "district", "zone", "department", ...(table?.dimensions.map((d) => d.key) ?? []), r.key])].map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>
                      )}
                      {r.role === "category" && (
                        <div style={{ display: "grid", gap: 3, marginTop: 3 }}>
                          <input aria-label={`Column ${i + 1} category name`} value={r.label} style={input} onChange={(e) => {
                            const key = e.target.value.toLowerCase().replace(/[^a-z0-9 ()./&+-]/g, "").trim().slice(0, 60) || r.key;
                            // A standard reservation (SC, ST, OBC, EWS, UR/General) is part of the total by definition.
                            const kind = r.kind === "UNDETERMINED" && initialCategoryKind(key) === "VERTICAL" ? "VERTICAL" : r.kind;
                            setRole(i, { ...r, label: e.target.value, key, kind });
                          }} />
                          <select aria-label={`Column ${i + 1} place in the total`} value={r.kind} style={input} onChange={(e) => setRole(i, { ...r, kind: e.target.value as CategoryKind })}>
                            {(["VERTICAL", "HORIZONTAL", "UNDETERMINED"] as CategoryKind[]).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
                          </select>
                          {r.kind !== "UNDETERMINED" && initialCategoryKind(r.key) !== r.kind && (
                            <input aria-label={`Column ${i + 1}: how is this known`} value={r.note ?? ""} onChange={(e) => setRole(i, { ...r, note: e.target.value })} placeholder="How is this known? e.g. notice p.47: “out of which”" style={{ ...input, borderColor: r.note?.trim() ? "#2b3a5c" : C.amber }} />
                          )}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((l, j) => (
                  <tr key={j} style={{ color: j < headerLines ? C.muted : C.text, fontStyle: j < headerLines ? "italic" : "normal" }}>
                    {roles.map((_, i) => <td key={i} style={{ padding: "3px 6px", borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{l[i] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {effectiveGrid.lines.length > preview.length && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>…and {effectiveGrid.lines.length - preview.length} more lines.</div>}
          </div>

          {ordered && (
            <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6 }}>
              {ordered.errors.map((e, i) => <div key={`e${i}`} role="alert" style={{ color: C.red }}>✕ {e}</div>)}
              {ordered.notes.map((n, i) => <div key={`n${i}`} style={{ color: C.amber }}>• {n}</div>)}
              {plan && plan.problems.map((p, i) => <div key={`p${i}`} role="alert" style={{ color: C.red }}>✕ {p}</div>)}
              {plan && plan.problems.length === 0 && (
                <>
                  <div data-paste-summary>
                    <b>{ordered.rows.length}</b> rows read: <b>{plan.added.length}</b> new, <b>{plan.same.length}</b> already in the table with the same figures, <b>{plan.differ.length}</b> already in the table with different figures.
                    {ordered.statedTotals.length > 0 && <> <b>{ordered.statedTotals.length}</b> total line{ordered.statedTotals.length === 1 ? "" : "s"} kept as the notice’s printed total{ordered.statedTotals.length === 1 ? "" : "s"}.</>}
                  </div>
                  {plan.differ.length > 0 && (
                    <div style={{ marginTop: 6, padding: 8, border: `1px solid ${C.amber}55`, borderRadius: 6 }}>
                      {plan.differ.slice(0, 6).map((d) => (
                        <div key={d.before.id} style={{ color: C.text }}>{Object.values(d.before.at).join(", ")}: saved {d.before.status === "STATED" ? fmt(d.before.total ?? 0) : STATUS_WORDS[d.before.status]} → pasted {d.after.status === "STATED" ? fmt(d.after.total ?? 0) : STATUS_WORDS[d.after.status]}</div>
                      ))}
                      {plan.differ.length > 6 && <div style={{ color: C.muted }}>…and {plan.differ.length - 6} more.</div>}
                      <label style={{ display: "flex", gap: 6, marginTop: 6, color: C.amber }}>
                        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace these {plan.differ.length} saved rows with the pasted figures
                      </label>
                    </div>
                  )}
                  <button style={{ ...primary, marginTop: 10 }} disabled={plan.added.length === 0 && !(replace && plan.differ.length > 0) && ordered.statedTotals.length === 0}
                    onClick={() => onAdd(plan.table, `Pasted ${plan.added.length} new row${plan.added.length === 1 ? "" : "s"}${replace && plan.differ.length ? ` and replaced ${plan.differ.length}` : ""}${ordered.statedTotals.length ? `, ${ordered.statedTotals.length} printed total${ordered.statedTotals.length === 1 ? "" : "s"}` : ""}${page ? ` from page ${page}` : ""}${prepared ? " (prepared outside the notice)" : ""}`)}>
                    Put them in the table
                  </button>
                  <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>Nothing is saved until you click “Save table”.</span>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── The table ────────────────────────────────────────────

export function VacancyTableEditor({ record, onSaved, researchSources }: {
  record: RecruitmentRecord; onSaved: (r: RecruitmentRecord) => void;
  /** The job's documents brought in as research (from its import checks): their rows' figures are not the notice's. */
  researchSources?: string[];
}) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const research = useMemo(() => new Set(researchSources ?? []), [researchSources]);
  const isResearchRow = (r: VacancyTableRow) => r.source.retrievalId != null && research.has(r.source.retrievalId);
  const saved = record.vacancies.table?.value ?? null;
  const [draft, setDraft] = useState<VacancyTable | null>(saved);
  const [baseRevision, setBaseRevision] = useState(record.recordRevision);
  const [changes, setChanges] = useState<string[]>([]);
  const [pasting, setPasting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newDim, setNewDim] = useState("");
  const [sourceOf, setSourceOf] = useState<string | null>(null);

  // A save elsewhere on the page (another field) brings a new record: keep
  // unsaved table edits, but take the saved table when nothing is pending.
  if (record.recordRevision !== baseRevision) {
    setBaseRevision(record.recordRevision);
    if (changes.length === 0) setDraft(record.vacancies.table?.value ?? null);
  }

  const analysis = useMemo(() => (draft ? analyseVacancyTable(draft) : null), [draft]);
  const shape = useMemo(() => (draft ? vacancyTableShapeErrors(draft) : []), [draft]);
  const errorRows = useMemo(() => new Set((analysis?.issues ?? []).filter((i) => i.severity === "ERROR").flatMap((i) => i.rowIds ?? [])), [analysis]);
  const dirty = changes.length > 0;

  const change = (next: VacancyTable, what: string) => { setDraft(next); setChanges((c) => [...c, what]); setNote(null); setErr(null); };
  const updateRow = (id: string, patch: Partial<VacancyTableRow>) => draft && change({ ...draft, rows: draft.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, "Edited a row");

  async function save(table: VacancyTable | null, reason: string) {
    setSaving(true);
    setErr(null);
    try {
      // Not retried on a conflict: another session may have changed the table itself.
      const res = await fetch(`/api/admin/cms/records/${record.id}/fields`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldPath: "vacancies.table", field: { value: table, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: record.recordRevision, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(res.status === 409 ? "Someone saved this job in the meantime. Copy anything you need, then reload the page." : String(data.error ?? `HTTP ${res.status}`).replace(/^.*invariant:\s*/, ""));
        return;
      }
      setChanges([]);
      setBaseRevision(data.record.recordRevision);
      setDraft(data.record.vacancies?.table?.value ?? null);
      setNote(table ? "Saved. Total Vacancies and the post-wise breakdown were worked out again from the table; any checks of them were reopened." : "The table was removed. Total Vacancies and the breakdown keep their figures as entered.");
      onSaved(data.record);
    } finally {
      setSaving(false);
    }
  }

  // ── No table yet ──
  if (!draft) {
    return (
      <div data-vacancy-table="none" style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Vacancy table</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, maxWidth: 720 }}>
          For a notice that splits its vacancies by bank, state, city, district or category: keep its own figures here, and the totals are worked out from them.
        </div>
        {editable ? (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={quiet} onClick={() => setPasting(true)}>Paste a vacancy table</button>
            {(record.vacancies.breakdown?.value?.length || typeof record.vacancies.total?.value === "number") ? (
              <button style={quiet} onClick={() => change(tableFromLegacy(record.vacancies.total?.value, record.vacancies.breakdown?.value), "Started a vacancy table from the existing figures")}>
                Start a table from the figures above
              </button>
            ) : null}
          </div>
        ) : <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Click “Edit Record” first to add one.</div>}
        {pasting && <PastePanel table={null} onClose={() => setPasting(false)} onAdd={(t, s) => { change(t, s); setPasting(false); }} />}
      </div>
    );
  }

  const groupDim = draft.dimensions[0]?.key ?? "post";
  const issues = analysis?.issues ?? [];
  const shown = showAllIssues ? issues : issues.slice(0, 8);
  const cats = analysis?.categories ?? draft.categories;
  const cell: React.CSSProperties = { padding: "3px 4px", borderTop: `1px solid ${C.border}`, verticalAlign: "middle" };

  return (
    <div data-vacancy-table="present" style={{ marginTop: 4 }}>
      {/* Summary */}
      <div data-vacancy-summary style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.muted }}>Total vacancies</span>
          <span data-grand-total style={{ fontSize: 20, fontWeight: 700 }}>{analysis?.grandTotal ? `${analysis.grandTotal.complete ? "" : "at least "}${fmt(analysis.grandTotal.value)}` : "—"}</span>
          {analysis?.grandTotal && <FigureBadges f={analysis.grandTotal} research={draft.rows.some(isResearchRow)} />}
          {analysis?.grandTotal && <span style={{ fontSize: 11, color: C.muted, marginLeft: 6 }}>{methodWords(analysis.grandTotal, draft.rows.some(isResearchRow))}</span>}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
          <tbody>
            {analysis?.groups.map((g) => (
              <tr key={g.name}>
                <td style={{ padding: "4px 0", width: "40%" }}>{g.name || <em style={{ color: C.muted }}>(no {draft.dimensions[0]?.label.toLowerCase()})</em>}</td>
                <td style={{ padding: "4px 6px", fontWeight: 600, whiteSpace: "nowrap" }}>{g.total ? `${g.total.complete ? "" : "at least "}${fmt(g.total.value)}` : "—"}{g.total && <FigureBadges f={g.total} research={draft.rows.some((r) => g.rowIds.includes(r.id) && isResearchRow(r))} />}</td>
                <td style={{ padding: "4px 0", color: C.muted }}>
                  {cats.filter((c) => g.categories[c.key]).map((c) => `${c.label} ${fmt(g.categories[c.key].value)}${g.categories[c.key].complete ? "" : "+"}`).join(" · ")}
                  {g.rowIds.length > 1 && <span> — {g.reported} of {g.rowIds.length} rows with figures{g.notReported ? `, ${g.notReported} not reported` : ""}{g.noFigure ? `, ${g.noFigure} without a figure` : ""}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Problems */}
      {(issues.length > 0 || shape.length > 0) && (
        <div data-vacancy-issues style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
          {shape.map((s, i) => <div key={`s${i}`} role="alert" style={{ color: C.red }}>✕ {s}</div>)}
          {shown.map((i, n) => <div key={n} style={{ color: i.severity === "ERROR" ? C.red : C.amber }}>{i.severity === "ERROR" ? "✕" : "•"} {i.message}</div>)}
          {issues.length > shown.length && <button onClick={() => setShowAllIssues(true)} style={{ ...quiet, marginTop: 4 }}>Show all {issues.length}</button>}
        </div>
      )}

      {/* Columns and how they count */}
      <div style={{ marginTop: 12, fontSize: 12 }}>
        <div style={{ color: C.muted, marginBottom: 4 }}>Split by: {draft.dimensions.map((d) => d.label).join(" › ")}. Category columns and how they count towards the total:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {cats.map((c) => {
            const stored = draft.categories.find((x) => x.key === c.key)!;
            const fromTotals = stored.kind === "UNDETERMINED" && c.kind !== "UNDETERMINED";
            return (
              <div key={c.key} data-category={c.key} style={{ border: `1px solid ${c.kind === "UNDETERMINED" ? C.amber : C.border}`, borderRadius: 6, padding: "4px 6px", display: "grid", gap: 3, minWidth: 150 }}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                {editable ? (
                  <select aria-label={`${c.label}: place in the total`} value={stored.kind} style={input}
                    onChange={(e) => change({ ...draft, categories: draft.categories.map((x) => (x.key === c.key ? { ...x, kind: e.target.value as CategoryKind, ...(e.target.value === "UNDETERMINED" ? { established: undefined } : {}) } : x)) }, `Set how ${c.label} counts`)}>
                    {(["VERTICAL", "HORIZONTAL", "UNDETERMINED"] as CategoryKind[]).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
                  </select>
                ) : <span style={{ color: C.muted }}>{KIND_WORDS[c.kind]}</span>}
                {fromTotals && <span style={{ color: C.green, fontSize: 11 }}>shown by the printed totals: {KIND_WORDS[c.kind]}</span>}
                {editable && stored.kind !== "UNDETERMINED" && initialCategoryKind(stored.key) !== stored.kind && (
                  <input aria-label={`${c.label}: how is this known`} value={stored.established?.note ?? ""} placeholder="How is this known?" style={{ ...input, borderColor: stored.established?.note?.trim() ? "#2b3a5c" : C.amber }}
                    onChange={(e) => change({ ...draft, categories: draft.categories.map((x) => (x.key === c.key ? { ...x, established: { by: "ADMIN", note: e.target.value } } : x)) }, `Noted how ${c.label} counts`)} />
                )}
                {editable && (
                  <button style={{ ...quiet, color: C.red, padding: "1px 6px", fontSize: 11 }} onClick={() => {
                    const used = draft.rows.some((r) => r.cells[c.key] !== undefined);
                    if (used && !window.confirm(`Remove the ${c.label} column and its figures from every row?`)) return;
                    change({ ...draft, categories: draft.categories.filter((x) => x.key !== c.key), rows: draft.rows.map((r) => { const { [c.key]: _gone, ...rest } = r.cells; void _gone; return { ...r, cells: rest }; }) }, `Removed the ${c.label} column`);
                  }}>Remove column</button>
                )}
              </div>
            );
          })}
          {editable && (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
              <input aria-label="New category column" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New column, e.g. EBC" style={{ ...input, width: 150 }} />
              <button style={quiet} disabled={!newCat.trim()} onClick={() => {
                const labelText = newCat.trim();
                const key = labelText.toLowerCase().replace(/[^a-z0-9 ()./&+-]/g, "").trim().slice(0, 60);
                if (!key || draft.categories.some((x) => x.key === key)) { setErr(`There is already a column called ${labelText}.`); return; }
                const cat: VacancyCategory = { key, label: labelText, kind: initialCategoryKind(key) };
                change({ ...draft, categories: [...draft.categories, cat] }, `Added the ${labelText} column`);
                setNewCat("");
              }}>Add column</button>
            </div>
          )}
        </div>
        {editable && (
          <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: C.muted }}>Also split by:</span>
            <input aria-label="New dimension" value={newDim} onChange={(e) => setNewDim(e.target.value)} placeholder="e.g. State" style={{ ...input, width: 140 }} />
            <button style={quiet} disabled={!newDim.trim()} onClick={() => {
              const labelText = newDim.trim();
              const key = labelText.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
              if (!key || draft.dimensions.some((d) => d.key === key)) { setErr(`The table is already split by ${labelText}.`); return; }
              change({ ...draft, dimensions: [...draft.dimensions, { key, label: labelText }], rows: draft.rows.map((r) => ({ ...r, at: { ...r.at, [key]: "" } })) }, `Added the ${labelText} dimension`);
              setNewDim("");
            }}>Add</button>
            {draft.dimensions.length > 1 && draft.dimensions.slice(1).map((d) => (
              <button key={d.key} style={{ ...quiet, color: C.red, fontSize: 11 }} onClick={() => {
                if (!window.confirm(`Stop splitting by ${d.label}? Rows that then name the same ${draft.dimensions[0].label.toLowerCase()} will be flagged as duplicates.`)) return;
                change({ ...draft, dimensions: draft.dimensions.filter((x) => x.key !== d.key), rows: draft.rows.map((r) => { const { [d.key]: _gone, ...at } = r.at; void _gone; return { ...r, at }; }) }, `Removed the ${d.label} dimension`);
              }}>Remove “{d.label}”</button>
            ))}
          </div>
        )}
      </div>

      {/* Rows, by post */}
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        {(analysis?.groups ?? []).map((g) => {
          const rows = draft.rows.filter((r) => (r.at[groupDim] ?? "") === g.name);
          const isOpen = open[g.name] ?? draft.rows.length <= 60;
          return (
            <div key={g.name} data-vacancy-group={g.name} style={{ marginBottom: 10 }}>
              <button onClick={() => setOpen((o) => ({ ...o, [g.name]: !isOpen }))} style={{ ...quiet, border: "none", padding: "4px 0", color: C.text, fontWeight: 600 }}>
                {isOpen ? "▾" : "▸"} {g.name || "(no name)"} — {rows.length} row{rows.length === 1 ? "" : "s"}
              </button>
              {isOpen && (
                <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
                  <thead>
                    <tr style={{ color: C.muted, fontSize: 11, textAlign: "left" }}>
                      {draft.dimensions.map((d) => <th key={d.key} style={{ padding: "3px 4px", minWidth: 120 }}>{d.label}</th>)}
                      <th style={{ padding: "3px 4px" }}>Status</th>
                      {cats.map((c) => <th key={c.key} style={{ padding: "3px 4px", minWidth: 52, color: c.kind === "HORIZONTAL" ? C.muted : undefined }}>{c.label}{c.kind === "HORIZONTAL" ? " (of which)" : ""}</th>)}
                      <th style={{ padding: "3px 4px", minWidth: 60 }}>Total</th>
                      <th style={{ padding: "3px 4px" }}>Source</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const off = r.status === "NOT_REPORTED" || r.status === "NO_FIGURE";
                      return [
                        <tr key={r.id} data-row={r.id} style={{ outline: errorRows.has(r.id) ? `1px solid ${C.red}` : "none" }}>
                          {draft.dimensions.map((d) => (
                            <td key={d.key} style={cell}>
                              <input aria-label={`${d.label}`} value={r.at[d.key] ?? ""} disabled={!editable} style={input} onChange={(e) => updateRow(r.id, { at: { ...r.at, [d.key]: e.target.value } })} />
                            </td>
                          ))}
                          <td style={cell}>
                            <select aria-label="Row status" value={r.status} disabled={!editable} style={{ ...input, width: 118 }} onChange={(e) => updateRow(r.id, { status: e.target.value as RowStatus })}>
                              {(Object.keys(STATUS_WORDS) as RowStatus[]).map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
                            </select>
                          </td>
                          {cats.map((c) => (
                            <td key={c.key} style={cell}>
                              <input aria-label={c.label} inputMode="numeric" maxLength={7} disabled={!editable || off} value={r.cells[c.key] ?? ""} style={{ ...input, width: 60, textAlign: "right" }}
                                onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); const { [c.key]: _old, ...rest } = r.cells; void _old; updateRow(r.id, { cells: v === "" ? rest : { ...rest, [c.key]: Number(v) }, ...(v && r.unclear ? { unclear: r.unclear.filter((k) => k !== c.key) } : {}) }); }} />
                            </td>
                          ))}
                          <td style={cell}>
                            <input aria-label="Total" inputMode="numeric" maxLength={7} disabled={!editable || off} value={r.total ?? ""} style={{ ...input, width: 70, textAlign: "right", fontWeight: 600 }}
                              onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); updateRow(r.id, v === "" ? { total: undefined } : { total: Number(v), ...(r.unclear ? { unclear: r.unclear.filter((k) => k !== "total") } : {}) }); }} />
                          </td>
                          <td style={{ ...cell, whiteSpace: "nowrap" }}>
                            <input aria-label="Page" inputMode="numeric" disabled={!editable} value={r.source.page ?? ""} placeholder="page" style={{ ...input, width: 54 }}
                              onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); updateRow(r.id, { source: { ...r.source, page: v ? Number(v) : null } }); }} />
                            {!hasEvidence(r) && <span style={chip(C.amber)} title="No page of a document behind these figures">entered by hand</span>}
                            {r.source.readBy === "AI_IMAGE" && <span style={chip(C.amber)} title="This page had no text: the AI wrote this row out from the page image. Check every figure against the page.">AI-read from image</span>}
                            {r.source.readBy === "PREPARED" && <span style={chip(C.amber)} title="Prepared outside the notice (by an AI, a person or another website) and pasted in: research until checked against the notice's page.">prepared outside</span>}
                            {r.unclear?.length ? <span style={chip(C.red)} title="Printed, but not made out on the scanned page; never filled in">unreadable: {r.unclear.join(", ")}</span> : null}
                            {/* A spelling the AI suggests for a printed name: shown, applied only by the admin; the printed name is kept. */}
                            {Object.entries(r.suggested ?? {}).map(([k, v]) => (
                              <span key={`s-${k}`} style={chip(C.amber)} title={`Printed “${r.at[k]}”. The AI suggests “${v}”: a suggestion, not what the notice prints.`}>
                                AI suggests “{v}”
                                {editable && (
                                  <button aria-label={`Use the suggested spelling ${v}`} style={{ ...quiet, border: "none", padding: "0 4px" }} onClick={() => {
                                    const { [k]: _done, ...rest } = r.suggested ?? {}; void _done;
                                    updateRow(r.id, { at: { ...r.at, [k]: v }, printedAt: { ...(r.printedAt ?? {}), [k]: r.printedAt?.[k] ?? r.at[k] }, suggested: Object.keys(rest).length ? rest : undefined });
                                  }}>use it</button>
                                )}
                              </span>
                            ))}
                            {Object.entries(r.printedAt ?? {}).map(([k, v]) => <span key={`p-${k}`} style={chip(C.muted)} title="The name as printed in the notice, kept after a suggested spelling was applied">printed: {v}</span>)}
                            {r.source.line && <button onClick={() => setSourceOf(sourceOf === r.id ? null : r.id)} style={{ ...quiet, border: "none", padding: "0 4px" }} title={r.source.line}>line</button>}
                          </td>
                          <td style={cell}>
                            {editable && <button aria-label="Remove row" onClick={() => change({ ...draft, rows: draft.rows.filter((x) => x.id !== r.id) }, "Removed a row")} style={{ ...quiet, color: C.red, border: "none" }}>✕</button>}
                          </td>
                        </tr>,
                        sourceOf === r.id ? (
                          <tr key={`${r.id}-src`}><td colSpan={draft.dimensions.length + cats.length + 4} style={{ ...cell, color: C.muted, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap" }}>{isResearchRow(r) ? "As written in the research (not the notice)" : "As printed"}{r.source.page != null ? ` (page ${r.source.page})` : ""}: {r.source.line}</td></tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              )}
              {isOpen && editable && (
                <button style={{ ...quiet, marginTop: 4 }} onClick={() => change({ ...draft, rows: [...draft.rows, {
                  id: newId("m"), at: Object.fromEntries(draft.dimensions.map((d, i) => [d.key, i === 0 ? g.name : ""])), status: "STATED", cells: {},
                  source: { retrievalId: null, page: null, line: "" },
                }] }, "Added a row")}>Add a row to {g.name || "this group"}</button>
              )}
            </div>
          );
        })}
        {editable && (
          <button style={quiet} onClick={() => change({ ...draft, rows: [...draft.rows, {
            id: newId("m"), at: Object.fromEntries(draft.dimensions.map((d) => [d.key, ""])), status: "STATED", cells: {}, source: { retrievalId: null, page: null, line: "" },
          }] }, "Added a row")}>Add a row for another {draft.dimensions[0]?.label.toLowerCase() ?? "post"}</button>
        )}
      </div>

      {/* Totals the notice prints */}
      <div style={{ marginTop: 12, fontSize: 12 }}>
        <div style={{ color: C.muted }}>Totals printed in the notice (kept to check the figures against):</div>
        {draft.statedTotals.length === 0 && <div style={{ color: C.muted }}>None.</div>}
        {draft.statedTotals.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span>{Object.keys(s.at).length === 0 ? "Grand total" : Object.values(s.at).join(", ")}</span>
            <input aria-label="Printed total" inputMode="numeric" disabled={!editable} value={s.total} style={{ ...input, width: 80 }}
              onChange={(e) => change({ ...draft, statedTotals: draft.statedTotals.map((x, j) => (j === i ? { ...x, total: Number(e.target.value.replace(/\D/g, "") || 0) } : x)) }, "Edited a printed total")} />
            <input aria-label="Page of the printed total" inputMode="numeric" disabled={!editable} value={s.source.page ?? ""} placeholder="page" style={{ ...input, width: 54 }}
              onChange={(e) => change({ ...draft, statedTotals: draft.statedTotals.map((x, j) => (j === i ? { ...x, source: { ...x.source, page: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null } } : x)) }, "Edited a printed total")} />
            {editable && <button style={{ ...quiet, color: C.red, border: "none" }} onClick={() => change({ ...draft, statedTotals: draft.statedTotals.filter((_, j) => j !== i) }, "Removed a printed total")}>✕</button>}
          </div>
        ))}
        {editable && (
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button style={quiet} onClick={() => change({ ...draft, statedTotals: [...draft.statedTotals, { at: {}, total: 0, source: { retrievalId: null, page: null, line: "entered by hand" } }] }, "Added a printed grand total")}>Add the notice’s grand total</button>
            {(analysis?.groups ?? []).filter((g) => !draft.statedTotals.some((s) => s.at[groupDim] === g.name)).slice(0, 6).map((g) => (
              <button key={g.name} style={quiet} onClick={() => change({ ...draft, statedTotals: [...draft.statedTotals, { at: { [groupDim]: g.name }, total: 0, source: { retrievalId: null, page: null, line: "entered by hand" } }] }, "Added a printed post total")}>Add the printed total for {g.name}</button>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      {editable ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <button style={primary} disabled={!dirty || saving || shape.length > 0} onClick={() => { void save(draft, changes.length === 1 ? changes[0] : `Vacancy table: ${[...new Set(changes)].join("; ")}`.slice(0, 480)); }}>
            {saving ? "Saving…" : "Save table"}
          </button>
          {dirty && <button style={{ ...quiet, color: C.muted }} onClick={() => { setDraft(saved); setChanges([]); setErr(null); }}>Discard changes</button>}
          <button style={quiet} onClick={() => setPasting(true)}>Paste more rows</button>
          {dirty && <span style={{ fontSize: 12, color: C.amber }}>Not saved yet ({changes.length} change{changes.length === 1 ? "" : "s"}).</span>}
          {saved && !dirty && (
            <button style={{ ...quiet, color: C.red, marginLeft: "auto" }} onClick={() => {
              if (window.confirm("Stop using the vacancy table? Total Vacancies and the breakdown keep their current figures, as entered by hand.")) void save(null, "Removed the vacancy table");
            }}>Stop using the table</button>
          )}
          {!saved && !dirty && null}
        </div>
      ) : <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>Click “Edit Record” to change the table.</div>}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Saving works out Total Vacancies and the post-wise breakdown again from these rows; checks of them reopen.</div>
      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
      {note && <div role="status" style={{ color: C.green, fontSize: 12, marginTop: 8 }}>{note}</div>}
      {pasting && <PastePanel table={draft} onClose={() => setPasting(false)} onAdd={(t, s) => { change(t, s); setPasting(false); }} />}
    </div>
  );
}
