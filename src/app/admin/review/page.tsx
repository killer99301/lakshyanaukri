"use client";
// ═══════════════════════════════════════════════════════════
// Phase 9D: Admin Review Queue
// ═══════════════════════════════════════════════════════════
//
// Shows all PENDING_REVIEW candidates from discovery-candidates.json.
// Each candidate can be:
//   - Expanded to see extracted fields + Trust Gate
//   - Edited inline (admin overrides — evidence not erased)
//   - Approved → triggers PR creation via /api/admin/candidates/[id]/approve
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import type { CandidateNewRecruitment } from "@/intelligence/types";

const S = {
  card: {
    background: "#161b22",
    border: "1px solid #21262d",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 8,
  } as React.CSSProperties,
  sectionHead: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#8b949e",
    borderBottom: "1px solid #21262d",
    paddingBottom: 6,
    marginBottom: 10,
  } as React.CSSProperties,
  input: {
    padding: "5px 10px",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 4,
    color: "#e2e8f0",
    fontSize: 13,
    fontFamily: "monospace",
    width: "100%",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_REVIEW: "#d29922",
  PR_CREATED: "#3fb950",
  PR_FAILED: "#f85149",
  PR_BRANCH_ORPHANED: "#f0883e",
  APPROVED: "#58a6ff",
  REJECTED: "#8b949e",
};

// Extend type for adminNote
type Candidate = CandidateNewRecruitment & { adminNote?: string };

// ─── Editable field ───────────────────────────────────────────

function EditField({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string | number | undefined;
  type?: "text" | "number" | "url" | "date";
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, alignItems: "center", padding: "4px 0" }}>
      <label style={{ fontSize: 12, color: "#8b949e", fontWeight: 500 }}>{label}</label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={S.input}
      />
    </div>
  );
}

// ─── Trust Gate panel ─────────────────────────────────────────

interface TrustGate {
  passed: boolean;
  errors: Array<{ field?: string; message: string }>;
  warnings: Array<{ field?: string; message: string }>;
}

function TrustGatePanel({ tg }: { tg: TrustGate | null }) {
  if (!tg) return <p style={{ fontSize: 12, color: "#8b949e" }}>Run Trust Gate check by clicking Approve (dry run)</p>;
  return (
    <div>
      <span style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        background: tg.passed ? "#238636" : "#da3633",
        color: "white",
        marginBottom: 8,
      }}>
        {tg.passed ? "PASS" : "FAIL"}
      </span>
      {tg.errors.map((e, i) => (
        <div key={i} style={{ fontSize: 12, color: "#f85149", padding: "1px 0" }}>✗ [{e.field ?? "?"}] {e.message}</div>
      ))}
      {tg.warnings.map((w, i) => (
        <div key={i} style={{ fontSize: 12, color: "#d29922", padding: "1px 0" }}>⚠ [{w.field ?? "?"}] {w.message}</div>
      ))}
    </div>
  );
}

// ─── Single candidate card ────────────────────────────────────

