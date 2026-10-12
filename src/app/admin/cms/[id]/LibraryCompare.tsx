"use client";

// ═══════════════════════════════════════════════════════════
// Admin: this job's exam pattern and syllabus against the library's copy
// ═══════════════════════════════════════════════════════════
//
// The library holds what an exam's pattern and syllabus were the last time.
// Once this job has its own (typed, pasted or filled by AI Assist from this
// year's notice), the two are compared here and every difference is listed in
// plain words, so a change in the new notice is seen without reading both.
//
// Nothing is changed by looking. The one button replaces the library's copy
// with this job's, and only when the admin presses it.

import { useEffect, useMemo, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { parseContentFile } from "@/lib/cms/content-import";
import { suggestFromLibrary, type LibraryEntrySummary } from "@/lib/cms/syllabus-library";
import { compareWithLibrary } from "@/lib/cms/library-compare";
import { buildLibraryFile, isAutoEntryOf, isUnapproved, updatedBasis } from "@/lib/cms/library-from-job";

const C = { card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8", accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950" };

interface Kept { entry: LibraryEntrySummary; content: string }

async function loadMatch(names: Array<string | null | undefined>): Promise<Kept | null> {
  const res = await fetch("/api/admin/cms/syllabus-library");
  const data = await res.json();
  if (!res.ok) return null;
  const match = suggestFromLibrary((data.entries ?? []) as LibraryEntrySummary[], names)[0];
  if (!match) return null;
  const one = await fetch(`/api/admin/cms/syllabus-library?id=${encodeURIComponent(match.id)}`);
  const got = await one.json();
  return one.ok && got.entry?.content ? { entry: match, content: got.entry.content as string } : null;
}

export function LibraryCompare({ record }: { record: RecruitmentRecord }) {
  const [kept, setKept] = useState<Kept | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const title = record.identity.title?.value ?? "";
  const shortTitle = record.identity.shortTitle?.value ?? "";
  const organization = record.identity.organizationName;
  // Looked up again after each save, because a save may have just put this job's copy in the library.
  const revision = record.recordRevision;

  useEffect(() => {
    let alive = true;
    void loadMatch([title, shortTitle, organization])
      .then((found) => { if (alive) setKept(found); })
      .catch(() => { if (alive) setKept(null); });
    return () => { alive = false; };
  }, [title, shortTitle, organization, revision]);

  const examPattern = useMemo(() => record.examPattern?.value ?? [], [record.examPattern]);
  const syllabus = useMemo(() => record.syllabus?.value ?? [], [record.syllabus]);

  const result = useMemo(() => {
    if (!kept) return null;
    const old = parseContentFile(kept.content);
    return compareWithLibrary({ examPattern: old.examPattern, syllabus: old.syllabus }, { examPattern, syllabus });
  }, [kept, examPattern, syllabus]);

  if (!kept || !result || (examPattern.length === 0 && syllabus.length === 0)) return null;

  const differences = [...result.pattern, ...result.syllabus];
  const own = isAutoEntryOf(kept.entry.basis, record.slug);
  // This job's own automatic copy always equals the job; there is nothing to compare it with.
  if (own && differences.length === 0 && result.notCompared.length === 0) {
    return (
      <div role="status" style={{ fontSize: 12, color: C.muted, margin: "0 0 12px", lineHeight: 1.5 }}>
        This job’s exam pattern and syllabus are kept in the syllabus library as “{kept.entry.exam}”
        {isUnapproved(kept.entry.basis) ? ", not yet approved. Approve it on the Syllabus page once you have checked it against the notice." : "."}
      </div>
    );
  }

  async function replace() {
    if (!kept) return;
    setSaving(true);
    setNote(null);
    try {
      const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      // A part this job does not have is kept as the library has it, never dropped.
      const old = parseContentFile(kept.content);
      const text = buildLibraryFile({
        exam: kept.entry.exam,
        match: kept.entry.match,
        basis: updatedBasis(title, today),
        examPattern: examPattern.length > 0 ? examPattern : old.examPattern,
        syllabus: syllabus.length > 0 ? syllabus : old.syllabus,
      });
      const res = await fetch("/api/admin/cms/syllabus-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setKept({ entry: { ...kept.entry, basis: updatedBasis(title, today) }, content: text });
      setNote({ ok: true, text: `The library entry “${kept.entry.exam}” now holds this job’s version.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const since = new Date(kept.entry.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section aria-label="Compared with the syllabus library" style={{ background: C.card, border: `1px solid ${differences.length > 0 ? C.amber + "55" : C.border}`, borderRadius: 10, padding: 12, margin: "0 0 14px", fontSize: 12, lineHeight: 1.55 }}>
      <div style={{ color: C.text, fontWeight: 700 }}>
        Compared with the library’s copy, “{kept.entry.exam}” (kept since {since})
        {isUnapproved(kept.entry.basis) ? <span style={{ color: C.amber, fontWeight: 500 }}> · not yet approved</span> : null}
      </div>

      {differences.length === 0 ? (
        <div style={{ color: C.green, marginTop: 4 }}>
          No differences{result.notCompared.length > 0 ? " in the part both have" : ""}: this job’s exam pattern and syllabus match the library’s copy.
        </div>
      ) : (
        <>
          <div style={{ color: C.amber, marginTop: 4 }}>
            {differences.length} difference{differences.length === 1 ? "" : "s"}. If this job was filled from the new notice, the exam has changed; if it was filled from the library, something was edited.
          </div>
          {result.pattern.length > 0 && <div style={{ color: C.muted, marginTop: 8, fontWeight: 600 }}>Exam pattern</div>}
          {result.pattern.map((d, i) => <div key={`p${i}`} style={{ color: C.text }}>• {d}</div>)}
          {result.syllabus.length > 0 && <div style={{ color: C.muted, marginTop: 8, fontWeight: 600 }}>Syllabus</div>}
          {result.syllabus.map((d, i) => <div key={`s${i}`} style={{ color: C.text }}>• {d}</div>)}
        </>
      )}
      {result.notCompared.map((d, i) => <div key={`n${i}`} style={{ color: C.muted, marginTop: 4 }}>{d}</div>)}

      {(differences.length > 0 || result.notCompared.length > 0) && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <button
            onClick={() => { void replace(); }}
            disabled={saving}
            title="Replaces the library's copy for this exam with what is on this job now. A part this job does not have is kept as the library has it."
            style={{ padding: "5px 14px", background: "none", border: `1px solid ${C.accent}66`, color: C.accent, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: saving ? "wait" : "pointer" }}
          >
            {saving ? "Saving…" : "Update the library with this job’s version"}
          </button>
          <span style={{ color: C.muted }}>Only press this once you have checked this job against the notice.</span>
        </div>
      )}
      {note && <div role={note.ok ? "status" : "alert"} style={{ color: note.ok ? C.green : C.red, marginTop: 8 }}>{note.text}</div>}
    </section>
  );
}
