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

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  RecruitmentRecord,
  ProvenanceField,
  FieldStatus,
  FieldRevision,
  RecruitmentStatus,
  CmsRecruitmentLink,
  RecruitmentLinkType,
} from "@/types/recruitment-record";
import type { UpdateRecord } from "@/types";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { savedFilePath, savedFileProblem, MAX_SAVED_FILE_LABEL, SAVED_FILE_CONTENT_TYPE } from "@/lib/cms/saved-files";
import { aiAssistReason, buildAiField, describeAiValue } from "@/lib/cms/ai-assist-apply";
import { ExamStagesEditor } from "./ExamStagesEditor";
import { ExamPatternEditor, SyllabusEditor } from "./PatternSyllabusEditors";
import { InfoTip, HELP } from "../InfoTip";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import { OfficialNotificationCard } from "@/components/jobs/OfficialNotificationCard";

// ─── Design tokens ────────────────────────────────────────

const C = {
  bg:      "#070b16",
  // Panels are slightly see-through so the page glow shows behind them.
  surface: "rgba(14,21,38,0.72)",
  border:  "rgba(148,163,184,0.14)",
  text:    "#e2e8f0",
  muted:   "#8c9bb8",
  accent:  "#62b5ff",
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
  NOT_SPECIFIED:{ bg: "#8c9bb822",      text: C.muted,  label: "Not Specified" },
};

// ─── Provenance badge ─────────────────────────────────────

function Badge({ status }: { status: FieldStatus }) {
  const c = BADGE_COLORS[status];
  return (
    <span title={HELP[status]} style={{
      cursor: "help",
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
  recordRevision: string;
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
  recordRevision,
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
        body: JSON.stringify({ fieldPath, field: newField, clientRevision: recordRevision, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.error === "CONFLICT") {
          setErr(`Conflict: record was modified by another session. Reload the page to get the latest version.`);
        } else {
          setErr(data.error ?? `HTTP ${res.status}`);
        }
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
        <InfoTip id={fieldPath} />
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
              style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { void setValNotSpecified(fieldPath, recordId, recordRevision, field, onSaved, setSaving, setErr, setEditing); }}
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
  recordRevision: string,
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
      body: JSON.stringify({ fieldPath, field: notSpecField, clientRevision: recordRevision }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 && data.error === "CONFLICT") {
        setErr("Conflict: record was modified by another session. Reload the page.");
      } else {
        setErr(data.error ?? `HTTP ${res.status}`);
      }
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  background: "#070b16",
  border: "1px solid #2b3a5c",
  borderRadius: 5,
  color: "#e2e8f0",
  fontSize: 13,
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "#8c9bb8",
  marginBottom: 4,
  fontWeight: 500,
};

// ─── Panel look ───────────────────────────────────────────

const PANEL: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 40px rgba(0,0,0,0.28)",
};

// ─── Section wrapper ──────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...PANEL, marginBottom: 16 }}>
      <div style={{
        padding: "11px 18px",
        borderBottom: `1px solid ${C.border}`,
        borderRadius: "14px 14px 0 0",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "#c7d2e6",
        background: "linear-gradient(90deg, rgba(249,115,22,0.10), rgba(99,102,241,0.08) 45%, transparent 80%)",
        display: "flex",
        alignItems: "center",
      }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: "#f97316", boxShadow: "0 0 10px #f97316", marginRight: 10 }} />
        {title}
        <InfoTip id={title} />
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

// ─── Plain-list editors: links and how-to-apply ───────────
//
// Both save through the same /fields endpoint as every other edit, so each
// change is validated server-side and recorded in revision history.

async function saveListField(
  recordId: string,
  recordRevision: string,
  fieldPath: "links" | "howToApply" | "classification" | "examStages" | "examPattern" | "syllabus" | "vacancies.breakdown",
  value: unknown,
  reason: string,
): Promise<{ record?: RecruitmentRecord; error?: string }> {
  try {
    const res = await fetch(`/api/admin/cms/records/${recordId}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fieldPath,
        field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true },
        clientRevision: recordRevision,
        reason,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 && data.error === "CONFLICT") {
        return { error: "Conflict: record was modified by another session. Reload the page." };
      }
      return { error: data.error ?? `HTTP ${res.status}` };
    }
    return { record: data.record as RecruitmentRecord };
  } catch (e) {
    return { error: String(e) };
  }
}

const LINK_TYPE_OPTIONS: Array<{ type: RecruitmentLinkType; label: string }> = [
  { type: "OFFICIAL_NOTIFICATION", label: "Official Notification" },
  { type: "APPLY_ONLINE",          label: "Apply Online" },
  { type: "OFFICIAL_WEBSITE",      label: "Official Website" },
  { type: "CORRIGENDUM",           label: "Corrigendum" },
  { type: "ADMIT_CARD",            label: "Admit Card" },
  { type: "RESULT",                label: "Result" },
  { type: "ANSWER_KEY",            label: "Answer Key" },
  { type: "CUT_OFF",               label: "Cut-off Marks" },
  { type: "EXAM_NOTICE",           label: "Exam Notice" },
  { type: "OTHER",                 label: "Other" },
];

function LinksEditor({ record, onSaved }: { record: RecruitmentRecord; onSaved: (r: RecruitmentRecord) => void }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const [type, setType] = useState<RecruitmentLinkType>("OFFICIAL_NOTIFICATION");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [official, setOfficial] = useState(false);
  // A saved copy is our own copy of the file (e.g. on Google Drive), listed with the official page it came from.
  const [isCopy, setIsCopy] = useState(false);
  const [savedFrom, setSavedFrom] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: CmsRecruitmentLink[], reason: string) {
    setSaving(true);
    setErr(null);
    const out = await saveListField(record.id, record.recordRevision, "links", next, reason);
    setSaving(false);
    if (out.error || !out.record) { setErr(out.error ?? "Save failed"); return false; }
    onSaved(out.record);
    return true;
  }

  // Sends the chosen PDF straight to file storage and puts its address in the URL box.
  async function uploadPdf(file: File) {
    setErr(null);
    setUploadedName(null);
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const problem = savedFileProblem(file, head);
    if (problem) { setErr(problem); return; }
    setUploading(true);
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(savedFilePath(record.slug, file.name), file, {
        access: "public",
        handleUploadUrl: "/api/admin/cms/upload",
        contentType: SAVED_FILE_CONTENT_TYPE,
      });
      setUrl(blob.url);
      setUploadedName(file.name);
      setIsCopy(true);
      setOfficial(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(/not set up|Blob store/i.test(message) ? message : `Upload failed: ${message}`);
    } finally {
      setUploading(false);
    }
  }

  async function addLink() {
    const defaultLabel = LINK_TYPE_OPTIONS.find((o) => o.type === type)?.label ?? "Link";
    const link: CmsRecruitmentLink = isCopy
      ? { type, label: label.trim() || defaultLabel, url: url.trim(), official: false, savedFrom: savedFrom.trim() }
      : { type, label: label.trim() || defaultLabel, url: url.trim(), official };
    if (await save([...record.links, link], `Added ${isCopy ? "saved copy" : "link"}: ${link.label}`)) {
      setLabel(""); setUrl(""); setOfficial(false); setIsCopy(false); setSavedFrom(""); setUploadedName(null);
    }
  }

  const cell: React.CSSProperties = { padding: "6px 10px", borderBottom: `1px solid ${C.border}` };

  return (
    <div>
      {record.links.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13 }}>
          No links added. Publishing needs at least one link marked official.
        </div>
      ) : (
        <table style={{ fontSize: 13, width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Type", "Label", "URL", "Official", ""].map((h, i) => (
                <th key={i} style={{ textAlign: "left", ...cell, color: C.muted, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {record.links.map((l, i) => (
              <tr key={i}>
                <td style={{ ...cell, color: C.muted, fontSize: 11 }}>{l.type}</td>
                <td style={cell}>{l.label}</td>
                <td style={cell}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 12, wordBreak: "break-all" }}>{l.url}</a>
                </td>
                <td style={{ ...cell, color: l.official ? C.green : l.savedFrom ? C.amber : C.muted, fontSize: 12 }}>
                  {l.official ? "✓" : l.savedFrom ? (
                    <span title={`Saved from ${l.savedFrom}${l.savedOn ? ` on ${l.savedOn}` : ""}`}>Saved copy</span>
                  ) : "—"}
                </td>
                <td style={cell}>
                  {editable && (
                    <button
                      onClick={() => { void save(record.links.filter((_, j) => j !== i), `Removed link: ${l.label}`); }}
                      disabled={saving}
                      aria-label={`Remove link ${l.label}`}
                      style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editable ? (
        <div style={{ marginTop: 16, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ minWidth: 190 }}>
              <label style={labelStyle} htmlFor="link-type">Type<InfoTip id="Link type" /></label>
              <select id="link-type" value={type} onChange={(e) => setType(e.target.value as RecruitmentLinkType)} style={inputStyle}>
                {LINK_TYPE_OPTIONS.map((o) => <option key={o.type} value={o.type}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={labelStyle} htmlFor="link-label">Label (optional)</label>
              <input id="link-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle} placeholder="Defaults to the type name" />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle} htmlFor="link-url">URL</label>
            <input id="link-url" type="url" value={url} onChange={(e) => { setUrl(e.target.value); setUploadedName(null); }} style={inputStyle} placeholder="https://…" />
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label
              style={{
                padding: "6px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                border: `1px solid ${C.border}`, color: C.accent,
                cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1,
              }}
            >
              {uploading ? "Uploading…" : "Upload a PDF instead"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPdf(f); }}
                style={{ display: "none" }}
              />
            </label>
            <span style={{ fontSize: 11, color: uploadedName ? C.green : C.muted }}>
              {uploadedName
                ? `Uploaded “${uploadedName}”. Now enter the official page it came from, then add it.`
                : `For results, answer keys and cut-offs. PDF only, up to ${MAX_SAVED_FILE_LABEL}. Never upload a single candidate's admit card or scorecard.`}
            </span>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, fontSize: 12, color: C.text, cursor: "pointer" }}>
            <input type="checkbox" checked={official} disabled={isCopy} onChange={(e) => setOfficial(e.target.checked)} style={{ marginTop: 2 }} />
            <span style={{ opacity: isCopy ? 0.5 : 1 }}>
              Official source — I have checked this URL is on the recruiting organisation&apos;s own website.
              <span style={{ color: C.muted }}> Leave unticked for third-party pages.</span>
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: 12, color: C.text, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isCopy}
              onChange={(e) => { setIsCopy(e.target.checked); if (e.target.checked) setOfficial(false); }}
              style={{ marginTop: 2 }}
            />
            <span>
              My saved copy — the URL above is my own copy of the file (uploaded here, or hosted elsewhere).
              <span style={{ color: C.muted }}> Shown to visitors as “Saved copy”, never as official.</span>
            </span>
          </label>
          {isCopy && (
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle} htmlFor="link-saved-from">Official page or file this copy came from</label>
              <input
                id="link-saved-from"
                type="url"
                value={savedFrom}
                onChange={(e) => setSavedFrom(e.target.value)}
                style={inputStyle}
                placeholder="https://ssc.gov.in/…"
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button
              onClick={() => { void addLink(); }}
              disabled={saving || !url.trim() || (isCopy && !savedFrom.trim())}
              style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: saving || !url.trim() || (isCopy && !savedFrom.trim()) ? "not-allowed" : "pointer", opacity: saving || !url.trim() || (isCopy && !savedFrom.trim()) ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : isCopy ? "Add saved copy" : "Add link"}
            </button>
          </div>
          {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
      ) : (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
          Links can be edited while the record is a draft. Click “Edit Record” first.
        </div>
      )}
    </div>
  );
}

