"use client";
// ═══════════════════════════════════════════════════════════
// Phase D: CMS Record Editor — all 14 sections
// ═══════════════════════════════════════════════════════════
//
// All edits go through the typed writer path:
//   form → PATCH /api/admin/cms/records/[id]/fields
//        → routeFieldUpdate() → validation → FieldRevision → DB
//
// Provenance badges are always visible.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  RecruitmentRecord,
  ProvenanceField,
  FieldStatus,
  FieldRevision,
} from "@/types/recruitment-record";

// ─── Design tokens ────────────────────────────────────────

const C = {
  bg:      "#0d1117",
  surface: "#161b22",
  border:  "#21262d",
  text:    "#e2e8f0",
  muted:   "#8b949e",
  accent:  "#58a6ff",
  green:   "#3fb950",
  amber:   "#d29922",
  red:     "#f85149",
  orange:  "#f0883e",
};

const BADGE_COLORS: Record<FieldStatus, { bg: string; text: string; label: string }> = {
  VERIFIED:     { bg: C.green + "22",  text: C.green,  label: "Verified"      },
  PENDING:      { bg: C.amber + "22",  text: C.amber,  label: "Pending"       },
  CONFLICTED:   { bg: C.red + "22",    text: C.red,    label: "Conflicted"    },
  NEEDS_UPDATE: { bg: C.orange + "22", text: C.orange, label: "Needs Update"  },
  NOT_SPECIFIED:{ bg: "#8b949e22",      text: C.muted,  label: "Not Specified" },
};

// ─── Provenance badge ─────────────────────────────────────

