"use client";

// ═══════════════════════════════════════════════════════════
// Admin: what republishing would change on the live page
// ═══════════════════════════════════════════════════════════
//
// Shown on a live job that is open for editing. Lists each difference between
// the page visitors see now and what the edit would publish, so nothing
// changes on the public page by accident. Read only.

import { useEffect, useMemo, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview, type PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import { liveChanges } from "@/lib/cms/live-changes";

const C = { card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8", accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950" };

export function LiveChangesPanel({ record, onJump }: { record: RecruitmentRecord; onJump: (section: string) => void }) {
  const editingLive = Boolean(record.publishedAt) && (record.draftState === "DRAFT" || record.draftState === "APPROVED");
  const [live, setLive] = useState<PublishedRecruitmentSnapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!editingLive) return;
    let alive = true;
    fetch(`/api/admin/cms/records/${record.id}/published`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) { setLive(d.snapshot ?? null); setProblem(null); } })
      .catch((e) => { if (alive) setProblem(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [editingLive, record.id]);

  const changes = useMemo(() => (live ? liveChanges(live, projectForPreview(record)) : []), [live, record]);

  if (!editingLive) return null;
  if (problem) return <div role="alert" style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>Could not load the live page to compare: {problem}</div>;
  if (!live) return null;

  return (
    <section aria-label="Changes against the live page" style={{ background: C.card, border: `1px solid ${changes.length > 0 ? C.accent + "55" : C.border}`, borderRadius: 14, padding: "12px 16px", marginBottom: 16, fontSize: 12, lineHeight: 1.55 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.text, fontSize: 13, fontWeight: 700, textAlign: "left" }}>
        {changes.length === 0
          ? "Nothing differs from the live page yet"
          : `Publishing will change ${changes.length} thing${changes.length === 1 ? "" : "s"} on the live page`}
        {changes.length > 0 && <span style={{ color: C.muted, fontWeight: 400 }}> {open ? "▾" : "▸"}</span>}
      </button>
      {open && changes.length > 0 && (
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["", "Live now", "After publishing"].map((h) => (
                  <th key={h} style={{ textAlign: "left", color: C.muted, fontWeight: 600, fontSize: 11, padding: "4px 8px 4px 0", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i} style={{ verticalAlign: "top" }}>
                  <td style={{ padding: "5px 10px 5px 0", whiteSpace: "nowrap" }}>
                    <button onClick={() => onJump(c.section)} title="Open this section" style={{ background: "none", border: "none", padding: 0, color: C.accent, cursor: "pointer", fontSize: 12, textAlign: "left" }}>{c.label}</button>
                  </td>
                  {c.before === "" ? (
                    <td colSpan={2} style={{ padding: "5px 0", color: C.text }}>{c.after}</td>
                  ) : (
                    <>
                      <td style={{ padding: "5px 10px 5px 0", color: C.muted, overflowWrap: "anywhere" }}>{c.before}</td>
                      <td style={{ padding: "5px 0", color: c.after === "Removed" ? C.red : C.text, fontWeight: 600, overflowWrap: "anywhere" }}>{c.after}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
