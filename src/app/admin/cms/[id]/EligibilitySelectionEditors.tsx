"use client";

// ═══════════════════════════════════════════════════════════
// Admin: eligibility and selection process editors
// ═══════════════════════════════════════════════════════════
//
// Both are typed as plain lines, the way they are copied from a notification.
// Anything already on a row that the form does not show (a post's pay scale,
// a stage's type) stays with that row as long as its name is unchanged.
// Saved through the normal field route as Pending, with a change-history entry.

import { useMemo, useState } from "react";
import { readEligibilityLines } from "@/lib/cms/eligibility-lines";
import type { CmsRecruitmentPost, CmsSelectionInformation, CmsSelectionStage, RecruitmentRecord } from "@/types/recruitment-record";

const C = {
  bg: "#070b16", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", red: "#f85149", amber: "#d29922", green: "#3fb950",
};

const input: React.CSSProperties = {
  width: "100%", padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c",
  borderRadius: 6, color: C.text, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit",
};
const label: React.CSSProperties = { display: "block", fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 500 };
const link: React.CSSProperties = { background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, marginTop: 12 };
const box: React.CSSProperties = { marginTop: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 };
const primary = (disabled: boolean): React.CSSProperties => ({
  padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none",
  borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
});

type SaveFn = (fieldPath: "eligibility" | "selection", value: unknown, reason: string) => Promise<string | null>;

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

function NotEditable({ what }: { what: string }) {
  return (
    <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
      {what} can be edited while the record is a draft. Click “Edit Record” first.
    </div>
  );
}

function Actions({ saving, onSave, onCancel, saveLabel, err }: { saving: boolean; onSave: () => void; onCancel: () => void; saveLabel: string; err: string | null }) {
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button onClick={onSave} disabled={saving} style={primary(saving)}>{saving ? "Saving…" : saveLabel}</button>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>Cancel</button>
      </div>
      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
    </>
  );
}

// ─── Eligibility ────────────────────────────────────────────

export function EligibilityEditor({ record, onSave }: { record: RecruitmentRecord; onSave: SaveFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const posts: CmsRecruitmentPost[] = useMemo(() => record.eligibility?.value ?? [], [record.eligibility]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Read on every keystroke, so a wrong line shows before Save is pressed.
  const read = useMemo(() => readEligibilityLines(text, posts), [text, posts]);

  async function save() {
    if (read.problems.length > 0) { setErr(read.problems[0].message); return; }
    if (read.posts.length === 0) { setErr("Type at least one line as “Post | qualification”."); return; }
    const next = read.posts;
    setSaving(true);
    setErr(null);
    const problem = await onSave("eligibility", next, "Edited post-wise eligibility");
    setSaving(false);
    if (problem) { setErr(problem.replace(/^.*invariant:\s*/, "")); return; }
    setEditing(false);
  }

  if (!editable) return <NotEditable what="Eligibility" />;
  if (!editing) {
    return (
      <button
        onClick={() => { setText(posts.map((p) => `${p.post} | ${(p.qualification ?? []).join("; ")}`).join("\n")); setErr(null); setEditing(true); }}
        style={link}
      >
        {posts.length ? "Edit eligibility" : "Add eligibility"}
      </button>
    );
  }
  return (
    <div style={box}>
      <label style={label} htmlFor="eligibility-rows">One post per line: Post | qualification. Separate more than one qualification with a semicolon.</label>
      <textarea
        id="eligibility-rows"
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(null); }}
        style={{ ...input, height: 180, resize: "vertical" }}
        placeholder={"Clerk | Graduate in any discipline; Knowledge of computers\nPeon | Matriculation or equivalent"}
      />
      {text.trim() && (
        <div role="status" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          <div style={{ color: read.problems.length > 0 ? C.muted : C.green }}>
            {read.posts.length} post{read.posts.length === 1 ? "" : "s"} read{read.problems.length > 0 ? `, ${read.problems.length} line${read.problems.length === 1 ? "" : "s"} to fix` : ""}.
          </div>
          {read.problems.map((p, i) => <div key={i} style={{ color: C.red }}>• {p.message}</div>)}
          {read.warnings.map((w, i) => <div key={i} style={{ color: C.amber }}>• {w}</div>)}
        </div>
      )}
      <Actions saving={saving} onSave={() => { void save(); }} onCancel={() => setEditing(false)} saveLabel="Save eligibility" err={err} />
    </div>
  );
}

// ─── Selection process ──────────────────────────────────────

export function SelectionEditor({ record, onSave }: { record: RecruitmentRecord; onSave: SaveFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const selection: CmsSelectionInformation = record.selection?.value ?? {};
  const stages: CmsSelectionStage[] = selection.stages ?? [];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [negative, setNegative] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const rows = lines(text);
    if (rows.length > 20) { setErr("At most 20 stages."); return; }
    const nextStages: CmsSelectionStage[] = rows.map((line, i) => {
      const cut = line.indexOf("|");
      const name = (cut === -1 ? line : line.slice(0, cut)).trim();
      const description = cut === -1 ? "" : line.slice(cut + 1).trim();
      const before = stages.find((s) => s.name === name);
      return {
        ...(before ?? { type: "OTHER" as const }),
        name,
        order: i + 1,
        ...(description ? { description } : { description: undefined }),
      };
    });
    if (nextStages.some((s) => !s.name)) { setErr("Every stage needs a name before the “|”."); return; }
    if (nextStages.length === 0 && !negative.trim()) { setErr("Enter at least one stage."); return; }
    const next: CmsSelectionInformation = {
      ...selection,
      stages: nextStages.map(({ description, ...s }) => (description ? { ...s, description } : s)),
      negativeMarking: negative.trim() || undefined,
    };
    setSaving(true);
    setErr(null);
    const problem = await onSave("selection", next, "Edited selection process");
    setSaving(false);
    if (problem) { setErr(problem.replace(/^.*invariant:\s*/, "")); return; }
    setEditing(false);
  }

  if (!editable) return <NotEditable what="The selection process" />;
  if (!editing) {
    return (
      <button
        onClick={() => {
          setText(stages.map((s) => (s.description ? `${s.name} | ${s.description}` : s.name)).join("\n"));
          setNegative(selection.negativeMarking ?? "");
          setErr(null);
          setEditing(true);
        }}
        style={link}
      >
        {stages.length ? "Edit selection process" : "Add selection process"}
      </button>
    );
  }
  return (
    <div style={box}>
      <label style={label} htmlFor="selection-rows">Stages in order, one per line. A short description after “|” is optional.</label>
      <textarea
        id="selection-rows"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ ...input, height: 150, resize: "vertical" }}
        placeholder={"Computer Based Test | 100 questions, 90 minutes\nDocument Verification\nMedical Examination"}
      />
      <div style={{ marginTop: 10 }}>
        <label style={label} htmlFor="selection-negative">Negative marking (optional)</label>
        <input id="selection-negative" style={input} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="1/3 mark for each wrong answer" />
      </div>
      <Actions saving={saving} onSave={() => { void save(); }} onCancel={() => setEditing(false)} saveLabel="Save selection process" err={err} />
    </div>
  );
}
