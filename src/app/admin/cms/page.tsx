"use client";
// ═══════════════════════════════════════════════════════════
// Phase D: CMS — Recruitment Records List
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";

const S = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  } as React.CSSProperties,
  h1: {
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: "-0.01em",
    color: "#f1f5ff",
    margin: 0,
  } as React.CSSProperties,
  btn: {
    padding: "9px 18px",
    background: "linear-gradient(135deg, #f97316, #fb7185)",
    boxShadow: "0 0 22px rgba(249,115,22,0.35)",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  } as React.CSSProperties,
  card: {
    background: "rgba(14,21,38,0.72)",
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 14,
    overflow: "hidden",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 40px rgba(0,0,0,0.28)",
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "10px 16px",
    color: "#8c9bb8",
    background: "rgba(7,11,22,0.55)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    borderBottom: "1px solid #1c2740",
  } as React.CSSProperties,
  td: {
    padding: "12px 16px",
    borderBottom: "1px solid #131c31",
    color: "#e2e8f0",
    verticalAlign: "top" as const,
  } as React.CSSProperties,
  link: {
    color: "#62b5ff",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: 14,
  } as React.CSSProperties,
  empty: {
    textAlign: "center" as const,
    color: "#8c9bb8",
    padding: "60px 24px",
    fontSize: 14,
  } as React.CSSProperties,
};

const STATE_COLORS: Record<string, string> = {
  DRAFT:     "#d29922",
  APPROVED:  "#3fb950",
  PUBLISHED: "#62b5ff",
  ARCHIVED:  "#8c9bb8",
};

const STATE_LABELS: Record<string, string> = {
  DRAFT:     "Draft",
  APPROVED:  "Approved",
  PUBLISHED: "Published",
  ARCHIVED:  "Archived",
};

const FILTERS = ["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"] as const;
type Filter = (typeof FILTERS)[number];

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

// Approved records are drafts that have not gone live yet.
const filterOf = (state: string): string => (state === "APPROVED" ? "DRAFT" : state);

function updatedLabel(iso: string | undefined, now: number): string {
  if (!iso) return "—";
  const then = new Date(iso);
  const days = Math.floor((now - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function CmsListPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cms/records");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecords(data.records ?? []);
      setLoadedAt(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: records.length, DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const r of records) {
      const key = filterOf(r.draft_state) as Filter;
      if (key in c && key !== "ALL") c[key]++;
    }
    return c;
  }, [records]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (filter !== "ALL" && filterOf(r.draft_state) !== filter) return false;
      if (!q) return true;
      return [r.title_text, r.organization_name, r.organization_id, r.slug].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [records, query, filter]);

  if (loading) return <div style={S.empty}>Loading records…</div>;
  if (error) return <div style={{ ...S.empty, color: "#f85149" }}>Error: {error}</div>;

  return (
    <div>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>Jobs</h1>
          <div style={{ fontSize: 13, color: "#8c9bb8", marginTop: 4 }}>
            Create a record, fill it with AI Assist, check it, then publish.
          </div>
        </div>
        <Link href="/admin/cms/new" style={S.btn}>+ New job</Link>
      </div>

      {records.length === 0 ? (
        <div style={{ ...S.card, ...S.empty }}>
          No records yet.{" "}
          <Link href="/admin/cms/new" style={{ color: "#62b5ff" }}>
            Create the first one.
          </Link>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FILTERS.map((f) => {
                const active = filter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: active ? "#16223d" : "transparent",
                      color: active ? "#fff" : "#8c9bb8",
                      border: `1px solid ${active ? "#f97316" : "#2b3a5c"}`,
                    }}
                  >
                    {f === "ALL" ? "All" : STATE_LABELS[f]}{" "}
                    <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{counts[f]}</span>
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or organisation…"
              aria-label="Search jobs"
              style={{
                marginLeft: "auto",
                width: "min(320px, 100%)",
                padding: "8px 12px",
                background: "#070b16",
                border: "1px solid #2b3a5c",
                borderRadius: 8,
                color: "#e2e8f0",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ ...S.card, overflowX: "auto" }}>
            {visible.length === 0 ? (
              <div style={S.empty}>Nothing matches. Clear the search or pick another filter.</div>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Job</th>
                    <th style={S.th}>Organisation</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Updated</th>
                    <th style={S.th} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const color = STATE_COLORS[r.draft_state] ?? "#8c9bb8";
                    return (
                      <tr key={r.id} className="cms-row">
                        <td style={S.td}>
                          <Link href={`/admin/cms/${r.id}`} style={S.link}>
                            {r.title_text ?? r.slug}
                          </Link>
                          <div style={{ color: "#6e7681", fontSize: 11, marginTop: 3 }}>{r.slug}</div>
                        </td>
                        <td style={S.td}>
                          {r.organization_name ?? r.organization_id}
                          <div style={{ color: "#6e7681", fontSize: 11, marginTop: 3 }}>{r.gov_type ?? ""}</div>
                        </td>
                        <td style={S.td}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 10px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: color + "22",
                            color,
                            border: `1px solid ${color}44`,
                            whiteSpace: "nowrap",
                          }}>
                            {STATE_LABELS[r.draft_state] ?? r.draft_state}
                          </span>
                        </td>
                        <td style={{ ...S.td, color: "#8c9bb8", fontSize: 12, whiteSpace: "nowrap" }}>
                          {updatedLabel(r.updated_at, loadedAt)}
                        </td>
                        <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                          {r.draft_state === "PUBLISHED" && (
                            <a
                              href={`/jobs/${r.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#8c9bb8", fontSize: 12, textDecoration: "none", marginRight: 14 }}
                            >
                              View live ↗
                            </a>
                          )}
                          <Link href={`/admin/cms/${r.id}`} style={{ color: "#62b5ff", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                            Open →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <style>{".cms-row td { transition: background-color .15s ease; } .cms-row:hover td { background: rgba(99,102,241,0.08); }"}</style>
        </>
      )}
    </div>
  );
}
