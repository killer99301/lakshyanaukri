"use client";

// ═══════════════════════════════════════════════════════════
// Admin: checking the whole vacancy table against the notice (Stage C, C3 step 3)
// ═══════════════════════════════════════════════════════════
//
// One whole-table decision (C-D1), in four steps: have the original of each
// official document (step 1), read the table (step 2), look at the marked
// rows (step 3), then name what was compared and confirm (step 4). The server
// judges every document and decides again when the check is sent (C2.1);
// this screen only asks for what it needs, in plain words. Nothing here
// verifies anything by itself: every tick is the reviewer's own declaration.
// Opened afresh (keyed by the table's revision) after any save or a 409.

import { useMemo, useState } from "react";
import { C, badge, inputStyle, labelStyle, quietBtn } from "../import/ui";
import { analyseVacancyTable, type VacancyTable, type VacancyTableRow } from "@/lib/vacancy-table";
import { rowAttention } from "@/lib/cms/importer/row-attention";
import { compareWithImported, fingerprintMessage } from "@/lib/file-fingerprint";
import { assignRows, buildDecision, comparedOfficial, emptyForm, isPageless, requiredPages, stillNeeded, type TableCheckForm, type TableNeeds } from "./table-check-form";

export interface PanelRetrieval { id: string; contentKind: string; originUrl?: string | null; sha256?: string | null }

const box = { border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, display: "grid", gap: 6 } as const;
const stepTitle = { fontWeight: 700, color: C.text } as const;
const small = { fontSize: 11, color: C.muted, lineHeight: 1.45 } as const;

/** What a row's stored line is, said wherever it is shown: never "the notice". */
function lineLabel(r: VacancyTableRow, kind: string | undefined, eligible: boolean | undefined): string {
  if (r.source?.readBy === "PREPARED") return "prepared outside the notice (research): not the notice";
  if (r.source?.readBy === "AI_IMAGE") return "the AI's reading of a page image, not the page: check every name and figure on the page itself";
  if (!r.source?.retrievalId) return r.source?.page != null ? "typed from the notice: check it on the page" : "entered by hand, with no source line";
  if (eligible === false) return "research (a portal, an article or other unofficial text): not the notice";
  if (isPageless(kind)) return "as the server extracted it from the web page or text: it is not the page";
  return "as extracted from the PDF's text: check it on the page";
}

