"use client";

// ═══════════════════════════════════════════════════════════
// Admin: take a live job off the website, and put it back
// ═══════════════════════════════════════════════════════════
//
// Not a delete and not "Open for editing": the job disappears from every
// public page at once, while the record, its published versions and its
// history stay. Putting it back shows the version visitors last saw; edits
// made since stay in the draft until they are published the usual way.
// Neither step posts anything to Telegram.

import { useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";

const C = { card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8", accent: "#62b5ff", red: "#f85149", green: "#3fb950", bg: "#0b1222" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Whether the job is on the website now, so it can be taken off. */
export const canTakeDown = (r: RecruitmentRecord) => Boolean(r.lastPublishedRevision) && r.draftState !== "ARCHIVED" && !r.takenDown;

async function post(url: string, body?: unknown): Promise<{ record?: RecruitmentRecord; revalidated?: boolean; error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? data : { error: data.error ?? `HTTP ${res.status}` };
}

/** Side-panel control on a live job: asks for a reason, then takes it off the site. */
export function TakeDownControl({ record, onChange }: { record: RecruitmentRecord; onChange: (r: RecruitmentRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canTakeDown(record)) return null;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const out = await post(`/api/admin/cms/records/${record.id}/take-down`, { reason: reason.trim() });
    setBusy(false);
    if (out.error || !out.record) { setErr(out.error ?? "Something went wrong"); return; }
    setOpen(false);
    setReason("");
    onChange(out.record);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Hide this job from every public page now. The record and its history are kept, and you can put it back."
        style={{ width: "100%", marginTop: 8, padding: "7px 14px", background: "none", color: C.red, border: `1px solid ${C.red}55`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        Take off website
      </button>
    );
  }

  return (
    <div role="dialog" aria-label="Take this job off the website" style={{ marginTop: 8, padding: 12, borderRadius: 8, border: `1px solid ${C.red}66`, background: `${C.red}10`, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Take this job off the website?</div>
      <div style={{ color: C.muted, fontSize: 11, marginBottom: 8 }}>
        It disappears from the job list, search, its own page and the sitemap straight away. Nothing is deleted and nothing is posted to Telegram. You can put it back.
      </div>
      <label style={{ display: "block", fontSize: 11, color: C.muted, marginBottom: 4 }} htmlFor="take-down-reason">Why? (kept in the history)</label>
      <textarea
        id="take-down-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder="e.g. Last date passed in Nov 2025; notice is out of date"
        style={{ width: "100%", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: 6, fontSize: 12, resize: "vertical" }}
      />
      {err && <div role="alert" style={{ color: C.red, fontSize: 11, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => { void submit(); }}
          disabled={busy || reason.trim().length < 3}
          style={{ flex: 1, padding: "6px 10px", background: reason.trim().length < 3 ? "#1c2740" : C.red, color: reason.trim().length < 3 ? C.muted : "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : reason.trim().length < 3 ? "not-allowed" : "pointer" }}
        >
          {busy ? "Taking it off…" : "Take it off now"}
        </button>
        <button
          onClick={() => { setOpen(false); setErr(null); }}
          disabled={busy}
          style={{ padding: "6px 10px", background: "none", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Banner on a job that is off the website: who, when, why, and "Put it back". */
export function TakenDownBanner({ record, onChange }: { record: RecruitmentRecord; onChange: (r: RecruitmentRecord) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = record.takenDown;
  if (!t) return null;

  const putBack = async () => {
    setBusy(true);
    setErr(null);
    const out = await post(`/api/admin/cms/records/${record.id}/put-back`);
    setBusy(false);
    if (out.error || !out.record) { setErr(out.error ?? "Something went wrong"); return; }
    setConfirming(false);
    onChange(out.record);
  };

  const editedSince = record.draftState !== "PUBLISHED";

  return (
    <div role="status" style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.red}66`, background: `${C.red}12`, fontSize: 12, color: C.text, lineHeight: 1.55 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 320px" }}>
          <strong>Off the website.</strong> Visitors cannot see this job anywhere.
          <span style={{ display: "block", color: C.muted }}>
            Taken off {when(t.at)}{t.byName ? ` by ${t.byName}` : ""}. Reason: <span style={{ color: C.text }}>{t.reason}</span>
          </span>
        </span>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            style={{ padding: "6px 14px", background: C.green, color: "#04130c", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Put it back
          </button>
        )}
      </div>
      {confirming && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
          <div>
            Visitors will see the version that was last published, exactly as before it was taken off.
            {editedSince && " Your edits since then stay in the draft and go live only when you publish them."}
            {" "}Nothing is posted to Telegram.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={() => { void putBack(); }}
              disabled={busy}
              style={{ padding: "6px 14px", background: C.green, color: "#04130c", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}
            >
              {busy ? "Putting it back…" : "Yes, put it back"}
            </button>
            <button
              onClick={() => { setConfirming(false); setErr(null); }}
              disabled={busy}
              style={{ padding: "6px 14px", background: "none", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <div role="alert" style={{ color: C.red, fontSize: 11, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
