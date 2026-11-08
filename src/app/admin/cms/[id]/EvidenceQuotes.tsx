"use client";

// ═══════════════════════════════════════════════════════════
// Admin: the source's words behind a field
// ═══════════════════════════════════════════════════════════
//
// AI Assist keeps, for every value it fills or suggests, the quote from the
// source that backs it (see lib/cms/assist-evidence.ts). Here those quotes are
// loaded once per record and shown:
//
//   - beside a field, behind a small "Source words" toggle;
//   - in full in the record's Sources section.
//
// A quote only says what the source said when AI Assist read it. The field
// may have been changed since; the admin compares and verifies.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const C = { border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8", accent: "#62b5ff", bg: "#070b16" };

export interface EvidenceRow {
  id: string;
  url: string;
  title: string | null;
  sourceType: string;
  fetchedAt: string;
  excerpts: Array<{ fieldPath?: string; quote?: string; outcome?: string } | string>;
}

export interface FieldQuote { quote: string; source: string; url: string; at: string }

/** A document Smart intake brought in for the job, as stored with its import (never re-checked here). */
export interface ImportedDoc {
  id: string; name: string; declaredKind: string; method: string; originUrl: string | null; authenticity: string;
  retrievedAt: string; contentKind: string; pageCount: number | null; versionLabel: string | null; documentDate: string | null;
}

const Ctx = createContext<{ rows: EvidenceRow[]; docs: ImportedDoc[]; byField: Map<string, FieldQuote[]> }>({ rows: [], docs: [], byField: new Map() });

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function EvidenceProvider({ recordId, revision, children }: { recordId: string; revision: string; children: React.ReactNode }) {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [docs, setDocs] = useState<ImportedDoc[]>([]);
  useEffect(() => {
    let alive = true;
    // The documents Smart intake brought in, as kept with each import (nothing when the job was not imported).
    fetch(`/api/admin/cms/records/${recordId}/checks`)
      .then((r) => (r.ok ? r.json() : { retrievals: [] }))
      .then((d) => { if (alive) setDocs(Array.isArray(d.retrievals) ? d.retrievals : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [recordId, revision]);
  useEffect(() => {
    let alive = true;
    // Looked up again after each save: AI Assist may just have added quotes.
    fetch(`/api/admin/cms/records/${recordId}/evidence`)
      .then((r) => (r.ok ? r.json() : { evidence: [] }))
      .then((d) => { if (alive) setRows(d.evidence ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [recordId, revision]);

  const byField = useMemo(() => {
    const map = new Map<string, FieldQuote[]>();
    for (const row of rows) {
      for (const e of row.excerpts) {
        if (typeof e !== "object" || !e.fieldPath || !e.quote) continue;
        const list = map.get(e.fieldPath) ?? [];
        if (!list.some((q) => q.quote === e.quote)) list.push({ quote: e.quote, source: row.title ?? row.url, url: row.url, at: row.fetchedAt });
        map.set(e.fieldPath, list);
      }
    }
    return map;
  }, [rows]);

  return <Ctx.Provider value={{ rows, docs, byField }}>{children}</Ctx.Provider>;
}

/** A "Source words" toggle for one field; nothing when no quote is kept for it. */
export function FieldQuotes({ fieldPath, block = false }: { fieldPath: string; block?: boolean }) {
  const { byField } = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const quotes = byField.get(fieldPath) ?? [];
  if (quotes.length === 0) return null;
  return (
    <span style={{ display: block ? "block" : "inline", marginLeft: block ? 0 : 8, marginBottom: block ? 12 : 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="The words in the source that AI Assist read this value from"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.accent, fontSize: 11 }}
      >
        ❝ Source words{quotes.length > 1 ? ` (${quotes.length})` : ""} {open ? "▾" : "▸"}
      </button>
      {open && (
        <span style={{ display: "block", marginTop: 6, padding: "8px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, lineHeight: 1.5, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          {quotes.slice(0, 12).map((q, i) => (
            <span key={i} style={{ display: "block", marginBottom: 6 }}>
              <span style={{ color: C.text }}>“{q.quote}”</span>
              <span style={{ display: "block", color: C.muted, fontSize: 11 }}>
                read by AI Assist on {when(q.at)} from <a href={q.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, wordBreak: "break-all" }}>{q.source}</a>
              </span>
            </span>
          ))}
          <span style={{ display: "block", color: C.muted, fontSize: 11 }}>What the source said when it was read. Compare it with the value before marking the field Verified.</span>
        </span>
      )}
    </span>
  );
}

const SOURCE_TYPES: Record<string, string> = {
  AI_ASSIST: "Read by AI Assist",
  OFFICIAL: "Official source (found by the old automatic intake)",
  SECONDARY: "Other source (found by the old automatic intake)",
};

const DECLARED: Record<string, string> = {
  OFFICIAL_NOTIFICATION: "Official notification", OFFICIAL_CORRIGENDUM: "Official corrigendum", OFFICIAL_PAGE: "Official web page",
  RESEARCH: "Research (not official evidence)", OTHER: "Other document",
};
const STANDING: Record<string, string> = {
  CONFIRMED: "confirmed as the official document",
  ATTESTED: "attested by an admin as downloaded or copied by hand",
  UNCONFIRMED: "not confirmed as official",
  NOT_APPLICABLE: "not checked (research)",
};
const HOW: Record<string, string> = { FETCHED: "fetched from its address by the server", UPLOADED: "uploaded", PASTED: "pasted" };

/** The documents Smart intake brought in for this job. */
function ImportedDocs({ docs }: { docs: ImportedDoc[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: C.muted }}>Documents brought in by Smart intake ({docs.length})</div>
      {docs.map((d) => (
        <div key={d.id} data-imported-doc style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13, color: C.text }}>{d.name}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
            {DECLARED[d.declaredKind] ?? d.declaredKind} · {HOW[d.method] ?? d.method} · {STANDING[d.authenticity] ?? d.authenticity}
            {d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? "" : "s"}` : ""} · brought in {when(d.retrievedAt)}
            {d.documentDate ? ` · dated ${d.documentDate}` : ""}
          </div>
          {d.originUrl && (
            <a href={d.originUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 12, wordBreak: "break-all" }}>{d.originUrl}</a>
          )}
        </div>
      ))}
    </div>
  );
}

/** Every source kept for the record: the documents Smart intake brought in, and AI Assist's quotes field by field. */
export function EvidenceList({ labelFor }: { labelFor: (fieldPath: string) => string }) {
  const { rows, docs } = useContext(Ctx);
  if (rows.length === 0 && docs.length === 0) {
    return (
      <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
        No sources are kept for this record. Documents brought in by Smart intake, and the words each AI Assist run read every value from,
        appear here.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {docs.length > 0 && <ImportedDocs docs={docs} />}
      {docs.length > 0 && rows.length > 0 && <div style={{ fontSize: 12, color: C.muted }}>Read by AI Assist</div>}
      {rows.map((row) => (
        <div key={row.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, color: C.muted }}>{SOURCE_TYPES[row.sourceType] ?? row.sourceType} · {when(row.fetchedAt)}</div>
          <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 13, wordBreak: "break-all" }}>{row.title ?? row.url}</a>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {row.excerpts.map((e, i) =>
              typeof e === "string" ? (
                <div key={i} style={{ fontSize: 12, color: C.text }}>“{e}”</div>
              ) : (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: C.muted }}>{e.fieldPath ? labelFor(e.fieldPath) : "—"}{e.outcome === "suggested" ? " (suggested)" : ""}: </span>
                  <span style={{ color: C.text }}>“{e.quote}”</span>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
