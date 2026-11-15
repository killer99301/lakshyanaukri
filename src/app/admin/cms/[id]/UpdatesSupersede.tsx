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
// "Correct details" (15 Nov 2026) sets, corrects or clears one announcement's
// "relevant until" and kind, the same way: saved into the job, public only
// after the reviewed publish (announcement-correction.ts).

import React, { useState } from "react";
import type { UpdateRecord } from "@/types";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { currentUpdates, updatesFingerprint, replacementOf } from "@/lib/cms/announcements";
import { EVENT_KINDS, describeKind, metaOf, type AnnouncementMeta } from "@/lib/cms/announcement-correction";
import { statusOfKind } from "@/lib/important-update";
import { formatDate } from "@/lib/utils";

const todayIndia = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

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
  const [open, setOpen] = useState<null | { action: "supersede" } | { action: "restore"; id: string } | { action: "correct"; id: string; was: AnnouncementMeta }>(null);
  const [fix, setFix] = useState<AnnouncementMeta>({ relevantUntil: "", eventKind: "", eventStage: "" });
  const stageNames = (record.examStages ?? []).map((s) => s.name).filter(Boolean);
  const [replacedBy, setReplacedBy] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const candidates = [...current].filter((u) => !picked.has(u.id)).sort((a, b) => b.date.localeCompare(a.date));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reset = () => { setOpen(null); setPicked(new Set()); setReplacedBy(""); setSourceUrl(""); setReason(""); setErr(null); };
  const openCorrect = (u: UpdateRecord) => { setPicked(new Set()); setReason(""); setErr(null); setFix(metaOf(u)); setOpen({ action: "correct", id: u.id, was: metaOf(u) }); };
  const correcting = open?.action === "correct" ? updates.find((u) => u.id === open.id) : undefined;

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
            {open.action === "supersede" ? `Mark ${picked.size} announcement${picked.size === 1 ? "" : "s"} superseded`
              : open.action === "correct" ? `Correct the details of “${correcting?.title ?? ""}”` : "Make this announcement current again"}
          </div>
          {open.action === "correct" && correcting && (
            <div data-correct-form>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                Its title, text, date and source stay exactly as they are. No new announcement is made.
              </div>
              <label style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 4 }} htmlFor="co-until">Relevant until (the last day the notice matters; leave empty if the notice gives none)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input id="co-until" data-correct-until type="date" style={{ ...input, width: "auto", colorScheme: "dark" }} value={fix.relevantUntil} min={correcting.date.slice(0, 10)}
                  onChange={(e) => setFix((f) => ({ ...f, relevantUntil: e.target.value }))} />
                {fix.relevantUntil && (
                  <button type="button" data-correct-clear-until onClick={() => setFix((f) => ({ ...f, relevantUntil: "" }))} style={{ ...btn, borderColor: C.border, color: C.muted }}>Clear</button>
                )}
              </div>
              <label style={{ fontSize: 12, color: C.muted, display: "block", margin: "8px 0 4px" }} htmlFor="co-kind">Kind</label>
              <select id="co-kind" data-correct-kind style={input} value={fix.eventKind} onChange={(e) => setFix((f) => ({ ...f, eventKind: e.target.value, eventStage: e.target.value ? f.eventStage : "" }))}>
                <option value="">Not set: guessed from its words</option>
                {EVENT_KINDS.map((k) => <option key={k} value={k}>{statusOfKind(k)}</option>)}
              </select>
              <label style={{ fontSize: 12, color: C.muted, display: "block", margin: "8px 0 4px" }} htmlFor="co-stage">Exam stage it is about</label>
              <select id="co-stage" data-correct-stage style={input} value={fix.eventStage} disabled={!fix.eventKind} onChange={(e) => setFix((f) => ({ ...f, eventStage: e.target.value }))}>
                <option value="">None or not one stage</option>
                {[...new Set([...stageNames, ...(open.was.eventStage ? [open.was.eventStage] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <div data-correct-effect style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>
                {fix.relevantUntil && fix.relevantUntil < todayIndia()
                  ? `After your next publish it is no longer shown as current: listed as Closed, out of Important now and the job page's banner.`
                  : fix.relevantUntil
                    ? `Shown as current until ${formatDate(fix.relevantUntil)}, then Closed.`
                    : `With no date it stays current until a newer notice replaces it (or its stage ends, for an admit card or exam date).`}
              </div>
            </div>
          )}
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
                : open.action === "correct"
                  ? { action: "correct", id: open.id, set: fix, was: open.was, reason }
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
              {!u.superseded && (
                <div data-update-meta={u.id} style={{ fontSize: 11, color: C.muted, margin: "-4px 0 10px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span>Kind: {describeKind(u)}</span>
                  <span>Relevant until: {u.relevantUntil ? formatDate(u.relevantUntil) : "not set"}</span>
                  {editable && (
                    <button type="button" data-correct={u.id} onClick={() => openCorrect(u)}
                      style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 11, padding: 0 }}>
                      Correct details
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
