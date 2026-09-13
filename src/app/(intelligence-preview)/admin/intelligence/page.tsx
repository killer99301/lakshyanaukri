"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import type {
  RecruitmentIntelligenceDraft,
  RecruitmentIdentity,
  RecruitmentDates,
  FieldValue,
  IntelligenceSource,
  IntelligenceConflict,
  RecruitmentDate,
  VacancyData,
  VacancyRow,
  DateCertainty,
} from "@/intelligence/draft-types";
import {
  applyFieldEdit,
  resetFieldToMachine,
  applyDateEdit,
  resetDateToMachine,
  applyVacancyRowEdit,
  addVacancyRow,
  removeVacancyRow,
  recalculateDerivedTotal,
  resolveConflict,
  saveDraft,
} from "@/intelligence/draft-editor";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number) { return `${Math.round(n * 100)}%`; }

function fmtDate(d?: string) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRelTime(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function sourceAuthorityRank(kind: IntelligenceSource["kind"]) {
  const m: Record<string, number> = {
    OFFICIAL: 4, APPLICATION_PORTAL: 3, RESULT_PORTAL: 3, SECONDARY: 1, OTHER: 0,
  };
  return m[kind] ?? 0;
}

const CERTAINTY_OPTIONS: DateCertainty[] = ["CONFIRMED", "TENTATIVE", "TBA", "POSTPONED", "CANCELLED"];

const FIELD_PATH_LABELS: Record<string, string> = {
  "vacancies.total": "Vacancy Total",
  "dates.notificationDate.date": "Notification Date",
  "dates.applicationOpenDate.date": "Application Open Date",
  "dates.applicationCloseDate.date": "Application Close Date",
  "dates.feePaymentOpenDate.date": "Fee Payment Open Date",
  "dates.feePaymentCloseDate.date": "Fee Payment Close Date",
  "dates.examDate.date": "Exam Date",
  "dates.prelimsDate.date": "Prelims Date",
  "dates.mainsDate.date": "Mains Date",
  "dates.resultDate.date": "Result Date",
  "dates.joiningDate.date": "Joining Date",
  "identity.title": "Title",
  "identity.shortTitle": "Short Title",
  "identity.organizationId": "Organisation ID",
  "identity.organizationName": "Organisation Name",
  "identity.notificationNumber": "Notification Number",
  "identity.advertisementNumber": "Advertisement Number",
  "identity.recruitmentYear": "Year",
  "identity.recruitmentType": "Type",
};

function humanFieldName(path: string): string {
  if (FIELD_PATH_LABELS[path]) return FIELD_PATH_LABELS[path];
  const last = path.split(".").pop() ?? path;
  return last.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

// ─── Field states ─────────────────────────────────────────────────────────────

type FieldState = "machine" | "conflict" | "derived" | "manual" | "resolved";

function resolveState(fv: FieldValue<unknown>): FieldState {
  if (fv.manuallyEdited) return "manual";
  if (fv.conflict) return "conflict";
  return "machine";
}

function resolveDateState(rd: RecruitmentDate): FieldState {
  if (rd.manuallyEdited) return "manual";
  if (rd.conflict) return "conflict";
  return "machine";
}

const STATE_CFG: Record<FieldState, { icon: string; label: string; text: string; box: string; editBox: string }> = {
  machine:  { icon: "✦", label: "Machine",  text: "text-slate-400",  box: "bg-white border-slate-200",          editBox: "border-[#ea580c]" },
  conflict: { icon: "⚠", label: "Conflict", text: "text-red-500",    box: "bg-red-50/40 border-red-200",        editBox: "border-red-400" },
  derived:  { icon: "≈", label: "Derived",  text: "text-amber-600",  box: "bg-amber-50/40 border-amber-200",    editBox: "border-amber-400" },
  manual:   { icon: "✏", label: "Edited",   text: "text-indigo-500", box: "bg-indigo-50/40 border-indigo-200",  editBox: "border-indigo-400" },
  resolved: { icon: "✓", label: "Resolved", text: "text-green-600",  box: "bg-green-50/40 border-green-200",    editBox: "border-green-400" },
};

// ─── Primitives ───────────────────────────────────────────────────────────────

type BadgeVariant = "official" | "secondary" | "conflict" | "neutral" | "ok" | "err" | "warn" | "primary" | "indigo";

function Badge({ children, variant }: { children: React.ReactNode; variant: BadgeVariant }) {
  const cls: Record<BadgeVariant, string> = {
    official:  "bg-green-50  text-green-700  border border-green-200",
    secondary: "bg-amber-50  text-amber-700  border border-amber-200",
    conflict:  "bg-red-50    text-red-600    border border-red-200",
    neutral:   "bg-slate-100 text-slate-500  border border-slate-200",
    ok:        "bg-green-50  text-green-700",
    err:       "bg-red-50    text-red-600",
    warn:      "bg-amber-50  text-amber-700",
    primary:   "bg-orange-50 text-orange-600 border border-orange-200",
    indigo:    "bg-indigo-50 text-indigo-600 border border-indigo-200",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-[7px] py-[2px] rounded-full whitespace-nowrap leading-[1.4] ${cls[variant]}`}>
      {children}
    </span>
  );
}

function StateMeta({ state, confidence, sourceId }: { state: FieldState; confidence?: number; sourceId?: string }) {
  const cfg = STATE_CFG[state];
  return (
    <span className={`text-[10px] font-semibold flex items-center gap-1 ${cfg.text}`}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
      {confidence !== undefined && <span className="text-slate-400 font-normal">· {pct(confidence)}</span>}
      {sourceId && <span className="text-slate-400 font-normal">· {sourceId}</span>}
    </span>
  );
}

function SectionCard({ title, accentClass = "from-[#ea580c] via-[#f97316] to-[#fed7aa]", children }: {
  title: string; accentClass?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
      <div className={`h-[3px] bg-gradient-to-r ${accentClass}`} />
      <div className="px-[22px] py-[18px]">
        <div className="text-[11px] font-bold tracking-[.08em] uppercase text-[#ea580c] mb-[14px]">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ─── EditableField ────────────────────────────────────────────────────────────
// Editable field row: label → value box (hover ✎) → save/cancel → original trace

function EditableField({
  label,
  fv,
  type = "text",
  onSave,
  onReset,
}: {
  label: string;
  fv?: FieldValue<unknown>;
  type?: "text" | "number";
  onSave: (v: string | number, reason?: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!fv) return null;

  const state = resolveState(fv);
  const cfg = STATE_CFG[state];
  const display = fv.value === undefined || fv.value === null ? null : String(fv.value);
  const top = fv.evidence[0];
  const machineDisplay = fv.machineValue !== undefined ? String(fv.machineValue) : null;

  function startEdit() {
    setInputVal(display ?? "");
    setReason("");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function cancel() { setEditing(false); setInputVal(""); setReason(""); }

  function save() {
    const trimmed = inputVal.trim();
    if (!trimmed) return;
    const val: string | number = type === "number" ? (Number(trimmed) || 0) : trimmed;
    onSave(val, reason.trim() || undefined);
    setEditing(false);
    setReason("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  }

  return (
    <div className="py-3 border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      {/* Label row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-slate-400">{label}</span>
        {!editing && <StateMeta state={state} confidence={fv.confidence} sourceId={top?.sourceId} />}
      </div>

      {editing ? (
        /* ── Edit mode ── */
        <div>
          <input
            ref={inputRef}
            type={type}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`w-full px-3 py-2.5 rounded-lg border-2 text-[13px] font-semibold text-slate-900 outline-none bg-white ${cfg.editBox}`}
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for edit (optional)"
            className="w-full mt-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-[11.5px] text-slate-600 outline-none bg-[#f7f6f3] focus:border-slate-400 placeholder:text-slate-300"
          />
          <div className="flex items-center gap-2 mt-2 justify-end">
            <button onClick={cancel}
              className="px-3 py-1.5 text-[12px] font-medium text-slate-500 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer">
              Cancel
            </button>
            <button onClick={save}
              className="px-3 py-1.5 text-[12px] font-bold text-white bg-[#ea580c] rounded-lg hover:bg-[#c2410c] cursor-pointer">
              Save
            </button>
          </div>
        </div>
      ) : (
        /* ── Read mode ── */
        <div>
          <div
            className={`group relative px-3 py-2.5 rounded-lg border text-[13px] font-semibold transition-colors cursor-text
              ${display ? `${cfg.box} text-slate-900 hover:border-[#ea580c]` : "bg-slate-50 border-slate-100 text-slate-400"}`}
            onClick={startEdit}
          >
            {display ?? "—"}
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#ea580c] select-none leading-none"
              title="Edit this field"
            >
              ✎
            </button>
          </div>
          {/* Manual edit trace */}
          {fv.manuallyEdited && machineDisplay !== null && (
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10.5px] text-slate-400">
                Original: <span className="font-mono text-slate-500">{machineDisplay}</span>
                {fv.editedBy && <span className="ml-1.5">· {fv.editedBy}</span>}
                {fv.editedAt && <span className="ml-1"> · {fmtRelTime(fv.editedAt)}</span>}
              </span>
              <button
                onClick={onReset}
                className="text-[10.5px] text-indigo-500 hover:text-indigo-700 hover:underline cursor-pointer"
              >
                Reset
              </button>
            </div>
          )}
          {fv.editReason && (
            <div className="mt-0.5 text-[10.5px] text-slate-400 italic">{`"${fv.editReason}"`}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EditableDateRow ──────────────────────────────────────────────────────────

function EditableDateRow({
  label,
  rd,
  onSave,
  onReset,
}: {
  label: string;
  rd?: RecruitmentDate;
  onSave: (date: string | undefined, certainty: DateCertainty, reason?: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dateVal, setDateVal] = useState("");
  const [certainty, setCertainty] = useState<DateCertainty>("CONFIRMED");
  const [reason, setReason] = useState("");

  if (!rd) return null;

  const state = resolveDateState(rd);
  const cfg = STATE_CFG[state];
  const dateStr = fmtDate(rd.date);
  const machineStr = rd.machineDate ? fmtDate(rd.machineDate) : null;
  const top = rd.sourceEvidence[0];

  function startEdit() {
    setDateVal(rd!.date ?? "");
    setCertainty(rd!.certainty);
    setReason("");
    setEditing(true);
  }

  function cancel() { setEditing(false); }

  function save() {
    onSave(dateVal || undefined, certainty, reason.trim() || undefined);
    setEditing(false);
  }

  return (
    <div className="py-3 border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-slate-400">{label}</span>
        {!editing && <StateMeta state={state} confidence={top?.confidence} sourceId={top?.sourceId} />}
      </div>

      {editing ? (
        <div>
          <div className="flex gap-2 items-stretch">
            <input
              type="date"
              value={dateVal}
              onChange={(e) => setDateVal(e.target.value)}
              className={`flex-1 px-3 py-2.5 rounded-lg border-2 text-[13px] font-semibold text-slate-900 outline-none bg-white ${cfg.editBox}`}
            />
            <select
              value={certainty}
              onChange={(e) => setCertainty(e.target.value as DateCertainty)}
              className="px-2.5 py-2 rounded-lg border-2 border-slate-200 text-[12px] font-semibold text-slate-700 outline-none bg-white cursor-pointer"
            >
              {CERTAINTY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for edit (optional)"
            className="w-full mt-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-[11.5px] text-slate-600 outline-none bg-[#f7f6f3] focus:border-slate-400 placeholder:text-slate-300"
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button onClick={cancel}
              className="px-3 py-1.5 text-[12px] font-medium text-slate-500 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer">
              Cancel
            </button>
            <button onClick={save}
              className="px-3 py-1.5 text-[12px] font-bold text-white bg-[#ea580c] rounded-lg hover:bg-[#c2410c] cursor-pointer">
              Save
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div
            className={`group relative px-3 py-2.5 rounded-lg border transition-colors cursor-text flex items-center gap-2.5
              ${dateStr ? `${cfg.box} text-slate-900 hover:border-[#ea580c]` : "bg-slate-50 border-slate-100 text-slate-400"}`}
            onClick={startEdit}
          >
            <span className="text-[13px] font-semibold tabular-nums">{dateStr ?? "—"}</span>
            <Badge variant="neutral">{rd.certainty}</Badge>
            {rd.conflict && <Badge variant="conflict">CONFLICT</Badge>}
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              className="ml-auto text-[12px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#ea580c] select-none"
              title="Edit this date"
            >
              ✎
            </button>
          </div>
          {rd.manuallyEdited && machineStr && (
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10.5px] text-slate-400">
                Original: <span className="font-mono text-slate-500">{machineStr}</span>
                {rd.editedBy && <span className="ml-1.5">· {rd.editedBy}</span>}
                {rd.editedAt && <span className="ml-1">· {fmtRelTime(rd.editedAt)}</span>}
              </span>
              <button onClick={onReset} className="text-[10.5px] text-indigo-500 hover:text-indigo-700 hover:underline cursor-pointer">
                Reset
              </button>
            </div>
          )}
          {rd.editReason && <div className="mt-0.5 text-[10.5px] text-slate-400 italic">{`"${rd.editReason}"`}</div>}
        </div>
      )}
    </div>
  );
}

// ─── VacancyRowEditor ─────────────────────────────────────────────────────────

type RowEditValues = { postName: string; postCode: string; total: string; UR: string; OBC: string; SC: string; ST: string; EWS: string };

function emptyRowEdit(row?: VacancyRow): RowEditValues {
  return {
    postName: row?.postName ?? "",
    postCode: row?.postCode ?? "",
    total: row?.total !== undefined ? String(row.total) : "",
    UR:  String(row?.categoryBreakdown?.UR ?? ""),
    OBC: String(row?.categoryBreakdown?.OBC ?? ""),
    SC:  String(row?.categoryBreakdown?.SC ?? ""),
    ST:  String(row?.categoryBreakdown?.ST ?? ""),
    EWS: String(row?.categoryBreakdown?.EWS ?? ""),
  };
}

function RowForm({ initial, onSave, onCancel }: {
  initial: RowEditValues;
  onSave: (v: RowEditValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const num = (s: string) => s === "" ? undefined : (parseInt(s, 10) || 0);

  return (
    <tr className="bg-orange-50/30">
      <td className="py-2 px-[10px]">
        <input value={v.postName} onChange={(e) => setV({ ...v, postName: e.target.value })}
          placeholder="Post name" className="w-full px-2 py-1 text-[12px] border border-slate-300 rounded bg-white outline-none focus:border-[#ea580c]" />
        <input value={v.postCode} onChange={(e) => setV({ ...v, postCode: e.target.value })}
          placeholder="Code (opt.)" className="w-full mt-1 px-2 py-1 text-[11px] border border-slate-200 rounded bg-white outline-none focus:border-[#ea580c] text-slate-500" />
      </td>
      {(["total", "UR", "OBC", "SC", "ST", "EWS"] as const).map((field) => (
        <td key={field} className="py-2 px-[10px]">
          <input
            type="number"
            value={v[field as keyof RowEditValues]}
            onChange={(e) => setV({ ...v, [field]: e.target.value })}
            placeholder="—"
            className="w-full px-2 py-1 text-[12px] border border-slate-200 rounded bg-white outline-none focus:border-[#ea580c] text-right tabular-nums min-w-[52px]"
          />
        </td>
      ))}
      <td className="py-2 px-[10px]">
        <div className="flex gap-1">
          <button onClick={() => onSave({ ...v, total: v.total })} title="Save row"
            className="text-[11px] font-bold px-2 py-1 rounded bg-[#ea580c] text-white hover:bg-[#c2410c] cursor-pointer whitespace-nowrap">
            Save
          </button>
          <button onClick={onCancel} title="Cancel"
            className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 bg-white hover:bg-slate-50 cursor-pointer">
            ✕
          </button>
        </div>
      </td>
      {/* consume remaining header columns */}
    </tr>
  );

  void num; // used via saveRow in parent
}

// ─── EditableVacancyTable ─────────────────────────────────────────────────────

function EditableVacancyTable({
  vac,
  onUpdate,
}: {
  vac: VacancyData;
  onUpdate: (updated: VacancyData) => void;
}) {
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const activeRows = vac.rows.filter((r) => !r.isDeleted);
  const explicitTotal = vac.total?.value;
  const total = explicitTotal ?? vac.derivedTotal;
  const isDerived = explicitTotal === undefined && vac.derivedTotal !== undefined;

  function saveRowEdit(rowId: string, vals: RowEditValues) {
    const num = (s: string) => s === "" ? undefined : (parseInt(s, 10) || 0);
    const updates = {
      postName: vals.postName || "Unnamed Post",
      postCode: vals.postCode || undefined,
      total: num(vals.total),
      categoryBreakdown: {
        UR: num(vals.UR), OBC: num(vals.OBC), SC: num(vals.SC),
        ST: num(vals.ST), EWS: num(vals.EWS),
      },
    };
    const row = vac.rows.find((r) => r.id === rowId)!;
    const updated = recalculateDerivedTotal({
      ...vac,
      rows: vac.rows.map((r) => r.id === rowId ? applyVacancyRowEdit(r, updates, "admin") : r),
    });
    void row;
    onUpdate(updated);
    setEditingRowId(null);
  }

  function deleteRow(rowId: string) {
    onUpdate(removeVacancyRow(vac, rowId));
  }

  function addRow(vals: RowEditValues) {
    const num = (s: string) => s === "" ? undefined : (parseInt(s, 10) || 0);
    onUpdate(addVacancyRow(
      vac,
      {
        id: `row-admin-${Date.now()}`,
        postName: vals.postName || "New Post",
        postCode: vals.postCode || undefined,
        total: num(vals.total),
        categoryBreakdown: {
          UR: num(vals.UR), OBC: num(vals.OBC), SC: num(vals.SC),
          ST: num(vals.ST), EWS: num(vals.EWS),
        },
      },
      "admin",
    ));
    setAdding(false);
  }

  const CATS = ["UR", "OBC", "SC", "ST", "EWS"] as const;

  return (
    <div>
      {total !== undefined && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-slate-400">Total Vacancies</span>
            <StateMeta state={isDerived ? "derived" : "machine"} />
          </div>
          <div className={`inline-flex items-center gap-3 px-4 py-2.5 rounded-lg border ${isDerived ? "bg-amber-50/40 border-amber-200" : "bg-white border-slate-200"}`}>
            <span className="text-[28px] font-extrabold text-[#ea580c] leading-none tabular-nums">{total}</span>
            {!isDerived && <Badge variant="ok">Authoritative</Badge>}
            {isDerived && <Badge variant="warn">Sum of {activeRows.length} row{activeRows.length !== 1 ? "s" : ""}</Badge>}
            {isDerived && vac.derivedTotalExplanation && (
              <span className="text-[11px] text-slate-400">{vac.derivedTotalExplanation}</span>
            )}
          </div>
        </div>
      )}

      {(activeRows.length > 0 || adding) && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="py-[7px] px-[10px] text-[11px] font-bold tracking-[.04em] text-slate-500 text-left">Post</th>
                {["Total", ...CATS].map((h) => (
                  <th key={h} className="py-[7px] px-[10px] text-[11px] font-bold tracking-[.04em] text-slate-500 text-right">{h}</th>
                ))}
                <th className="py-[7px] px-[10px] w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row, i) =>
                editingRowId === row.id ? (
                  <RowForm
                    key={row.id}
                    initial={emptyRowEdit(row)}
                    onSave={(vals) => saveRowEdit(row.id, vals)}
                    onCancel={() => setEditingRowId(null)}
                  />
                ) : (
                  <tr key={row.id} className={`border-b border-slate-50 ${i % 2 !== 0 ? "bg-slate-50/60" : ""} group`}>
                    <td className="py-[7px] px-[10px] font-medium text-slate-800">
                      {row.postName}
                      {row.grade && <span className="text-slate-400 font-normal"> ({row.grade})</span>}
                      {row.isAdminAdded && <span className="ml-1.5 text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">ADDED</span>}
                      {row.manuallyEdited && !row.isAdminAdded && <span className="ml-1.5 text-[9px] font-bold text-indigo-500">✏</span>}
                    </td>
                    <td className="py-[7px] px-[10px] text-right font-bold tabular-nums text-slate-900">{row.total ?? "—"}</td>
                    {CATS.map((cat) => (
                      <td key={cat} className="py-[7px] px-[10px] text-right tabular-nums text-slate-600">
                        {row.categoryBreakdown?.[cat] ?? "—"}
                      </td>
                    ))}
                    <td className="py-[7px] px-[10px]">
                      <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditingRowId(row.id)} title="Edit row"
                          className="text-[11px] text-slate-400 hover:text-[#ea580c] cursor-pointer px-1">✎</button>
                        <button onClick={() => deleteRow(row.id)} title="Delete row"
                          className="text-[11px] text-slate-400 hover:text-red-500 cursor-pointer px-1">✕</button>
                      </div>
                    </td>
                  </tr>
                )
              )}
              {adding && (
                <RowForm
                  initial={emptyRowEdit()}
                  onSave={addRow}
                  onCancel={() => setAdding(false)}
                />
              )}
            </tbody>
          </table>
        </div>
      )}

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 text-[12px] font-semibold text-[#ea580c] hover:text-[#c2410c] flex items-center gap-1 cursor-pointer"
        >
          <span className="text-[16px] leading-none">+</span> Add post
        </button>
      )}
    </div>
  );
}

// ─── ConflictResolver ─────────────────────────────────────────────────────────

function ConflictResolver({
  conflict,
  onResolve,
}: {
  conflict: IntelligenceConflict;
  onResolve: (selectedValue: unknown, selectedSourceId: string, reason: string) => void;
}) {
  const decided = conflict.adminDecision;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [customVal, setCustomVal] = useState("");
  const [reason, setReason] = useState("");

  if (decided) {
    return (
      <div className="mt-2.5 p-3 rounded-xl bg-green-50 border border-green-200">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-bold text-green-700">✓ Admin Decision Applied</span>
          <span className="text-[10px] text-green-600">· {decided.decidedBy} · {fmtRelTime(decided.decidedAt)}</span>
        </div>
        <div className="text-[13px] font-bold text-slate-800 tabular-nums">{String(decided.selectedValue)}</div>
        {decided.reason && <div className="mt-1 text-[11px] text-slate-500 italic">{`"${decided.reason}"`}</div>}
        <div className="mt-1.5 text-[10.5px] text-slate-400">All competing values preserved in evidence.</div>
      </div>
    );
  }

  function apply() {
    const val = selected === "__custom__" ? customVal : conflict.values.find((v) => v.sourceId === selected)?.value;
    if (!val) return;
    onResolve(val, selected === "__custom__" ? "custom" : selected, reason.trim());
    setOpen(false);
  }

  const sevVariant = conflict.severity === "BLOCKING" ? "err" : conflict.severity === "WARNING" ? "warn" : "neutral";
  const humanName = humanFieldName(conflict.field);

  return (
    <div className="py-[12px] border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center gap-2 mb-2.5">
        <Badge variant={sevVariant}>{conflict.severity}</Badge>
        <span className="text-[13px] font-semibold text-slate-800">{humanName}</span>
      </div>

      <div className="flex flex-col gap-[6px] mb-2.5">
        {conflict.values.map((v, i) => (
          <div key={i} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-[12.5px]
              ${v.sourceKind === "OFFICIAL" ? "bg-green-50/50 border-green-100" : "bg-slate-50 border-slate-100"}`}>
            <Badge variant={v.sourceKind === "OFFICIAL" ? "official" : "secondary"}>{v.sourceKind}</Badge>
            <span className="font-bold text-slate-900 tabular-nums">{String(v.value)}</span>
            <span className="text-slate-400 text-[11px] mt-px">{v.sourceId}</span>
          </div>
        ))}
      </div>

      {conflict.resolution && !open && (
        <div className="mb-2 text-[11.5px] text-green-700 flex gap-1.5 items-start">
          <span>✓</span>
          <span>Auto-resolved: <strong>{String(conflict.resolution.selectedValue)}</strong> — {conflict.resolution.reason}</span>
        </div>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)}
          className="text-[11.5px] font-semibold text-[#ea580c] hover:text-[#c2410c] hover:underline cursor-pointer">
          Apply admin decision →
        </button>
      ) : (
        <div className="mt-2 p-3 rounded-xl bg-orange-50/50 border border-orange-200">
          <div className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-500 mb-2">Select value</div>
          <div className="flex flex-col gap-1.5 mb-3">
            {conflict.values.map((v) => (
              <label key={v.sourceId} className="flex items-center gap-2 cursor-pointer text-[12.5px]">
                <input type="radio" name={`conflict-${conflict.field}`} value={v.sourceId}
                  checked={selected === v.sourceId} onChange={() => setSelected(v.sourceId)}
                  className="accent-[#ea580c]" />
                <span className="font-semibold tabular-nums">{String(v.value)}</span>
                <span className="text-slate-400 text-[11px]">{v.sourceKind}</span>
              </label>
            ))}
            <label className="flex items-center gap-2 cursor-pointer text-[12.5px]">
              <input type="radio" name={`conflict-${conflict.field}`} value="__custom__"
                checked={selected === "__custom__"} onChange={() => setSelected("__custom__")}
                className="accent-[#ea580c]" />
              <span className="text-slate-500">Enter custom value</span>
            </label>
          </div>
          {selected === "__custom__" && (
            <input type="text" value={customVal} onChange={(e) => setCustomVal(e.target.value)}
              placeholder="Custom value"
              className="w-full mb-2 px-3 py-1.5 border-2 border-[#ea580c] rounded-lg text-[13px] font-semibold outline-none bg-white" />
          )}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Decision reason (recommended for conflicts)"
            rows={2}
            className="w-full mb-2 px-3 py-1.5 border border-slate-200 rounded-lg text-[11.5px] text-slate-700 outline-none bg-white resize-none focus:border-[#ea580c] placeholder:text-slate-300"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-[12px] font-medium text-slate-500 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 cursor-pointer">
              Cancel
            </button>
            <button onClick={apply} disabled={!selected}
              className="px-3 py-1.5 text-[12px] font-bold text-white bg-[#ea580c] rounded-lg hover:bg-[#c2410c] disabled:bg-slate-200 disabled:text-slate-400 cursor-pointer disabled:cursor-not-allowed">
              Apply Decision
            </button>
          </div>
        </div>
      )}

      <details className="mt-2">
        <summary className="text-[10.5px] text-slate-400 cursor-pointer select-none hover:text-slate-600 w-fit">Field path</summary>
        <code className="text-[10.5px] text-slate-500 font-mono">{conflict.field}</code>
      </details>
    </div>
  );
}

