"use client";

// The import check state of one field, beside its usual CMS status badge.
// Shown on imported jobs only. It is worked out from the importer's claims
// and decisions for the field's current revision; the field's own status
// (Pending, Verified…) is left exactly as it is in the record, but its badge is
// not shown beside this one, which is the state that counts on an imported job.

import { createContext, useContext } from "react";

export const ImportVerdicts = createContext<Record<string, string>>({});

const LOOK: Record<string, { label: string; color: string; help: string }> = {
  VERIFIED: { label: "Verified against an official document", color: "#22c55e", help: "A person checked this exact value against an official document brought in for this job (the notification, a corrigendum or the official web page)." },
  NOT_APPLICABLE: { label: "Not applicable — reviewed", color: "#22c55e", help: "Recorded as not applicable after reading the official notification." },
  NOT_YET_OPEN: { label: "Link not released yet — reviewed", color: "#62b5ff", help: "The recruiting body's own notice says the application link will be released later; recorded after reading it. No link is shown until one is added and verified." },
  NOT_STATED: { label: "Not stated — reviewed", color: "#62b5ff", help: "The official notification does not state this; recorded after reading it." },
  SUPPORTED: { label: "Official source — needs review", color: "#d29922", help: "An official document in the import gives this value; a person has not checked it yet." },
  RESEARCH_ONLY: { label: "Research — pending", color: "#f97316", help: "Only research (an article, ChatGPT) gives this value. Check it against the official notification." },
  UNSUPPORTED: { label: "No official source — needs review", color: "#f85149", help: "No official document in the imports gives this value." },
  CONFLICTING: { label: "Sources disagree", color: "#f85149", help: "The imported sources give different values." },
  LEGACY: { label: "Entered before import — needs review", color: "#d29922", help: "This value was on the job before it was first imported." },
};

/** Whether the import check shows a state for this field: then it replaces the field's own CMS status badge,
 *  so "Pending" is never shown beside "Verified" for the same value. */
export function useHasImportVerdict(fieldPath: string | undefined): boolean {
  const all = useContext(ImportVerdicts);
  return !!fieldPath && !!LOOK[all[fieldPath] ?? ""];
}

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
