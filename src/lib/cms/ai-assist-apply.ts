// Client-safe AI Assist helpers (no server-only imports): shared by the editor
// page and the route so both write paths record provenance the same way.

import type { ProvenanceField } from "@/types/recruitment-record";

// The note names the source URL only. It never calls the source official
// and never implies the value has been verified.
export function aiAssistReason(sourceUrl: string, mode: "filled" | "applied"): string {
  const action = mode === "filled" ? "auto-filled empty field" : "suggestion applied by admin";
  return `AI Assist (${action}) — extracted from ${sourceUrl} — unverified, requires human verification`;
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
