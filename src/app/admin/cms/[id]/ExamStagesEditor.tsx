"use client";

// ═══════════════════════════════════════════════════════════
// Admin: exam stages editor
// ═══════════════════════════════════════════════════════════
//
// The ordered stages after the application window (Tier-I, Tier-II, document
// verification…). The same list feeds the public dates table, the timeline and
// "What's next". Every save goes through the normal field route, so it is
// validated on the server and recorded in the change history.
//
// Nothing is filled in for the admin: a stage with no announced date is saved
// with no date.

import { useState } from "react";
import type { ExamStage, ExamStageStatus, DateCertainty } from "@/types";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { InfoTip } from "../InfoTip";

const C = {
  bg: "#070b16", border: "#1c2740", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", green: "#3fb950", amber: "#d29922", red: "#f85149",
};

const STATUS_OPTIONS: Array<{ value: ExamStageStatus; label: string; color: string }> = [
  { value: "NOT_DECLARED",    label: "Date not announced",  color: C.muted },
  { value: "SCHEDULED",       label: "Scheduled",           color: C.accent },
  { value: "ADMIT_CARD_OUT",  label: "Admit card released", color: C.amber },
  { value: "CONDUCTED",       label: "Held",                color: C.green },
  { value: "RESULT_DECLARED", label: "Result declared",     color: C.green },
  { value: "POSTPONED",       label: "Postponed",           color: C.red },
];
const statusOf = (s: ExamStageStatus) => STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0];

interface Draft {
  name: string;
  status: ExamStageStatus;
  dateIso: string;
  dateDisplay: string;
  certainty: "" | "CONFIRMED" | "TENTATIVE";
  notes: string;
  noticeUrl: string;
  dateProvenance: string;
}

const EMPTY: Draft = { name: "", status: "NOT_DECLARED", dateIso: "", dateDisplay: "", certainty: "", notes: "", noticeUrl: "", dateProvenance: "" };

const toDraft = (s: ExamStage): Draft => ({
  name: s.name,
  status: s.status,
  dateIso: s.dateIso ?? "",
  dateDisplay: s.dateDisplay ?? "",
  certainty: s.certainty === "CONFIRMED" || s.certainty === "TENTATIVE" ? s.certainty : "",
  notes: s.notes ?? "",
  noticeUrl: s.noticeUrl ?? "",
  dateProvenance: s.dateProvenance ?? "",
});

/** What is sent to the server for one stage. Order is set by the server from the list position. */
function toPayload(d: Draft): Record<string, unknown> {
  const hasDate = Boolean(d.dateIso || d.dateDisplay.trim());
  let certainty: DateCertainty | undefined;
  if (d.status === "POSTPONED") certainty = "POSTPONED";
  else if (hasDate && d.certainty) certainty = d.certainty;
  return {
    name: d.name,
    status: d.status,
    dateIso: d.dateIso || undefined,
    dateDisplay: d.dateDisplay || undefined,
    certainty,
    notes: d.notes || undefined,
    noticeUrl: d.noticeUrl || undefined,
    dateProvenance: d.dateProvenance || undefined,
  };
}

const input: React.CSSProperties = {
  width: "100%", padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c",
  borderRadius: 5, color: C.text, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit",
};
const label: React.CSSProperties = { display: "block", fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 500 };
const ghost: React.CSSProperties = { background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: "2px 4px" };

