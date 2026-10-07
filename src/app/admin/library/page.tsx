"use client";
// ═══════════════════════════════════════════════════════════
// Admin: syllabus library
// ═══════════════════════════════════════════════════════════
//
// One prepared file per recurring exam (SSC CHSL, IBPS PO, RRB NTPC…). When a
// job's title contains an entry's match words, the job editor offers the file
// in its Exam pattern and Syllabus sections. Nothing here changes a job.

import { useCallback, useEffect, useMemo, useState } from "react";
import { readLibraryFile, examKey, type LibraryEntrySummary } from "@/lib/cms/syllabus-library";

const C = {
  bg: "#070b16", card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950",
};

const EXAMPLE = `LIBRARY
Exam: SSC CHSL (Combined Higher Secondary Level)
Match: ssc chsl; combined higher secondary

SOURCE
Basis: OFFICIAL NOTICE (2026)

EXAM PATTERN

Paper: Tier-I
Subjects:
General Awareness | 25 | 50

SYLLABUS

Subject: General Awareness
Topics:
History
Geography`;

interface Loaded { entries: LibraryEntrySummary[]; notSetUp: boolean; problem: string | null }

async function fetchLibrary(): Promise<Loaded> {
  try {
    const res = await fetch("/api/admin/cms/syllabus-library");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return { entries: data.entries ?? [], notSetUp: Boolean(data.notSetUp), problem: null };
  } catch (e) {
    return { entries: [], notSetUp: false, problem: e instanceof Error ? e.message : String(e) };
  }
}

export default function SyllabusLibraryPage() {
  const [entries, setEntries] = useState<LibraryEntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notSetUp, setNotSetUp] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const apply = useCallback((data: Loaded) => {
    setEntries(data.entries);
    setNotSetUp(data.notSetUp);
    setLoadErr(data.problem);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchLibrary().then((data) => { if (alive) apply(data); });
    return () => { alive = false; };
  }, [apply]);

  // The same check the server runs, so problems show before anything is sent.
  const read = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { file: readLibraryFile(text), problem: null };
    } catch (e) {
      return { file: null, problem: e instanceof Error ? e.message : "This file could not be read." };
    }
  }, [text]);
  const file = read?.file ?? null;
  const existing = file ? entries.find((e) => examKey(e.exam) === examKey(file.exam)) : undefined;

  async function save() {
    setSaving(true);
    setErr(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/cms/syllabus-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDone(`${data.replaced ? "Replaced" : "Added"} “${data.entry.exam}”.`);
      setText("");
      apply(await fetchLibrary());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const canSave = Boolean(file) && !saving && !notSetUp;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em", color: "#f1f5ff", margin: "0 0 6px" }}>Syllabus library</h1>
      <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 720 }}>
        One prepared file for each exam that comes back every year. When a job’s title contains an entry’s match words, the job editor offers
        that file in its Exam pattern and Syllabus sections. You still read it, correct it against the new notification and save it there:
        nothing on this page changes a job.
      </p>

      {notSetUp && (
        <div role="alert" style={{ color: C.amber, fontSize: 13, marginBottom: 16 }}>
          The syllabus library is not set up on this database yet. Its table has to be created once before files can be kept here.
        </div>
      )}
      {loadErr && <div role="alert" style={{ color: C.red, fontSize: 13, marginBottom: 16 }}>Could not load the library: {loadErr}</div>}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 24 }}>
        <label htmlFor="library-file" style={{ display: "block", fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 6 }}>
          Add or replace a file
        </label>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
          Paste the whole file. It starts with a LIBRARY block: “Exam:” names the exam, and “Match:” lists the words a job title must
          contain, with “;” between alternatives. A file for an exam already in the library replaces the one kept.
        </div>
        <textarea
          id="library-file"
          value={text}
          onChange={(e) => { setText(e.target.value); setErr(null); setDone(null); }}
          placeholder={EXAMPLE}
          style={{ width: "100%", height: 260, padding: "8px 10px", background: C.bg, border: "1px solid #2b3a5c", borderRadius: 6, color: C.text, fontSize: 12, boxSizing: "border-box", fontFamily: "ui-monospace, monospace", resize: "vertical" }}
        />

        {read?.problem && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{read.problem}</div>}
        {file && (
          <div role="status" style={{ fontSize: 12, color: C.text, marginTop: 8, lineHeight: 1.6 }}>
            <div>
              <b>{file.exam}</b>: {file.papers} exam paper{file.papers === 1 ? "" : "s"}, {file.subjects} syllabus subject{file.subjects === 1 ? "" : "s"}.
              {file.basis ? <span style={{ color: C.muted }}> Source stated: {file.basis}.</span> : null}
            </div>
            <div style={{ color: C.muted }}>Offered on jobs whose title contains: {file.match.map((m) => `“${m}”`).join(" or ")}</div>
            {existing && <div style={{ color: C.amber }}>Saving replaces the file already kept for “{existing.exam}”.</div>}
            {file.warnings.map((w, i) => <div key={i} style={{ color: C.amber }}>• {w}</div>)}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
          <button
            onClick={() => { void save(); }}
            disabled={!canSave}
            style={{ padding: "7px 18px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.6 }}
          >
            {saving ? "Saving…" : existing ? "Replace in the library" : "Add to the library"}
          </button>
          {done && <span role="status" style={{ color: C.green, fontSize: 12 }}>{done}</span>}
          {err && <span role="alert" style={{ color: C.red, fontSize: 12 }}>{err}</span>}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Exam", "Offered when the job title contains", "Source stated", "Kept since"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: C.muted, background: "rgba(7,11,22,0.55)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 16px", color: C.text, fontWeight: 600 }}>{e.exam}</td>
                  <td style={{ padding: "10px 16px", color: C.muted }}>{e.match.join(" · ")}</td>
                  <td style={{ padding: "10px 16px", color: e.basis && /not from an official notice/i.test(e.basis) ? C.amber : C.muted }}>{e.basis ?? "—"}</td>
                  <td style={{ padding: "10px 16px", color: C.muted, whiteSpace: "nowrap" }}>{new Date(e.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "24px 16px", color: C.muted, textAlign: "center" }}>
                    {loading ? "Loading…" : "The library is empty. Paste the first file above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
