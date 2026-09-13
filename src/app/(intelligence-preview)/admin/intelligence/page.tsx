"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  RecruitmentIntelligenceDraft,
  FieldValue,
  IntelligenceSource,
  IntelligenceConflict,
  RecruitmentDate,
  VacancyData,
} from "@/intelligence/draft-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function fmtDate(d?: string) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function sourceAuthorityRank(kind: IntelligenceSource["kind"]) {
  const m: Record<string, number> = {
    OFFICIAL: 4, APPLICATION_PORTAL: 3, RESULT_PORTAL: 3, SECONDARY: 1, OTHER: 0,
  };
  return m[kind] ?? 0;
}

// Human-readable labels for dot-path conflict field names
const FIELD_PATH_LABELS: Record<string, string> = {
  "vacancies.total":                      "Vacancy Total",
  "dates.notificationDate.date":          "Notification Date",
  "dates.applicationOpenDate.date":       "Application Open Date",
  "dates.applicationCloseDate.date":      "Application Close Date",
  "dates.feePaymentOpenDate.date":        "Fee Payment Open Date",
  "dates.feePaymentCloseDate.date":       "Fee Payment Close Date",
  "dates.examDate.date":                  "Exam Date",
  "dates.prelimsDate.date":              "Prelims Date",
  "dates.mainsDate.date":                "Mains Date",
  "dates.resultDate.date":               "Result Date",
  "dates.joiningDate.date":              "Joining Date",
  "identity.title":                      "Title",
  "identity.shortTitle":                 "Short Title",
  "identity.organizationId":             "Organisation ID",
  "identity.organizationName":           "Organisation Name",
  "identity.notificationNumber":         "Notification Number",
  "identity.advertisementNumber":        "Advertisement Number",
  "identity.recruitmentYear":            "Year",
  "identity.recruitmentType":            "Type",
};

