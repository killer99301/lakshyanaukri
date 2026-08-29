// ═══════════════════════════════════════════════════════════
// Phase 7B: Warning Classification and Acknowledgement Policy
// ═══════════════════════════════════════════════════════════
//
// Every Trust Gate warning has a policy tier:
//
//   INFORMATIONAL  — displayed to reviewer; never blocks a commit
//   ACKNOWLEDGE    — reviewer must supply an exact --acknowledge string;
//                    writer refuses without it
//   BLOCKING       — writer refuses regardless of acknowledgement
//
// The WARNING_POLICY table is the authoritative record of which tier
// applies to which warning. Unknown warnings default to INFORMATIONAL —
// the safe fallback that never silently blocks.
//
// checkWarningPolicy() is the single function the writer calls.
// It returns { blocked, refuseReason } — pure, no side effects.
// ═══════════════════════════════════════════════════════════

export type WarningTier = "INFORMATIONAL" | "ACKNOWLEDGE" | "BLOCKING";

interface WarningPolicyEntry {
  tier: WarningTier;
  pattern: string;  // substring match against the warning message
  reason: string;   // explains why this tier was chosen (auditable)
}

// ─── Policy table ─────────────────────────────────────────────
//
// Add new entries here when a new warning pattern is identified.
// Order matters: first match wins. Keep BLOCKING entries first so they
// cannot be shadowed by a broader INFORMATIONAL pattern below them.
//
// Patterns use substring matching — keep them specific enough to avoid
// accidental matches on unrelated messages.

export const WARNING_POLICY: WarningPolicyEntry[] = [
  // ── BLOCKING (reserved — no live patterns yet) ─────────────
  {
    tier: "BLOCKING",
    pattern: "[COMMIT-BLOCKED]",
    reason:
      "Reserved sentinel for patterns that permanently prevent a commit. " +
      "No acknowledgement overrides a BLOCKING tier.",
  },

  // ── ACKNOWLEDGE (reserved — no live patterns yet) ──────────
  {
    tier: "ACKNOWLEDGE",
    pattern: "[ACKNOWLEDGE-REQUIRED]",
    reason:
      "Reserved sentinel for patterns that require an explicit --acknowledge " +
      "string from the reviewer before the writer will commit.",
  },

  // ── INFORMATIONAL ──────────────────────────────────────────
  {
    tier: "INFORMATIONAL",
    pattern: "Vacancy breakdown total",
    reason:
      "The system cannot determine the correct distribution across breakdown " +
      "categories when only totalVacancies changes. The reviewer sees the " +
      "numeric detail (proposed total, breakdown total, difference) at approval " +
      "time. The writer records the warning in CommitResult for the audit trail.",
  },
];

// ─── Classification ───────────────────────────────────────────

/**
 * Returns the policy tier for a given warning message.
 * Matches by substring; first match wins.
 * Unknown warnings default to INFORMATIONAL — the safe fallback.
 */
export function classifyWarning(message: string): WarningTier {
  for (const entry of WARNING_POLICY) {
    if (message.includes(entry.pattern)) return entry.tier;
  }
  return "INFORMATIONAL";
}

// ─── Commit-time enforcement ──────────────────────────────────

/**
 * Checks all post-mutation Trust Gate warnings against the policy.
 * Called by writer.ts as Guard 7 — after the Trust Gate passes (Guard 6).
 *
 * Returns { blocked: false } when the commit may proceed.
 * Returns { blocked: true, refuseReason } when it must not.
 *
 * BLOCKING tier: always refuses, even if the warning string appears in `acknowledged`.
 * ACKNOWLEDGE tier: refuses only when the exact warning string is absent from `acknowledged`.
 * INFORMATIONAL tier: never blocks.
 */
export function checkWarningPolicy(
  warnings: string[],
  acknowledged: string[]
): { blocked: boolean; refuseReason?: string } {
  for (const msg of warnings) {
    const tier = classifyWarning(msg);

    if (tier === "BLOCKING") {
      return {
        blocked: true,
        refuseReason: `commit permanently blocked by warning policy: "${msg}"`,
      };
    }

    if (tier === "ACKNOWLEDGE") {
      if (!acknowledged.includes(msg)) {
        return {
          blocked: true,
          refuseReason:
            `warning requires explicit acknowledgement before commit:\n` +
            `  "${msg}"\n` +
            `  Re-approve with: --acknowledge "${msg}"`,
        };
      }
    }
  }
  return { blocked: false };
}
