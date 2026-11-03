// ═══════════════════════════════════════════════════════════
// Smart intake: "I downloaded or copied this myself" (an admin's attestation)
// ═══════════════════════════════════════════════════════════
//
// The server counts a document the admin brought in as attested only with an
// address it came from and a note of at least ATTESTATION_MIN characters
// (service.ts, where the document's standing is decided); without them it
// stays unconfirmed, and nothing on the job can be checked against it. This
// says what is needed before the form is sent, and the form is not sent while
// a ticked declaration lacks it. It never makes a document attested itself.

import React from "react";
import { C, inputStyle } from "./ui";

/** The server's own minimum, after trimming (service.ts). */
export const ATTESTATION_MIN = 10;

/** What is missing from a ticked declaration, in the admin's words; null when nothing is (or the box is not ticked). */
export function attestationProblem(s: { attest: boolean; attestation: string; url: string }): string | null {
  if (!s.attest) return null;
  const missing: string[] = [];
  let host = "";
  try { const u = new URL(s.url.trim()); if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname; } catch { /* no address */ }
  if (!host) missing.push("the address it came from, in the box above");
  const note = s.attestation.trim();
  if (!note) missing.push(`a note of how you got it (at least ${ATTESTATION_MIN} characters)`);
  else if (note.length < ATTESTATION_MIN) missing.push(`a longer note: at least ${ATTESTATION_MIN} characters, now ${note.length}`);
  return missing.length ? `Needed for this declaration: ${missing.join("; and ")}. Without it, the document stays unconfirmed and nothing can be checked against it.` : null;
}

export function AttestationField({ id, attest, attestation, url, onChange }: {
  /** Unique on the page, for the message the note points to. */
  id: string;
  attest: boolean;
  attestation: string;
  url: string;
  onChange: (next: { attest: boolean; attestation: string }) => void;
}) {
  const problem = attestationProblem({ attest, attestation, url });
  const messageId = `${id}-attestation-needed`;
  return (
    <label data-attestation style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.muted }}>
      <input type="checkbox" checked={attest} onChange={(e) => onChange({ attest: e.target.checked, attestation })} style={{ marginTop: 2 }} />
      <span>The official site blocks the server, so I downloaded or copied this myself from the address above.
        {attest && (
          <>
            <span style={{ display: "block", marginTop: 4 }}>
              Say where you got it and when, in at least {ATTESTATION_MIN} characters, and keep the address above. It records your word, not a check by the server.
            </span>
            <input value={attestation} onChange={(e) => onChange({ attest, attestation: e.target.value })}
              placeholder="e.g. Downloaded from rrbcdg.gov.in on 25 Oct 2026; the site blocks automated access"
              aria-invalid={problem ? true : undefined} aria-describedby={problem ? messageId : undefined}
              style={{ ...inputStyle, marginTop: 6, ...(problem ? { borderColor: C.amber } : {}) }} />
            {problem && <span id={messageId} data-attestation-needed aria-live="polite" style={{ display: "block", marginTop: 4, color: C.amber }}>{problem}</span>}
          </>
        )}
      </span>
    </label>
  );
}
