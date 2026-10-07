"use client";

// ═══════════════════════════════════════════════════════════
// Admin: paste a prepared content file
// ═══════════════════════════════════════════════════════════
//
// Takes a whole text file with EXAM PATTERN and SYLLABUS sections
// (docs/antigravity-content-brief.md) and fills both sections in one go. The
// admin sees exactly what was read, and every warning, before anything is
// saved. Saving replaces the current exam pattern and/or syllabus, as Pending,
// through the normal field route.
//
// It also offers files from the syllabus library whose match words fit this
// job. Choosing one only loads it into the same box, so it is read, checked
// and saved exactly like a pasted file.

import { useEffect, useMemo, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { parseContentFile } from "@/lib/cms/content-import";
import { stripLibraryBlock, suggestFromLibrary, type LibraryEntrySummary } from "@/lib/cms/syllabus-library";

const C = {
  bg: "#070b16", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950",
};

type Block = { fieldPath: "examPattern" | "syllabus"; value: unknown; reason: string };
type SaveManyFn = (blocks: Block[]) => Promise<string | null>;

export function ContentImportBox({ record, onSaveMany }: { record: RecruitmentRecord; onSaveMany: SaveManyFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryEntrySummary[]>([]);
  const [fromLibrary, setFromLibrary] = useState<LibraryEntrySummary | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(false);

  // The library is only a convenience: if it cannot be read, the paste box still works.
  useEffect(() => {
    if (!editable) return;
    let alive = true;
    fetch("/api/admin/cms/syllabus-library")
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((data) => { if (alive) setLibrary(data.entries ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [editable]);

  const suggested = useMemo(
    () => suggestFromLibrary(library, [record.identity.title?.value, record.identity.shortTitle?.value, record.identity.organizationName]),
    [library, record.identity.title?.value, record.identity.shortTitle?.value, record.identity.organizationName],
  );
  const others = library.filter((e) => !suggested.includes(e));

  async function loadEntry(id: string) {
    setLoadingEntry(true);
    setErr(null);
    setDone(null);
    try {
      const res = await fetch(`/api/admin/cms/syllabus-library?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok || !data.entry) throw new Error(data.error ?? "That library file could not be loaded.");
      setText(stripLibraryBlock(data.entry.content));
      setFromLibrary(data.entry);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That library file could not be loaded.");
    } finally {
      setLoadingEntry(false);
    }
  }

  const read = useMemo(() => (text.trim() ? parseContentFile(text) : null), [text]);
  const papers = read?.examPattern.length ?? 0;
  const subjects = read?.syllabus.length ?? 0;
  const topics = read?.syllabus.reduce((n, s) => n + s.topics.length, 0) ?? 0;

  const hasPattern = (record.examPattern?.value ?? []).length > 0;
  const hasSyllabus = (record.syllabus?.value ?? []).length > 0;

  async function save() {
    if (!read) return;
    const blocks: Block[] = [];
    if (papers > 0) blocks.push({ fieldPath: "examPattern", value: read.examPattern, reason: fromLibrary ? `Exam pattern taken from the syllabus library (${fromLibrary.exam})` : "Exam pattern pasted from a prepared file" });
    if (subjects > 0) blocks.push({ fieldPath: "syllabus", value: read.syllabus, reason: fromLibrary ? `Syllabus taken from the syllabus library (${fromLibrary.exam})` : "Syllabus pasted from a prepared file" });
    if (blocks.length === 0) { setErr("Nothing in this text could be read as an exam pattern or a syllabus."); return; }
    setSaving(true);
    setErr(null);
    const problem = await onSaveMany(blocks);
    setSaving(false);
    if (problem) { setErr(problem.replace(/^.*invariant:\s*/, "")); return; }
    setFromLibrary(null);
    setDone(`Saved ${[papers > 0 ? `${papers} paper${papers === 1 ? "" : "s"}` : "", subjects > 0 ? `${subjects} subject${subjects === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} as Pending.`);
    setText("");
    setOpen(false);
  }

  if (!editable) return null;

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button
          onClick={() => { setOpen(true); setFromLibrary(null); setErr(null); setDone(null); }}
          style={{ background: "none", border: `1px dashed ${C.border}`, color: C.accent, cursor: "pointer", fontSize: 12, padding: "6px 12px", borderRadius: 6 }}
        >
          Paste a prepared file (exam pattern and syllabus together)
        </button>
        {done && <span role="status" style={{ color: C.green, fontSize: 12, marginLeft: 10 }}>{done}</span>}
        {library.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {suggested.length > 0 ? <span style={{ color: C.text }}>The syllabus library has a file that looks like this exam:</span> : <span>Nothing in the syllabus library matches this job’s title.</span>}
            {suggested.map((e) => (
              <button
                key={e.id}
                onClick={() => { void loadEntry(e.id); }}
                disabled={loadingEntry}
                style={{ background: "rgba(98,181,255,0.1)", border: `1px solid ${C.accent}`, color: C.accent, cursor: loadingEntry ? "wait" : "pointer", fontSize: 12, padding: "4px 10px", borderRadius: 6 }}
              >
                Look at “{e.exam}”
              </button>
            ))}
            {others.length > 0 && (
              <select
                aria-label="Choose another library file"
                value=""
                disabled={loadingEntry}
                onChange={(e) => { if (e.target.value) void loadEntry(e.target.value); }}
                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.muted, fontSize: 12, padding: "4px 8px", borderRadius: 6 }}
              >
                <option value="">{suggested.length > 0 ? "or choose another…" : "Choose from the library…"}</option>
                {others.map((e) => <option key={e.id} value={e.id}>{e.exam}</option>)}
              </select>
            )}
          </div>
        )}
        {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
      {fromLibrary && (
        <div role="note" style={{ color: C.amber, fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
          From the syllabus library: “{fromLibrary.exam}”, kept since {new Date(fromLibrary.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.
          {" "}It was written for an earlier cycle of this exam. Compare it with this job’s notification, correct it here, then save. Nothing is saved until you press the button.
        </div>
      )}
      <label htmlFor="content-import-text" style={{ display: "block", fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 500 }}>
        Paste the whole file, including its SOURCE, EXAM PATTERN and SYLLABUS headings
      </label>
      <textarea
        id="content-import-text"
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(null); }}
        style={{ width: "100%", height: 200, padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c", borderRadius: 6, color: C.text, fontSize: 12, boxSizing: "border-box", fontFamily: "ui-monospace, monospace", resize: "vertical" }}
        placeholder={"SOURCE\nBasis: OFFICIAL NOTICE (this year)\n\nEXAM PATTERN\n\nPaper: Tier-I\nSubjects:\nGeneral Awareness | 25 | 50\n\nSYLLABUS\n\nSubject: General Awareness\nTopics:\nHistory\nGeography"}
      />

      {read && (
        <div role="status" style={{ marginTop: 10, fontSize: 12, color: C.text, lineHeight: 1.6 }}>
          <div>
            Read from this text: <b>{papers}</b> exam paper{papers === 1 ? "" : "s"}, <b>{subjects}</b> syllabus subject{subjects === 1 ? "" : "s"}, <b>{topics}</b> topic{topics === 1 ? "" : "s"}.
            {read.basis ? <span style={{ color: C.muted }}> Source stated: {read.basis}.</span> : null}
          </div>
          {papers > 0 && hasPattern && <div style={{ color: C.amber }}>Saving replaces the exam pattern already on this record.</div>}
          {subjects > 0 && hasSyllabus && <div style={{ color: C.amber }}>Saving replaces the syllabus already on this record.</div>}
          {read.warnings.map((w, i) => (
            <div key={i} style={{ color: C.amber }}>• {w}</div>
          ))}
          {subjects > 0 && (
            <div style={{ color: C.muted, marginTop: 6 }}>
              Subjects: {read.syllabus.map((s) => `${s.paper ? `[${s.paper}] ` : ""}${s.subject} (${s.topics.length})`).join(" · ")}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button
          onClick={() => { void save(); }}
          disabled={saving || !read || (papers === 0 && subjects === 0)}
          style={{
            padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5,
            fontSize: 13, fontWeight: 600,
            cursor: saving || !read || (papers === 0 && subjects === 0) ? "not-allowed" : "pointer",
            opacity: saving || !read || (papers === 0 && subjects === 0) ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save what was read"}
        </button>
        <button onClick={() => { setOpen(false); setText(""); setFromLibrary(null); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
          Cancel
        </button>
      </div>
      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