const QUALIFICATION_OPTIONS = ["10th Pass", "12th Pass", "ITI", "Diploma", "Graduate", "Post Graduate"];
const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "government", label: "Government (general)" },
  { value: "ssc", label: "SSC" },
  { value: "banking", label: "Banking" },
  { value: "railway", label: "Railway" },
  { value: "defence", label: "Defence" },
  { value: "teaching", label: "Teaching" },
  { value: "state-psc", label: "State PSC" },
];

// Qualification, location, category and short description: they fill the
// header boxes on the public page and drive the listing filters.
function ListingDetailsEditor({ record, onSaved }: { record: RecruitmentRecord; onSaved: (r: RecruitmentRecord) => void }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const c = record.classification ?? {};
  const [editing, setEditing] = useState(false);
  const [qualification, setQualification] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setQualification(c.qualification ?? "");
    setCategory(c.category ?? "");
    setState(c.state ?? "");
    setShortDescription(c.shortDescription ?? "");
    setErr(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    const out = await saveListField(record.id, record.recordRevision, "classification", { qualification, category, state, shortDescription }, "Edited listing details");
    setSaving(false);
    if (out.error || !out.record) { setErr(out.error ?? "Save failed"); return; }
    setEditing(false);
    onSaved(out.record);
  }

  const shown = (v: string | undefined) => v || "— not set —";

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        Listing details
        <InfoTip id="Listing details" />
      </div>
      {!editing ? (
        <>
          <Row label="Qualification" value={shown(c.qualification)} />
          <Row label="Location" value={shown(c.state)} />
          <Row label="Category" value={shown(c.category)} />
          <Row label="Short description" value={shown(c.shortDescription)} />
          {editable ? (
            <button onClick={startEdit} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, marginTop: 8 }}>
              Edit listing details
            </button>
          ) : (
            <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>Click “Edit Record” first to change these.</div>
          )}
        </>
      ) : (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle} htmlFor="ld-qualification">Qualification (lowest level any post needs)</label>
              <select id="ld-qualification" value={qualification} onChange={(e) => setQualification(e.target.value)} style={inputStyle}>
                <option value="">— not set —</option>
                {QUALIFICATION_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle} htmlFor="ld-category">Category</label>
              <select id="ld-category" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                <option value="">— not set —</option>
                {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle} htmlFor="ld-state">Location</label>
              <input id="ld-state" type="text" value={state} onChange={(e) => setState(e.target.value)} style={inputStyle} placeholder="All India, Bihar, Karnataka…" maxLength={60} />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle} htmlFor="ld-description">Short description (shown under the title and in search results)</label>
            <textarea id="ld-description" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} style={{ ...inputStyle, height: 70, resize: "vertical" }} maxLength={300} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button onClick={() => { void save(); }} disabled={saving} style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>Cancel</button>
          </div>
          {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

function HowToApplyEditor({ record, onSaved }: { record: RecruitmentRecord; onSaved: (r: RecruitmentRecord) => void }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const steps = record.howToApply ?? [];

  async function save() {
    const next = text.split("\n").map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    setErr(null);
    const out = await saveListField(record.id, record.recordRevision, "howToApply", next, "Edited how-to-apply steps");
    setSaving(false);
    if (out.error || !out.record) { setErr(out.error ?? "Save failed"); return; }
    setEditing(false);
    onSaved(out.record);
  }

  return (
    <div>
      {steps.length ? (
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
          {steps.map((step, i) => <li key={i} style={{ marginBottom: 4 }}>{step}</li>)}
        </ol>
      ) : (
        <div style={{ color: C.muted, fontSize: 13 }}>No steps entered yet.</div>
      )}

      {!editable ? (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
          Steps can be edited while the record is a draft. Click “Edit Record” first.
        </div>
      ) : !editing ? (
        <button
          onClick={() => { setText(steps.join("\n")); setErr(null); setEditing(true); }}
          style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, marginTop: 12 }}
        >
          Edit steps
        </button>
      ) : (
        <div style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
          <label style={labelStyle} htmlFor="how-to-apply-steps">One step per line</label>
          <textarea
            id="how-to-apply-steps"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ ...inputStyle, height: 160, resize: "vertical" }}
            placeholder={"Visit the official website\nRegister and fill the application form\nPay the fee and submit"}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button
              onClick={() => { void save(); }}
              disabled={saving}
              style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {saving ? "Saving…" : "Save steps"}
            </button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
              Cancel
            </button>
          </div>
          {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Vacancy breakdown ────────────────────────────────────
//
// Post-wise numbers typed one per line, the way they are copied from a
// notification table. The total above is a separate field and is never
// worked out from these rows.

function VacancyBreakdownEditor({ record, onSaved }: { record: RecruitmentRecord; onSaved: (r: RecruitmentRecord) => void }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = record.vacancies.breakdown?.value ?? [];
  const sum = rows.reduce((n, r) => n + r.count, 0);
  const total = record.vacancies.total?.value;

  async function save() {
    const next = [];
    for (const [i, line] of text.split("\n").map((l) => l.trim()).filter(Boolean).entries()) {
      const [post, count, payScale] = line.split("|").map((part) => part.trim());
      const n = Number((count ?? "").replace(/,/g, ""));
      if (!post || !Number.isInteger(n) || n <= 0) {
        setErr(`Line ${i + 1}: write it as “Post name | number”, for example “Warder | 560”.`);
        return;
      }
      // Details that were on the row before (category split, eligibility) stay with it.
      const before = rows.find((r) => r.post === post);
      next.push({ ...(before ?? {}), post, count: n, ...(payScale ? { payScale } : before?.payScale ? { payScale: before.payScale } : {}) });
    }
    setSaving(true);
    setErr(null);
    const out = await saveListField(record.id, record.recordRevision, "vacancies.breakdown", next, "Edited post-wise vacancies");
    setSaving(false);
    if (out.error || !out.record) { setErr((out.error ?? "Save failed").replace(/^.*invariant:\s*/, "")); return; }
    setEditing(false);
    onSaved(out.record);
  }

  const cell: React.CSSProperties = { padding: "6px 10px", borderBottom: `1px solid ${C.border}` };

  return (
    <div>
      {rows.length ? (
        <>
          <table style={{ fontSize: 13, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Post", "Count", "Pay Scale"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td style={cell}>{row.post}</td>
                  <td style={cell}>{row.count}</td>
                  <td style={{ ...cell, color: C.muted }}>{row.payScale ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {typeof total === "number" && sum !== total && (
            <div role="status" style={{ color: C.amber, fontSize: 12, marginTop: 8 }}>
              These rows add up to {sum}, but Total Vacancies says {total}. Check both against the notification.
            </div>
          )}
        </>
      ) : (
        <div style={{ color: C.muted, fontSize: 13 }}>No post-wise numbers entered yet.</div>
      )}

      {!editable ? (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
          The breakdown can be edited while the record is a draft. Click “Edit Record” first.
        </div>
      ) : !editing ? (
        <button
          onClick={() => { setText(rows.map((r) => [r.post, r.count, r.payScale ?? ""].join(" | ").replace(/ \| $/, "")).join("\n")); setErr(null); setEditing(true); }}
          style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, marginTop: 12 }}
        >
          {rows.length ? "Edit breakdown" : "Add post-wise numbers"}
        </button>
      ) : (
        <div style={{ marginTop: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
          <label style={labelStyle} htmlFor="vacancy-breakdown-rows">One post per line: Post name | number | pay scale (optional)</label>
          <textarea
            id="vacancy-breakdown-rows"
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ ...inputStyle, height: 160, resize: "vertical" }}
            placeholder={"Warder (RPC) | 560\nInstructor Grade-II (RPC) | 16\nJailor (Kalyana Karnataka) | 5 | ₹61,300 – ₹1,12,900"}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button
              onClick={() => { void save(); }}
              disabled={saving}
              style={{ padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {saving ? "Saving…" : "Save breakdown"}
            </button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>
              Cancel
            </button>
          </div>
          {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
        </div>
      )}
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

// Section keys are what the page switches on; labels are what the admin reads.
const SECTION_GROUPS: Array<{ group: string; items: Array<{ key: string; label: string }> }> = [
  { group: "The job", items: [
    { key: "Identity",     label: "Basic info" },
    { key: "Dates",        label: "Important dates" },
    { key: "Vacancies",    label: "Vacancies" },
    { key: "Eligibility",  label: "Eligibility" },
    { key: "Age",          label: "Age limit" },
    { key: "Financial",    label: "Fees & pay" },
  ] },
  { group: "Selection & applying", items: [
    { key: "Selection",    label: "Selection process" },
    { key: "Exam Stages",  label: "Exam stages" },
    { key: "Exam Pattern", label: "Exam pattern" },
    { key: "Syllabus",     label: "Syllabus" },
    { key: "How to Apply", label: "How to apply" },
    { key: "Links",        label: "Links" },
    { key: "Documents",    label: "Documents" },
  ] },
  { group: "After publishing", items: [
    { key: "Status",       label: "Recruitment status" },
    { key: "Updates",      label: "Official updates" },
    { key: "Conditions",   label: "Special conditions" },
  ] },
  { group: "Records", items: [
    { key: "Evidence",     label: "Sources" },
    { key: "Conflicts",    label: "Conflicts" },
    { key: "Revisions",    label: "Change history" },
  ] },
];

// The side menu's keys, matched to the section titles the help text is filed under.
const SECTION_HELP: Record<string, string> = {
  "Identity": HELP["Identity"],
  "Dates": HELP["Important Dates"],
  "Vacancies": HELP["Vacancies"],
  "Eligibility": HELP["Post-wise Eligibility"],
  "Age": HELP["Age Criteria"],
  "Financial": HELP["Fees & Pay"],
  "Selection": HELP["Selection Process"],
  "Exam Stages": HELP["Exam Stages"],
  "Exam Pattern": HELP["Exam Pattern"],
  "Syllabus": HELP["Syllabus"],
  "How to Apply": HELP["How to Apply"],
  "Links": HELP["Links"],
  "Documents": HELP["Candidate Documents"],
  "Status": HELP["Recruitment Status"],
  "Updates": HELP["Official Update History"],
  "Conditions": HELP["Special Conditions"],
  "Evidence": HELP["Evidence Sources"],
  "Conflicts": HELP["Conflicts"],
  "Revisions": HELP["Revision History"],
};

type Fill = "filled" | "partial" | "empty";

const hasValue = (f: { value: unknown } | null | undefined): boolean => {
  const v = f?.value;
  if (v === null || v === undefined || v === "") return false;
  return !(Array.isArray(v) && v.length === 0);
};

/** How complete a section is, or null where "complete" has no meaning. */
function sectionFill(record: RecruitmentRecord, key: string): Fill | null {
  const one = (ok: boolean): Fill => (ok ? "filled" : "empty");
  switch (key) {
    case "Identity": {
      const c = record.classification ?? {};
      return c.qualification && c.shortDescription ? "filled" : "partial";
    }
    case "Dates": {
      if (hasValue(record.dates.applicationCloseDate)) return "filled";
      return Object.values(record.dates as unknown as Record<string, { value: unknown } | undefined>).some(hasValue) ? "partial" : "empty";
    }
    case "Vacancies":    return one(hasValue(record.vacancies.total));
    case "Eligibility":  return one(hasValue(record.eligibility));
    case "Age":          return one(hasValue(record.age));
    case "Financial":    return one(hasValue(record.financial.feeGeneral));
    case "Selection":    return one(hasValue(record.selection));
    case "Exam Stages":  return one((record.examStages ?? []).length > 0);
    case "Exam Pattern": return one(hasValue(record.examPattern));
    case "Syllabus":     return one(hasValue(record.syllabus));
    case "How to Apply": return one((record.howToApply ?? []).length > 0);
    case "Links":
      if (record.links.some((l) => l.official)) return "filled";
      return record.links.length > 0 ? "partial" : "empty";
    case "Documents":    return one(record.documents.length > 0);
    default:             return null;
  }
}

const FILL_COLORS: Record<Fill, string> = { filled: C.green, partial: C.amber, empty: "#2b3a5c" };
const FILL_TITLES: Record<Fill, string> = { filled: "Filled", partial: "Partly filled", empty: "Empty" };

const STATE_INFO: Record<string, { label: string; note: string }> = {
  DRAFT:     { label: "Draft",     note: "Not visible to the public" },
  APPROVED:  { label: "Approved",  note: "Ready to publish — not yet public" },
  PUBLISHED: { label: "Published", note: "Live on the website" },
  ARCHIVED:  { label: "Archived",  note: "Removed from the website" },
};

// ─── Publish checklist ────────────────────────────────────

function countPending(record: RecruitmentRecord): number {
  const fields: Array<{ value: unknown; status?: string } | null | undefined> = [
    record.identity.notificationNumber,
    ...Object.values(record.dates as unknown as Record<string, { value: unknown; status?: string } | undefined>),
    record.vacancies.total,
    record.vacancies.breakdown,
    ...Object.values(record.financial as unknown as Record<string, { value: unknown; status?: string } | undefined>),
    record.eligibility,
    record.age,
    record.selection,
    record.examPattern,
    record.syllabus,
  ];
  return fields.filter((f) => f && typeof f === "object" && hasValue(f) && f.status === "PENDING").length;
}

function PublishChecklist({ record, onJump }: { record: RecruitmentRecord; onJump: (section: string) => void }) {
  const items: Array<{ label: string; section: string; done: boolean; required?: boolean }> = [
    { label: "Official link",    section: "Links",        done: record.links.some((l) => l.official), required: true },
    { label: "Last date",        section: "Dates",        done: hasValue(record.dates.applicationCloseDate) },
    { label: "Vacancies",        section: "Vacancies",    done: hasValue(record.vacancies.total) },
    { label: "Eligibility",      section: "Eligibility",  done: hasValue(record.eligibility) },
    { label: "Age limit",        section: "Age",          done: hasValue(record.age) },
    { label: "Application fee",  section: "Financial",    done: hasValue(record.financial.feeGeneral) },
    { label: "Selection process", section: "Selection",   done: hasValue(record.selection) },
    { label: "How to apply",     section: "How to Apply", done: (record.howToApply ?? []).length > 0 },
    { label: "Listing details",  section: "Identity",     done: sectionFill(record, "Identity") === "filled" },
  ];
  const done = items.filter((i) => i.done).length;
  const blocked = !items[0].done;
  const pending = countPending(record);
  const pct = Math.round((done / items.length) * 100);

  return (
    <div style={{ ...PANEL, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
          {blocked ? "Not ready to publish yet" : done === items.length ? "Ready to publish" : "Can be published — some details are still empty"}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>{done} of {items.length} filled</div>
      </div>
      <div style={{ height: 6, background: "#070b16", borderRadius: 999, marginTop: 10, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: blocked ? "linear-gradient(90deg, #f59e0b, #f97316)" : "linear-gradient(90deg, #22c55e, #22d3ee)", boxShadow: blocked ? "0 0 12px rgba(249,115,22,0.55)" : "0 0 12px rgba(34,211,238,0.5)", borderRadius: 999, transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        {items.map((i) => (
          <button
            key={i.label}
            onClick={() => onJump(i.section)}
            title={i.done ? "Filled — click to open" : "Empty — click to fill"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
              background: i.done ? C.green + "14" : i.required ? C.red + "18" : "transparent",
              color: i.done ? C.green : i.required ? C.red : C.muted,
              border: `1px solid ${i.done ? C.green + "44" : i.required ? C.red + "66" : C.border}`,
              fontWeight: i.done ? 500 : 600,
            }}
          >
            <span aria-hidden>{i.done ? "✓" : "○"}</span>
            {i.label}{i.required && !i.done ? " (required)" : ""}
          </button>
        ))}
      </div>
      {blocked && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
          Publishing needs at least one link marked official. Open <b style={{ color: C.text }}>Links</b>, or run AI Assist and click “Add as official link”.
        </div>
      )}
      {pending > 0 && (
        <div style={{ fontSize: 12, color: C.amber, marginTop: 8, lineHeight: 1.5 }}>
          {pending} value{pending === 1 ? " is" : "s are"} marked Pending — check {pending === 1 ? "it" : "them"} against the official notification before publishing.
        </div>
      )}
    </div>
  );
}

export default function CmsRecordEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [record, setRecord] = useState<RecruitmentRecord | null>(null);
  const [revisions, setRevisions] = useState<FieldRevision[]>([]);
  const [activeSection, setActiveSection] = useState<string>("Identity");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [publishingSeq, setPublishingSeq] = useState(false);
  const [publishSeqErr, setPublishSeqErr] = useState<string | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertErr, setRevertErr] = useState<string | null>(null);
  const [showAddUpdate, setShowAddUpdate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  // AI Assist
  const [aiUrl, setAiUrl] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{
    filled: { fieldPath: string; label: string; value: unknown }[];
    suggested: { fieldPath: string; label: string; aiValue: unknown; existingValue: unknown; existingEvidenceIds?: string[] }[];
    notFound: string[];
    confirmed: string[];
    flagged: { label: string; value: unknown; reason: string }[];
    suggestedLinks: (CmsRecruitmentLink & { context: string; host: string })[];
    identityCheck?: {
      organization: { existing: string; detected: string | null; status: string };
      year: { existing: number; detected: number[]; status: string };
    };
    sourceUrl: string;
    sourceKind?: "html" | "pdf";
  } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiApplying, setAiApplying] = useState<string | null>(null);

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

  // Used by the exam pattern and syllabus editors. Resolves to an error message, or null.
  async function saveBlock(fieldPath: "examPattern" | "syllabus", value: unknown, reason: string): Promise<string | null> {
    if (!record) return "Record not loaded";
    const out = await saveListField(record.id, record.recordRevision, fieldPath, value, reason);
    if (out.error || !out.record) return out.error ?? "Save failed";
    onFieldSaved(out.record);
    return null;
  }

  function onFieldSaved(updated: RecruitmentRecord) {
    setRecord(updated);
    void loadRevisions();
  }

  async function handleRevert() {
    if (!record) return;
    setReverting(true);
    setRevertErr(null);
    try {
      const res = await fetch(`/api/admin/cms/records/${id}/revert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRevertErr(data.error ?? `Revert failed: HTTP ${res.status}`);
        return;
      }
      setRecord(data.record);
      void loadRevisions();
    } catch (e) {
      setRevertErr(String(e));
    } finally {
      setReverting(false);
    }
  }

  async function handlePublishSequence() {
    if (!record) return;
    setPublishingSeq(true);
    setPublishSeqErr(null);
    try {
      if (record.draftState === "DRAFT") {
        const approveRes = await fetch(`/api/admin/cms/records/${id}/approve`, { method: "POST" });
        const approveData = await approveRes.json();
        if (!approveRes.ok) {
          setPublishSeqErr(approveData.error ?? `Approve failed: HTTP ${approveRes.status}`);
          return;
        }
        setRecord(approveData.record);
      }
      const publishRes = await fetch(`/api/admin/cms/records/${id}/publish`, { method: "POST" });
      const publishData = await publishRes.json();
      if (!publishRes.ok) {
        setPublishSeqErr(publishData.error ?? `Publish failed: HTTP ${publishRes.status}`);
        return;
      }
      setRecord(publishData.record);
      if (publishData.revalidated === false) {
        setPublishSeqErr(
          "Published, but the public site cache could not be refreshed. The public pages will update after the next deployment.",
        );
      }
    } catch (e) {
      setPublishSeqErr(String(e));
    } finally {
      setPublishingSeq(false);
    }
  }

  // With a file, the PDF itself is sent along with the address it came from.
  async function handleAiAssist(file?: File) {
    if (!aiUrl.trim() || !record) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.set("url", aiUrl.trim());
        form.set("file", file);
        res = await fetch(`/api/admin/cms/records/${id}/ai-assist`, { method: "POST", body: form });
      } else {
        res = await fetch(`/api/admin/cms/records/${id}/ai-assist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: aiUrl.trim() }),
        });
      }
      if (res.status === 413) {
        setAiError("This PDF is larger than 4 MB, which is the most that can be uploaded here.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setRecord(data.record);
      void loadRevisions();
      setAiResult({
        filled: data.filled,
        suggested: data.suggested,
        notFound: data.notFound,
        confirmed: data.confirmed ?? [],
        flagged: data.flagged ?? [],
        suggestedLinks: data.suggestedLinks ?? [],
        identityCheck: data.identityCheck,
        sourceUrl: data.sourceUrl,
        sourceKind: data.sourceKind,
      });
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiApplySuggestion(fieldPath: string, label: string, aiValue: unknown, existingEvidenceIds: string[] = []) {
    if (!record || !aiResult) return;
    setAiApplying(fieldPath);
    try {
      const field = buildAiField(aiValue, existingEvidenceIds);
      const res = await fetch(`/api/admin/cms/records/${id}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldPath,
          field,
          clientRevision: record.recordRevision,
          reason: aiAssistReason(aiResult.sourceUrl, "applied"),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? `Could not apply ${label}`);
        return;
      }
      setRecord(data.record);
      void loadRevisions();
      // Remove from suggested list
      setAiResult((prev) =>
        prev ? { ...prev, suggested: prev.suggested.filter((s) => s.fieldPath !== fieldPath) } : null
      );
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiApplying(null);
    }
  }

  // Adding a suggested link is the admin's statement that they checked it.
  async function handleAiAddLink(link: CmsRecruitmentLink & { context: string; host: string }) {
    if (!record || !aiResult) return;
    setAiApplying(link.url);
    setAiError(null);
    const next: CmsRecruitmentLink = { type: link.type, label: link.label, url: link.url, official: true };
    const out = await saveListField(
      record.id,
      record.recordRevision,
      "links",
      [...record.links, next],
      `AI Assist (link added by admin) — found on ${aiResult.sourceUrl}`,
    );
    setAiApplying(null);
    if (out.error || !out.record) {
      setAiError(out.error ?? `Could not add ${link.label}`);
      return;
    }
    setRecord(out.record);
    void loadRevisions();
    setAiResult((prev) => (prev ? { ...prev, suggestedLinks: prev.suggestedLinks.filter((l) => l.url !== link.url) } : null));
  }

  if (loading) return <div style={{ color: C.muted, padding: 40 }}>Loading…</div>;
  if (loadErr) return <div style={{ color: C.red, padding: 40 }}>Error: {loadErr}</div>;
  if (!record) return <div style={{ color: C.muted, padding: 40 }}>Record not found.</div>;

  const stateColor = { DRAFT: C.amber, APPROVED: C.green, PUBLISHED: C.accent, ARCHIVED: C.muted }[record.draftState] ?? C.muted;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* ── Left: section nav ── */}
      <div style={{
        width: 208, flexShrink: 0, position: "sticky", top: 68,
        display: "flex", flexDirection: "column",
        maxHeight: "calc(100vh - 84px)", overflowY: "auto",
      }}>
        {/* Shown below the actions, which come later in the markup. */}
        <div style={{
          ...PANEL,
          overflow: "hidden",
          flexShrink: 0,
          order: 2,
          marginTop: 12,
        }}>
          {/* Section tabs */}
          <nav style={{ padding: "6px 0 8px" }}>
            {SECTION_GROUPS.map((g) => (
              <div key={g.group}>
                <div style={{ padding: "10px 14px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6e7681" }}>
                  {g.group}
                </div>
                {g.items.map(({ key, label }) => {
                  const active = activeSection === key;
                  const fill = sectionFill(record, key);
                  return (
                    <button
                      key={key}
                      title={SECTION_HELP[key]}
                      onClick={() => setActiveSection(key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 14px",
                        background: active ? "linear-gradient(90deg, rgba(249,115,22,0.16), rgba(99,102,241,0.10))" : "transparent",
                        border: "none",
                        borderLeft: active ? `2px solid ${C.orange}` : "2px solid transparent",
                        color: active ? C.text : "#adb5bd",
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        cursor: "pointer",
                      }}
                    >
                      <span>{label}</span>
                      {fill && (
                        <span
                          title={FILL_TITLES[fill]}
                          aria-label={FILL_TITLES[fill]}
                          style={{ width: 8, height: 8, borderRadius: 999, background: FILL_COLORS[fill], flexShrink: 0 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div style={{ display: "flex", gap: 10, padding: "8px 14px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted }}>
            {(["filled", "partial", "empty"] as Fill[]).map((f) => (
              <span key={f} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: FILL_COLORS[f] }} />
                {f === "filled" ? "Filled" : f === "partial" ? "Partly" : "Empty"}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        {(record.draftState === "DRAFT" || record.draftState === "APPROVED") && (
          <div>
            <button
              onClick={() => { void handlePublishSequence(); }}
              title={HELP["Approve & Publish"]}
              disabled={publishingSeq}
              style={{
                width: "100%",
                padding: "9px 14px",
                background: "linear-gradient(135deg, #22c55e, #14b8a6)",
                color: "#04130c",
                border: "none",
                boxShadow: "0 0 22px rgba(34,197,94,0.35)",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {publishingSeq
                ? (record.draftState === "DRAFT" ? "Approving…" : "Publishing…")
                : (record.draftState === "DRAFT" ? "Approve & Publish" : "Publish Record")}
            </button>
            {publishSeqErr && (
              <div style={{ color: C.red, fontSize: 11, marginTop: 8 }}>{publishSeqErr}</div>
            )}
          </div>
        )}

        {record.draftState === "PUBLISHED" && (
          <div>
            <button
              onClick={() => { void handleRevert(); }}
              title={HELP["Edit Record"]}
              disabled={reverting}
              style={{
                width: "100%",
                padding: "9px 14px",
                background: reverting ? "#1c2740" : C.amber,
                color: reverting ? C.muted : "#070b16",
                border: reverting ? `1px solid ${C.border}` : "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                cursor: reverting ? "not-allowed" : "pointer",
              }}
            >
              {reverting ? "Reverting…" : "Edit Record"}
            </button>
            {revertErr && (
              <div style={{ color: C.red, fontSize: 11, marginTop: 8 }}>{revertErr}</div>
            )}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textAlign: "center" }}>
              The live page stays as it is until you publish again
            </div>
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={() => setShowPreview(true)}
            title={HELP["Preview public page"]}
            style={{
              width: "100%",
              padding: "7px 14px",
              background: "none",
              color: C.accent,
              border: `1px solid ${C.accent}44`,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Preview public page
          </button>
          <button
            onClick={() => router.push("/admin/cms")}
            style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            ← All records
          </button>
        </div>
      </div>

      {/* ── Preview overlay ── */}
      {showPreview && (
        <DraftPreviewOverlay
          record={record}
          onClose={() => setShowPreview(false)}
          scrollRef={previewScrollRef}
        />
      )}

      {/* ── Add Update modal ── */}
      {showAddUpdate && (
        <AddUpdateModal
          recordId={id}
          recordRevision={record.recordRevision}
          draftState={record.draftState}
          onSaved={(updated) => { setRecord(updated); void loadRevisions(); }}
          onClose={() => setShowAddUpdate(false)}
        />
      )}

      {/* ── Right: section content ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* ── Record header ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.3 }}>
              {record.identity.title.value ?? record.slug}
            </h1>
            <span style={{
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              background: stateColor + "22",
              color: stateColor,
              border: `1px solid ${stateColor}44`,
            }}>
              {STATE_INFO[record.draftState]?.label ?? record.draftState}
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            {record.identity.organizationName} · {STATE_INFO[record.draftState]?.note}
            {record.draftState === "PUBLISHED" && (
              <>
                {" · "}
                <a href={`/jobs/${record.slug}`} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: "none" }}>
                  View live page ↗
                </a>
              </>
            )}
          </div>
        </div>

        {(record.draftState === "DRAFT" || record.draftState === "APPROVED") && (
          <PublishChecklist record={record} onJump={setActiveSection} />
        )}

        {/* ── AI Assist panel (DRAFT / APPROVED only) ── */}
        {(record.draftState === "DRAFT" || record.draftState === "APPROVED") && (
          <div style={{ ...PANEL, marginBottom: 16, overflow: "hidden" }}>
            <div style={{
              padding: "10px 18px",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.muted,
              background: "#070b16",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span>✦</span>
              <span>AI Assist</span>
              <InfoTip id="AI Assist" />
              <span style={{ fontWeight: 400, fontSize: 10, opacity: 0.6, textTransform: "none", letterSpacing: 0 }}>
                — optional · fields stay editable · does not publish
              </span>
            </div>
            <div style={{ padding: 18 }}>
              <p style={{ fontSize: 12, color: C.muted, margin: "0 0 14px", lineHeight: 1.5 }}>
                Paste an official notification URL. AI will extract what it can and pre-fill empty fields as{" "}
                <span style={{ color: C.amber, fontWeight: 600 }}>Pending</span>.
                Existing values are never overwritten.
              </p>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <input
                  type="url"
                  value={aiUrl}
                  onChange={(e) => setAiUrl(e.target.value)}
                  placeholder="https://ssc.gov.in/notice/... or https://..."
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    background: "#070b16",
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    color: C.text,
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAiAssist(); }}
                />
                <button
                  onClick={() => { void handleAiAssist(); }}
                  disabled={aiLoading || !aiUrl.trim()}
                  style={{
                    padding: "8px 18px",
                    background: aiLoading ? "#1c2740" : "#1a3a6b",
                    color: aiLoading ? C.muted : C.accent,
                    border: `1px solid ${aiLoading ? C.border : C.accent + "44"}`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: aiLoading || !aiUrl.trim() ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                    fontFamily: "inherit",
                  }}
                >
                  {aiLoading ? "Extracting…" : "Assist with AI"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                Link gives an error? Some official sites block us. Download the PDF yourself, keep its link in the box, then{" "}
                <label style={{ color: aiLoading || !aiUrl.trim() ? C.muted : C.accent, cursor: aiLoading || !aiUrl.trim() ? "not-allowed" : "pointer", fontWeight: 600 }}>
                  upload the PDF
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={aiLoading || !aiUrl.trim()}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void handleAiAssist(file);
                    }}
                  />
                </label>
                {" "}(up to 4 MB).
              </div>

              {aiError && (
                <div style={{ color: C.red, fontSize: 12, padding: "8px 12px", background: C.red + "11", borderRadius: 5, border: `1px solid ${C.red}33`, marginBottom: 12 }}>
                  {aiError}
                </div>
              )}

              {aiResult && (
                <div style={{ fontSize: 12 }}>
                  {aiResult.sourceKind === "pdf" && (
                    <div style={{ color: C.muted, marginBottom: 10 }}>Source read as PDF document</div>
                  )}
                  {/* Filled */}
                  {aiResult.filled.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: C.green, fontWeight: 700, marginBottom: 6 }}>
                        ✓ Filled {aiResult.filled.length} field{aiResult.filled.length !== 1 ? "s" : ""}
                      </div>
                      {aiResult.filled.map((f) => (
                        <div key={f.fieldPath} style={{ display: "flex", gap: 8, marginBottom: 3, color: C.text }}>
                          <span style={{ color: C.muted, minWidth: 160 }}>{f.label}</span>
                          <span style={{ color: C.amber }}>Pending</span>
                          <span style={{ color: C.text, whiteSpace: "pre-wrap", minWidth: 0 }}>{describeAiValue(f.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Suggested (occupied fields) */}
                  {aiResult.suggested.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: C.accent, fontWeight: 700, marginBottom: 6 }}>
                        💡 Suggested {aiResult.suggested.length} field{aiResult.suggested.length !== 1 ? "s" : ""} (existing value preserved)
                      </div>
                      {aiResult.suggested.map((s) => (
                        <div key={s.fieldPath} style={{ marginBottom: 8, padding: "8px 10px", background: "#070b16", borderRadius: 5, border: `1px solid ${C.border}` }}>
                          <div style={{ fontWeight: 600, color: C.muted, marginBottom: 4 }}>{s.label}</div>
                          <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
                            <span style={{ color: C.muted }}>Current: <span style={{ color: C.text, whiteSpace: "pre-wrap" }}>{describeAiValue(s.existingValue)}</span></span>
                            <span style={{ color: C.muted }}>AI: <span style={{ color: C.amber, whiteSpace: "pre-wrap" }}>{describeAiValue(s.aiValue)}</span></span>
                            <button
                              onClick={() => { void handleAiApplySuggestion(s.fieldPath, s.label, s.aiValue, s.existingEvidenceIds ?? []); }}
                              disabled={aiApplying === s.fieldPath}
                              style={{
                                padding: "2px 10px",
                                background: "none",
                                color: C.accent,
                                border: `1px solid ${C.accent}44`,
                                borderRadius: 4,
                                fontSize: 11,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              {aiApplying === s.fieldPath ? "Applying…" : "Apply AI value"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Source agrees with the record — nothing to apply */}
                  {(aiResult.confirmed ?? []).length > 0 && (
                    <div style={{ marginBottom: 12, color: C.muted }}>
                      <span style={{ color: C.green, fontWeight: 700 }}>✓ Matches current value:</span>{" "}
                      {(aiResult.confirmed ?? []).join(", ")}
                    </div>
                  )}

                  {/* Organisation / year: read-only comparison, never applied */}
                  {aiResult.identityCheck && (() => {
                    const { organization: o, year: y } = aiResult.identityCheck;
                    const tone = (s: string) => (s === "mismatch" ? C.red : s === "ambiguous" ? C.amber : s === "match" ? C.green : C.muted);
                    const word = (s: string) => (s === "mismatch" ? "⚠ Mismatch" : s === "ambiguous" ? "Ambiguous" : s === "match" ? "Matches" : "Not detected");
                    return (
                      <div style={{ marginBottom: 12, padding: "8px 10px", background: "#070b16", borderRadius: 5, border: `1px solid ${C.border}` }}>
                        <div style={{ color: C.muted, fontWeight: 700, marginBottom: 6 }}>
                          Organisation / year — comparison only, not editable here
                        </div>
                        <div style={{ marginBottom: 3, color: C.muted }}>
                          Organisation — record: <span style={{ color: C.text }}>{o.existing}</span>
                          {" · "}source: <span style={{ color: C.text }}>{o.detected ?? "—"}</span>
                          {" · "}<span style={{ color: tone(o.status) }}>{word(o.status)}</span>
                        </div>
                        <div style={{ marginBottom: 6, color: C.muted }}>
                          Year — record: <span style={{ color: C.text }}>{y.existing}</span>
                          {" · "}source: <span style={{ color: C.text }}>{y.detected.length > 0 ? y.detected.join(" / ") : "—"}</span>
                          {" · "}<span style={{ color: tone(y.status) }}>{word(y.status)}</span>
                        </div>
                        <a href={aiResult.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, wordBreak: "break-all" }}>
                          Open source: {aiResult.sourceUrl}
                        </a>
                      </div>
                    );
                  })()}

                  {/* Links to official domains found on the source page — added only on click */}
                  {(aiResult.suggestedLinks ?? []).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: C.accent, fontWeight: 700, marginBottom: 6 }}>
                        🔗 Official links found on this page — open each one to check, then add
                      </div>
                      {aiResult.suggestedLinks.map((l) => (
                        <div key={l.url} style={{ marginBottom: 8, padding: "8px 10px", background: "#070b16", borderRadius: 5, border: `1px solid ${C.border}` }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: C.text }}>{l.label}</span>
                            <span style={{ color: C.green }}>on {l.host}</span>
                            <button
                              onClick={() => { void handleAiAddLink(l); }}
                              disabled={aiApplying === l.url}
                              style={{ padding: "2px 10px", background: "none", color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                            >
                              {aiApplying === l.url ? "Adding…" : "Add as official link"}
                            </button>
                          </div>
                          <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, wordBreak: "break-all" }}>{l.url}</a>
                          <div style={{ color: C.muted }}>Shown on the page as: {l.context}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Flagged: extracted but not trusted enough to apply or suggest */}
                  {(aiResult.flagged ?? []).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: C.amber, fontWeight: 700, marginBottom: 6 }}>
                        ⚠ Needs manual check — {aiResult.flagged.length} value{aiResult.flagged.length !== 1 ? "s" : ""} not applied
                      </div>
                      {aiResult.flagged.map((f, i) => (
                        <div key={`${f.label}-${i}`} style={{ marginBottom: 4, color: C.muted }}>
                          <span style={{ color: C.text }}>{f.label}:</span>{" "}
                          <span style={{ color: C.amber }}>{String(f.value)}</span> — {f.reason}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Not found */}
                  {aiResult.notFound.length > 0 && (
                    <div>
                      <div style={{ color: C.muted, fontWeight: 700, marginBottom: 6 }}>
                        — Not found: {aiResult.notFound.join(", ")}
                      </div>
                    </div>
                  )}

                  {aiResult.filled.length === 0 && aiResult.suggested.length === 0 && (aiResult.confirmed ?? []).length === 0 && (aiResult.flagged ?? []).length === 0 && (
                    <div style={{ color: C.muted }}>
                      AI could not extract any fields from this URL. Try a more specific page or enter values manually.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Identity ── */}
        {activeSection === "Identity" && (
          <Section title="Identity">
            <EditableField
              label="Title"
              fieldPath="identity.title"
              field={record.identity.title as ProvenanceField<unknown>}
              recordId={id}
              recordRevision={record.recordRevision}
              onSaved={onFieldSaved}
              placeholder="e.g. BPSC 72nd Combined Competitive Exam"
            />
            <EditableField
              label="Short Title"
              fieldPath="identity.shortTitle"
              field={record.identity.shortTitle as ProvenanceField<unknown> | undefined}
              recordId={id}
              recordRevision={record.recordRevision}
              onSaved={onFieldSaved}
              placeholder="e.g. BPSC 72nd CCE"
            />
            <EditableField
              label="Notification Number"
              fieldPath="identity.notificationNumber"
              field={record.identity.notificationNumber as ProvenanceField<unknown> | undefined}
              recordId={id}
              recordRevision={record.recordRevision}
              onSaved={onFieldSaved}
              placeholder="e.g. Advt No. 72/2024"
            />
            <EditableField
              label="Advertisement Number"
              fieldPath="identity.advertisementNumber"
              field={record.identity.advertisementNumber as ProvenanceField<unknown> | undefined}
              recordId={id}
              recordRevision={record.recordRevision}
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
            <ListingDetailsEditor record={record} onSaved={onFieldSaved} />
          </Section>
        )}

        {/* ── Status ── */}
        {activeSection === "Status" && (
          <Section title="Recruitment Status">
            <LifecycleStatusSelect
              record={record}
              recordId={id}
              onSaved={onFieldSaved}
            />
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
                recordRevision={record.recordRevision}
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
              recordRevision={record.recordRevision}
              onSaved={onFieldSaved}
              inputType="number"
              placeholder="e.g. 1000"
            />
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Breakdown
                {record.vacancies.breakdown && <Badge status={record.vacancies.breakdown.status} />}
              </div>
              <VacancyBreakdownEditor record={record} onSaved={onFieldSaved} />
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
              recordRevision={record.recordRevision}
              onSaved={onFieldSaved}
              inputType="number"
              placeholder="e.g. 500 (or leave blank for 0 = free)"
            />
            <EditableField
              label="Application Fee — SC / ST / PwD"
              fieldPath="financial.feeSCST"
              field={record.financial.feeSCST as ProvenanceField<unknown> | undefined}
              recordId={id}
              recordRevision={record.recordRevision}
              onSaved={onFieldSaved}
              inputType="number"
              placeholder="e.g. 0 (or 250)"
            />
            <EditableField
              label="Pay Scale"
              fieldPath="financial.payScale"
              field={record.financial.payScale as ProvenanceField<unknown> | undefined}
              recordId={id}
              recordRevision={record.recordRevision}
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

        {/* ── Exam Stages ── */}
        {activeSection === "Exam Stages" && (
          <Section title="Exam Stages">
            <ExamStagesEditor
              record={record}
              onSave={async (stages, reason) => {
                const out = await saveListField(record.id, record.recordRevision, "examStages", stages, reason);
                if (out.error || !out.record) return out.error ?? "Save failed";
                onFieldSaved(out.record);
                return null;
              }}
            />
          </Section>
        )}

        {/* ── Exam Pattern ── */}
        {activeSection === "Exam Pattern" && (
          <Section title="Exam Pattern">
            <ExamPatternEditor record={record} onSave={saveBlock} />
          </Section>
        )}

        {/* ── Syllabus ── */}
        {activeSection === "Syllabus" && (
          <Section title="Syllabus">
            <SyllabusEditor record={record} onSave={saveBlock} />
          </Section>
        )}

        {/* ── How to Apply ── */}
        {activeSection === "How to Apply" && (
          <Section title="How to Apply">
            <HowToApplyEditor record={record} onSaved={onFieldSaved} />
          </Section>
        )}

        {/* ── Links ── */}
        {activeSection === "Links" && (
          <Section title="Links">
            <LinksEditor record={record} onSaved={onFieldSaved} />
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

        {/* ── Updates (Official Update History) ── */}
        {activeSection === "Updates" && (
          <Section title="Official Update History">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: C.muted }}>
                {record.updates.length} update{record.updates.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setShowAddUpdate(true)}
                style={{
                  padding: "5px 12px",
                  background: "none",
                  color: C.accent,
                  border: `1px solid ${C.accent}44`,
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                + Add Update
              </button>
            </div>
            {record.updates.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13 }}>No updates recorded yet.</div>
            ) : (
              <div>
                {[...record.updates].reverse().map((u) => (
                  <UpdateRecordCard key={u.id} update={u} />
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
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#1c2740", borderRadius: 6, fontSize: 13, color: C.muted }}>
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
                    background: c.resolvedAt ? "#1c2740" : C.red + "11",
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
                      <code style={{ fontSize: 12, color: C.accent, background: "#16223d", padding: "1px 6px", borderRadius: 4 }}>
                        {rev.fieldPath}
                      </code>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        {new Date(rev.revisedAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                    {rev.reason && (
                      <div style={{ fontSize: 12, color: C.amber, marginBottom: 4, fontStyle: "italic" }}>&ldquo;{rev.reason}&rdquo;</div>
                    )}
                    <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.muted, fontSize: 10, marginBottom: 2 }}>BEFORE</div>
                        <pre style={{ margin: 0, color: C.muted, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#070b16", padding: "6px 8px", borderRadius: 4, maxHeight: 80, overflow: "auto" }}>
                          {JSON.stringify(rev.oldValue, null, 2)}
                        </pre>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.green, fontSize: 10, marginBottom: 2 }}>AFTER</div>
                        <pre style={{ margin: 0, color: C.text, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#070b16", padding: "6px 8px", borderRadius: 4, maxHeight: 80, overflow: "auto" }}>
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
      <div style={{ width: 160, color: C.muted, flexShrink: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", paddingTop: 2 }}>{label}<InfoTip id={label} /></div>
      <div style={{ color: C.text, fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? 12 : 13 }}>{value}</div>
    </div>
  );
}

// ─── Lifecycle Status Select ──────────────────────────────

const RECRUITMENT_STATUSES: RecruitmentStatus[] = [
  "DRAFT", "UPCOMING", "OPEN", "CLOSING_SOON", "APPLICATIONS_CLOSED",
  "EXAM_SCHEDULED", "RESULT_PENDING", "COMPLETED", "CANCELLED", "PAUSED",
];

const STATUS_COLORS: Record<RecruitmentStatus, string> = {
  DRAFT: C.muted,
  UPCOMING: C.accent,
  OPEN: C.green,
  CLOSING_SOON: C.orange,
  APPLICATIONS_CLOSED: C.amber,
  EXAM_SCHEDULED: C.accent,
  RESULT_PENDING: C.amber,
  COMPLETED: C.green,
  CANCELLED: C.red,
  PAUSED: C.muted,
};

function LifecycleStatusSelect({
  record,
  recordId,
  onSaved,
}: {
  record: RecruitmentRecord;
  recordId: string;
  onSaved: (updated: RecruitmentRecord) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const computed = record.lifecycle.status;
  const override = record.lifecycle.statusOverride;
  const effective = override ?? computed;

  async function setOverride(value: RecruitmentStatus | "") {
    setSaving(true);
    setErr(null);
    try {
      const field: ProvenanceField<RecruitmentStatus | null> = {
        value: value === "" ? null : value,
        status: "PENDING",
        evidenceIds: [],
        conflict: false,
        manuallyEdited: true,
      };
      const res = await fetch(`/api/admin/cms/records/${recordId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldPath: "lifecycle.statusOverride",
          field,
          clientRevision: record.recordRevision,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onSaved(data.record as RecruitmentRecord);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  const effectiveColor = STATUS_COLORS[effective] ?? C.muted;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          Effective Status
        </div>
        <span style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 5,
          fontSize: 13,
          fontWeight: 700,
          background: effectiveColor + "22",
          color: effectiveColor,
          border: `1px solid ${effectiveColor}44`,
        }}>
          {effective}
        </span>
        {override && (
          <span style={{ marginLeft: 8, fontSize: 11, color: C.amber }}>overridden</span>
        )}
        {!override && (
          <span style={{ marginLeft: 8, fontSize: 11, color: C.muted }}>computed</span>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          Status Override
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={override ?? ""}
            onChange={(e) => { void setOverride(e.target.value as RecruitmentStatus | ""); }}
            disabled={saving || record.draftState === "PUBLISHED" || record.draftState === "ARCHIVED"}
            style={{
              ...inputStyle,
              width: "auto",
              minWidth: 200,
              cursor: record.draftState === "PUBLISHED" || record.draftState === "ARCHIVED" ? "not-allowed" : "pointer",
            }}
          >
            <option value="">— use computed ({computed}) —</option>
            {RECRUITMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {saving && <span style={{ fontSize: 12, color: C.muted }}>Saving…</span>}
        </div>
        {err && <div style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</div>}
        {(record.draftState === "PUBLISHED" || record.draftState === "ARCHIVED") && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            Status override is read-only for {record.draftState} records.
          </div>
        )}
      </div>

      <div style={{ paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <Row label="Computed Status" value={computed} />
        {override && <Row label="Override" value={override} />}
        <Row label="Conflicts" value={record.lifecycle.conflicts.length === 0 ? "None" : `${record.lifecycle.conflicts.filter((c) => !c.resolvedAt).length} unresolved`} />
        <Row label="Events" value={String(record.lifecycle.events.length)} />
      </div>
    </div>
  );
}

// ─── Update Record Card ───────────────────────────────────

const UPDATE_TYPE_COLORS: Record<string, string> = {
  CORRIGENDUM: C.orange,
  VACANCY_REVISION: C.amber,
  DEADLINE_EXTENSION: C.accent,
  POSTPONEMENT: C.amber,
  RESCHEDULE: C.accent,
  EXAM_NOTICE: C.green,
  CANCELLATION: C.red,
  GENERAL_NOTICE: C.muted,
};

function UpdateRecordCard({ update }: { update: UpdateRecord }) {
  const typeColor = UPDATE_TYPE_COLORS[update.type] ?? C.muted;
  return (
    <div style={{
      marginBottom: 12,
      padding: "12px 14px",
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{
          display: "inline-block",
          padding: "1px 8px",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          background: typeColor + "22",
          color: typeColor,
          border: `1px solid ${typeColor}44`,
        }}>
          {update.type.replace(/_/g, " ")}
        </span>
        <span style={{ fontSize: 12, color: C.muted }}>{update.date}</span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{update.title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{update.description}</div>
      {update.field && (
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
          Field: <code style={{ color: C.accent, background: "#16223d", padding: "1px 5px", borderRadius: 3 }}>{update.field}</code>
          {update.previousValue !== undefined && (
            <span> {String(update.previousValue)} → {String(update.newValue)}</span>
          )}
        </div>
      )}
      {update.sourceUrl && (
        <a href={update.sourceUrl} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 12, color: C.accent, marginTop: 6, display: "block" }}>
          Source Notice ↗
        </a>
      )}
    </div>
  );
}

// ─── Add Update Modal ─────────────────────────────────────

const UPDATE_TYPES: UpdateRecord["type"][] = [
  "CORRIGENDUM", "VACANCY_REVISION", "DEADLINE_EXTENSION", "POSTPONEMENT",
  "RESCHEDULE", "EXAM_NOTICE", "CANCELLATION", "GENERAL_NOTICE",
];

function AddUpdateModal({
  recordId,
  recordRevision,
  draftState,
  onSaved,
  onClose,
}: {
  recordId: string;
  recordRevision: string;
  draftState: string;
  onSaved: (record: RecruitmentRecord) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<UpdateRecord["type"]>("GENERAL_NOTICE");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isStructural, setIsStructural] = useState(false);
  const [fieldPath, setFieldPath] = useState("");
  const [previousValue, setPreviousValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setErr("Title and description are required.");
      return;
    }
    setSubmitting(true);
    setErr(null);

    const updatePayload = {
      type,
      date,
      title: title.trim(),
      description: description.trim(),
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
      ...(isStructural && fieldPath.trim() ? { field: fieldPath.trim() } : {}),
      ...(isStructural && previousValue.trim() ? { previousValue: previousValue.trim() } : {}),
      ...(isStructural && newValue.trim() ? { newValue: newValue.trim() } : {}),
    };

    try {
      let res: Response;

      if (isStructural && fieldPath.trim()) {
        // Structural path: PATCH /fields with the updateEntry appended atomically.
        // The field value itself must be provided as the new plain-string value.
        const fieldValue = newValue.trim();
        res = await fetch(`/api/admin/cms/records/${recordId}/fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldPath: fieldPath.trim(),
            field: {
              value: fieldValue,
              status: "MANUAL",
              evidenceIds: [],
              conflict: false,
              manuallyEdited: true,
            },
            clientRevision: recordRevision,
            reason: `Structural update: ${type}`,
            updateEntry: updatePayload,
          }),
        });
      } else {
        // Announcement-only path: POST /updates
        res = await fetch(`/api/admin/cms/records/${recordId}/updates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ update: updatePayload }),
        });
      }

      const data = await res.json() as { record: RecruitmentRecord; error?: string };
      if (!res.ok) {
        setErr(data.error ?? `Failed: HTTP ${res.status}`);
        return;
      }
      onSaved(data.record);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "7px 10px",
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 5,
    color: C.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  };
  const labelStyle = { fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4, display: "block" };

  const canStructural = draftState === "DRAFT" || draftState === "APPROVED";

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 1100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.6)",
    }}>
      <form
        onSubmit={(e) => { void submit(e); }}
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "24px 28px",
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Add Update Record</h3>
          <button type="button" onClick={onClose}
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as UpdateRecord["type"])} style={inputStyle}>
              {UPDATE_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Notice Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} required />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Application Deadline Extended by 10 Days"
            style={inputStyle}
            required
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief summary of what changed and why"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            required
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Source URL (optional)</label>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            style={inputStyle}
          />
        </div>

        {canStructural && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isStructural}
                onChange={(e) => setIsStructural(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              <span>This update changes a structural field</span>
            </label>
          </div>
        )}

        {isStructural && canStructural && (
          <div style={{ padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.amber, marginBottom: 10, fontWeight: 600 }}>
              Structural mode — field update + announcement are committed atomically
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Field Path</label>
              <input
                type="text"
                value={fieldPath}
                onChange={(e) => setFieldPath(e.target.value)}
                placeholder="e.g. vacancies.total, dates.applicationCloseDate"
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={labelStyle}>Previous Value</label>
                <input type="text" value={previousValue} onChange={(e) => setPreviousValue(e.target.value)}
                  placeholder="Old value (display only)" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>New Value</label>
                <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  placeholder="New value to apply" style={inputStyle} />
              </div>
            </div>
          </div>
        )}

        {err && (
          <div style={{ color: C.red, fontSize: 12, marginBottom: 12, padding: "8px 10px", background: C.red + "11", borderRadius: 5 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}
            style={{ padding: "7px 16px", background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "7px 16px",
              background: submitting ? "#1c2740" : C.accent,
              color: submitting ? C.muted : "#070b16",
              border: "none",
              borderRadius: 5,
              fontSize: 13,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Saving…" : "Add Update"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Draft Preview Overlay ────────────────────────────────

function DraftPreviewOverlay({
  record,
  onClose,
  scrollRef,
}: {
  record: RecruitmentRecord;
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Build the projected snapshot — pure, no network call.
  // projectForPreview accepts any draftState; snapshot shows current editor state.
  let previewJob: ReturnType<typeof snapshotToGovernmentRecruitment> | null = null;
  let previewErr: string | null = null;
  try {
    const snapshot = projectForPreview(record);
    previewJob = snapshotToGovernmentRecruitment(snapshot);
  } catch (e) {
    previewErr = String(e);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        background: "#F8FAFC",
        overflowY: "hidden",
      }}
    >
      {/* Preview banner */}
      <div style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 24px",
        background: "#070b16",
        borderBottom: "2px solid #f0883e",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            display: "inline-block",
            padding: "3px 10px",
            background: "#f0883e22",
            color: "#f0883e",
            border: "1px solid #f0883e66",
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}>
            DRAFT PREVIEW
          </span>
          <span style={{ fontSize: 12, color: "#8c9bb8" }}>
            Showing current editor state — not the published page
          </span>
          <span style={{
            fontSize: 11,
            color: "#d29922",
            background: "#d2992222",
            border: "1px solid #d2992244",
            borderRadius: 4,
            padding: "2px 8px",
            fontWeight: 700,
          }}>
            {record.draftState}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: `1px solid #1c2740`,
            color: "#e2e8f0",
            borderRadius: 5,
            padding: "5px 14px",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Close Preview  ✕
        </button>
      </div>

      {/* Preview content */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px 0 48px" }}>
        {previewErr ? (
          <div style={{ maxWidth: 800, margin: "40px auto", padding: "20px 24px", background: "#fee2e2", borderRadius: 8, color: "#991b1b", fontSize: 14 }}>
            Preview error: {previewErr}
          </div>
        ) : previewJob ? (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px" }}>
            <OfficialNotificationCard
              notificationPdfUrl={previewJob.type === "government" ? previewJob.links.notification : undefined}
              officialWebsiteUrl={previewJob.links.website}
              sourceName={previewJob.provenance.primarySourceType.replace(/_/g, " ")}
              verifiedAt={previewJob.provenance.lastVerifiedAt}
            />
            <div style={{ marginTop: 24 }}>
              <JobDetailHeader job={previewJob} />
            </div>
            <div style={{ marginTop: 24 }}>
              <JobDetailSections job={previewJob} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