export function ExamStagesEditor({
  record,
  onSave,
}: {
  record: RecruitmentRecord;
  /** Saves the whole list. Resolves to an error message, or null on success. */
  onSave: (stages: Array<Record<string, unknown>>, reason: string) => Promise<string | null>;
}) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const stages = record.examStages ?? [];
  // null = form closed; -1 = adding; otherwise the index being edited.
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectionStages = record.selection?.value?.stages ?? [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const hasDate = Boolean(draft.dateIso || draft.dateDisplay.trim());

  async function save(next: Array<Record<string, unknown>>, reason: string): Promise<boolean> {
    setSaving(true);
    setErr(null);
    const problem = await onSave(next, reason);
    setSaving(false);
    if (problem) { setErr(problem); return false; }
    return true;
  }

  const existing = () => stages.map((s) => toPayload(toDraft(s)));

  async function submit() {
    const list = existing();
    const item = toPayload(draft);
    const adding = editing === -1;
    if (adding) list.push(item);
    else if (editing !== null) list[editing] = item;
    if (await save(list, `${adding ? "Added" : "Edited"} exam stage: ${draft.name.trim()}`)) {
      setEditing(null);
      setDraft(EMPTY);
    }
  }

  async function move(index: number, by: -1 | 1) {
    const list = existing();
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    await save(list, `Reordered exam stages`);
  }

  return (
    <div>
      {stages.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          No exam stages yet. Add each stage that comes after the application window, in order. Leave the date empty
          until it is officially announced.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stages.map((s, i) => {
            const st = statusOf(s.status);
            const date = s.dateDisplay || s.dateIso;
            return (
              <div key={`${s.order}-${s.name}`} style={{ padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{i + 1}.</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.color, border: `1px solid ${st.color}55`, background: `${st.color}18`, padding: "1px 8px", borderRadius: 999 }}>
                    {st.label}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 13, color: date ? C.text : C.muted, fontWeight: 600 }}>
                    {date ?? "No date"}
                    {date && s.certainty === "TENTATIVE" && <span style={{ color: C.amber, fontWeight: 500 }}> · tentative</span>}
                    {date && s.certainty === "CONFIRMED" && <span style={{ color: C.green, fontWeight: 500 }}> · confirmed</span>}
                  </span>
                </div>
                {(s.notes || s.dateProvenance || s.noticeUrl) && (
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
                    {s.notes && <div>{s.notes}</div>}
                    {s.dateProvenance && <div>Date from: {s.dateProvenance}</div>}
                    {s.noticeUrl && (
                      <a href={s.noticeUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, wordBreak: "break-all" }}>{s.noticeUrl}</a>
                    )}
                  </div>
                )}
                {editable && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button style={ghost} disabled={saving} onClick={() => { setEditing(i); setDraft(toDraft(s)); setErr(null); }}>Edit</button>
                    <button style={{ ...ghost, opacity: i === 0 ? 0.3 : 1 }} disabled={saving || i === 0} onClick={() => { void move(i, -1); }} aria-label={`Move ${s.name} up`}>↑ Up</button>
                    <button style={{ ...ghost, opacity: i === stages.length - 1 ? 0.3 : 1 }} disabled={saving || i === stages.length - 1} onClick={() => { void move(i, 1); }} aria-label={`Move ${s.name} down`}>↓ Down</button>
                    <button
                      style={{ ...ghost, color: C.red, marginLeft: "auto" }}
                      disabled={saving}
                      onClick={() => { void save(existing().filter((_, j) => j !== i), `Removed exam stage: ${s.name}`); }}
                      aria-label={`Remove stage ${s.name}`}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!editable ? (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
          Stages can be edited while the record is a draft. Click “Edit Record” first.
        </div>
      ) : editing === null ? (
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => { setEditing(-1); setDraft(EMPTY); setErr(null); }}
            style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            + Add stage
          </button>
          {stages.length === 0 && selectionStages.length > 0 && (
            <button
              disabled={saving}
              onClick={() => { void save(selectionStages.map((s) => ({ name: s.name, status: "NOT_DECLARED" })), "Started exam stages from the selection process"); }}
              style={{ padding: "6px 14px", background: "none", color: C.accent, border: `1px solid ${C.accent}55`, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              title="Creates one stage per selection step, with no dates"
            >
              Start from the selection process ({selectionStages.length} steps, no dates)
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>
            {editing === -1 ? "New stage" : `Edit stage ${editing + 1}`}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={label} htmlFor="stage-name">Stage name</label>
              <input id="stage-name" style={input} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Tier-I Exam, Skill Test, Document Verification…" />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={label} htmlFor="stage-status">Where it stands<InfoTip id="Where it stands" /></label>
              <select id="stage-status" style={input} value={draft.status} onChange={(e) => set("status", e.target.value as ExamStageStatus)}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={label} htmlFor="stage-date">Exact date (if announced)</label>
              <input id="stage-date" type="date" style={input} value={draft.dateIso} onChange={(e) => set("dateIso", e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={label} htmlFor="stage-date-text">Or as written (range or month)<InfoTip id="Or as written" /></label>
              <input id="stage-date-text" style={input} value={draft.dateDisplay} onChange={(e) => set("dateDisplay", e.target.value)} placeholder="12–20 Dec 2026, or December 2026" />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={label} htmlFor="stage-certainty">Is the date confirmed?<InfoTip id="Is the date confirmed?" /></label>
              <select
                id="stage-certainty"
                style={{ ...input, opacity: hasDate && draft.status !== "POSTPONED" ? 1 : 0.5 }}
                disabled={!hasDate || draft.status === "POSTPONED"}
                value={hasDate ? draft.certainty : ""}
                onChange={(e) => set("certainty", e.target.value as Draft["certainty"])}
              >
                <option value="">{hasDate ? "Choose…" : "No date yet"}</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="TENTATIVE">Tentative</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={label} htmlFor="stage-note">Short note (optional)</label>
              <input id="stage-note" style={input} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="City slip from 5 Dec" />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={label} htmlFor="stage-source">Where the date comes from (optional)</label>
              <input id="stage-source" style={input} value={draft.dateProvenance} onChange={(e) => set("dateProvenance", e.target.value)} placeholder="SSC exam calendar, 1 Oct 2026" />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={label} htmlFor="stage-notice">Official notice link (optional)</label>
            <input id="stage-notice" type="url" style={input} value={draft.noticeUrl} onChange={(e) => set("noticeUrl", e.target.value)} placeholder="https://…" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button
              onClick={() => { void submit(); }}
              disabled={saving || !draft.name.trim()}
              style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: saving || !draft.name.trim() ? "not-allowed" : "pointer", opacity: saving || !draft.name.trim() ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : editing === -1 ? "Add stage" : "Save stage"}
            </button>
            <button onClick={() => { setEditing(null); setDraft(EMPTY); setErr(null); }} style={{ ...ghost, color: C.muted }}>Cancel</button>
          </div>
        </div>
      )}

      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{err.replace(/^.*examStages invariant:\s*/, "")}</div>}
    </div>
  );
}