function humanFieldName(path: string): string {
  if (FIELD_PATH_LABELS[path]) return FIELD_PATH_LABELS[path];
  // Fallback: take last segment and humanise camelCase
  const last = path.split(".").pop() ?? path;
  return last.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

// ─── Four field states ────────────────────────────────────────────────────────
//
// machine  — AI extracted, no conflict
// conflict — competing values from ≥2 sources
// derived  — computed from other values (e.g. sum of rows)
// manual   — admin has overridden the machine value

type FieldState = "machine" | "conflict" | "derived" | "manual";

function resolveState(fv: FieldValue<unknown>): FieldState {
  if (fv.manuallyEdited) return "manual";
  if (fv.conflict) return "conflict";
  return "machine";
}

const STATE_CFG: Record<FieldState, { icon: string; label: string; text: string; box: string }> = {
  machine:  { icon: "✦", label: "Machine",  text: "text-slate-400",  box: "bg-white border-slate-200 hover:border-[#ea580c]" },
  conflict: { icon: "⚠", label: "Conflict", text: "text-red-500",    box: "bg-red-50/40 border-red-200" },
  derived:  { icon: "≈", label: "Derived",  text: "text-amber-600",  box: "bg-amber-50/40 border-amber-200" },
  manual:   { icon: "✏", label: "Edited",   text: "text-indigo-500", box: "bg-indigo-50/40 border-indigo-200" },
};

// ─── Primitives ───────────────────────────────────────────────────────────────

function Badge({ children, variant }: {
  children: React.ReactNode;
  variant: "official" | "secondary" | "conflict" | "neutral" | "ok" | "err" | "warn" | "primary";
}) {
  const cls: Record<string, string> = {
    official:  "bg-green-50  text-green-700  border border-green-200",
    secondary: "bg-amber-50  text-amber-700  border border-amber-200",
    conflict:  "bg-red-50    text-red-600    border border-red-200",
    neutral:   "bg-slate-100 text-slate-500  border border-slate-200",
    ok:        "bg-green-50  text-green-700",
    err:       "bg-red-50    text-red-600",
    warn:      "bg-amber-50  text-amber-700",
    primary:   "bg-orange-50 text-orange-600 border border-orange-200",
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
      {confidence !== undefined && (
        <span className="text-slate-400 font-normal">· {pct(confidence)}</span>
      )}
      {sourceId && (
        <span className="text-slate-400 font-normal">· {sourceId}</span>
      )}
    </span>
  );
}

function SectionCard({ title, accentClass = "from-[#ea580c] via-[#f97316] to-[#fed7aa]", children }: {
  title: string;
  accentClass?: string;
  children: React.ReactNode;
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

// ─── Edit-ready field row ─────────────────────────────────────────────────────
// Label (uppercase, small) above a bordered value box.
// The box has hover:border-orange to signal future editability without
// implementing editing yet (Commit E).

function FieldRow({ label, fv }: { label: string; fv?: FieldValue<unknown> }) {
  if (!fv) return null;
  const val = fv.value;
  const display = val === undefined || val === null ? null : String(val);
  const state = resolveState(fv);
  const cfg = STATE_CFG[state];
  const top = fv.evidence[0];

  return (
    <div className="py-3 border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-slate-400">{label}</span>
        <StateMeta state={state} confidence={fv.confidence} sourceId={top?.sourceId} />
      </div>
      <div
        className={`px-3 py-2.5 rounded-lg border text-[13px] font-semibold transition-colors cursor-default
          ${display ? `${cfg.box} text-slate-900` : "bg-slate-50 border-slate-100 text-slate-400"}`}
      >
        {display ?? "—"}
      </div>
    </div>
  );
}

// ─── Date row (same edit-ready treatment) ────────────────────────────────────

function DateRow({ label, rd }: { label: string; rd?: RecruitmentDate }) {
  if (!rd) return null;
  const dateStr = fmtDate(rd.date);
  const state: FieldState = rd.conflict ? "conflict" : "machine";
  const cfg = STATE_CFG[state];
  const topEvidence = rd.sourceEvidence[0];

  return (
    <div className="py-3 border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-slate-400">{label}</span>
        <StateMeta
          state={state}
          confidence={topEvidence?.confidence}
          sourceId={topEvidence?.sourceId}
        />
      </div>
      <div
        className={`px-3 py-2.5 rounded-lg border transition-colors cursor-default flex items-center gap-2.5
          ${dateStr ? `${cfg.box} text-slate-900` : "bg-slate-50 border-slate-100 text-slate-400"}`}
      >
        <span className="text-[13px] font-semibold tabular-nums">{dateStr ?? "—"}</span>
        <Badge variant="neutral">{rd.certainty}</Badge>
      </div>
    </div>
  );
}

// ─── Source item ──────────────────────────────────────────────────────────────

function SourceItem({ source }: { source: IntelligenceSource }) {
  const rank = sourceAuthorityRank(source.kind);
  const variant = rank >= 4 ? "official" : rank >= 1 ? "secondary" : "neutral";
  return (
    <div className="py-[10px] border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center gap-[7px] flex-wrap mb-1">
        <Badge variant={variant}>{source.kind}</Badge>
        {source.organizationId && (
          <span className="text-[11px] font-semibold text-slate-600">{source.organizationId}</span>
        )}
        <Badge variant={source.success ? "ok" : "err"}>{source.success ? "OK" : "FAILED"}</Badge>
        <span className="text-[10px] text-slate-400">rank {rank} · {source.retrievalMethod ?? "HTML"}</span>
      </div>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11.5px] text-[#ea580c] break-all hover:underline"
      >
        {source.url}
      </a>
    </div>
  );
}

// ─── Conflict item (human-readable primary, path in <details>) ───────────────

function ConflictItem({ conflict }: { conflict: IntelligenceConflict }) {
  const sevVariant = conflict.severity === "BLOCKING" ? "err" : conflict.severity === "WARNING" ? "warn" : "neutral";
  const humanName = humanFieldName(conflict.field);
  return (
    <div className="py-[12px] border-b border-slate-50 last:border-0 last:pb-0 first:pt-0">
      <div className="flex items-center gap-2 mb-2.5">
        <Badge variant={sevVariant}>{conflict.severity}</Badge>
        <span className="text-[13px] font-semibold text-slate-800">{humanName}</span>
      </div>
      <div className="flex flex-col gap-[6px]">
        {conflict.values.map((v, i) => (
          <div
            key={i}
            className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-[12.5px]
              ${v.sourceKind === "OFFICIAL"
                ? "bg-green-50/50 border-green-100"
                : "bg-slate-50 border-slate-100"}`}
          >
            <Badge variant={v.sourceKind === "OFFICIAL" ? "official" : "secondary"}>{v.sourceKind}</Badge>
            <span className="font-bold text-slate-900 tabular-nums">{String(v.value)}</span>
            <span className="text-slate-400 text-[11px] mt-px">{v.sourceId} · authority {Math.round(v.confidence * 4)}</span>
          </div>
        ))}
      </div>
      {conflict.resolution && (
        <div className="mt-2.5 text-[11.5px] text-green-700 flex gap-1.5 items-start">
          <span className="mt-px">✓</span>
          <span>Auto-resolved: selected <strong>{String(conflict.resolution.selectedValue)}</strong> — {conflict.resolution.reason}. Both values preserved in evidence.</span>
        </div>
      )}
      {/* Technical path for developers — hidden by default */}
      <details className="mt-2">
        <summary className="text-[10.5px] text-slate-400 cursor-pointer select-none hover:text-slate-600 w-fit">
          Field path
        </summary>
        <code className="text-[10.5px] text-slate-500 font-mono">{conflict.field}</code>
      </details>
    </div>
  );
}

// ─── Vacancies panel ──────────────────────────────────────────────────────────

function VacanciesPanel({ vac }: { vac: VacancyData }) {
  const explicitTotal = vac.total?.value;
  const total = explicitTotal ?? vac.derivedTotal;
  const isDerived = explicitTotal === undefined && vac.derivedTotal !== undefined;
  const state: FieldState = isDerived ? "derived" : "machine";
  const cfg = STATE_CFG[state];

  return (
    <div>
      {total !== undefined && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-slate-400">Total Vacancies</span>
            <StateMeta state={state} />
          </div>
          <div className={`inline-flex items-center gap-3 px-4 py-2.5 rounded-lg border ${cfg.box}`}>
            <span className="text-[28px] font-extrabold text-[#ea580c] leading-none tabular-nums">{total}</span>
            {vac.isIndicative === false && !isDerived && <Badge variant="ok">Authoritative</Badge>}
            {isDerived && <Badge variant="warn">Sum of {vac.rows.length} row{vac.rows.length !== 1 ? "s" : ""}</Badge>}
          </div>
        </div>
      )}
      {vac.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {["Post", "Total", "UR", "OBC", "SC", "ST", "EWS"].map((h, i) => (
                  <th key={h} className={`py-[7px] px-[10px] text-[11px] font-bold tracking-[.04em] text-slate-500 ${i > 0 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vac.rows.map((row, i) => (
                <tr key={row.id} className={`border-b border-slate-50 ${i % 2 !== 0 ? "bg-slate-50/60" : ""}`}>
                  <td className="py-[7px] px-[10px] font-medium text-slate-800">
                    {row.postName}
                    {row.grade && <span className="text-slate-400 font-normal"> ({row.grade})</span>}
                  </td>
                  <td className="py-[7px] px-[10px] text-right font-bold tabular-nums text-slate-900">{row.total ?? "—"}</td>
                  {(["UR", "OBC", "SC", "ST", "EWS"] as const).map((cat) => (
                    <td key={cat} className="py-[7px] px-[10px] text-right tabular-nums text-slate-600">
                      {row.categoryBreakdown?.[cat] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function IntelligencePreviewPage() {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<RecruitmentIntelligenceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyse() {
    const urlList = urls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (!urlList.length) return;
    setLoading(true);
    setError(null);
    setDraft(null);
    try {
      const res = await fetch("/api/admin/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlList }),
      });
      const data = (await res.json()) as { draft?: RecruitmentIntelligenceDraft; error?: string };
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Analysis failed");
      } else {
        setDraft(data.draft);
      }
    } catch {
      setError("Network error — could not reach the intelligence API.");
    } finally {
      setLoading(false);
    }
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
          <Link
            href="/admin"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 px-[10px] py-1.5 rounded-lg border border-slate-200 bg-white hover:text-[#ea580c] hover:border-orange-200 transition-colors"
          >
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
              <div className="mt-2.5 px-3.5 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600">
                {error}
              </div>
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
                <div className={`text-[28px] font-extrabold leading-none tabular-nums ${conflicts.length > 0 ? "text-red-600" : "text-green-700"}`}>
                  {conflicts.length}
                </div>
                <div className="text-[11px] text-slate-400 mt-1.5">
                  {conflicts.filter((c) => c.severity === "BLOCKING").length} blocking
                </div>
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

            {/* Identity */}
            <SectionCard title="Organisation &amp; Identity">
              <FieldRow label="Organisation"     fv={draft.identity.organizationName} />
              <FieldRow label="Org ID"           fv={draft.identity.organizationId} />
              <FieldRow label="Title"            fv={draft.identity.title} />
              <FieldRow label="Short Title"      fv={draft.identity.shortTitle} />
              <FieldRow label="Notification No." fv={draft.identity.notificationNumber} />
              <FieldRow label="Ad. Number"       fv={draft.identity.advertisementNumber} />
              <FieldRow label="Year"             fv={draft.identity.recruitmentYear} />
              <FieldRow label="Type"             fv={draft.identity.recruitmentType} />
            </SectionCard>

            {/* Dates */}
            <SectionCard title="Important Dates">
              <DateRow label="Notification Date"   rd={draft.dates.notificationDate} />
              <DateRow label="Application Opens"   rd={draft.dates.applicationOpenDate} />
              <DateRow label="Application Closes"  rd={draft.dates.applicationCloseDate} />
              <DateRow label="Fee Payment Opens"   rd={draft.dates.feePaymentOpenDate} />
              <DateRow label="Fee Payment Closes"  rd={draft.dates.feePaymentCloseDate} />
              <DateRow label="Correction Window"   rd={draft.dates.correctionOpenDate} />
              <DateRow label="Exam Date"           rd={draft.dates.examDate} />
              <DateRow label="Prelims"             rd={draft.dates.prelimsDate} />
              <DateRow label="Mains"               rd={draft.dates.mainsDate} />
              <DateRow label="Result Date"         rd={draft.dates.resultDate} />
              <DateRow label="Joining Date"        rd={draft.dates.joiningDate} />
            </SectionCard>

            {/* Vacancies */}
            {(draft.vacancies.rows.length > 0 ||
              draft.vacancies.total?.value !== undefined ||
              draft.vacancies.derivedTotal !== undefined) && (
              <SectionCard title="Vacancies">
                <VacanciesPanel vac={draft.vacancies} />
              </SectionCard>
            )}

            {/* Conflicts */}
            {conflicts.length > 0 && (
              <SectionCard title={`Conflicts (${conflicts.length})`} accentClass="from-red-400 via-red-300 to-red-200">
                {conflicts.map((c, i) => <ConflictItem key={i} conflict={c} />)}
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

            {/* Approve & Publish — disabled in Commit D */}
            <div className="bg-white border border-orange-200 rounded-2xl px-[22px] py-[18px] flex items-center justify-between gap-4 flex-wrap shadow-xs">
              <div>
                <h3 className="text-[14px] font-bold">Approve &amp; Publish</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">Publishing adds this to the canonical recruitment record. Resolve all warnings first.</p>
              </div>
              <button
                disabled
                title="Approval flow is coming in a later phase"
                className="px-[22px] py-[10px] rounded-[10px] text-[13px] font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
              >
                Approve &amp; Publish
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