function CandidateCard({ candidate: initial, onUpdated }: {
  candidate: Candidate;
  onUpdated: (c: Candidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [edits, setEdits] = useState<Partial<Candidate>>({});
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [tg, setTg] = useState<TrustGate | null>(null);
  const [prResult, setPrResult] = useState<{ outcome: string; prUrl?: string; error?: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const c = { ...initial, ...edits };

  function set(field: keyof Candidate) {
    return (v: string) => setEdits((e) => ({ ...e, [field]: v || undefined }));
  }

  function setNum(field: keyof Candidate) {
    return (v: string) => setEdits((e) => ({ ...e, [field]: v ? parseInt(v, 10) : undefined }));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/candidates/${c.candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edits),
      });
      if (!res.ok) { setMsg(`Save failed: ${(await res.json()).error}`); return; }
      const data = await res.json();
      setEdits({});
      onUpdated(data.candidate);
      setMsg("Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(dryRun: boolean) {
    setApproving(true);
    setMsg(null);
    setPrResult(null);
    setTg(null);
    try {
      const res = await fetch(`/api/admin/candidates/${c.candidateId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      const data = await res.json();
      setTg({
        passed: data.trustGatePassed,
        errors: data.trustGateErrors?.map((m: string) => ({ message: m })) ?? [],
        warnings: data.trustGateWarnings?.map((m: string) => ({ message: m })) ?? [],
      });
      setPrResult({ outcome: data.outcome, prUrl: data.prUrl, error: data.error });
      if (!dryRun && data.outcome === "PR_CREATED") {
        onUpdated({ ...c, status: "PR_CREATED", prUrl: data.prUrl, prNumber: data.prNumber });
        setMsg(`PR created: ${data.prUrl}`);
      } else if (dryRun) {
        setMsg(data.trustGatePassed ? "Dry run: Trust Gate PASSED — ready to approve." : "Dry run: Trust Gate FAILED — see errors below.");
      } else {
        setMsg(`Outcome: ${data.outcome}${data.error ? ` — ${data.error}` : ""}`);
      }
    } finally {
      setApproving(false);
    }
  }

  const hasEdits = Object.keys(edits).length > 0;
  const statusColor = STATUS_COLORS[c.status] ?? "#8b949e";

  return (
    <div style={S.card}>
      {/* Header row */}
      <div
        style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
            {c.title ?? <em style={{ color: "#8b949e", fontWeight: 400 }}>title not set</em>}
          </span>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>
            <span>{c.organizationName}</span>
            {c.notificationNumber && <span> · <code style={{ fontFamily: "monospace", fontSize: 11, background: "#21262d", padding: "1px 5px", borderRadius: 3 }}>{c.notificationNumber}</code></span>}
            {c.adminNote && <span style={{ color: "#58a6ff" }}> · note: {c.adminNote.slice(0, 60)}</span>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: statusColor + "22", padding: "2px 8px", borderRadius: 4 }}>
            {c.status}
          </span>
          {c.prUrl && (
            <a href={c.prUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#58a6ff" }} onClick={(e) => e.stopPropagation()}>
              PR →
            </a>
          )}
          <span style={{ color: "#8b949e", fontSize: 16 }}>{expanded ? "▾" : "▸"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #21262d", padding: "20px" }}>
          {/* Editable fields */}
          <div style={S.sectionHead}>Fields — edit before approving</div>
          <div style={{ marginBottom: 16 }}>
            <EditField label="Title"                value={c.title}                  type="text"   onChange={set("title")} />
            <EditField label="Notification number"  value={c.notificationNumber}      type="text"   onChange={set("notificationNumber")} />
            <EditField label="Total vacancies"      value={c.totalVacancies}          type="number" onChange={setNum("totalVacancies")} />
            <EditField label="Application open"     value={c.applicationOpenDate}     type="date"   onChange={set("applicationOpenDate")} />
            <EditField label="Application close"    value={c.applicationCloseDate}    type="date"   onChange={set("applicationCloseDate")} />
            <EditField label="Notification date"    value={c.postDate}                type="date"   onChange={set("postDate")} />
            <EditField label="Notification PDF URL" value={c.notifPdfUrl}             type="url"    onChange={set("notifPdfUrl")} />
          </div>

          {hasEdits && (
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: "6px 16px", background: "#1f6feb", border: "none", borderRadius: 4, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {saving ? "Saving…" : "Save Edits"}
              </button>
              <button
                onClick={() => setEdits({})}
                style={{ padding: "6px 16px", background: "none", border: "1px solid #21262d", borderRadius: 4, color: "#8b949e", fontSize: 13, cursor: "pointer" }}
              >
                Discard
              </button>
              <span style={{ fontSize: 12, color: "#d29922" }}>Unsaved changes</span>
            </div>
          )}

          {/* Trust Gate */}
          <div style={S.sectionHead}>Trust Gate</div>
          <div style={{ marginBottom: 16 }}>
            <TrustGatePanel tg={tg} />
          </div>

          {/* Provenance info */}
          <div style={S.sectionHead}>Provenance</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 16, fontFamily: "monospace" }}>
            <div>ID: {c.candidateId}</div>
            <div>Org ID: {c.organizationId}</div>
            <div>Discovery source: {c.discoverySourceUrl}</div>
            <div>Discovered: {c.discoveredAt}</div>
            <div>Confidence: {Math.round((c.confidence ?? 0) * 100)}%</div>
          </div>

          {/* Approval actions */}
          <div style={S.sectionHead}>Approval</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => handleApprove(true)}
              disabled={approving || hasEdits}
              title={hasEdits ? "Save edits first" : ""}
              style={{
                padding: "7px 18px",
                background: "#21262d",
                border: "1px solid #30363d",
                borderRadius: 4,
                color: hasEdits ? "#484f58" : "#e2e8f0",
                fontSize: 13,
                fontWeight: 600,
                cursor: hasEdits || approving ? "default" : "pointer",
              }}
            >
              {approving ? "Checking…" : "Check Trust Gate (dry run)"}
            </button>
            <button
              onClick={() => handleApprove(false)}
              disabled={approving || hasEdits || c.status === "PR_CREATED"}
              title={hasEdits ? "Save edits first" : c.status === "PR_CREATED" ? "PR already created" : ""}
              style={{
                padding: "7px 18px",
                background: hasEdits || c.status === "PR_CREATED" ? "#21262d" : "#238636",
                border: "none",
                borderRadius: 4,
                color: hasEdits || c.status === "PR_CREATED" ? "#484f58" : "white",
                fontSize: 13,
                fontWeight: 700,
                cursor: hasEdits || approving || c.status === "PR_CREATED" ? "default" : "pointer",
              }}
            >
              {approving ? "Creating PR…" : "Approve & Create PR"}
            </button>
          </div>

          {msg && (
            <div style={{ fontSize: 13, color: prResult?.outcome === "PR_CREATED" ? "#3fb950" : "#d29922", fontFamily: "monospace" }}>
              {msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────

export default function ReviewPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"PENDING_REVIEW" | "ALL">("PENDING_REVIEW");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/candidates")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setCandidates(data.candidates ?? []);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const visible = filter === "ALL"
    ? candidates
    : candidates.filter((c) => c.status === "PENDING_REVIEW");

  const counts = {
    pending: candidates.filter((c) => c.status === "PENDING_REVIEW").length,
    prCreated: candidates.filter((c) => c.status === "PR_CREATED").length,
    failed: candidates.filter((c) => c.status === "PR_FAILED" || c.status === "PR_BRANCH_ORPHANED").length,
  };

  function updateCandidate(updated: Candidate) {
    setCandidates((prev) => prev.map((c) => c.candidateId === updated.candidateId ? updated : c));
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>Pending Review</h1>
          <p style={{ fontSize: 13, color: "#8b949e", margin: "4px 0 0" }}>
            {counts.pending} pending · {counts.prCreated} PR created · {counts.failed} failed
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            style={{ padding: "6px 10px", background: "#21262d", border: "1px solid #30363d", borderRadius: 4, color: "#e2e8f0", fontSize: 12, cursor: "pointer" }}
          >
            <option value="PENDING_REVIEW">Pending only</option>
            <option value="ALL">All candidates</option>
          </select>
          <button onClick={load} style={{ padding: "6px 14px", background: "#21262d", border: "1px solid #30363d", borderRadius: 4, color: "#8b949e", fontSize: 12, cursor: "pointer" }}>
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#8b949e", fontSize: 13 }}>Loading…</p>
      ) : visible.length === 0 ? (
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "40px 24px", textAlign: "center", color: "#8b949e" }}>
          {filter === "PENDING_REVIEW" ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 14 }}>Queue is empty — all caught up.</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>
                <a href="/admin/intake" style={{ color: "#58a6ff" }}>Run a new intake →</a>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14 }}>No candidates in queue yet.</div>
          )}
        </div>
      ) : (
        visible.map((c) => (
          <CandidateCard key={c.candidateId} candidate={c} onUpdated={updateCandidate} />
        ))
      )}
    </div>
  );
}
