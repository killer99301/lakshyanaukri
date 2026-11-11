"use client";

// ═══════════════════════════════════════════════════════════
// Admin: age limit editor
// ═══════════════════════════════════════════════════════════
//
// The overall range, the date age is counted on, the relaxations, and — where
// a notice sets them post by post — a range per post, with that post's own
// cut-off date, relaxations and upper ages by category. Lists are typed as
// plain lines, the way they are copied from a notification table. Saved
// through the normal field route: cleaned on the server, stored as Pending,
// and recorded in the change history.
//
// Smart intake keeps the notice's words behind each value. They are shown
// here, and kept on save only for values that were not changed by hand.

import { useState } from "react";
import { SmartDateInput, UNREADABLE_DATE } from "../../SmartDateInput";
import type { AgeCriteria, RecruitmentRecord } from "@/types/recruitment-record";
import type { AgeEvidence, PostAgeRange } from "@/types";

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

interface Draft {
  min: string; max: string; asOf: string; bornFrom: string; bornTo: string; relaxations: string; postWise: string;
  /** "Post | cut-off date", one per line. */
  postAsOf: string;
  /** "Post | Category | years (or a note)", one per line. */
  postRelaxations: string;
  /** "All | Category | maximum" or "Post | Category | maximum": upper ages as printed. */
  categoryMax: string;
}

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
  postAsOf: (age?.postWise ?? []).filter((p) => p.asOf).map((p) => `${p.post} | ${showDate(p.asOf)}`).join("\n"),
  postRelaxations: (age?.postWise ?? [])
    .flatMap((p) => (p.relaxations ?? []).map((r) => [p.post, r.category, r.years != null ? String(r.years) : r.text ?? ""].join(" | ")))
    .join("\n"),
  categoryMax: [
    ...(age?.categoryMax ?? []).map((c) => `All | ${c.category} | ${c.max}`),
    ...(age?.postWise ?? []).flatMap((p) => (p.categoryMax ?? []).map((c) => `${p.post} | ${c.category} | ${c.max}`)),
  ].join("\n"),
});

type Valued = { min?: number; max?: number; bornFrom?: string; bornTo?: string; asOf?: string; relaxations?: AgeCriteria["relaxations"]; categoryMax?: AgeCriteria["categoryMax"]; post?: string };

/** What an evidence entry's value is now, to tell whether it still stands behind it. */
function currentValue(v: Valued, about: string): string | undefined {
  if (about === "post") return v.post;
  if (about === "min" || about === "max") return v[about] != null ? String(v[about]) : undefined;
  if (about === "bornFrom" || about === "bornTo" || about === "asOf") return v[about];
  const m = /^(relaxation|categoryMax): (.+)$/.exec(about);
  if (m?.[1] === "relaxation") {
    const r = (v.relaxations ?? []).find((x) => x.category === m[2]);
    return r ? (r.years != null ? String(r.years) : r.text) : undefined;
  }
  if (m?.[1] === "categoryMax") {
    const c = (v.categoryMax ?? []).find((x) => x.category === m[2]);
    return c ? String(c.max) : undefined;
  }
  return undefined;
}
/** Evidence kept only where its value was not changed by hand. */
const stillBacked = (old: AgeEvidence[] | undefined, now: Valued) => (old ?? []).filter((e) => currentValue(now, e.about) === e.value);

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

  // A post's own cut-off date, relaxations and printed upper ages: each line names a post listed above.
  const postNamed = (name: string | undefined, what: string, i: number): PostAgeRange | { error: string } => {
    const p = postWise.find((x) => x.post === name);
    return p ?? { error: `${what}, line ${i + 1}: “${name ?? ""}” is not one of the posts listed in Post-wise.` };
  };
  for (const [i, line] of lines(d.postAsOf).entries()) {
    const [name, date] = line.split("|").map((p) => p.trim());
    const p = postNamed(name, "Post cut-off dates", i);
    if ("error" in p) return p;
    const iso = readDate(date);
    if (!iso) return { error: `Post cut-off dates, line ${i + 1}: write it as “Post | 01-09-2026”.` };
    p.asOf = iso;
  }
  for (const [i, line] of lines(d.postRelaxations).entries()) {
    const [name, category, second] = line.split("|").map((p) => p.trim());
    const p = postNamed(name, "Post relaxations", i);
    if ("error" in p) return p;
    if (!category || !second) return { error: `Post relaxations, line ${i + 1}: write it as “Post | Category | years”, for example “Office Assistant | Ex-servicemen | 3”.` };
    const years = whole(second);
    (p.relaxations ??= []).push(years !== undefined ? { category, years } : { category, text: second });
  }
  const categoryMax: NonNullable<AgeCriteria["categoryMax"]> = [];
  for (const [i, line] of lines(d.categoryMax).entries()) {
    const [name, category, max] = line.split("|").map((p) => p.trim());
    const n = whole(max);
    if (!category || n === undefined) return { error: `Upper ages by category, line ${i + 1}: write it as “All | OBC | 33” or “Post | OBC | 33”, as printed.` };
    if (/^all$/i.test(name ?? "")) { categoryMax.push({ category, max: n }); continue; }
    const p = postNamed(name, "Upper ages by category", i);
    if ("error" in p) return p;
    (p.categoryMax ??= []).push({ category, max: n });
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
      ...(categoryMax.length ? { categoryMax } : {}),
      ...(postWise.length ? { postWise } : {}),
    },
  };
}

