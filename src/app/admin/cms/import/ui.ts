// Shared look for the importer's admin screens: the same tokens, panel and
// inputs as the record editor, so the importer reads as part of the CMS.

import type React from "react";
import { describeAiValue } from "@/lib/cms/ai-assist-apply";

export const C = {
  bg: "#070b16",
  surface: "rgba(14,21,38,0.72)",
  border: "rgba(148,163,184,0.14)",
  text: "#e2e8f0",
  muted: "#8c9bb8",
  accent: "#62b5ff",
  green: "#3fb950",
  amber: "#d29922",
  red: "#f85149",
  orange: "#f0883e",
};

export const PANEL: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 40px rgba(0,0,0,0.28)",
};

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", background: "#070b16", border: "1px solid #2b3a5c", borderRadius: 5,
  color: "#e2e8f0", fontSize: 13, boxSizing: "border-box", fontFamily: "inherit",
};

export const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, color: "#8c9bb8", marginBottom: 4, fontWeight: 500 };

export const primaryBtn: React.CSSProperties = {
  padding: "9px 18px", background: "linear-gradient(135deg, #f97316, #fb7185)", boxShadow: "0 0 22px rgba(249,115,22,0.35)",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
};

export const quietBtn: React.CSSProperties = {
  padding: "6px 12px", background: "none", color: C.accent, border: `1px solid ${C.accent}55`, borderRadius: 6,
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

export function badge(color: string): React.CSSProperties {
  return { display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: color + "22", color, border: `1px solid ${color}44`, whiteSpace: "nowrap" };
}

/** A proposed or current value, in words. */
export function showValue(value: unknown, fieldPath?: string): string {
  if (value && typeof value === "object" && !Array.isArray(value) && "url" in (value as object)) {
    const l = value as { label?: string; url: string; official?: boolean };
    return `${l.label ?? "Link"}: ${l.url}${l.official ? " (official)" : ""}`;
  }
  // Exam stages: name, then the date or what the notice says instead.
  if (fieldPath === "examStages" && Array.isArray(value)) {
    return (value as Array<{ name: string; dateIso?: string; dateDisplay?: string; notes?: string; certainty?: string }>)
      .map((s, i) => `${i + 1}. ${s.name} — ${s.dateIso ?? s.dateDisplay ?? s.notes ?? "date not announced"}${s.certainty === "TENTATIVE" ? " (tentative)" : ""}`).join("\n");
  }
  // Vacancy rows with their category split.
  if (fieldPath === "vacancies.breakdown" && Array.isArray(value)) {
    return (value as Array<{ post: string; count: number; payScale?: string; breakdown?: Record<string, unknown> }>).map((r) => {
      const split = Object.entries(r.breakdown ?? {}).filter(([, n]) => typeof n === "number").map(([k, n]) => `${k.length <= 5 ? k.toUpperCase() : k} ${n}`).join(", ");
      return `${r.post}: ${r.count}${r.payScale ? ` (${r.payScale})` : ""}${split ? ` — ${split}` : ""}`;
    }).join("\n");
  }
  if (fieldPath === "conditions" && Array.isArray(value)) return (value as string[]).map((n, i) => `${i + 1}. ${n}`).join("\n");
  return describeAiValue(value);
}

/** Field classes for the check list, in words and colours. */
export const CLASS_LOOK: Record<string, { label: string; color: string }> = {
  VERIFIED: { label: "Verified", color: C.green },
  NOT_APPLICABLE: { label: "Not applicable", color: C.green },
  NOT_STATED: { label: "Not stated", color: C.accent },
  SUPPORTED: { label: "Official source, not checked", color: C.amber },
  RESEARCH_ONLY: { label: "Research only", color: C.orange },
  UNSUPPORTED: { label: "No source", color: C.red },
  CONFLICTING: { label: "Sources disagree", color: C.red },
  LEGACY: { label: "Entered before import", color: C.amber },
  MISSING: { label: "Missing", color: C.red },
};
