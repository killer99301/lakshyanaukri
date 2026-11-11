"use client";

// ═══════════════════════════════════════════════════════════
// Admin: Simple Update — one routine update to a job that has been published (CMS usability batch 2)
// ═══════════════════════════════════════════════════════════
//
// Pick what has changed, type only that, see the before/after, save. The plan
// comes from lib/cms/simple-update.ts (the same proposals and savesFor() that
// Check for updates uses) and the saves from apply-saves.ts (the same path
// that panel uses). Everything is saved as Pending; a live job is first opened
// for editing, so the public keeps the published version. Nothing is approved
// or published here: the owner's publication review does that.
//
// No AI is called. "Read it with AI instead" only hands the address to the
// existing Check for updates panel, which runs when the owner presses its
// button.

import { useEffect, useMemo, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { UpdateType } from "@/types";
import { SmartDateInput } from "../../SmartDateInput";
import { SIMPLE_KINDS, planSimpleUpdate, suggestOfficial, type ExamChange, type SimpleInput, type SimpleKind } from "@/lib/cms/simple-update";
import { todayInIndia } from "@/lib/cms/attention";
import { formatDate } from "@/lib/utils";
import { applySaves } from "./apply-saves";

const C = {
  bg: "#070b16", card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.18)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950",
};
const input: React.CSSProperties = { width: "100%", padding: "7px 10px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" };
const label: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 };
const row: React.CSSProperties = { marginBottom: 12 };

const NOTICE_TYPES: Array<[UpdateType, string]> = [
  ["CORRIGENDUM", "Corrigendum"], ["GENERAL_NOTICE", "General notice"], ["EXAM_NOTICE", "Exam notice"],
  ["VACANCY_REVISION", "Vacancy revision"], ["POSTPONEMENT", "Postponement"], ["CANCELLATION", "Cancellation"],
];

