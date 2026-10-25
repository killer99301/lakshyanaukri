"use client";

// The import check state of one field, beside its usual CMS status badge.
// Shown on imported jobs only. It is worked out from the importer's claims
// and decisions for the field's current revision; the field's own status
// (Pending, Verified…) is left exactly as it is.

import { createContext, useContext } from "react";

export const ImportVerdicts = createContext<Record<string, string>>({});

const LOOK: Record<string, { label: string; color: string; help: string }> = {
  VERIFIED: { label: "Verified against official notification", color: "#22c55e", help: "A person checked this exact value against the official notification." },
  NOT_APPLICABLE: { label: "Not applicable — reviewed", color: "#22c55e", help: "Recorded as not applicable after reading the official notification." },
  NOT_STATED: { label: "Not stated — reviewed", color: "#62b5ff", help: "The official notification does not state this; recorded after reading it." },
  SUPPORTED: { label: "Official source — needs review", color: "#d29922", help: "An official document in the import gives this value; a person has not checked it yet." },
  RESEARCH_ONLY: { label: "Research — pending", color: "#f97316", help: "Only research (an article, ChatGPT) gives this value. Check it against the official notification." },
  UNSUPPORTED: { label: "No official source — needs review", color: "#f85149", help: "No official document in the imports gives this value." },
  CONFLICTING: { label: "Sources disagree", color: "#f85149", help: "The imported sources give different values." },
  LEGACY: { label: "Entered before import — needs review", color: "#d29922", help: "This value was on the job before it was first imported." },
};

export function ImportVerdictBadge({ fieldPath }: { fieldPath: string }) {
  const cls = useContext(ImportVerdicts)[fieldPath];
  const look = cls ? LOOK[cls] : undefined;
  if (!look) return null;
  return (
    <span data-import-verdict={cls} title={look.help} style={{
      marginLeft: 6, display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700,
      color: look.color, border: `1px solid ${look.color}55`, background: `${look.color}14`, cursor: "help",
    }}>
      {look.label}
    </span>
  );
}
