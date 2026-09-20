"use client";
// ═══════════════════════════════════════════════════════════
// Phase D: CMS — Recruitment Records List
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const S = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  } as React.CSSProperties,
  h1: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e2e8f0",
    margin: 0,
  } as React.CSSProperties,
  btn: {
    padding: "8px 18px",
    background: "#1f6feb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } as React.CSSProperties,
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
    color: "#e2e8f0",
    verticalAlign: "top" as const,
  } as React.CSSProperties,
  link: {
    color: "#58a6ff",
    textDecoration: "none",
    fontWeight: 500,
  } as React.CSSProperties,
  empty: {
    textAlign: "center" as const,
    color: "#8b949e",
    padding: "60px 24px",
    fontSize: 14,
  } as React.CSSProperties,
};

const STATE_COLORS: Record<string, string> = {
  DRAFT:     "#d29922",
  APPROVED:  "#3fb950",
  PUBLISHED: "#58a6ff",
  ARCHIVED:  "#8b949e",
};

interface RecordRow {
  id: string;
  slug: string;
  draft_state: string;
  organization_id: string;
  organization_name: string;
  title_text: string;
  gov_type: string;
  updated_at: string;
}

export default function CmsListPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cms/records");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecords(data.records ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div style={S.empty}>Loading records…</div>;
  if (error) return <div style={{ ...S.empty, color: "#f85149" }}>Error: {error}</div>;

  return (
    <div>
      <div style={S.header}>
        <h1 style={S.h1}>Recruitment Records</h1>
        <Link href="/admin/cms/new" style={S.btn}>+ New Record</Link>
      </div>

      {records.length === 0 ? (
        <div style={S.empty}>
          No records yet.{" "}
          <Link href="/admin/cms/new" style={{ color: "#58a6ff" }}>
            Create the first one.
          </Link>
        </div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Title</th>
              <th style={S.th}>Organization</th>
              <th style={S.th}>Type</th>
              <th style={S.th}>State</th>
              <th style={S.th}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td style={S.td}>
                  <Link href={`/admin/cms/${r.id}`} style={S.link}>
                    {r.title_text ?? r.slug}
                  </Link>
                  <div style={{ color: "#8b949e", fontSize: 11, marginTop: 2 }}>{r.slug}</div>
                </td>
                <td style={S.td}>{r.organization_name ?? r.organization_id}</td>
                <td style={S.td}>{r.gov_type ?? "—"}</td>
                <td style={S.td}>
                  <span style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    background: (STATE_COLORS[r.draft_state] ?? "#8b949e") + "22",
                    color: STATE_COLORS[r.draft_state] ?? "#8b949e",
                    border: `1px solid ${STATE_COLORS[r.draft_state] ?? "#8b949e"}44`,
                  }}>
                    {r.draft_state}
                  </span>
                </td>
                <td style={{ ...S.td, color: "#8b949e", fontSize: 12 }}>
                  {r.updated_at ? new Date(r.updated_at).toLocaleDateString("en-IN") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