export function SimpleUpdatePanel({ record, onRecordChange, onAdvanced, onUseAi, dirtyRef }: {
  record: RecruitmentRecord;
  onRecordChange: (record: RecruitmentRecord) => void;
  /** Back to the full editor. */
  onAdvanced: () => void;
  /** Hand the source address to Check for updates (it runs only when the owner presses its button there). */
  onUseAi: (source: string) => void;
  /** Set while something typed here is not saved, so the editor's own links can ask before leaving. */
  dirtyRef?: { current: boolean };
}) {
  const [kind, setKind] = useState<SimpleKind | null>(null);
  const [source, setSource] = useState("");
  // The previous update's source, offered for deliberate reuse only (never carried over by itself).
  const [lastSource, setLastSource] = useState("");
  const [stageChoice, setStageChoice] = useState("");
  const [newStage, setNewStage] = useState("");
  const [examChange, setExamChange] = useState<ExamChange | "">("");
  const [dateIso, setDateIso] = useState("");
  const [certainty, setCertainty] = useState<"CONFIRMED" | "TENTATIVE" | "">("");
  const [feeDateIso, setFeeDateIso] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  // null until the owner touches it: then the form's suggestion no longer applies.
  const [linkOfficialChoice, setLinkOfficialChoice] = useState<boolean | null>(null);
  const [finalResult, setFinalResult] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [noteType, setNoteType] = useState<UpdateType>("CORRIGENDUM");
  const [noteDate, setNoteDate] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [replaceVerified, setReplaceVerified] = useState(false);
  const [dupesSeen, setDupesSeen] = useState(false);
  const [badDates, setBadDates] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Tell the editor whether leaving would drop something typed here; cleared when the panel closes.
  useEffect(() => {
    if (!dirtyRef) return;
    dirtyRef.current = dirty && !done;
    return () => { dirtyRef.current = false; };
  }, [dirty, done, dirtyRef]);
  const stages = [...(record.examStages ?? [])].sort((a, b) => a.order - b.order);
  const stageName = stageChoice === "__new" ? newStage : stageChoice;
  const linkOfficial = linkOfficialChoice ?? (linkUrl.trim() ? suggestOfficial(linkUrl.trim(), record) : false);
  const validity = (box: string) => (ok: boolean) => setBadDates((b) => (ok ? b.filter((x) => x !== box) : b.includes(box) ? b : [...b, box]));
  const today = todayInIndia();

  const wantsAnnouncement = kind === "NOTICE" || ((kind === "DEADLINE" || kind === "ANSWER_KEY" || kind === "CUT_OFF") && announce);
  const plan = useMemo(() => {
    if (!kind) return null;
    const i: SimpleInput = {
      kind, source, stageName, examChange: examChange || undefined, dateIso, certainty: certainty || undefined, feeDateIso,
      linkUrl, linkLabel, linkOfficial, finalResult, replaceVerified,
      announcement: wantsAnnouncement ? { type: kind === "DEADLINE" ? "DEADLINE_EXTENSION" : kind === "NOTICE" ? noteType : "GENERAL_NOTICE", date: noteDate, title: noteTitle, description: noteText } : null,
    };
    return planSimpleUpdate(record, i, today);
  }, [kind, source, stageName, examChange, dateIso, certainty, feeDateIso, linkUrl, linkLabel, linkOfficial, finalResult, replaceVerified, wantsAnnouncement, noteType, noteDate, noteTitle, noteText, record, today]);

  const problems = [...(plan?.problems ?? []), ...(badDates.length > 0 ? ["A date box cannot read its date. Correct it or clear it."] : [])];
  const needsDupeOk = (plan?.duplicates.length ?? 0) > 0 && !dupesSeen;
  const canSave = Boolean(plan) && problems.length === 0 && !needsDupeOk && !saving;

  function choose(k: SimpleKind) {
    setKind(k); setErr(null); setDone(null); setDupesSeen(false); setBadDates([]);
    // Each kind starts empty, the source included: a date or a notice address given for one kind
    // must never turn up, unnoticed, on another. The last source is offered for reuse by a button.
    if (source.trim()) setLastSource(source.trim());
    setSource("");
    setStageChoice(""); setNewStage(""); setExamChange(""); setDateIso(""); setCertainty(""); setFeeDateIso("");
    setLinkUrl(""); setLinkLabel(""); setLinkOfficialChoice(null); setFinalResult(false); setReplaceVerified(false);
    setNoteType("CORRIGENDUM"); setNoteDate(""); setNoteTitle(""); setNoteText("");
    // A deadline is announced by default: a date change alone writes no announcement.
    setAnnounce(k === "DEADLINE");
  }

  async function save() {
    if (!plan || !kind || !canSave) return;
    setSaving(true); setErr(null);
    // Worked out again on the job as it is once opened for editing, so nothing is saved against a stale copy.
    const i: SimpleInput = {
      kind, source, stageName, examChange: examChange || undefined, dateIso, certainty: certainty || undefined, feeDateIso,
      linkUrl, linkLabel, linkOfficial, finalResult, replaceVerified,
      announcement: wantsAnnouncement ? { type: kind === "DEADLINE" ? "DEADLINE_EXTENSION" : kind === "NOTICE" ? noteType : "GENERAL_NOTICE", date: noteDate, title: noteTitle, description: noteText } : null,
    };
    const out = await applySaves(record, (opened) => planSimpleUpdate(opened, i, today).saves, plan.announcement);
    onRecordChange(out.record);
    setSaving(false);
    if (out.error) {
      setErr(`${out.error.where}: ${out.error.why}. ${out.record.draftState === "PUBLISHED" ? "Nothing was changed." : `${out.saved} change${out.saved === 1 ? " is" : "s are"} saved in the draft as Pending; nothing new is public.`}`);
      return;
    }
    setDirty(false);
    setDone(`Saved to the draft as Pending (${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"}). The live page is unchanged until you publish from the publication review.`);
    document.querySelector("[data-publication-review]")?.scrollIntoView({ block: "start" });
  }

  function leave() {
    if (dirty && !done && !window.confirm("Leave this update? What you typed here is not saved.")) return;
    onAdvanced();
  }

  const dateBox = (id: string, value: string, set: (v: string) => void, aria: string) => (
    <SmartDateInput id={id} value={value} onChange={(v) => { set(v); setDirty(true); }} style={input} ariaLabel={aria} onValidity={validity(id)} />
  );

  const stagePicker = (optional: boolean) => (
    <div style={row}>
      <label style={label} htmlFor="su-stage">{optional ? "Exam stage it is for (optional: marks that stage on the job)" : "Exam stage"}</label>
      <select id="su-stage" style={input} value={stageChoice} onChange={(e) => { setStageChoice(e.target.value); setDirty(true); }}>
        <option value="">{optional ? "— none —" : "Choose a stage…"}</option>
        {stages.map((s) => <option key={s.name} value={s.name}>{s.name}{s.dateIso ? ` (${formatDate(s.dateIso)})` : s.dateDisplay ? ` (${s.dateDisplay})` : ""}</option>)}
        <option value="__new">A new stage…</option>
      </select>
      {stageChoice === "__new" && (
        <input aria-label="New stage name" style={{ ...input, marginTop: 6 }} value={newStage} placeholder="As the notice names it, e.g. Preliminary Examination" onChange={(e) => { setNewStage(e.target.value); setDirty(true); }} />
      )}
    </div>
  );

  const linkFields = (what: string) => (
    <>
      <div style={row}>
        <label style={label} htmlFor="su-link">{what} link (the official download or login page)</label>
        <input id="su-link" style={input} type="url" value={linkUrl} placeholder="https://…" onChange={(e) => { setLinkUrl(e.target.value); setDirty(true); }} />
      </div>
      <div style={row}>
        <label style={label} htmlFor="su-link-label">Button label (optional)</label>
        <input id="su-link-label" style={input} value={linkLabel} placeholder={what} onChange={(e) => { setLinkLabel(e.target.value); setDirty(true); }} />
      </div>
      <label style={{ ...row, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.text, lineHeight: 1.5 }}>
        <input type="checkbox" data-su-official checked={linkOfficial} onChange={(e) => { setLinkOfficialChoice(e.target.checked); setDirty(true); }} />
        <span>
          Official link: I have checked it is on the recruiting body&apos;s own website.
          <span style={{ color: C.muted }}> {linkUrl.trim() ? (suggestOfficial(linkUrl.trim(), record) ? "(It is on this job's official site or a government domain.)" : "(Not on this job's official site: leave unticked unless you have checked it.)") : ""} Only official links are listed on the Admit Cards, Results and Answer Keys pages.</span>
        </span>
      </label>
    </>
  );

  const announcementFields = (required: boolean) => (
    <div style={{ ...row, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8 }}>
      {!required && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.text, marginBottom: announce ? 10 : 0 }}>
          <input type="checkbox" data-su-announce checked={announce} onChange={(e) => { setAnnounce(e.target.checked); setDirty(true); }} />
          Also add an announcement to the job&apos;s updates
        </label>
      )}
      {(required || announce) && (
        <>
          {kind === "NOTICE" && (
            <div style={row}>
              <label style={label} htmlFor="su-note-type">Kind of notice</label>
              <select id="su-note-type" style={input} value={noteType} onChange={(e) => { setNoteType(e.target.value as UpdateType); setDirty(true); }}>
                {NOTICE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
          <div style={row}>
            <label style={label}>Date printed on the notice</label>
            {dateBox("su-note-date", noteDate, setNoteDate, "Date printed on the notice")}
          </div>
          <div style={row}>
            <label style={label} htmlFor="su-note-title">Title</label>
            <input id="su-note-title" style={input} value={noteTitle} placeholder={kind === "DEADLINE" ? "Last date to apply extended to …" : "As short as the notice allows"} onChange={(e) => { setNoteTitle(e.target.value); setDirty(true); }} />
          </div>
          <div>
            <label style={label} htmlFor="su-note-text">What it says</label>
            <textarea id="su-note-text" style={{ ...input, height: 60, resize: "vertical" }} value={noteText} onChange={(e) => { setNoteText(e.target.value); setDirty(true); }} />
          </div>
        </>
      )}
    </div>
  );

  return (
    // Typing here is this panel's own business: the editor's "unsaved field" guard is not involved.
    <div data-simple-update onInput={(e) => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.accent}55`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Update existing recruitment</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5, maxWidth: 620 }}>
            Pick what has changed and enter only that. Everything else on the job stays as it is. It is saved as Pending, and the live page does not change until you publish from the publication review.
          </div>
        </div>
        <button type="button" data-su-advanced onClick={leave} style={{ background: "none", border: `1px solid ${C.border}`, color: C.accent, borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Advanced editing →
        </button>
      </div>

      <div role="radiogroup" aria-label="What has changed" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {SIMPLE_KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} data-su-kind={k.kind} title={k.hint} onClick={() => choose(k.kind)}
            style={{ padding: "7px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${kind === k.kind ? C.accent : C.border}`, background: kind === k.kind ? `${C.accent}22` : "transparent", color: kind === k.kind ? C.text : C.muted }}>
            {k.label}
          </button>
        ))}
      </div>

      {kind && (
        <div style={{ maxWidth: 640 }}>
          <div style={row}>
            <label style={label} htmlFor="su-source">Official source: the page or PDF this comes from</label>
            <input id="su-source" style={input} type="url" value={source} placeholder="https://… official notice" onChange={(e) => { setSource(e.target.value); setDirty(true); }} />
            {!source.trim() && lastSource && (
              <button type="button" data-su-reuse-source onClick={() => { setSource(lastSource); setDirty(true); }}
                style={{ marginTop: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 6, padding: "4px 10px", color: C.accent, cursor: "pointer", fontSize: 11, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                Use the same source as the last update: {lastSource}
              </button>
            )}
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              Recorded with the change.{" "}
              <button type="button" data-su-use-ai disabled={!/^https?:\/\//i.test(source.trim())} onClick={() => onUseAi(source.trim())}
                style={{ background: "none", border: "none", padding: 0, color: C.accent, cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>
                Read it with AI instead (Check for updates; runs only when you press its button)
              </button>
            </div>
          </div>

          {kind === "EXAM_DATE" && (
            <>
              {stagePicker(false)}
              <div style={row} role="radiogroup" aria-label="How the date changed">
                <span style={label}>What happened</span>
                {([["ANNOUNCED", "Date announced"], ["RESCHEDULED", "Rescheduled to a new date"], ["CONFIRMED", "Same date, now confirmed"], ["POSTPONED", "Postponed, new date not announced"]] as const).map(([v, l]) => (
                  <label key={v} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 14, fontSize: 12, color: C.text }}>
                    <input type="radio" name="su-change" checked={examChange === v} onChange={() => { setExamChange(v); setDirty(true); }} /> {l}
                  </label>
                ))}
              </div>
              {examChange === "CONFIRMED" && (
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>The stage keeps its date and status; only &quot;tentative&quot; becomes &quot;confirmed&quot;. No announcement is written for this.</div>
              )}
              {examChange && examChange !== "POSTPONED" && examChange !== "CONFIRMED" && (
                <>
                  <div style={row}>
                    <label style={label}>Exam date</label>
                    {dateBox("su-date", dateIso, setDateIso, "Exam date")}
                  </div>
                  <div style={row} role="radiogroup" aria-label="Is the date final">
                    <span style={label}>Does the notice give this date as final?</span>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 14, fontSize: 12, color: C.text }}>
                      <input type="radio" name="su-certainty" checked={certainty === "CONFIRMED"} onChange={() => { setCertainty("CONFIRMED"); setDirty(true); }} /> Yes, confirmed
                    </label>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, color: C.text }}>
                      <input type="radio" name="su-certainty" checked={certainty === "TENTATIVE"} onChange={() => { setCertainty("TENTATIVE"); setDirty(true); }} /> No, tentative
                    </label>
                  </div>
                </>
              )}
            </>
          )}

          {kind === "ADMIT_CARD" && (
            <>
              {linkFields("Admit card")}
              {stagePicker(true)}
              <div style={row}>
                <label style={label}>Admit card release date (optional)</label>
                {dateBox("su-date", dateIso, setDateIso, "Admit card release date")}
              </div>
            </>
          )}

          {kind === "RESULT" && (
            <>
              {linkFields("Result")}
              {stagePicker(true)}
              <label style={{ ...row, display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.text }}>
                <input type="checkbox" checked={finalResult} onChange={(e) => { setFinalResult(e.target.checked); setDirty(true); }} />
                This is the final result of the whole recruitment
              </label>
              {finalResult && (
                <div style={row}>
                  <label style={label}>Final result date</label>
                  {dateBox("su-date", dateIso, setDateIso, "Final result date")}
                </div>
              )}
            </>
          )}

          {(kind === "ANSWER_KEY" || kind === "CUT_OFF") && (
            <>
              {linkFields(kind === "ANSWER_KEY" ? "Answer key" : "Cut-off")}
              {announcementFields(false)}
            </>
          )}

          {kind === "DEADLINE" && (
            <>
              <div style={row}>
                <label style={label}>New last date to apply (now {record.dates.applicationCloseDate?.value ? formatDate(record.dates.applicationCloseDate.value) : "not set"})</label>
                {dateBox("su-date", dateIso, setDateIso, "New last date to apply")}
              </div>
              <div style={row}>
                <label style={label}>New fee payment last date (optional)</label>
                {dateBox("su-fee-date", feeDateIso, setFeeDateIso, "New fee payment last date")}
              </div>
              {announcementFields(false)}
            </>
          )}

          {kind === "NOTICE" && (
            <>
              {announcementFields(true)}
              {linkFields("Notice PDF")}
            </>
          )}

          {plan && !plan.offersAnnouncement && (
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>No separate announcement is needed: changing the stage writes its own (shown in the review below).</div>
          )}

          {/* Review: before → after, and what still stops the save. */}
          <div data-su-review style={{ marginTop: 6, padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>Review before saving</div>
            {plan && plan.changes.length > 0 && (
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", marginBottom: 8, overflowWrap: "anywhere" }}>
                <thead><tr style={{ color: C.muted, textAlign: "left" }}><th style={{ padding: "3px 6px" }}>What</th><th style={{ padding: "3px 6px" }}>Now</th><th style={{ padding: "3px 6px" }}>After saving</th></tr></thead>
                <tbody>
                  {plan.changes.map((c, i) => (
                    <tr key={i} data-su-change style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "4px 6px", color: C.text }}>{c.label}</td>
                      <td style={{ padding: "4px 6px", color: C.muted }}>{c.before}</td>
                      <td style={{ padding: "4px 6px", color: C.text }}>{c.after}{c.note ? <span style={{ color: C.amber }}> ({c.note})</span> : null} <span style={{ color: C.amber, fontSize: 10, fontWeight: 700 }}>PENDING</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan && plan.verifiedReplaced.length > 0 && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.amber, marginBottom: 8 }}>
                <input type="checkbox" checked={replaceVerified} onChange={(e) => { setReplaceVerified(e.target.checked); setDirty(true); }} />
                {plan.verifiedReplaced.join(", ")} is marked Verified. The official notice replaces it (the new date is saved as Pending until you verify it).
              </label>
            )}
            {plan && plan.duplicates.length > 0 && (
              <div role="alert" data-su-duplicate style={{ fontSize: 12, color: C.text, padding: "8px 10px", background: `${C.amber}14`, border: `1px solid ${C.amber}55`, borderRadius: 6, marginBottom: 8, lineHeight: 1.5 }}>
                <div style={{ color: C.amber, fontWeight: 700 }}>This announcement may already be on the job</div>
                {plan.duplicates.map((d) => <div key={d.entry.id}>• {d.entry.date}: {d.entry.title} <span style={{ color: C.muted }}>({d.why})</span></div>)}
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input type="checkbox" checked={dupesSeen} onChange={(e) => setDupesSeen(e.target.checked)} /> It is different news: add it anyway
                </label>
              </div>
            )}
            {problems.length > 0 && (
              <ul data-su-problems style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12, color: C.amber, lineHeight: 1.6 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            {err && <div role="alert" style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{err}</div>}
            {done && <div role="status" data-su-done style={{ fontSize: 12, color: C.green, marginBottom: 8 }}>{done}</div>}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" data-su-save disabled={!canSave} onClick={() => { void save(); }}
                style={{ padding: "8px 16px", background: canSave ? "linear-gradient(135deg, #4f46e5, #7c3aed)" : "#1c2740", color: canSave ? "#fff" : C.muted, border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed" }}>
                {saving ? "Saving…" : record.draftState === "PUBLISHED" ? "Open for editing and save as Pending" : "Save as Pending"}
              </button>
              {done && (
                <button type="button" onClick={() => document.querySelector("[data-publication-review]")?.scrollIntoView({ block: "start" })}
                  style={{ background: "none", border: `1px solid ${C.green}66`, color: C.green, borderRadius: 6, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Go to the publication review
                </button>
              )}
              <span style={{ fontSize: 11, color: C.muted }}>Nothing is published from here.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
