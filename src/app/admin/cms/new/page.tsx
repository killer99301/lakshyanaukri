"use client";
// ═══════════════════════════════════════════════════════════
// Phase D: CMS — Create New Recruitment Record
// ═══════════════════════════════════════════════════════════

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { slugify } from "@/lib/cms/slug";

interface DuplicateRecord {
  id: string;
  slug: string;
  draftState: string;
  title: string;
}

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
    background: "#0e1526",
    border: "1px solid #1c2740",
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
    color: "#8c9bb8",
    marginBottom: 6,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  field: { marginBottom: 20 } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "8px 12px",
    background: "#070b16",
    border: "1px solid #1c2740",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 13,
    boxSizing: "border-box" as const,
    outline: "none",
  } as React.CSSProperties,
  select: {
    width: "100%",
    padding: "8px 12px",
    background: "#070b16",
    border: "1px solid #1c2740",
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
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
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
  const [customOrgName, setCustomOrgName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateRecord[] | null>(null);

  const isCustomOrg = orgId === "other";

  async function submit(forceCreate: boolean) {
    if (!title.trim()) { setErr("Title is required"); return; }
    const organizationName = isCustomOrg ? customOrgName.trim() : (ORG_NAMES[orgId] ?? orgId);
    const organizationId = isCustomOrg ? slugify(organizationName, 40) : orgId;
    if (isCustomOrg && organizationId.length < 2) {
      setErr("Enter the organisation's name (for example: Canara Bank)");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/cms/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          organizationName,
          govType,
          title: title.trim(),
          recruitmentYear: year,
          forceCreate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (Array.isArray(data.duplicates)) {
        setDuplicates(data.duplicates as DuplicateRecord[]);
        return;
      }
      router.push(`/admin/cms/${data.record.id}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicates(null);
    void submit(false);
  }

  return (
    <div>
      <h1 style={{ ...S.h1, marginBottom: 0 }}>New Recruitment Record</h1>
      <p style={{ color: "#8c9bb8", fontSize: 13, marginBottom: 24, marginTop: 6 }}>
        Creates a DRAFT record. You can fill all fields in the editor after creation.
      </p>

      <div style={S.card}>
        <form onSubmit={handleSubmit}>
          <div style={S.field}>
            <label style={S.label} htmlFor="new-org">Organization</label>
            <select
              id="new-org"
              style={S.select}
              value={orgId}
              onChange={(e) => { setOrgId(e.target.value); setDuplicates(null); }}
            >
              {ORG_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
              <option value="other">Other (custom)</option>
            </select>
          </div>

          {isCustomOrg && (
            <div style={S.field}>
              <label style={S.label} htmlFor="new-org-name">Organisation name</label>
              <input
                id="new-org-name"
                style={S.input}
                type="text"
                value={customOrgName}
                onChange={(e) => { setCustomOrgName(e.target.value); setDuplicates(null); }}
                placeholder="e.g. Canara Bank"
                maxLength={160}
              />
              <div style={{ color: "#8c9bb8", fontSize: 12, marginTop: 6 }}>
                This is shown on the public page and cannot be changed in the editor later.
              </div>
            </div>
          )}

          <div style={S.field}>
            <label style={S.label} htmlFor="new-title">Recruitment Title</label>
            <input
              id="new-title"
              style={S.input}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. BPSC 72nd Combined Competitive Exam"
              maxLength={200}
            />
          </div>

          <div style={S.row}>
            <div style={{ ...S.field, flex: 1 }}>
              <label style={S.label} htmlFor="new-year">Year</label>
              <input
                id="new-year"
                style={S.input}
                type="number"
                value={year}
                onChange={(e) => { setYear(parseInt(e.target.value, 10)); setDuplicates(null); }}
                min={2020}
                max={2035}
              />
            </div>
            <div style={{ ...S.field, flex: 2 }}>
              <label style={S.label} htmlFor="new-govtype">Govt Type</label>
              <select
                id="new-govtype"
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

          {err && <div role="alert" style={S.err}>{err}</div>}

          {duplicates && (
            <div
              role="alert"
              style={{ marginTop: 12, padding: "12px 14px", background: "#d2992222", border: "1px solid #d2992266", borderRadius: 6, fontSize: 13, color: "#e2e8f0" }}
            >
              <div style={{ fontWeight: 700, color: "#d29922", marginBottom: 8 }}>
                {duplicates.length === 1 ? "A record already exists" : `${duplicates.length} records already exist`} for this organisation and year
              </div>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                {duplicates.map((d) => (
                  <li key={d.id} style={{ marginBottom: 4 }}>
                    <Link href={`/admin/cms/${d.id}`} style={{ color: "#62b5ff" }}>
                      {d.title || d.slug}
                    </Link>
                    <span style={{ color: "#8c9bb8" }}> — {d.draftState}</span>
                  </li>
                ))}
              </ul>
              <div style={{ color: "#8c9bb8", marginBottom: 10 }}>
                Open the existing record to update it, or create a separate record if this is a different recruitment.
              </div>
              <button
                type="button"
                onClick={() => { void submit(true); }}
                disabled={saving}
                style={{ padding: "6px 14px", background: "none", color: "#d29922", border: "1px solid #d2992288", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {saving ? "Creating…" : "Create new record anyway"}
              </button>
            </div>
          )}

          <button type="submit" style={S.btn} disabled={saving}>
            {saving ? "Creating…" : "Create Record"}
          </button>
        </form>
      </div>
    </div>
  );
}
