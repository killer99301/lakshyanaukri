"use client";

import { useState, useEffect } from "react";
import type { CandidateNewRecruitment } from "@/intelligence/types";

const STATUS_COLORS: Record<string, string> = {
  PENDING_REVIEW: "#d29922",
  PR_CREATED: "#3fb950",
  PR_FAILED: "#f85149",
  PR_BRANCH_ORPHANED: "#f0883e",
  APPROVED: "#58a6ff",
  REJECTED: "#8b949e",
};

interface AuditEntry {
  ts?: string;
  timestamp?: string;
  source?: string;
  result?: string;
  recruited?: number;
  error?: string;
  [key: string]: unknown;
}

function fmt(ts: string | undefined): string {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

export default function HistoryPage() {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [candidates, setCandidates] = useState<CandidateNewRecruitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"candidates" | "audit">("candidates");
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/history")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setAuditEntries(data.auditEntries ?? []);
          setCandidates(data.candidates ?? []);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>History</h1>
          <p style={{ fontSize: 13, color: "#8b949e", margin: "4px 0 0" }}>
            {candidates.length} total candidates · {auditEntries.length} audit log entries
          </p>
        </div>
        <button
          onClick={refresh}
          style={{ padding: "6px 14px", background: "#21262d", border: "1px solid #30363d", borderRadius: 4, color: "#8b949e", fontSize: 12, cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #21262d", paddingBottom: 0 }}>
        {(["candidates", "audit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 16px",
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid #58a6ff" : "2px solid transparent",
              color: tab === t ? "#58a6ff" : "#8b949e",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t === "candidates" ? `Candidates (${candidates.length})` : `Audit log (${auditEntries.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: "#8b949e", fontSize: 13 }}>Loading…</p>
      ) : tab === "candidates" ? (
        <CandidatesTab candidates={candidates} />
      ) : (
        <AuditTab entries={auditEntries} />
      )}
    </div>
  );
}

function CandidatesTab({ candidates }: { candidates: CandidateNewRecruitment[] }) {
  if (candidates.length === 0) {
    return (
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "40px 24px", textAlign: "center", color: "#8b949e" }}>
        <div style={{ fontSize: 14 }}>No candidates yet.</div>
        <div style={{ fontSize: 13, marginTop: 8 }}>
          <a href="/admin/intake" style={{ color: "#58a6ff" }}>Run your first intake →</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #21262d" }}>
            {["Title", "Org", "Notif #", "Status", "Discovered", "PR"].map((h) => (
              <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#8b949e", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const statusColor = STATUS_COLORS[c.status] ?? "#8b949e";
            return (
              <tr key={c.candidateId} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ padding: "10px 12px", color: "#e2e8f0", maxWidth: 280 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title ?? <em style={{ color: "#484f58" }}>no title</em>}
                  </div>
                </td>
                <td style={{ padding: "10px 12px", color: "#8b949e", whiteSpace: "nowrap" }}>
                  {c.organizationName}
                </td>
                <td style={{ padding: "10px 12px", color: "#8b949e" }}>
                  <code style={{ fontSize: 11, background: "#21262d", padding: "1px 5px", borderRadius: 3 }}>
                    {c.notificationNumber ?? "—"}
                  </code>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: statusColor + "22", padding: "2px 8px", borderRadius: 4 }}>
                    {c.status}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "#8b949e", whiteSpace: "nowrap" }}>
                  {fmt(c.discoveredAt)}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {c.prUrl ? (
                    <a href={c.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff", fontSize: 12 }}>
                      #{c.prNumber} →
                    </a>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "40px 24px", textAlign: "center", color: "#8b949e", fontSize: 14 }}>
        No audit log entries yet.
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry, i) => {
        const ts = entry.ts ?? entry.timestamp;
        const hasError = !!entry.error;
        return (
          <div key={i} style={{ display: "flex", gap: 16, padding: "10px 0", borderBottom: "1px solid #21262d", alignItems: "flex-start" }}>
            <span style={{ fontSize: 11, color: "#484f58", whiteSpace: "nowrap", fontFamily: "monospace", minWidth: 160 }}>
              {fmt(ts)}
            </span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12, color: hasError ? "#f85149" : "#8b949e" }}>
                {entry.source ?? "intake"}{" "}
                {entry.result && <strong style={{ color: hasError ? "#f85149" : "#3fb950" }}>{String(entry.result)}</strong>}
                {typeof entry.recruited === "number" && <> · {entry.recruited} recruited</>}
                {entry.error && <> · {String(entry.error).slice(0, 120)}</>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