export function TableCheckPanel({ recordId, table, needs, revisionId, decisionId, retrievals, onDone, onCancel }: {
  recordId: string; table: VacancyTable; needs: TableNeeds; revisionId: string | null; decisionId: string | null;
  retrievals: PanelRetrieval[]; onDone: (message?: string) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<TableCheckForm>(() => emptyForm());
  const [fileNote, setFileNote] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<{ rows: string[]; doc: string; page: string }>({ rows: [], doc: "", page: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const docInfo = (id: string | null | undefined) => (id ? needs.documents.find((d) => d.retrievalId === id) ?? null : null);
  const officialKind = (id: string) => needs.official.find((o) => o.retrievalId === id)?.kind;
  const retrieval = (id: string) => retrievals.find((r) => r.id === id);
  const sourceKinds = useMemo(() => Object.fromEntries([...needs.documents.map((d) => [d.retrievalId, d.kind]), ...needs.official.map((o) => [o.retrievalId, o.kind])]), [needs]);
  const attention = useMemo(() => rowAttention(table, { sourceKinds }), [table, sourceKinds]);
  const marked = attention.filter((a) => a.worthALook.length > 0);
  const total = useMemo(() => analyseVacancyTable(table, { sourceKinds }).grandTotal, [table, sourceKinds]);
  const official = comparedOfficial(needs, f);
  const needed = stillNeeded(needs, f, marked.length);
  // Any change to what was compared, or how, asks for the confirmation again.
  const change = (next: Partial<TableCheckForm>) => setF((x) => ({ ...x, ...next, confirm: next.confirm ?? false }));
  const label = (r: VacancyTableRow) => table.dimensions.map((d) => r.at[d.key]).filter(Boolean).join(" › ");

  const onFile = async (id: string, file: File | undefined) => {
    if (!file) return;
    const res = await compareWithImported(file, retrieval(id)?.sha256 ?? null);
    setFileNote((n) => ({ ...n, [id]: fingerprintMessage(res) }));
    change({ sources: { ...f.sources, [id]: res.status === "SAME_BYTES" ? { by: "FILE_HASH", sha256: res.actual } : (f.sources[id]?.by === "OFFICIAL_ADDRESS" ? f.sources[id] : null) } });
  };

  const record = async () => {
    setBusy(true);
    setErr(null);
    const d = buildDecision(needs, f, marked.length);
    const res = await fetch(`/api/admin/cms/records/${recordId}/decisions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "decide", fieldPath: "vacancies.table", kind: "ADMIN_VERIFIED", retrievalId: d.retrievalId, page: d.page, quote: d.quote, reviewScope: d.reviewScope, seen: { revisionId, decisionId } }),
    }).catch(() => null);
    setBusy(false);
    if (!res) { setErr("Not recorded: the connection failed. Try again."); return; }
    if (res.status === 409) { onDone("The table changed while you were checking it. It has been reloaded: look at it again."); return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(body.error ?? `Not recorded (HTTP ${res.status})`); return; }
    onDone();
  };

  const groups = new Map<string, VacancyTableRow[]>();
  for (const r of table.rows) {
    const k = r.source?.readBy === "PREPARED" ? "prepared" : r.source?.retrievalId ?? (r.source?.page != null ? "typed" : "hand");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const groupName = (k: string) => (k === "prepared" ? "Prepared outside the notice" : k === "typed" ? "Typed from the notice" : k === "hand" ? "Entered by hand" : docInfo(k)?.name ?? "A document");
  const attentionOf = (id: string) => attention.find((a) => a.rowId === id);

  return (
    <div data-table-check-panel style={{ border: `1px solid ${C.accent}44`, borderRadius: 8, padding: 12, margin: "8px 0", display: "grid", gap: 10, fontSize: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Check the whole table against the notice</div>
        <div style={small}>
          {table.rows.length} rows{total ? `; total ${total.complete ? "" : "at least "}${total.value.toLocaleString("en-IN")} (${total.basis === "STATED" ? "printed" : total.basis === "CALCULATED" ? "calculated" : "entered"})` : ""}.
          One decision for the whole table. It is your own check: nothing here is verified by the screen.
        </div>
      </div>

      {/* Step 1 */}
      <div data-step="1" style={box}>
        <div style={stepTitle}>1. Have the original of each official document</div>
        {official.length === 0 && <div style={small}>No official document is chosen yet. Choose, in step 4, the official PDF the rows were typed from.</div>}
        {official.map((o) => {
          const r = retrieval(o.retrievalId);
          const src = f.sources[o.retrievalId];
          const pageless = isPageless(o.kind);
          return (
            <div key={o.retrievalId} data-source-doc={o.retrievalId} style={{ display: "grid", gap: 4, paddingBottom: 4, borderBottom: `1px dashed ${C.border}` }}>
              <div><strong>{o.name}</strong> <span style={badge(C.muted)}>{pageless ? "web page or text" : o.kind}</span> {src && <span style={badge(C.green)}>{src.by === "FILE_HASH" ? "your file is the imported file" : "you opened the official address"}</span>}</div>
              {!pageless && r?.sha256 && (
                <label style={small}>A. Your own copy of this file (read on your computer; nothing is uploaded):{" "}
                  <input type="file" aria-label={`Your copy of ${o.name}`} onChange={(e) => { void onFile(o.retrievalId, e.target.files?.[0]); }} />
                </label>
              )}
              {fileNote[o.retrievalId] && <div data-file-note style={small}>{fileNote[o.retrievalId]}</div>}
              {r?.originUrl && (
                <label style={{ ...small, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <input type="checkbox" checked={src?.by === "OFFICIAL_ADDRESS"} onChange={(e) => change({ sources: { ...f.sources, [o.retrievalId]: e.target.checked ? { by: "OFFICIAL_ADDRESS", url: r.originUrl! } : (src?.by === "FILE_HASH" ? src : null) } })} />
                  <span>{pageless ? "" : "B. "}I opened the official notice at <a href={r.originUrl} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{r.originUrl}</a>.
                    {" "}It may now serve a different or newer version{pageless ? "; what is stored is only what the server read when it was imported, not the page. If the page cannot be opened, do not record this check" : "; your own copy (A) is the stronger proof"}.</span>
                </label>
              )}
              {!r?.originUrl && (pageless || !r?.sha256) && <div style={{ ...small, color: C.amber }}>The original cannot be obtained here: there is no address and no file to compare. The stored text is the import&apos;s extraction, not the notice. Bring in the official notice first.</div>}
            </div>
          );
        })}
      </div>

      {/* Step 2 */}
      <div data-step="2" style={box}>
        <div style={stepTitle}>2. Read the table against the original</div>
        {[...groups.entries()].map(([k, rows]) => (
          <div key={k} style={{ display: "grid", gap: 3 }}>
            <div style={{ fontWeight: 600 }}>{groupName(k)} <span style={small}>({rows.length} row{rows.length === 1 ? "" : "s"})</span></div>
            {rows.map((r) => {
              const a = attentionOf(r.id);
              const d = docInfo(r.source?.retrievalId);
              return (
                <div key={r.id} data-check-panel-row={r.id} style={{ display: "grid", gap: 2, paddingLeft: 8 }}>
                  <div>{label(r)}: <strong>{r.status === "NOT_REPORTED" ? "not reported" : r.status === "NO_FIGURE" ? "no figure" : (r.total ?? "—")}</strong>
                    {r.source?.page != null && <span style={small}> · page {r.source.page}</span>}
                    {a?.worthALook.length ? <span style={badge(C.amber)}> worth a look</span> : null}
                    {a?.problems.some((p) => p.severity === "ERROR") ? <span style={badge(C.red)}> problem (found by code)</span> : null}
                  </div>
                  {r.source?.line && <div style={small}>“{r.source.line.replace(/\s+/g, " ").slice(0, 220)}” — {lineLabel(r, d?.kind, d?.eligible)}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Step 3 */}
      <div data-step="3" style={box}>
        <div style={stepTitle}>3. The rows marked “worth a look”</div>
        {marked.length === 0
          ? <div style={small}>No row is marked. This does not mean every row is right: compare the whole table.</div>
          : <>
            <div style={small}>{marked.length} row{marked.length === 1 ? " is" : "s are"} marked. A mark is not a finding that the row is wrong; it is where to look first.</div>
            {marked.map((a) => (
              <div key={a.rowId} data-marked-row={a.rowId} style={{ paddingLeft: 8 }}>
                <strong>{a.label ?? a.rowId}</strong>{a.page != null ? ` (page ${a.page})` : ""}: {a.worthALook.map((w) => w.message).join(" ")}
              </div>
            ))}
            <label style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" checked={f.flaggedAck} onChange={(e) => change({ flaggedAck: e.target.checked })} /> I looked at each of the {marked.length} marked rows in the original notice.
            </label>
          </>}
      </div>

      {/* Step 4 */}
      <div data-step="4" style={box}>
        <div style={stepTitle}>4. What you compared</div>
        {needs.pageOnlyPages.length > 0 && (
          <label><span style={labelStyle}>The official PDF the rows typed from the notice are on (page{needs.pageOnlyPages.length === 1 ? "" : "s"} {needs.pageOnlyPages.join(", ")})</span>
            <select aria-label="Official PDF of the typed rows" value={f.pageOnlyDoc ?? ""} onChange={(e) => change({ pageOnlyDoc: e.target.value || null })} style={inputStyle}>
              <option value="">Choose…</option>
              {needs.official.filter((o) => !isPageless(o.kind)).map((o) => <option key={o.retrievalId} value={o.retrievalId}>{o.name}</option>)}
            </select>
          </label>
        )}
        {official.map((o) => isPageless(o.kind)
          ? (
            <label key={o.retrievalId} data-whole-doc={o.retrievalId} style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" checked={!!f.wholeDoc[o.retrievalId]} onChange={(e) => change({ wholeDoc: { ...f.wholeDoc, [o.retrievalId]: e.target.checked } })} /> I compared the whole of {o.name} (a web page or text has no pages).
            </label>)
          : (
            <div key={o.retrievalId} data-doc-pages={o.retrievalId} style={{ display: "grid", gap: 4 }}>
              <span style={labelStyle}>Pages of {o.name} you compared (every page the table comes from is needed)</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {requiredPages(needs, f, o.retrievalId).map((p) => (
                  <label key={p} style={{ display: "flex", gap: 4, color: C.muted }}>
                    <input type="checkbox" checked={(f.pagesTicked[o.retrievalId] ?? []).includes(p)}
                      onChange={(e) => { const cur = f.pagesTicked[o.retrievalId] ?? []; change({ pagesTicked: { ...f.pagesTicked, [o.retrievalId]: e.target.checked ? [...cur, p] : cur.filter((x) => x !== p) } }); }} /> page {p}
                  </label>
                ))}
              </div>
              <input aria-label={`Other pages of ${o.name}`} value={f.extraPages[o.retrievalId] ?? ""} placeholder="other pages compared, e.g. 3, 4" onChange={(e) => change({ extraPages: { ...f.extraPages, [o.retrievalId]: e.target.value } })} style={inputStyle} />
            </div>))}

        {needs.rowsToMap.length > 0 && (
          <div data-rows-to-map style={{ display: "grid", gap: 4, borderTop: `1px dashed ${C.border}`, paddingTop: 6 }}>
            <span style={labelStyle}>Rows to compare with the official notice ({needs.rowsToMap.length}): research or prepared outside, so they are not evidence by themselves</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={small}>For the rows ticked:</span>
              <select aria-label="Official document for the rows ticked" value={bulk.doc} onChange={(e) => setBulk((b) => ({ ...b, doc: e.target.value }))} style={{ ...inputStyle, width: "auto" }}>
                <option value="">official document…</option>
                {needs.official.map((o) => <option key={o.retrievalId} value={o.retrievalId}>{o.name}</option>)}
              </select>
              {bulk.doc && !isPageless(officialKind(bulk.doc)) && <input aria-label="Page for the rows ticked" value={bulk.page} placeholder="page" onChange={(e) => setBulk((b) => ({ ...b, page: e.target.value.replace(/\D/g, "") }))} style={{ ...inputStyle, width: 70 }} />}
              <button style={quietBtn} disabled={!bulk.doc || bulk.rows.length === 0} onClick={() => { setF((x) => assignRows(needs, x, bulk.rows, bulk.doc, bulk.page ? Number(bulk.page) : null)); setBulk({ rows: [], doc: "", page: "" }); }}>Set for the {bulk.rows.length} ticked</button>
              <span style={small}>This only fills in the document and page: you still confirm the comparison below.</span>
            </div>
            {needs.rowsToMap.map((r) => {
              const m = f.maps[r.rowId];
              const pdfTarget = m && !isPageless(officialKind(m.retrievalId));
              const fixed = r.why === "prepared" && r.claimedPage != null;
              return (
                <div key={r.rowId} data-map-row={r.rowId} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", paddingLeft: 4 }}>
                  <input type="checkbox" aria-label={`Tick ${r.label}`} checked={bulk.rows.includes(r.rowId)} onChange={(e) => setBulk((b) => ({ ...b, rows: e.target.checked ? [...b.rows, r.rowId] : b.rows.filter((x) => x !== r.rowId) }))} />
                  <span><strong>{r.label}</strong> <span style={badge(C.amber)}>{r.why === "prepared" ? "prepared outside" : "research"}</span></span>
                  <span style={small}>compared with</span>
                  <select aria-label={`Official document for ${r.label}`} value={m?.retrievalId ?? ""} onChange={(e) => setF((x) => (e.target.value ? assignRows(needs, x, [r.rowId], e.target.value, m?.page ?? null) : { ...x, maps: { ...x.maps, [r.rowId]: undefined }, confirm: false }))} style={{ ...inputStyle, width: "auto" }}>
                    <option value="">official document…</option>
                    {needs.official.map((o) => <option key={o.retrievalId} value={o.retrievalId}>{o.name}</option>)}
                  </select>
                  {pdfTarget && (fixed
                    ? <span style={small}>page {r.claimedPage} (the page it claims; no other is accepted)</span>
                    : <input aria-label={`Page for ${r.label}`} value={m?.page ?? ""} placeholder="page" onChange={(e) => setF((x) => ({ ...x, maps: { ...x.maps, [r.rowId]: { retrievalId: m!.retrievalId, page: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null } }, confirm: false }))} style={{ ...inputStyle, width: 70 }} />)}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 6, borderTop: `1px dashed ${C.border}`, paddingTop: 6 }}>
          <label><span style={labelStyle}>The words you cite are from</span>
            <select aria-label="Document of the words cited" value={f.quoteDoc} onChange={(e) => change({ quoteDoc: e.target.value, quotePage: "" })} style={inputStyle}>
              <option value="">official document…</option>
              {needs.official.map((o) => <option key={o.retrievalId} value={o.retrievalId}>{o.name}</option>)}
            </select>
          </label>
          {f.quoteDoc && !isPageless(officialKind(f.quoteDoc))
            ? <label><span style={labelStyle}>Page</span><input aria-label="Page of the words cited" value={f.quotePage} onChange={(e) => change({ quotePage: e.target.value.replace(/\D/g, "") })} inputMode="numeric" style={inputStyle} /></label>
            : <span />}
        </div>
        <label><span style={labelStyle}>A line of the table, copied exactly from the notice (its heading or a row)</span>
          <textarea aria-label="Words cited" rows={2} value={f.quote} onChange={(e) => change({ quote: e.target.value })} placeholder="Copy them from the notice" style={{ ...inputStyle, resize: "vertical" }} />
        </label>
        <label data-final-confirm style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <input type="checkbox" checked={f.confirm} onChange={(e) => setF((x) => ({ ...x, confirm: e.target.checked }))} />
          <span>I compared every row, label and figure of this table with the original notice{official.length ? ` (${official.map((o) => o.name).join("; ")})` : ""}{needs.rowsToMap.length ? `, including the ${needs.rowsToMap.length} research or prepared row${needs.rowsToMap.length === 1 ? "" : "s"} with the pages chosen above` : ""}. I am recording that the whole table matches it.</span>
        </label>
      </div>

      {needed.length > 0 && <div data-still-needed style={small}>Still needed: {needed.join("; ")}.</div>}
      {err && <div role="alert" style={{ color: C.red }}>{err}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button data-record-table-check onClick={() => { void record(); }} disabled={busy || needed.length > 0} style={{ ...quietBtn, borderColor: C.green, color: C.green }}>{busy ? "Recording…" : "Record the check"}</button>
        <button onClick={onCancel} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Cancel</button>
      </div>
    </div>
  );
}