/** The new value with the evidence of every value left as it was. */
function keepEvidence(next: AgeCriteria, old: AgeCriteria | null): AgeCriteria {
  const overall = stillBacked(old?.evidence, next);
  const postWise = next.postWise?.map((p) => {
    const before = old?.postWise?.find((o) => o.post === p.post);
    const kept = stillBacked(before?.evidence, p);
    return kept.length ? { ...p, evidence: kept } : p;
  });
  return { ...next, ...(postWise ? { postWise } : {}), ...(overall.length ? { evidence: overall } : {}) };
}

/** The notice's words behind the values, post by post, as Smart intake read them. */
function EvidenceList({ age }: { age: AgeCriteria }) {
  const groups = [
    ...(age.evidence?.length ? [{ title: "Overall", items: age.evidence }] : []),
    ...(age.postWise ?? []).filter((p) => p.evidence?.length).map((p) => ({ title: p.post, items: p.evidence! })),
  ];
  if (groups.length === 0) return null;
  return (
    <details style={{ marginTop: 12, fontSize: 12, color: C.muted }}>
      <summary style={{ cursor: "pointer", color: C.text }}>Where each value was read ({groups.reduce((n, g) => n + g.items.length, 0)})</summary>
      {groups.map((g) => (
        <div key={g.title} style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, color: C.text }}>{g.title}</div>
          {g.items.map((e, i) => (
            <div key={i} style={{ marginTop: 4, lineHeight: 1.5 }}>
              <span style={{ color: C.accent }}>{e.about}</span> = {e.value}
              {e.page != null ? ` · page ${e.page}` : ""} — “{e.quote}”
            </div>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 8 }}>A value changed by hand loses its quote when saved.</div>
    </details>
  );
}

export function AgeEditor({ record, onSave }: { record: RecruitmentRecord; onSave: SaveFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const age = record.age?.value ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(age));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  // Date boxes whose text cannot be read: saving would store the dates from before.
  const [badDates, setBadDates] = useState<string[]>([]);
  const validity = (box: string) => (ok: boolean) => setBadDates((b) => (ok ? b.filter((x) => x !== box) : b.includes(box) ? b : [...b, box]));

  async function save() {
    if (badDates.length > 0) { setErr(UNREADABLE_DATE); return; }
    const out = fromDraft(draft);
    if (out.error || !out.value) { setErr(out.error ?? "Nothing to save"); return; }
    setSaving(true);
    setErr(null);
    const problem = await onSave("age", keepEvidence(out.value, age), "Edited age limit");
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
      <div>
        <button
          onClick={() => { setDraft(toDraft(age)); setErr(null); setBadDates([]); setEditing(true); }}
          style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, marginTop: 12 }}
        >
          {age ? "Edit age limit" : "Add age limit"}
        </button>
        {age && <EvidenceList age={age} />}
      </div>
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
          <SmartDateInput id="age-as-of" style={input} value={draft.asOf} onChange={(v) => set("asOf", v)} onValidity={validity("asOf")} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
        If the ages differ by post, put the widest range here and list each post below. An age range needs the “counted on” date for the public age checker to work.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 12 }}>
        <div>
          <label style={label} htmlFor="age-born-from">Born on or after (if the notice gives dates of birth)</label>
          <SmartDateInput id="age-born-from" style={input} value={draft.bornFrom} onChange={(v) => set("bornFrom", v)} onValidity={validity("bornFrom")} />
        </div>
        <div>
          <label style={label} htmlFor="age-born-to">Born on or before</label>
          <SmartDateInput id="age-born-to" style={input} value={draft.bornTo} onChange={(v) => set("bornTo", v)} onValidity={validity("bornTo")} />
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

      <div style={{ marginTop: 12 }}>
        <label style={label} htmlFor="age-post-as-of">A post&apos;s own cut-off date, if it differs — one per line: Post | date</label>
        <textarea id="age-post-as-of" value={draft.postAsOf} onChange={(e) => set("postAsOf", e.target.value)} style={{ ...input, height: 60, resize: "vertical" }} placeholder={"Officer Scale-I | 01-09-2026"} />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={label} htmlFor="age-post-relaxations">Relaxations for one post only — one per line: Post | Category | years (added to the ones above)</label>
        <textarea id="age-post-relaxations" value={draft.postRelaxations} onChange={(e) => set("postRelaxations", e.target.value)} style={{ ...input, height: 60, resize: "vertical" }} placeholder={"Office Assistant | Ex-servicemen | service + 3 years, up to 50"} />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={label} htmlFor="age-category-max">Upper ages by category, exactly as printed — one per line: All (or Post) | Category | maximum</label>
        <textarea id="age-category-max" value={draft.categoryMax} onChange={(e) => set("categoryMax", e.target.value)} style={{ ...input, height: 60, resize: "vertical" }} placeholder={"All | Unreserved (Male) | 37\nAll | SC / ST | 42"} />
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
          Only where the notice prints a maximum for a category. Never add relaxation years to make one.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button
          onClick={() => { void save(); }}
          disabled={saving || badDates.length > 0}
          style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: saving || badDates.length > 0 ? "not-allowed" : "pointer", opacity: saving || badDates.length > 0 ? 0.6 : 1 }}
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
