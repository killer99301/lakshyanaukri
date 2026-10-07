"use client";

// ═══════════════════════════════════════════════════════════
// Admin: age limit editor
// ═══════════════════════════════════════════════════════════
//
// The overall range, the date age is counted on, the relaxations, and — where
// a notice sets them post by post — a range per post. Lists are typed as plain
// lines, the way they are copied from a notification table. Saved through the
// normal field route: cleaned on the server, stored as Pending, and recorded
// in the change history.

import { useState } from "react";
import type { AgeCriteria, RecruitmentRecord } from "@/types/recruitment-record";

const C = {
  bg: "#070b16", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149",
};

const input: React.CSSProperties = {
  width: "100%", padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c",
  borderRadius: 6, color: C.text, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit",
};
const label: React.CSSProperties = { display: "block", fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 500 };

type SaveFn = (fieldPath: "age", value: unknown, reason: string) => Promise<string | null>;

interface Draft { min: string; max: string; asOf: string; bornFrom: string; bornTo: string; relaxations: string; postWise: string }

const toDraft = (age: AgeCriteria | null | undefined): Draft => ({
  min: age?.min != null ? String(age.min) : "",
  max: age?.max != null ? String(age.max) : "",
  asOf: age?.asOf ?? "",
  bornFrom: age?.bornFrom ?? "",
  bornTo: age?.bornTo ?? "",
  relaxations: (age?.relaxations ?? [])
    .map((r) => [r.category, r.years != null ? String(r.years) : r.text ?? ""].join(" | "))
    .join("\n"),
  postWise: (age?.postWise ?? [])
    .map((p) => (p.bornFrom || p.bornTo ? [p.post, showDate(p.bornFrom), showDate(p.bornTo)] : [p.post, p.min ?? "", p.max ?? ""]).join(" | "))
    .join("\n"),
});

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
const whole = (text: string | undefined): number | undefined => {
  const t = (text ?? "").trim();
  return /^\d{1,2}$/.test(t) ? Number(t) : undefined;
};

// Dates are typed the way notices print them, day first: 01-11-2005 (or 01/11/2005).
function showDate(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}
function readDate(text: string | undefined): string | undefined {
  const t = (text ?? "").trim();
  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined;
}

/** Turns the typed form into an age limit, or says which line is wrong. */
function fromDraft(d: Draft): { value?: AgeCriteria; error?: string } {
  const relaxations: AgeCriteria["relaxations"] = [];
  for (const [i, line] of lines(d.relaxations).entries()) {
    const [category, second] = line.split("|").map((p) => p.trim());
    if (!category || !second) return { error: `Relaxations, line ${i + 1}: write it as “Category | years”, for example “SC/ST | 5”.` };
    const years = whole(second);
    // "SC/ST | 5" is a number of years; anything else is kept as a short note.
    relaxations.push(years !== undefined ? { category, years } : { category, text: second });
  }

  const postWise: NonNullable<AgeCriteria["postWise"]> = [];
  for (const [i, line] of lines(d.postWise).entries()) {
    const [post, min, max] = line.split("|").map((p) => p.trim());
    const lo = whole(min);
    const hi = whole(max);
    const from = readDate(min);
    const to = readDate(max);
    if (post && (from || to)) {
      // "Navik (GD) | 01-11-2005 | 01-05-2009": a date-of-birth window.
      postWise.push({ post, ...(from ? { bornFrom: from } : {}), ...(to ? { bornTo: to } : {}) });
      continue;
    }
    if (!post || (lo === undefined && hi === undefined)) {
      return { error: `Post-wise, line ${i + 1}: write it as “Post | minimum | maximum” (for example “Pharmacist | 20 | 35”), or with dates of birth as “Post | 01-11-2005 | 01-05-2009”.` };
    }
    postWise.push({ post, ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}) });
  }

  if (d.min.trim() && whole(d.min) === undefined) return { error: "Minimum age must be a whole number." };
  if (d.max.trim() && whole(d.max) === undefined) return { error: "Maximum age must be a whole number." };

  return {
    value: {
      ...(whole(d.min) !== undefined ? { min: whole(d.min) } : {}),
      ...(whole(d.max) !== undefined ? { max: whole(d.max) } : {}),
      ...(d.asOf ? { asOf: d.asOf } : {}),
      ...(d.bornFrom ? { bornFrom: d.bornFrom } : {}),
      ...(d.bornTo ? { bornTo: d.bornTo } : {}),
      relaxations,
      ...(postWise.length ? { postWise } : {}),
    },
  };
}

