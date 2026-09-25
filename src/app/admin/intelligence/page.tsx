"use client";
// ═══════════════════════════════════════════════════════════
// Phase 14: Intelligence Drafts — List
// ═══════════════════════════════════════════════════════════
//
// Shows all intelligence_drafts rows. Each row links to the
// draft review page (/admin/intelligence/[id]) where the admin
// can inspect evidence, resolve conflicts, and promote to CMS.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface DraftRow {
  id: string;
  status: string;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  titlePreview: string | null;
  orgPreview: string | null;
}

const S = {
  h1: { fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: 0 } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    color: "#8b949e",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    borderBottom: "1px solid #21262d",
  } as React.CSSProperties,
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #161b22",
    fontSize: 13,
    color: "#e2e8f0",
    verticalAlign: "top" as const,
  } as React.CSSProperties,
};

function statusColor(s: string): string {
  if (s === "IN_REVIEW") return "#d29922";
  return "#8b949e";
}

export default function IntelligenceDraftsPage() {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/intelligence/drafts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={S.h1}>Intelligence Drafts</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <Link
            href="/admin/intake"
            style={{
              padding: "8px 18px",
              background: "#238636",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            + New Intake
          </Link>
        </div>
      </div>

      {loading && (
        <div style={{ color: "#8b949e", fontSize: 13 }}>Loading…</div>
      )}
      {error && (
        <div style={{ background: "#f8514922", border: "1px solid #f8514944", borderRadius: 6, padding: "12px 16px", color: "#f85149", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && drafts.length === 0 && (
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "32px 24px", textAlign: "center", color: "#8b949e", fontSize: 13 }}>
          No intelligence drafts yet.{" "}
          <Link href="/admin/intake" style={{ color: "#58a6ff" }}>Run an intake</Link>{" "}
          to create the first one.
        </div>
      )}

      {drafts.length > 0 && (
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={S.th}>Recruitment</th>
                <th style={S.th}>Organisation</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Rev</th>
                <th style={S.th}>Updated</th>
                <th style={{ ...S.th, textAlign: "right" as const }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id} style={{ cursor: "pointer" }}>
                  <td style={S.td}>
                    <Link href={`/admin/intelligence/${d.id}`} style={{ color: "#58a6ff", textDecoration: "none", fontWeight: 500 }}>
                      {d.titlePreview ?? <em style={{ color: "#8b949e" }}>untitled</em>}
                    </Link>
                  </td>
                  <td style={{ ...S.td, color: "#8b949e" }}>{d.orgPreview ?? "—"}</td>
                  <td style={S.td}>
                    <span style={{ color: statusColor(d.status), fontWeight: 600, fontSize: 11 }}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ ...S.td, color: "#8b949e" }}>v{d.currentRevision}</td>
                  <td style={{ ...S.td, color: "#8b949e" }}>
                    {new Date(d.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td style={{ ...S.td, textAlign: "right" as const }}>
                    <Link
                      href={`/admin/intelligence/${d.id}`}
                      style={{ color: "#58a6ff", fontSize: 12, textDecoration: "none" }}
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