// ─── SourceItem ───────────────────────────────────────────────────────────────

function SourceItem({ source }: { source: IntelligenceSource }) {
  const rank = sourceAuthorityRank(source.kind);
  const variant = rank >= 4 ? "official" : rank >= 1 ? "secondary" : "neutral";
  return (
    <div className="py-[10px] border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center gap-[7px] flex-wrap mb-1">
        <Badge variant={variant}>{source.kind}</Badge>
        {source.organizationId && <span className="text-[11px] font-semibold text-slate-600">{source.organizationId}</span>}
        <Badge variant={source.success ? "ok" : "err"}>{source.success ? "OK" : "FAILED"}</Badge>
        <span className="text-[10px] text-slate-400">rank {rank} · {source.retrievalMethod ?? "HTML"}</span>
      </div>
      <a href={source.url} target="_blank" rel="noopener noreferrer"
        className="text-[11.5px] text-[#ea580c] break-all hover:underline">
        {source.url}
      </a>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function IntelligencePreviewPage() {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<RecruitmentIntelligenceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  function updateDraft(fn: (d: RecruitmentIntelligenceDraft) => RecruitmentIntelligenceDraft) {
    setDraft((prev) => (prev ? fn(prev) : prev));
  }

  async function analyse() {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!urlList.length) return;
    setLoading(true); setError(null); setDraft(null);
    try {
      const res = await fetch("/api/admin/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlList }),
      });
      const data = (await res.json()) as { draft?: RecruitmentIntelligenceDraft; error?: string };
      if (!res.ok || !data.draft) { setError(data.error ?? "Analysis failed"); }
      else { setDraft(data.draft); }
    } catch { setError("Network error — could not reach the intelligence API."); }
    finally { setLoading(false); }
  }

  function handleSaveDraft() {
    if (!draft) return;
    updateDraft(saveDraft);
    setSaveMsg("Review saved (session only)");
    setTimeout(() => setSaveMsg(null), 3000);
  }

  // ── Identity helpers ──
  function handleIdentityEdit(field: keyof RecruitmentIdentity, value: string | number, reason?: string) {
    updateDraft((d) => ({
      ...d,
      identity: {
        ...d.identity,
        [field]: applyFieldEdit(d.identity[field] as FieldValue<string | number>, value, "admin", reason),
      },
    }));
  }
  function handleIdentityReset(field: keyof RecruitmentIdentity) {
    updateDraft((d) => ({
      ...d,
      identity: {
        ...d.identity,
        [field]: resetFieldToMachine(d.identity[field] as FieldValue<string | number>),
      },
    }));
  }

  // ── Date helpers ──
  function handleDateEdit(field: keyof RecruitmentDates, date: string | undefined, certainty: DateCertainty, reason?: string) {
    updateDraft((d) => {
      const rd = d.dates[field];
      if (!rd) return d;
      return { ...d, dates: { ...d.dates, [field]: applyDateEdit(rd, date, certainty, "admin", reason) } };
    });
  }
  function handleDateReset(field: keyof RecruitmentDates) {
    updateDraft((d) => {
      const rd = d.dates[field];
      if (!rd) return d;
      return { ...d, dates: { ...d.dates, [field]: resetDateToMachine(rd) } };
    });
  }

  // ── Vacancy helpers ──
  function handleVacancyUpdate(updated: VacancyData) {
    updateDraft((d) => ({ ...d, vacancies: updated }));
  }

  // ── Conflict helper ──
  function handleConflictResolve(idx: number, selectedValue: unknown, selectedSourceId: string, reason: string) {
    updateDraft((d) => {
      const conflicts = [...d.conflicts];
      conflicts[idx] = resolveConflict(conflicts[idx], selectedValue, selectedSourceId, "admin", reason);
      return { ...d, conflicts };
    });
  }

  const conflicts  = draft?.conflicts ?? [];
  const missing    = draft?.missingFields ?? [];
  const sources    = draft?.sources ?? [];
  const confidence = draft?.overallConfidence ?? 0;

  return (
    <div className="min-h-screen bg-[#f7f6f3] text-[#0f172a]" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>

      {/* Page header */}
      <div className="border-b border-slate-200 bg-[#f7f6f3]">
        <div className="max-w-[900px] mx-auto px-4 py-4 flex items-center gap-3">
          <Link href="/admin"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 px-[10px] py-1.5 rounded-lg border border-slate-200 bg-white hover:text-[#ea580c] hover:border-orange-200 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Admin
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-[#ea580c] to-[#f97316] flex items-center justify-center text-base flex-shrink-0">
              🔍
            </div>
            <div>
              <h1 className="text-[18px] font-extrabold tracking-tight leading-none">Intelligence Preview</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">Recruitment Intelligence Pipeline · Phase 10</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto px-4 py-6 flex flex-col gap-[18px]">

        {/* URL Input */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="h-[3px] bg-gradient-to-r from-[#ea580c] via-[#f97316] to-[#fed7aa]" />
          <div className="px-[22px] py-[18px]">
            <label className="block text-[11px] font-bold tracking-[.06em] uppercase text-slate-400 mb-2">
              Source URLs — one per line
            </label>
            <div className="flex gap-2.5 items-start">
              <textarea
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                placeholder={"https://ibps.in/crp-po-mt-xv/\nhttps://sarkariresult.com/ibps-po-2025/"}
                rows={3}
                className="flex-1 font-mono text-[11.5px] leading-relaxed px-[13px] py-[9px] border border-slate-200 rounded-[10px] bg-[#f7f6f3] text-slate-800 resize-none outline-none focus:border-[#ea580c] transition-colors"
              />
              <div className="flex flex-col gap-2 items-end flex-shrink-0">
                <button
                  onClick={analyse}
                  disabled={loading || !urls.trim()}
                  className="px-[18px] py-[9px] rounded-[10px] text-[13px] font-bold bg-[#ea580c] text-white border-none cursor-pointer hover:bg-[#c2410c] transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Analysing…
                    </>
                  ) : "Analyse Sources"}
                </button>
                {draft && !loading && (
                  <span className="text-[11px] font-semibold text-green-700 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    Analysis complete
                  </span>
                )}
              </div>
            </div>
            {error && (
              <div className="mt-2.5 px-3.5 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600">{error}</div>
            )}
          </div>
        </div>

        {draft && (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-[14px] p-[14px_16px_12px] shadow-xs">
                <div className="text-[10px] font-bold tracking-[.08em] uppercase text-slate-500 mb-1.5">Overall Confidence</div>
                <div className="text-[28px] font-extrabold leading-none text-[#ea580c] tabular-nums">{pct(confidence)}</div>
                <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#ea580c] to-[#f97316]" style={{ width: pct(confidence) }} />
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-[14px] p-[14px_16px_12px] shadow-xs">
                <div className="text-[10px] font-bold tracking-[.08em] uppercase text-slate-500 mb-1.5">Sources Analysed</div>
                <div className="text-[28px] font-extrabold leading-none text-slate-900 tabular-nums">{sources.length}</div>
                <div className="text-[11px] text-slate-400 mt-1.5">{sources.filter((s) => s.success).length} successful</div>
              </div>
              <div className={`bg-white rounded-[14px] p-[14px_16px_12px] shadow-xs border ${conflicts.length > 0 ? "border-red-200" : "border-slate-200"}`}>
                <div className="text-[10px] font-bold tracking-[.08em] uppercase text-slate-500 mb-1.5">Conflicts</div>
                <div className={`text-[28px] font-extrabold leading-none tabular-nums ${conflicts.length > 0 ? "text-red-600" : "text-green-700"}`}>{conflicts.length}</div>
                <div className="text-[11px] text-slate-400 mt-1.5">{conflicts.filter((c) => c.severity === "BLOCKING").length} blocking</div>
              </div>
              <div className={`bg-white rounded-[14px] p-[14px_16px_12px] shadow-xs border ${draft.readiness.readyForReview ? "border-green-200" : "border-red-200"}`}>
                <div className="text-[10px] font-bold tracking-[.08em] uppercase text-slate-500 mb-1.5">Readiness</div>
                <div className={`text-[15px] font-extrabold leading-tight mt-1 ${draft.readiness.readyForReview ? "text-green-700" : "text-red-600"}`}>
                  {draft.readiness.readyForReview ? "Ready for Review" : "Needs Attention"}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{draft.readiness.blockingIssues.length} blocking issues</div>
              </div>
            </div>

            {/* Review notes */}
            {(draft.readiness.blockingIssues.length > 0 || draft.readiness.warnings.length > 0) && (
              <SectionCard title="Review Notes" accentClass="from-amber-400 via-amber-300 to-amber-200">
                {draft.readiness.blockingIssues.map((issue, i) => (
                  <div key={i} className="flex gap-2 items-start px-3 py-2 mb-2 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
                    <span>⛔</span><span>{issue}</span>
                  </div>
                ))}
                {draft.readiness.warnings.map((warn, i) => (
                  <div key={i} className="flex gap-2 items-start px-3 py-2 mb-2 last:mb-0 bg-amber-50 border border-amber-200 rounded-lg text-[12.5px] text-amber-800">
                    <span>⚠️</span><span>{warn}</span>
                  </div>
                ))}
              </SectionCard>
            )}

            {/* Identity — all fields editable */}
            <SectionCard title="Organisation &amp; Identity">
              <EditableField label="Organisation"     fv={draft.identity.organizationName}
                onSave={(v, r) => handleIdentityEdit("organizationName", v, r)}
                onReset={() => handleIdentityReset("organizationName")} />
              <EditableField label="Org ID"           fv={draft.identity.organizationId}
                onSave={(v, r) => handleIdentityEdit("organizationId", v, r)}
                onReset={() => handleIdentityReset("organizationId")} />
              <EditableField label="Title"            fv={draft.identity.title}
                onSave={(v, r) => handleIdentityEdit("title", v, r)}
                onReset={() => handleIdentityReset("title")} />
              <EditableField label="Short Title"      fv={draft.identity.shortTitle}
                onSave={(v, r) => handleIdentityEdit("shortTitle", v, r)}
                onReset={() => handleIdentityReset("shortTitle")} />
              <EditableField label="Notification No." fv={draft.identity.notificationNumber}
                onSave={(v, r) => handleIdentityEdit("notificationNumber", v, r)}
                onReset={() => handleIdentityReset("notificationNumber")} />
              <EditableField label="Ad. Number"       fv={draft.identity.advertisementNumber}
                onSave={(v, r) => handleIdentityEdit("advertisementNumber", v, r)}
                onReset={() => handleIdentityReset("advertisementNumber")} />
              <EditableField label="Year"             fv={draft.identity.recruitmentYear} type="number"
                onSave={(v, r) => handleIdentityEdit("recruitmentYear", v, r)}
                onReset={() => handleIdentityReset("recruitmentYear")} />
              <EditableField label="Type"             fv={draft.identity.recruitmentType}
                onSave={(v, r) => handleIdentityEdit("recruitmentType", v, r)}
                onReset={() => handleIdentityReset("recruitmentType")} />
            </SectionCard>

            {/* Dates — all editable */}
            <SectionCard title="Important Dates">
              <EditableDateRow label="Notification Date"  rd={draft.dates.notificationDate}
                onSave={(d, c, r) => handleDateEdit("notificationDate", d, c, r)}
                onReset={() => handleDateReset("notificationDate")} />
              <EditableDateRow label="Application Opens"  rd={draft.dates.applicationOpenDate}
                onSave={(d, c, r) => handleDateEdit("applicationOpenDate", d, c, r)}
                onReset={() => handleDateReset("applicationOpenDate")} />
              <EditableDateRow label="Application Closes" rd={draft.dates.applicationCloseDate}
                onSave={(d, c, r) => handleDateEdit("applicationCloseDate", d, c, r)}
                onReset={() => handleDateReset("applicationCloseDate")} />
              <EditableDateRow label="Fee Payment Opens"  rd={draft.dates.feePaymentOpenDate}
                onSave={(d, c, r) => handleDateEdit("feePaymentOpenDate", d, c, r)}
                onReset={() => handleDateReset("feePaymentOpenDate")} />
              <EditableDateRow label="Fee Payment Closes" rd={draft.dates.feePaymentCloseDate}
                onSave={(d, c, r) => handleDateEdit("feePaymentCloseDate", d, c, r)}
                onReset={() => handleDateReset("feePaymentCloseDate")} />
              <EditableDateRow label="Correction Window"  rd={draft.dates.correctionOpenDate}
                onSave={(d, c, r) => handleDateEdit("correctionOpenDate", d, c, r)}
                onReset={() => handleDateReset("correctionOpenDate")} />
              <EditableDateRow label="Exam Date"          rd={draft.dates.examDate}
                onSave={(d, c, r) => handleDateEdit("examDate", d, c, r)}
                onReset={() => handleDateReset("examDate")} />
              <EditableDateRow label="Prelims"            rd={draft.dates.prelimsDate}
                onSave={(d, c, r) => handleDateEdit("prelimsDate", d, c, r)}
                onReset={() => handleDateReset("prelimsDate")} />
              <EditableDateRow label="Mains"              rd={draft.dates.mainsDate}
                onSave={(d, c, r) => handleDateEdit("mainsDate", d, c, r)}
                onReset={() => handleDateReset("mainsDate")} />
              <EditableDateRow label="Result Date"        rd={draft.dates.resultDate}
                onSave={(d, c, r) => handleDateEdit("resultDate", d, c, r)}
                onReset={() => handleDateReset("resultDate")} />
              <EditableDateRow label="Joining Date"       rd={draft.dates.joiningDate}
                onSave={(d, c, r) => handleDateEdit("joiningDate", d, c, r)}
                onReset={() => handleDateReset("joiningDate")} />
            </SectionCard>

            {/* Vacancies — editable table */}
            {(draft.vacancies.rows.length > 0 ||
              draft.vacancies.total?.value !== undefined ||
              draft.vacancies.derivedTotal !== undefined) && (
              <SectionCard title="Vacancies">
                <EditableVacancyTable vac={draft.vacancies} onUpdate={handleVacancyUpdate} />
              </SectionCard>
            )}

            {/* Conflicts — with resolver */}
            {conflicts.length > 0 && (
              <SectionCard title={`Conflicts (${conflicts.length})`} accentClass="from-red-400 via-red-300 to-red-200">
                {conflicts.map((c, i) => (
                  <ConflictResolver
                    key={i}
                    conflict={c}
                    onResolve={(val, srcId, reason) => handleConflictResolve(i, val, srcId, reason)}
                  />
                ))}
              </SectionCard>
            )}

            {/* Missing fields */}
            {missing.length > 0 && (
              <SectionCard title={`Missing Fields (${missing.length})`} accentClass="from-amber-400 via-amber-300 to-amber-200">
                <div className="flex flex-wrap gap-2">
                  {missing.map((f) => (
                    <code key={f} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                      {humanFieldName(f)}
                    </code>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Sources */}
            <SectionCard title={`Sources (${sources.length})`}>
              {sources.map((s) => <SourceItem key={s.id} source={s} />)}
            </SectionCard>

            {/* Save Draft + Approve */}
            <div className="bg-white border border-orange-200 rounded-2xl px-[22px] py-[18px] flex items-center justify-between gap-4 flex-wrap shadow-xs">
              <div>
                <h3 className="text-[14px] font-bold">Review &amp; Publish</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Save Review keeps edits in this session only — refreshing the page loses them.
                  Durable draft persistence is a separate future commit.
                  Approve &amp; Publish requires Trust Gate to pass with no blocking issues.
                </p>
                {draft.savedAt && (
                  <p className="text-[11px] text-green-700 mt-1 flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    Review saved · {fmtRelTime(draft.savedAt)} · session only
                  </p>
                )}
                {saveMsg && (
                  <p className="text-[11px] text-green-600 mt-1">{saveMsg}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveDraft}
                  className="px-[18px] py-[10px] rounded-[10px] text-[13px] font-bold text-[#ea580c] bg-orange-50 border border-orange-200 hover:bg-orange-100 cursor-pointer transition-colors"
                >
                  Save Review
                </button>
                <button
                  disabled
                  title="Approval flow — coming after Trust Gate integration"
                  className="px-[22px] py-[10px] rounded-[10px] text-[13px] font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                >
                  Approve &amp; Publish
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
