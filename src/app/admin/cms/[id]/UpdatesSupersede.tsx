"use client";
// ═══════════════════════════════════════════════════════════
// Official updates: mark announcements superseded, or current again
// ═══════════════════════════════════════════════════════════
//
// Inside the editor's existing Official updates section (no separate page).
// Tick the outdated announcements, say what replaces them (a newer
// announcement of this job, or the official notice) and why, and save. The
// change waits in the job like any other edit and goes live only with the
// owner's reviewed publish. Restore undoes it the same way. Nothing here
// creates, deletes or rewrites an announcement's text, and nothing is posted.

import React, { useState } from "react";
import type { UpdateRecord } from "@/types";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { currentUpdates, updatesFingerprint, replacementOf } from "@/lib/cms/announcements";

const C = { text: "#e2e8f0", muted: "#8c9bb8", accent: "#62b5ff", amber: "#f59e0b", red: "#f87171", border: "#1c2740", bg: "#070b16" };
const input: React.CSSProperties = { width: "100%", padding: "7px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontSize: 13, boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "5px 12px", background: "none", border: `1px solid ${C.accent}55`, color: C.accent, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer" };

export function UpdatesSupersede({ record, renderCard, onSaved }: {
  record: RecruitmentRecord;
  renderCard: (u: UpdateRecord) => React.ReactNode;
  onSaved: (r: RecruitmentRecord) => void;
}) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const updates = record.updates ?? [];
  const current = currentUpdates(updates);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<null | { action: "supersede" } | { action: "restore"; id: string }>(null);
  const [replacedBy, setReplacedBy] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const candidates = [...current].filter((u) => !picked.has(u.id)).sort((a, b) => b.date.localeCompare(a.date));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reset = () => { setOpen(null); setPicked(new Set()); setReplacedBy(""); setSourceUrl(""); setReason(""); setErr(null); };

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/cms/records/${record.id}/updates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expected: updatesFingerprint(updates) }),
      });
      const data = await res.json() as { record?: RecruitmentRecord; error?: string };
      if (!res.ok || !data.record) { setErr(data.error ?? `Failed: HTTP ${res.status}`); return; }
      onSaved(data.record);
      reset();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-updates-supersede>
      {editable && current.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.muted }}>Tick announcements that newer verified information has replaced.</span>
          <button type="button" data-open-supersede disabled={picked.size === 0} onClick={() => { setOpen({ action: "supersede" }); setReplacedBy(candidates[0]?.id ?? ""); }}
            style={{ ...btn, opacity: picked.size === 0 ? 0.5 : 1, cursor: picked.size === 0 ? "not-allowed" : "pointer" }}>
            Mark superseded{picked.size > 0 ? ` (${picked.size})` : ""}
          </button>
        </div>
      )}

      {open && (
        <div data-supersede-form style={{ border: `1px solid ${C.amber}55`, borderRadius: 6, padding: 12, marginBottom: 12, background: C.bg }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            {open.action === "supersede" ? `Mark ${picked.size} announcement${picked.size === 1 ? "" : "s"} superseded` : "Make this announcement current again"}
          </div>
          {open.action === "supersede" && (
            <>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }} htmlFor="su-replaced-by">Replaced by</label>
              <select id="su-replaced-by" style={input} value={replacedBy} onChange={(e) => setReplacedBy(e.target.value)}>
                {candidates.map((u) => <option key={u.id} value={u.id}>{u.date}: {u.title}</option>)}
                <option value="">An official notice (address below)</option>
              </select>
              {!replacedBy && (
                <input aria-label="Official notice address" style={{ ...input, marginTop: 6 }} type="url" value={sourceUrl} placeholder="https://… the official notice with the correct information" onChange={(e) => setSourceUrl(e.target.value)} />
              )}
            </>
          )}
          <label style={{ fontSize: 12, color: C.muted, display: "block", margin: "8px 0 4px" }} htmlFor="su-reason">Reason (kept in the job&apos;s history, never shown publicly)</label>
          <input id="su-reason" style={input} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          {err && <div data-supersede-error style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" data-save-supersede disabled={busy} style={{ ...btn, borderColor: C.amber, color: C.amber }}
              onClick={() => { void send(open.action === "supersede"
                ? { action: "supersede", ids: [...picked], reason, ...(replacedBy ? { replacedBy } : { sourceUrl }) }
                : { action: "restore", ids: [open.id], reason }); }}>
              {busy ? "Saving…" : "Save (goes live with your next publish)"}
            </button>
            <button type="button" onClick={reset} style={{ ...btn, borderColor: C.border, color: C.muted }}>Cancel</button>
          </div>
        </div>
      )}

      {[...updates].reverse().map((u) => {
        const replacement = replacementOf(u, updates);
        return (
          <div key={u.id} data-update-row={u.id} data-superseded={u.superseded ? "true" : undefined} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {editable && !u.superseded && (
              <input type="checkbox" aria-label={`Select “${u.title}”`} checked={picked.has(u.id)} onChange={() => toggle(u.id)} style={{ marginTop: 14 }} />
            )}
            <div style={{ flex: 1, minWidth: 0, opacity: u.superseded ? 0.55 : 1 }}>
              {u.superseded && (
                <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, marginBottom: 2 }}>
                  Superseded on {u.superseded.on}
                  {replacement ? ` by “${replacement.title}”` : u.superseded.sourceUrl ? " by an official notice" : ""} · not shown as current
                  {editable && (
                    <button type="button" data-restore={u.id} onClick={() => { setPicked(new Set()); setOpen({ action: "restore", id: u.id }); setReason(""); setErr(null); }}
                      style={{ marginLeft: 8, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 11, padding: 0 }}>
                      Restore
                    </button>
                  )}
                  <div style={{ color: C.muted, fontWeight: 400 }}>Reason: {u.superseded.reason}</div>
                </div>
              )}
              {renderCard(u)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
