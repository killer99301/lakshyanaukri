// Client-safe AI Assist helpers (no server-only imports): shared by the editor
// page and the route so both write paths record provenance the same way.

import type { ProvenanceField } from "@/types/recruitment-record";

// The note names the source URL only. It never calls the source official
// and never implies the value has been verified.
export function aiAssistReason(sourceUrl: string, mode: "filled" | "applied"): string {
  const action = mode === "filled" ? "auto-filled empty field" : "suggestion applied by admin";
  return `AI Assist (${action}) — extracted from ${sourceUrl} — unverified, requires human verification`;
}

/** A readable one-block description of any value AI Assist can produce. */
export function describeAiValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((v) => typeof v === "string")) return value.map((v, i) => `${i + 1}. ${v}`).join("\n");
    return value
      .map((v) => {
        const item = v as { post?: string; qualification?: string[]; count?: number };
        if (item.post && item.qualification) return `${item.post}: ${item.qualification.join("; ")}`;
        if (item.post && item.count !== undefined) return `${item.post}: ${item.count}`;
        return JSON.stringify(v);
      })
      .join("\n");
  }

  const o = value as {
    min?: number; max?: number; asOf?: string; relaxations?: Array<{ category: string; years?: number; text?: string }>;
    stages?: Array<{ name: string; description?: string }>; negativeMarking?: string; examPattern?: string;
  };
  if (o.relaxations !== undefined || o.min !== undefined || o.max !== undefined) {
    const range =
      o.min !== undefined && o.max !== undefined ? `${o.min} to ${o.max} years`
        : o.max !== undefined ? `Up to ${o.max} years`
          : o.min !== undefined ? `${o.min} years and above` : "";
    const lines = [range ? `${range}${o.asOf ? ` (as of ${o.asOf})` : ""}` : ""];
    for (const r of o.relaxations ?? []) lines.push(`Relaxation — ${r.category}: ${r.years !== undefined ? `${r.years} years` : r.text ?? ""}`);
    return lines.filter(Boolean).join("\n");
  }
  if (o.stages !== undefined || o.negativeMarking !== undefined) {
    const lines = (o.stages ?? []).map((s, i) => `${i + 1}. ${s.name}${s.description ? ` — ${s.description}` : ""}`);
    if (o.examPattern) lines.push(`Exam pattern: ${o.examPattern}`);
    if (o.negativeMarking) lines.push(`Negative marking: ${o.negativeMarking}`);
    return lines.join("\n");
  }
  return JSON.stringify(value);
}

// Existing evidence links are kept; an AI value never clears them.
export function buildAiField<T>(value: T, existingEvidenceIds: string[] = []): ProvenanceField<T> {
  return {
    value,
    status: "PENDING",
    evidenceIds: [...existingEvidenceIds],
    conflict: false,
    manuallyEdited: false,
  };
}