export function AgeEditor({ record, onSave }: { record: RecruitmentRecord; onSave: SaveFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const age = record.age?.value ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(age));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    const out = fromDraft(draft);
    if (out.error || !out.value) { setErr(out.error ?? "Nothing to save"); return; }
    setSaving(true);
    setErr(null);
    const problem = await onSave("age", out.value, "Edited age limit");
    setSaving(false);
    if (problem) { setErr(problem.replace(/^.*invariant:\s*/, "")); return; }
    setEditing(false);
  }

  if (!editable) {
    return (
      <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
        The age limit can be edited while the record is a draft. Click “Edit Record” first.
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(toDraft(age)); setErr(null); setEditing(true); }}
        style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, marginTop: 12 }}
      >
        {age ? "Edit age limit" : "Add age limit"}
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <div>
          <label style={label} htmlFor="age-min">Minimum age</label>
          <input id="age-min" inputMode="numeric" style={input} value={draft.min} onChange={(e) => set("min", e.target.value)} placeholder="18" />
        </div>
        <div>
          <label style={label} htmlFor="age-max">Maximum age</label>
          <input id="age-max" inputMode="numeric" style={input} value={draft.max} onChange={(e) => set("max", e.target.value)} placeholder="27" />
        </div>
        <div>
          <label style={label} htmlFor="age-as-of">Age is counted on</label>
          <input id="age-as-of" type="date" style={input} value={draft.asOf} onChange={(e) => set("asOf", e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        If the ages differ by post, put the widest range here and list each post below. An age range needs the “counted on” date for the public age checker to work.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
        <div>
          <label style={label} htmlFor="age-born-from">Born on or after (if the notice gives dates of birth)</label>
          <input id="age-born-from" type="date" style={input} value={draft.bornFrom} onChange={(e) => set("bornFrom", e.target.value)} />
        </div>
        <div>
          <label style={label} htmlFor="age-born-to">Born on or before</label>
          <input id="age-born-to" type="date" style={input} value={draft.bornTo} onChange={(e) => set("bornTo", e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        Use these only when the notice prints one date-of-birth range for everyone. Leave the ages above empty in that case; do not work ages out from the dates.
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={label} htmlFor="age-relaxations">Relaxations — one per line: Category | years</label>
        <textarea
          id="age-relaxations"
          value={draft.relaxations}
          onChange={(e) => set("relaxations", e.target.value)}
          style={{ ...input, height: 110, resize: "vertical" }}
          placeholder={"SC/ST | 5\nOBC (Non-Creamy Layer) | 3\nPwBD - UR/EWS | 10\nEx-servicemen | 3 years after deduction of service"}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={label} htmlFor="age-post-wise">Post-wise, if the notice gives them — one per line: Post | minimum | maximum, or Post | earliest date of birth | latest date of birth</label>
        <textarea
          id="age-post-wise"
          value={draft.postWise}
          onChange={(e) => set("postWise", e.target.value)}
          style={{ ...input, height: 110, resize: "vertical" }}
          placeholder={"Nursing Superintendent | 20 | 40\nPharmacist (Entry Grade) | 20 | 35"}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button
          onClick={() => { void save(); }}
          disabled={saving}
          style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save age limit"}
        </button>
        <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
          Cancel
        </button>
      </div>
      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
