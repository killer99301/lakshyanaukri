"use client";
// ═══════════════════════════════════════════════════════════
// Phase D: CMS — Create New Recruitment Record
// ═══════════════════════════════════════════════════════════

import { useState } from "react";
import { useRouter } from "next/navigation";

const ORG_OPTIONS = [
  { id: "bpsc",  label: "BPSC — Bihar Public Service Commission" },
  { id: "upsc",  label: "UPSC — Union Public Service Commission" },
  { id: "ssc",   label: "SSC — Staff Selection Commission" },
  { id: "rrb",   label: "RRB — Railway Recruitment Boards" },
  { id: "ibps",  label: "IBPS — Banking Personnel Selection" },
  { id: "sbi",   label: "SBI — State Bank of India" },
  { id: "uppsc", label: "UPPSC — Uttar Pradesh PSC" },
  { id: "rpsc",  label: "RPSC — Rajasthan PSC" },
  { id: "mppsc", label: "MPPSC — Madhya Pradesh PSC" },
  { id: "mpsc",  label: "MPSC — Maharashtra PSC" },
  { id: "iaf",   label: "IAF — Indian Air Force" },
  { id: "navy",  label: "Indian Navy" },
  { id: "isro",  label: "ISRO — Indian Space Research Organisation" },
];

const ORG_NAMES: Record<string, string> = {
  bpsc:  "Bihar Public Service Commission",
  upsc:  "Union Public Service Commission",
  ssc:   "Staff Selection Commission",
  rrb:   "Railway Recruitment Boards",
  ibps:  "Institute of Banking Personnel Selection",
  sbi:   "State Bank of India",
  uppsc: "Uttar Pradesh Public Service Commission",
  rpsc:  "Rajasthan Public Service Commission",
  mppsc: "Madhya Pradesh Public Service Commission",
  mpsc:  "Maharashtra Public Service Commission",
  iaf:   "Indian Air Force",
  navy:  "Indian Navy",
  isro:  "Indian Space Research Organisation",
};

const S = {
  card: {
    background: "#161b22",
    border: "1px solid #21262d",
    borderRadius: 10,
    padding: 32,
    maxWidth: 560,
  } as React.CSSProperties,
  h1: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e2e8f0",
    marginBottom: 24,
    marginTop: 0,
  } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#8b949e",
    marginBottom: 6,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  field: { marginBottom: 20 } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "8px 12px",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 13,
    boxSizing: "border-box" as const,
    outline: "none",
  } as React.CSSProperties,
  select: {
    width: "100%",
    padding: "8px 12px",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 13,
    boxSizing: "border-box" as const,
    outline: "none",
  } as React.CSSProperties,
  row: {
    display: "flex",
    gap: 16,
  } as React.CSSProperties,
  btn: {
    padding: "10px 24px",
    background: "#1f6feb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
  } as React.CSSProperties,
  err: {
    color: "#f85149",
    fontSize: 13,
    marginTop: 12,
    padding: "10px 14px",
    background: "#f8514922",
    borderRadius: 6,
    border: "1px solid #f8514944",
  } as React.CSSProperties,
};

export default function NewCmsRecordPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState("bpsc");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [govType, setGovType] = useState<"Central Govt" | "State Govt" | "PSU">("State Govt");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Title is required"); return; }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/cms/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          organizationName: ORG_NAMES[orgId] ?? orgId,
          govType,
          title: title.trim(),
          recruitmentYear: year,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/admin/cms/${data.record.id}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 style={{ ...S.h1, marginBottom: 0 }}>New Recruitment Record</h1>
      <p style={{ color: "#8b949e", fontSize: 13, marginBottom: 24, marginTop: 6 }}>
        Creates a DRAFT record. You can fill all fields in the editor after creation.
      </p>

      <div style={S.card}>
        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <div style={S.field}>
            <label style={S.label}>Organization</label>
            <select
              style={S.select}
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
              {ORG_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
              <option value="other">Other (custom)</option>
            </select>
          </div>

          <div style={S.field}>
            <label style={S.label}>Recruitment Title</label>
            <input
              style={S.input}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. BPSC 72nd Combined Competitive Exam"
            />
          </div>

          <div style={S.row}>
            <div style={{ ...S.field, flex: 1 }}>
              <label style={S.label}>Year</label>
              <input
                style={S.input}
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                min={2020}
                max={2035}
              />
            </div>
            <div style={{ ...S.field, flex: 2 }}>
              <label style={S.label}>Govt Type</label>
              <select
                style={S.select}
                value={govType}
                onChange={(e) => setGovType(e.target.value as typeof govType)}
              >
                <option value="Central Govt">Central Govt</option>
                <option value="State Govt">State Govt</option>
                <option value="PSU">PSU</option>
              </select>
            </div>
          </div>

          {err && <div style={S.err}>{err}</div>}

          <button type="submit" style={S.btn} disabled={saving}>
            {saving ? "Creating…" : "Create Record"}
          </button>
        </form>
      </div>
    </div>
  );
}
