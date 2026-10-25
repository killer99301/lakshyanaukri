"use client";

// ═══════════════════════════════════════════════════════════
// Admin: "Check before publishing" for an imported job
// ═══════════════════════════════════════════════════════════
//
// Shown only on jobs that have had an import applied. Lists every critical
// field with its class and lets a person record, against one document:
// verified (page + exact words), not applicable (the words that say so),
// or not stated (what was read). Each decision is bound to the field's
// current revision; any later change to the field reopens it. Publishing is
// refused on the server until Tier A fields are verified or not applicable
// and Tier B fields are also allowed "not stated".

import { useCallback, useEffect, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { C, PANEL, CLASS_LOOK, badge, inputStyle, labelStyle, quietBtn, showValue } from "../import/ui";

interface Row {
  fieldPath: string; label: string; cls: string; reason: string; tier?: "A" | "B";
  value: unknown; latestRevisionId: string | null; decisionId?: string;
}
interface Retrieval {
  id: string; declaredKind: string; versionLabel: string | null; originHost: string | null; originRole: string;
  authenticity: string; contentKind: string; pageCount: number | null;
}
interface Checks { imported: boolean; ok: boolean; rows: Row[]; retrievals: Retrieval[] }
type Kind = "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED";

const docName = (r: Retrieval) =>
  `${r.originHost ?? "document"} — ${r.versionLabel ?? r.declaredKind.replace("OFFICIAL_", "").toLowerCase().replace(/_/g, " ")} (${r.authenticity.toLowerCase()}${r.originRole === "PARTNER" ? ", partner" : ""})`;

function DecisionForm({ recordId, row, kind, retrievals, onDone, onCancel }: {
  recordId: string; row: Row; kind: Kind; retrievals: Retrieval[]; onDone: () => void; onCancel: () => void;
}) {
  const eligible = retrievals.filter((r) => (r.authenticity === "CONFIRMED" || r.authenticity === "ATTESTED")
    && (kind === "ADMIN_NOT_STATED" ? r.originRole === "AUTHORITY" : r.originRole === "AUTHORITY" || r.originRole === "PARTNER"));
  const [retrievalId, setRetrievalId] = useState(eligible[0]?.id ?? "");
  const [page, setPage] = useState("");
  const [quote, setQuote] = useState("");
  const [whole, setWhole] = useState(true);
  const [pages, setPages] = useState("");
  const [justification, setJustification] = useState("");
  const [publicNote, setPublicNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const doc = eligible.find((r) => r.id === retrievalId);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = {
      action: "decide", fieldPath: row.fieldPath, kind, retrievalId,
      seen: { revisionId: row.latestRevisionId, decisionId: row.decisionId ?? null },
    };
    if (page) body.page = Number(page);
    if (kind !== "ADMIN_NOT_STATED") body.quote = quote;
    if (kind !== "ADMIN_VERIFIED") { body.justification = justification; if (publicNote) body.publicNote = publicNote; }
    if (kind === "ADMIN_NOT_STATED") {
      body.reviewScope = whole ? { whole_document: true } : { pages: pages.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) };
    }
    const res = await fetch(`/api/admin/cms/records/${recordId}/decisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    onDone();
  };

  if (eligible.length === 0) {
    return (
      <div style={{ fontSize: 12, color: C.amber, padding: "8px 0" }}>
        No document brought in for this job can support this: it needs a confirmed or attested document from {kind === "ADMIN_NOT_STATED" ? "the recruiting body itself" : "the recruiting body or a listed partner"}. Import the official notice first.
        <button onClick={onCancel} style={{ ...quietBtn, marginLeft: 8, padding: "2px 8px" }}>Close</button>
      </div>
    );
  }
  const title = { ADMIN_VERIFIED: "Checked against the official document", ADMIN_NOT_APPLICABLE: "Not applicable to this job", ADMIN_NOT_STATED: "The notice does not state this" }[kind];
  return (
    <div data-decision-form style={{ border: `1px solid ${C.accent}44`, borderRadius: 8, padding: 10, margin: "6px 0 10px", display: "grid", gap: 8, fontSize: 12 }}>
      <strong style={{ color: C.text }}>{title}</strong>
      <label><span style={labelStyle}>Document</span>
        <select value={retrievalId} onChange={(e) => setRetrievalId(e.target.value)} style={inputStyle}>
          {eligible.map((r) => <option key={r.id} value={r.id}>{docName(r)}</option>)}
        </select>
      </label>
      {kind !== "ADMIN_NOT_STATED" && (
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8 }}>
          <label><span style={labelStyle}>Page{doc?.contentKind === "PDF" ? " (required)" : ""}</span>
            <input value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))} inputMode="numeric" style={inputStyle} />
          </label>
          <label><span style={labelStyle}>The exact words in the document</span>
            <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Copy them from the PDF" />
          </label>
        </div>
      )}
      {kind === "ADMIN_NOT_STATED" && (
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ display: "flex", gap: 6, color: C.muted }}><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> I read the whole document</label>
          {!whole && <label><span style={labelStyle}>Pages read</span><input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1, 2, 3" style={inputStyle} /></label>}
        </div>
      )}
      {kind !== "ADMIN_VERIFIED" && (
        <>
          <label><span style={labelStyle}>Why (kept in the history)</span><input value={justification} onChange={(e) => setJustification(e.target.value)} style={inputStyle} placeholder={kind === "ADMIN_NOT_STATED" ? "e.g. Vacancies are not given; the notice says they will be notified later" : "e.g. The notice says no application fee is charged"} /></label>
          <label><span style={labelStyle}>Words for the public page (optional)</span><input value={publicNote} onChange={(e) => setPublicNote(e.target.value)} maxLength={160} style={inputStyle} placeholder={kind === "ADMIN_NOT_STATED" ? "Vacancies will be notified later" : "No application fee"} /></label>
        </>
      )}
      {err && <div role="alert" style={{ color: C.red }}>{err}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => { void submit(); }} disabled={busy || !retrievalId} style={{ ...quietBtn, borderColor: C.green, color: C.green }}>{busy ? "Saving…" : "Record"}</button>
        <button onClick={onCancel} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Cancel</button>
      </div>
    </div>
  );
}

export interface ImportCheckState { toCheck: number; checked: string[] }
const checkState = (c: Checks): ImportCheckState => ({
  toCheck: c.imported && !c.ok ? c.rows.filter((r) => !(r.cls === "VERIFIED" || r.cls === "NOT_APPLICABLE" || (r.cls === "NOT_STATED" && r.tier === "B"))).length : 0,
  checked: c.imported ? c.rows.filter((r) => r.cls === "VERIFIED").map((r) => r.fieldPath) : [],
});

export function ImportChecksPanel({ record, onRecordChange, onChecks }: {
  record: RecruitmentRecord;
  onRecordChange: (r: RecruitmentRecord) => void;
  /** How many imported fields still need a person's check, and which are checked. */
  onChecks?: (s: ImportCheckState) => void;
}) {
  const [checks, setChecks] = useState<Checks | null>(null);
  const [open, setOpen] = useState<{ path: string; kind: Kind } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/cms/records/${record.id}/checks`);
    if (res.ok) { const d: Checks = await res.json(); setChecks(d); onChecks?.(checkState(d)); }
  }, [record.id, onChecks]);
  // Reload whenever the job changes (any save can reopen a field).
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/cms/records/${record.id}/checks`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setChecks(d); onChecks?.(checkState(d)); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [record.id, record.recordRevision, record.updatedAt, onChecks]);

  const refresh = async () => {
    setOpen(null);
    await load();
    const r = await fetch(`/api/admin/cms/records/${record.id}`);
    if (r.ok) { const d = await r.json(); onRecordChange(d.record ?? d); }
  };
  const revoke = async (row: Row) => {
    setErr(null);
    const res = await fetch(`/api/admin/cms/records/${record.id}/decisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke", fieldPath: row.fieldPath, decisionId: row.decisionId }) });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`); return; }
    await refresh();
  };

  if (!checks || !checks.imported) return null;
  const blockers = checks.rows.filter((r) => !(r.cls === "VERIFIED" || r.cls === "NOT_APPLICABLE" || (r.cls === "NOT_STATED" && r.tier === "B")));

  return (
    // Typing here is not an edit of the job (each check is sent by its own
    // button), so it must not set off the page's "not saved" warning.
    <section data-import-checks aria-label="Check before publishing" onInput={(e) => e.stopPropagation()} style={{ ...PANEL, padding: "14px 18px", marginBottom: 16, fontSize: 12, color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {checks.ok ? "Checked — ready to publish" : `Check before publishing — ${blockers.length} field${blockers.length === 1 ? "" : "s"} to go`}
        </div>
        <span style={{ color: C.muted, fontSize: 11 }}>This job was imported, so a person must check each of these against the official document.</span>
      </div>
      {err && <div role="alert" style={{ color: C.red, marginTop: 6 }}>{err}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
        <tbody>
          {checks.rows.map((row) => {
            const look = CLASS_LOOK[row.cls] ?? { label: row.cls, color: C.muted };
            const blocking = blockers.includes(row);
            return [
              <tr key={row.fieldPath} data-check-row={row.fieldPath} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: "top" }}>
                <td style={{ padding: "7px 8px 7px 0", whiteSpace: "nowrap" }}>
                  <span style={{ color: blocking ? C.text : C.muted, fontWeight: blocking ? 700 : 400 }}>{row.label}</span>
                  {row.tier && <span style={{ color: C.muted, fontSize: 10 }}> · Tier {row.tier}</span>}
                </td>
                <td style={{ padding: "7px 8px 7px 0" }}><span style={badge(look.color)}>{look.label}</span></td>
                <td style={{ padding: "7px 8px 7px 0", color: C.muted, whiteSpace: "pre-wrap", maxWidth: 320, overflowWrap: "anywhere" }}>{row.value === null || row.value === undefined ? "—" : showValue(row.value)}</td>
                <td style={{ padding: "7px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                  {editable && (
                    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {row.value !== null && row.value !== undefined && row.cls !== "VERIFIED" && (
                        <button onClick={() => setOpen({ path: row.fieldPath, kind: "ADMIN_VERIFIED" })} style={{ ...quietBtn, padding: "2px 8px" }}>Verify</button>
                      )}
                      {row.cls !== "NOT_APPLICABLE" && <button onClick={() => setOpen({ path: row.fieldPath, kind: "ADMIN_NOT_APPLICABLE" })} style={{ ...quietBtn, padding: "2px 8px", color: C.muted, borderColor: C.border }}>Not applicable</button>}
                      {row.cls !== "NOT_STATED" && <button onClick={() => setOpen({ path: row.fieldPath, kind: "ADMIN_NOT_STATED" })} style={{ ...quietBtn, padding: "2px 8px", color: C.muted, borderColor: C.border }}>Not stated</button>}
                      {row.decisionId && <button onClick={() => { void revoke(row); }} style={{ ...quietBtn, padding: "2px 8px", color: C.red, borderColor: `${C.red}55` }}>Withdraw</button>}
                    </span>
                  )}
                </td>
              </tr>,
              open && open.path === row.fieldPath ? (
                <tr key={`${row.fieldPath}-form`}><td colSpan={4}>
                  <DecisionForm recordId={record.id} row={row} kind={open.kind} retrievals={checks.retrievals} onDone={() => { void refresh(); }} onCancel={() => setOpen(null)} />
                </td></tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {!editable && <div style={{ color: C.muted, marginTop: 8 }}>Open the job for editing to record checks.</div>}
    </section>
  );
}