function Badge({ status }: { status: FieldStatus }) {
  const c = BADGE_COLORS[status];
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 7px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.text}44`,
      verticalAlign: "middle",
      marginLeft: 6,
    }}>
      {c.label}
    </span>
  );
}

// ─── Inline editable ProvenanceField ─────────────────────

interface EditableFieldProps<T> {
  label: string;
  fieldPath: string;
  field: ProvenanceField<T> | undefined;
  recordId: string;
  onSaved: (updated: RecruitmentRecord) => void;
  inputType?: "text" | "number" | "date" | "textarea";
  placeholder?: string;
  renderValue?: (v: T | null) => React.ReactNode;
}

function EditableField<T>({
  label,
  fieldPath,
  field,
  recordId,
  onSaved,
  inputType = "text",
  placeholder,
  renderValue,
}: EditableFieldProps<T>) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>("");
  const [evidenceIds, setEvidenceIds] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    const current = field?.value;
    setVal(current !== null && current !== undefined ? String(current) : "");
    setEvidenceIds(field?.evidenceIds?.join(", ") ?? "");
    setReason("");
    setErr(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const isNotSpecified = val.trim() === "" || val === "__NOT_SPECIFIED__";
      const eids = evidenceIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const newField: ProvenanceField<unknown> = isNotSpecified
        ? { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true }
        : {
            value: inputType === "number" ? Number(val) : val,
            status: eids.length > 0 ? "VERIFIED" : "PENDING",
            evidenceIds: eids,
            conflict: false,
            machineValue: field?.machineValue !== undefined ? field.machineValue : undefined,
            manuallyEdited: true,
          };

      const res = await fetch(`/api/admin/cms/records/${recordId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldPath, field: newField, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setEditing(false);
      onSaved(data.record as RecruitmentRecord);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  const displayValue = field?.status === "NOT_SPECIFIED"
    ? <span style={{ color: C.muted, fontStyle: "italic" }}>Not specified</span>
    : field?.value !== null && field?.value !== undefined
      ? (renderValue ? renderValue(field.value) : <span>{String(field.value)}</span>)
      : <span style={{ color: C.muted }}>— not set —</span>;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </span>
        {field && <Badge status={field.status} />}
        {field?.conflict && (
          <span style={{ marginLeft: 6, fontSize: 11, color: C.red }}>⚠ conflict</span>
        )}
        {field?.machineValue !== undefined && (
          <span style={{ marginLeft: 6, fontSize: 10, color: C.muted }} title={`Machine extracted: ${String(field.machineValue)}`}>
            [M]
          </span>
        )}
      </div>

      {!editing ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 14, color: C.text }}>{displayValue}</div>
          <button
            onClick={startEdit}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: "0 4px" }}
          >
            Edit
          </button>
        </div>
      ) : (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
          {inputType === "textarea" ? (
            <textarea
              value={val}
              onChange={(e) => setVal(e.target.value)}
              style={{ ...inputStyle, height: 80, resize: "vertical" }}
              placeholder={placeholder}
            />
          ) : (
            <input
              type={inputType}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              style={inputStyle}
              placeholder={placeholder ?? `Enter ${label.toLowerCase()}`}
            />
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Evidence IDs (comma-separated, for VERIFIED)</label>
              <input
                type="text"
                value={evidenceIds}
                onChange={(e) => setEvidenceIds(e.target.value)}
                style={inputStyle}
                placeholder="evid-abc-001, evid-def-002"
              />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle}>Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Corrigendum No. 2 dated 2026-09-15"
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button
              onClick={() => { void save(); }}
              disabled={saving}
              style={{ padding: "6px 16px", background: "#1f6feb", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { void setValNotSpecified(fieldPath, recordId, field, onSaved, setSaving, setErr, setEditing); }}
              style={{ padding: "6px 12px", background: "none", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, cursor: "pointer" }}
            >
              Set Not Specified
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
          {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

async function setValNotSpecified(
  fieldPath: string,
  recordId: string,
  _field: ProvenanceField<unknown> | undefined,
  onSaved: (r: RecruitmentRecord) => void,
  setSaving: (v: boolean) => void,
  setErr: (v: string | null) => void,
  setEditing: (v: boolean) => void,
) {
  setSaving(true);
  setErr(null);
  try {
    const notSpecField: ProvenanceField<null> = {
      value: null,
      status: "NOT_SPECIFIED",
      evidenceIds: [],
      conflict: false,
      manuallyEdited: true,
    };
    const res = await fetch(`/api/admin/cms/records/${recordId}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldPath, field: notSpecField }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error ?? `HTTP ${res.status}`); return; }
    setEditing(false);
    onSaved(data.record as RecruitmentRecord);
  } catch (e) {
    setErr(String(e));
  } finally {
    setSaving(false);
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 5,
  color: "#e2e8f0",
  fontSize: 13,
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "#8b949e",
  marginBottom: 4,
  fontWeight: 500,
};

// ─── Section wrapper ──────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      marginBottom: 16,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 18px",
        borderBottom: `1px solid ${C.border}`,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: C.muted,
        background: "#0d1117",
      }}>
        {title}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

// ─── Date fields helper ───────────────────────────────────

const DATE_FIELDS: Array<{ key: keyof RecruitmentRecord["dates"]; label: string }> = [
  { key: "notificationDate",        label: "Notification Date" },
  { key: "applicationOpenDate",     label: "Application Opens" },
  { key: "applicationCloseDate",    label: "Application Closes" },
  { key: "feePaymentCloseDate",     label: "Fee Payment Deadline" },
  { key: "correctionWindowEnd",     label: "Correction Window End" },
  { key: "prelimsDate",             label: "Prelims Date" },
  { key: "examDate",                label: "Exam Date" },
  { key: "mainsDate",               label: "Mains Date" },
  { key: "admitCardDate",           label: "Admit Card Release" },
  { key: "interviewDate",           label: "Interview Date" },
  { key: "resultDate",              label: "Result Date" },
  { key: "documentVerificationDate", label: "Document Verification" },
  { key: "joiningDate",             label: "Joining Date" },
];

// ─── Main page ────────────────────────────────────────────

const SECTIONS = [
  "Identity", "Dates", "Vacancies", "Eligibility", "Age",
  "Financial", "Selection", "How to Apply", "Links", "Documents",
  "Conditions", "Evidence", "Conflicts", "Revisions",
] as const;

export default function CmsRecordEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [record, setRecord] = useState<RecruitmentRecord | null>(null);
  const [revisions, setRevisions] = useState<FieldRevision[]>([]);
  const [activeSection, setActiveSection] = useState<string>("Identity");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);

  const loadRecord = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/cms/records/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecord(data.record);
    } catch (e) {
      setLoadErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadRevisions = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/cms/records/${id}/revisions`);
      if (!res.ok) return;
      const data = await res.json();
      setRevisions(data.revisions ?? []);
    } catch { /* non-fatal */ }
  }, [id]);

  useEffect(() => {
    void loadRecord();
    void loadRevisions();
  }, [loadRecord, loadRevisions]);

  function onFieldSaved(updated: RecruitmentRecord) {
    setRecord(updated);
    void loadRevisions();
  }

  async function handleApprove() {
    if (!record) return;
    setApproving(true);
    setApproveErr(null);
    try {
      const res = await fetch(`/api/admin/cms/records/${id}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setApproveErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setRecord(data.record);
    } catch (e) {
      setApproveErr(String(e));
    } finally {
      setApproving(false);
    }
  }

  if (loading) return <div style={{ color: C.muted, padding: 40 }}>Loading…</div>;
  if (loadErr) return <div style={{ color: C.red, padding: 40 }}>Error: {loadErr}</div>;
  if (!record) return <div style={{ color: C.muted, padding: 40 }}>Record not found.</div>;

  const stateColor = { DRAFT: C.amber, APPROVED: C.green, PUBLISHED: C.accent, ARCHIVED: C.muted }[record.draftState] ?? C.muted;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* ── Left: section nav ── */}
      <div style={{ width: 160, flexShrink: 0 }}>
        <div style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 12,
        }}>
          {/* Record header */}
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4, lineHeight: 1.4 }}>
              {record.identity.title.value ?? record.slug}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                display: "inline-block",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                background: stateColor + "22",
                color: stateColor,
                border: `1px solid ${stateColor}44`,
              }}>
                {record.draftState}
              </span>
            </div>
          </div>

          {/* Section tabs */}
          <nav>
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: activeSection === s ? "#1f2937" : "transparent",
                  border: "none",
                  borderLeft: activeSection === s ? `2px solid ${C.accent}` : "2px solid transparent",
                  color: activeSection === s ? C.text : C.muted,
                  fontSize: 12,
                  fontWeight: activeSection === s ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {s}
              </button>
            ))}
          </nav>
        </div>

        {/* Actions */}
        {record.draftState === "DRAFT" && (
          <div>
            <button
              onClick={() => { void handleApprove(); }}
              disabled={approving}
              style={{
                width: "100%",
                padding: "9px 14px",
                background: C.green,
                color: "#0d1117",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {approving ? "Approving…" : "Approve Record"}
            </button>
            {approveErr && (
              <div style={{ color: C.red, fontSize: 11, marginTop: 8 }}>{approveErr}</div>
            )}
          </div>
        )}

        {record.draftState === "APPROVED" && (
          <div style={{
            padding: "10px 14px",
            background: C.green + "11",
            border: `1px solid ${C.green}33`,
            borderRadius: 6,
            fontSize: 12,
            color: C.green,
          }}>
            ✓ Approved — ready to publish
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => router.push("/admin/cms")}
            style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            ← All records
          </button>
        </div>
      </div>

      {/* ── Right: section content ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Identity ── */}
        {activeSection === "Identity" && (
          <Section title="Identity">
            <EditableField
              label="Title"
              fieldPath="identity.title"
              field={record.identity.title as ProvenanceField<unknown>}
              recordId={id}
              onSaved={onFieldSaved}
              placeholder="e.g. BPSC 72nd Combined Competitive Exam"
            />
            <EditableField
              label="Short Title"
              fieldPath="identity.shortTitle"
              field={record.identity.shortTitle as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              placeholder="e.g. BPSC 72nd CCE"
            />
            <EditableField
              label="Notification Number"
              fieldPath="identity.notificationNumber"
              field={record.identity.notificationNumber as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              placeholder="e.g. Advt No. 72/2024"
            />
            <EditableField
              label="Advertisement Number"
              fieldPath="identity.advertisementNumber"
              field={record.identity.advertisementNumber as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              placeholder="e.g. 2026-27/02"
            />
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <Row label="Organization" value={`${record.identity.organizationName} (${record.identity.organizationId})`} />
              <Row label="Year" value={String(record.identity.recruitmentYear)} />
              <Row label="Govt Type" value={record.identity.govType ?? "—"} />
              <Row label="Slug" value={record.slug} mono />
              <Row label="Record ID" value={record.id} mono />
            </div>
          </Section>
        )}

        {/* ── Dates ── */}
        {activeSection === "Dates" && (
          <Section title="Important Dates">
            {DATE_FIELDS.map(({ key, label }) => (
              <EditableField
                key={key}
                label={label}
                fieldPath={`dates.${key}`}
                field={record.dates[key] as ProvenanceField<unknown> | undefined}
                recordId={id}
                onSaved={onFieldSaved}
                inputType="date"
                placeholder="YYYY-MM-DD"
              />
            ))}
          </Section>
        )}

        {/* ── Vacancies ── */}
        {activeSection === "Vacancies" && (
          <Section title="Vacancies">
            <EditableField
              label="Total Vacancies"
              fieldPath="vacancies.total"
              field={record.vacancies.total as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              inputType="number"
              placeholder="e.g. 1000"
            />
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Breakdown
                {record.vacancies.breakdown && <Badge status={record.vacancies.breakdown.status} />}
              </div>
              {record.vacancies.breakdown?.value ? (
                <table style={{ fontSize: 13, width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Post", "Count", "Pay Scale"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {record.vacancies.breakdown.value.map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}` }}>{row.post}</td>
                        <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}` }}>{row.count}</td>
                        <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted }}>{row.payScale ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ color: C.muted, fontSize: 13 }}>No breakdown set. (Promote from IntelligenceDraft or enter manually in Phase E)</div>
              )}
            </div>
          </Section>
        )}

        {/* ── Eligibility ── */}
        {activeSection === "Eligibility" && (
          <Section title="Post-wise Eligibility">
            <ProvenanceBlockDisplay
              label="Eligibility Block"
              field={record.eligibility}
              renderContent={(val: unknown) => {
                const posts = val as Array<{ post: string; qualification?: string[]; experience?: string[] }>;
                return (
                  <div>
                    {posts.map((p, i) => (
                      <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < posts.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.post}</div>
                        {p.qualification?.length ? <div style={{ color: C.muted, fontSize: 13 }}>Qualification: {p.qualification.join(", ")}</div> : null}
                        {p.experience?.length ? <div style={{ color: C.muted, fontSize: 13 }}>Experience: {p.experience.join(", ")}</div> : null}
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
              Full eligibility block editing (post table) is in the Phase E promotion form.
            </div>
          </Section>
        )}

        {/* ── Age ── */}
        {activeSection === "Age" && (
          <Section title="Age Criteria">
            <ProvenanceBlockDisplay
              label="Age Block"
              field={record.age}
              renderContent={(val: unknown) => {
                const age = val as { min?: number; max?: number; asOf?: string; relaxations?: Array<{ category: string; years?: number; text?: string }> };
                return (
                  <div>
                    {(age.min || age.max) && (
                      <Row label="Age Range" value={`${age.min ?? "—"} – ${age.max ?? "—"} years (as of ${age.asOf ?? "not specified"})`} />
                    )}
                    {age.relaxations?.length ? (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6 }}>RELAXATIONS</div>
                        {age.relaxations.map((r, i) => (
                          <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                            {r.category}{r.years != null ? `: +${r.years} years` : ""}{r.text ? ` ${r.text}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />
            <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
              Age block editing is in the Phase E promotion form.
            </div>
          </Section>
        )}

        {/* ── Financial ── */}
        {activeSection === "Financial" && (
          <Section title="Fees & Pay">
            <EditableField
              label="Application Fee — General / OBC"
              fieldPath="financial.feeGeneral"
              field={record.financial.feeGeneral as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              inputType="number"
              placeholder="e.g. 500 (or leave blank for 0 = free)"
            />
            <EditableField
              label="Application Fee — SC / ST / PwD"
              fieldPath="financial.feeSCST"
              field={record.financial.feeSCST as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              inputType="number"
              placeholder="e.g. 0 (or 250)"
            />
            <EditableField
              label="Pay Scale"
              fieldPath="financial.payScale"
              field={record.financial.payScale as ProvenanceField<unknown> | undefined}
              recordId={id}
              onSaved={onFieldSaved}
              placeholder="e.g. Pay Matrix Level 10 (₹56,100 – ₹1,77,500)"
            />
            {record.financial.paymentModes?.length ? (
              <Row label="Payment Modes" value={record.financial.paymentModes.join(", ")} />
            ) : null}
          </Section>
        )}

        {/* ── Selection ── */}
        {activeSection === "Selection" && (
          <Section title="Selection Process">
            <ProvenanceBlockDisplay
              label="Selection Block"
              field={record.selection}
              renderContent={(val: unknown) => {
                const sel = val as { stages?: Array<{ name: string; order: number }>; examPattern?: string; negativeMarking?: string; finalMeritFormula?: string };
                return (
                  <div>
                    {sel.stages?.length ? (
                      <div style={{ marginBottom: 12 }}>
                        {sel.stages.map((s, i) => (
                          <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                            <span style={{ color: C.muted, marginRight: 8 }}>{s.order}.</span>{s.name}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {sel.examPattern && <Row label="Exam Pattern" value={sel.examPattern} />}
                    {sel.negativeMarking && <Row label="Negative Marking" value={sel.negativeMarking} />}
                    {sel.finalMeritFormula && <Row label="Merit Formula" value={sel.finalMeritFormula} />}
                  </div>
                );
              }}
            />
          </Section>
        )}

        {/* ── How to Apply ── */}
        {activeSection === "How to Apply" && (
          <Section title="How to Apply">
            {record.howToApply?.length ? (
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
                {record.howToApply.map((step, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{step}</li>
                ))}
              </ol>
            ) : (
              <div style={{ color: C.muted, fontSize: 13 }}>No steps entered yet.</div>
            )}
            <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
              How to Apply is a plain string[] — edit via PATCH with fieldPath "howToApply" (Phase E editor).
            </div>
          </Section>
        )}

        {/* ── Links ── */}
        {activeSection === "Links" && (
          <Section title="Links">
            {record.links.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No links added.</div>
            ) : (
              <table style={{ fontSize: 13, width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Type", "Label", "URL", "Official"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {record.links.map((l, i) => (
                    <tr key={i}>
                      <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 11 }}>{l.type}</td>
                      <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}` }}>{l.label}</td>
                      <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}` }}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 12, wordBreak: "break-all" }}>{l.url}</a>
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, color: l.official ? C.green : C.muted }}>{l.official ? "✓" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        )}

        {/* ── Documents ── */}
        {activeSection === "Documents" && (
          <Section title="Candidate Documents">
            {record.documents.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No documents added.</div>
            ) : (
              <div>
                {record.documents.map((d, i) => (
                  <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < record.documents.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>{d.type}</span>
                      {d.official && <span style={{ fontSize: 10, color: C.green }}>✓ Official</span>}
                    </div>
                    <div style={{ fontWeight: 500, marginTop: 2 }}>{d.label}</div>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 12 }}>{d.url}</a>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Conditions ── */}
        {activeSection === "Conditions" && (
          <Section title="Special Conditions">
            {record.conditions?.items.length ? (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
                {record.conditions.items.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : (
              <div style={{ color: C.muted, fontSize: 13 }}>No special conditions.</div>
            )}
            {record.conditions?.notes && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#21262d", borderRadius: 6, fontSize: 13, color: C.muted }}>
                <span style={{ color: C.amber, fontWeight: 600 }}>Admin note: </span>{record.conditions.notes}
              </div>
            )}
          </Section>
        )}

        {/* ── Evidence ── */}
        {activeSection === "Evidence" && (
          <Section title="Evidence Sources">
            <div style={{ color: C.muted, fontSize: 13 }}>
              Evidence is attached to individual fields via evidenceIds.
              The evidence store (recruitment_evidence table) is populated during IntelligenceDraft promotion (Phase E).
            </div>
            <div style={{ marginTop: 16 }}>
              <Row label="Record Revision" value={record.recordRevision} mono />
              <Row label="Last Updated" value={record.updatedAt} />
              <Row label="Provenance Status" value={record.provenance.status} />
              {record.provenance.primarySourceUrl && (
                <Row label="Primary Source" value={record.provenance.primarySourceUrl} />
              )}
            </div>
          </Section>
        )}

        {/* ── Conflicts ── */}
        {activeSection === "Conflicts" && (
          <Section title="Conflicts">
            {record.lifecycle.conflicts.length === 0 ? (
              <div style={{ color: C.green, fontSize: 13 }}>✓ No conflicts</div>
            ) : (
              <div>
                {record.lifecycle.conflicts.map((c, i) => (
                  <div key={i} style={{
                    marginBottom: 16,
                    padding: "12px 14px",
                    background: c.resolvedAt ? "#21262d" : C.red + "11",
                    border: `1px solid ${c.resolvedAt ? C.border : C.red + "44"}`,
                    borderRadius: 6,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{c.fieldPath}</span>
                      {c.resolvedAt
                        ? <span style={{ fontSize: 11, color: C.green }}>✓ Resolved</span>
                        : <span style={{ fontSize: 11, color: C.red }}>⚠ Unresolved</span>
                      }
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                      <div>
                        <div style={{ color: C.muted, marginBottom: 2 }}>Machine Value</div>
                        <code style={{ color: C.orange }}>{JSON.stringify(c.machineValue)}</code>
                      </div>
                      <div>
                        <div style={{ color: C.muted, marginBottom: 2 }}>Admin Value</div>
                        <code style={{ color: C.accent }}>{JSON.stringify(c.adminValue)}</code>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                      Detected: {new Date(c.detectedAt).toLocaleDateString("en-IN")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Revision History ── */}
        {activeSection === "Revisions" && (
          <Section title="Revision History">
            {revisions.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No revisions yet.</div>
            ) : (
              <div>
                {[...revisions].reverse().map((rev) => (
                  <div key={rev.id} style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <code style={{ fontSize: 12, color: C.accent, background: "#1f2937", padding: "1px 6px", borderRadius: 4 }}>
                        {rev.fieldPath}
                      </code>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        {new Date(rev.revisedAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                    {rev.reason && (
                      <div style={{ fontSize: 12, color: C.amber, marginBottom: 4, fontStyle: "italic" }}>"{rev.reason}"</div>
                    )}
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.muted, fontSize: 10, marginBottom: 2 }}>BEFORE</div>
                        <pre style={{ margin: 0, color: C.muted, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#0d1117", padding: "6px 8px", borderRadius: 4, maxHeight: 80, overflow: "auto" }}>
                          {JSON.stringify(rev.oldValue, null, 2)}
                        </pre>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.green, fontSize: 10, marginBottom: 2 }}>AFTER</div>
                        <pre style={{ margin: 0, color: C.text, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#0d1117", padding: "6px 8px", borderRadius: 4, maxHeight: 80, overflow: "auto" }}>
                          {JSON.stringify(rev.newValue, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

// ─── ProvenanceBlockDisplay ───────────────────────────────

function ProvenanceBlockDisplay({
  label,
  field,
  renderContent,
}: {
  label: string;
  field: ProvenanceField<unknown> | undefined;
  renderContent: (v: unknown) => React.ReactNode;
}) {
  if (!field) {
    return <div style={{ color: C.muted, fontSize: 13 }}>— not set —</div>;
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        <Badge status={field.status} />
        {field.evidenceIds.length > 0 && (
          <span style={{ marginLeft: 6, fontSize: 11, color: C.muted }}>{field.evidenceIds.length} source(s)</span>
        )}
      </div>
      {field.status === "NOT_SPECIFIED" ? (
        <div style={{ color: C.muted, fontStyle: "italic", fontSize: 13 }}>Not specified</div>
      ) : field.value !== null && field.value !== undefined ? (
        renderContent(field.value)
      ) : (
        <div style={{ color: C.muted, fontSize: 13 }}>— no value —</div>
      )}
    </div>
  );
}

// ─── Row helper ───────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 13 }}>
      <div style={{ width: 160, color: C.muted, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", paddingTop: 2 }}>{label}</div>
      <div style={{ color: C.text, fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? 12 : 13 }}>{value}</div>
    </div>
  );
}
