// ═══════════════════════════════════════════════════════════
// Phase 6A: Change Review CLI — business logic layer
// ═══════════════════════════════════════════════════════════
//
// All functions are injectable (queuePath, opportunities) so they
// can be exercised in tests without touching production files.
//
// The CLI script (scripts/intelligence-review.ts) is a thin
// wrapper that supplies real queue path + getAllOpportunities().
//
// INVARIANT: none of these functions write to src/data/.
// productionWrites stays 0. writer.ts is the only path to
// canonical data.
// ═══════════════════════════════════════════════════════════

import type { Opportunity, GovernmentRecruitment } from "@/types";
import type { ReviewItem } from "./types";
import {
  loadReviewQueue,
  approveItem,
  setItemStatus,
  generateProposedRecord,
  DEFAULT_QUEUE_PATH,
} from "./review-queue";
import { runTrustGateWithProposal } from "./trust-gate";
import { classifyWarning } from "./warning-policy";

// ─── Result type ──────────────────────────────────────────────

export interface CliResult {
  success: boolean;
  message: string;
  item?: ReviewItem;
}

// ─── Display helpers ──────────────────────────────────────────

const DIVIDER = "━".repeat(44);

/**
 * Formats Trust Gate warnings as a dedicated section with rich detail
 * where additional context can be computed from the proposed record.
 *
 * For the vacancyBreakdown case, shows proposed total, breakdown total,
 * and difference so the reviewer knows exactly what is and isn't changing.
 */
function formatConsistencyWarnings(
  warnings: string[],
  proposed?: GovernmentRecruitment
): string[] {
  if (warnings.length === 0) return [];

  const lines: string[] = [
    "",
    "CONSISTENCY WARNINGS ⚠",
    "─".repeat(40),
  ];

  for (const msg of warnings) {
    const tier = classifyWarning(msg);
    const tierLabel =
      tier === "BLOCKING"    ? "🚫 [COMMIT-BLOCKED]"         :
      tier === "ACKNOWLEDGE" ? "⚠ [REQUIRES ACKNOWLEDGEMENT]" :
                               "ℹ [INFORMATIONAL]";
    lines.push(`  ${tierLabel}  ${msg}`);

    // Enrich the vacancy breakdown case with computed detail
    if (proposed?.vacancyBreakdown && proposed.vacancyBreakdown.length > 0 && msg.includes("breakdown")) {
      const breakdownTotal = proposed.vacancyBreakdown.reduce((s, r) => s + r.count, 0);
      const diff = proposed.totalVacancies - breakdownTotal;
      lines.push(`    Proposed total:  ${proposed.totalVacancies.toLocaleString()}`);
      lines.push(`    Breakdown total: ${breakdownTotal.toLocaleString()}`);
      lines.push(`    Difference:      ${diff > 0 ? "+" : ""}${diff.toLocaleString()}`);
      lines.push(`    This proposal does NOT modify vacancyBreakdown.`);
    }
  }

  return lines;
}

function statusLabel(s: string): string {
  if (s === "PENDING")      return "⏳ PENDING";
  if (s === "APPROVED")     return "✅ APPROVED";
  if (s === "REJECTED")     return "❌ REJECTED";
  if (s === "NEEDS_REVIEW") return "🔍 NEEDS_REVIEW";
  return s;
}

// ─── list ─────────────────────────────────────────────────────

/**
 * Lists all PENDING review items in a compact table.
 */
export function listItems(queuePath = DEFAULT_QUEUE_PATH): CliResult {
  const queue = loadReviewQueue(queuePath);
  const pending = queue.items.filter((i) => i.status === "PENDING");

  if (pending.length === 0) {
    const total = queue.items.length;
    return {
      success: true,
      message: total === 0
        ? "Review queue is empty — no confirmed changes yet."
        : `No pending items. Queue has ${total} item(s) in other states.`,
    };
  }

  const lines: string[] = [
    "",
    DIVIDER,
    `CHANGE REVIEW QUEUE — ${pending.length} PENDING`,
    DIVIDER,
    "",
  ];

  for (const item of pending) {
    const shortId = item.id.slice(0, 8);
    const changeType = item.changeType.padEnd(30);
    const title = item.opportunityTitle.length > 42
      ? item.opportunityTitle.slice(0, 39) + "…"
      : item.opportunityTitle.padEnd(42);
    lines.push(`${shortId}  ${changeType}  ${title}`);
    lines.push(
      `          conf=${item.confidence.toFixed(2)}` +
      `  id="${item.matchedIdentifier}"` +
      `  queued=${item.queuedAt.slice(0, 10)}`
    );
    lines.push("");
  }

  return { success: true, message: lines.join("\n") };
}

// ─── show ─────────────────────────────────────────────────────

/**
 * Displays a human-readable audit view of one review item.
 * Accepts a full UUID or the first 8 characters as a prefix.
 *
 * When `opportunities` is provided (third parameter), a read-only Trust Gate
 * preview is run against the proposed record for PENDING items, surfacing
 * consistency warnings before the human commits to approving.
 */
export function showItem(
  idOrPrefix: string,
  queuePath = DEFAULT_QUEUE_PATH,
  opportunities?: Opportunity[]
): CliResult {
  const queue = loadReviewQueue(queuePath);
  const item = queue.items.find(
    (i) => i.id === idOrPrefix || i.id.startsWith(idOrPrefix)
  );

  if (!item) {
    return {
      success: false,
      message: `No review item found with ID or prefix: ${idOrPrefix}`,
    };
  }

  // ── Compute consistency warnings ──────────────────────────────
  // For APPROVED items: use stored trustGateWarnings from ProposedChange.
  // For PENDING items with opportunities: run Trust Gate read-only preview.
  let consistencyWarnings: string[] = [];
  let proposedForDisplay: GovernmentRecruitment | undefined;

  if (item.approvedChange) {
    consistencyWarnings = item.approvedChange.trustGateWarnings;
    // Re-derive proposed record for rich warning display (read-only, no write)
    if (opportunities && item.fieldDiffs.length > 0) {
      const opp = opportunities.find(
        (o) => o.id === item.opportunityId && o.type === "government"
      );
      if (opp) {
        proposedForDisplay = generateProposedRecord(item, opp as GovernmentRecruitment).proposed;
      }
    }
  } else if (opportunities && item.fieldDiffs.length > 0) {
    const opp = opportunities.find(
      (o) => o.id === item.opportunityId && o.type === "government"
    );
    if (opp) {
      const govOpp = opp as GovernmentRecruitment;
      const { proposed } = generateProposedRecord(item, govOpp);
      proposedForDisplay = proposed;
      const tg = runTrustGateWithProposal(opportunities, proposed);
      consistencyWarnings = tg.warnings.map((w) => w.message);
    }
  }

  // ── Format output ─────────────────────────────────────────────
  const lines: string[] = [
    "",
    DIVIDER,
    "CHANGE REVIEW",
    DIVIDER,
    `ID:          ${item.id}`,
    `Status:      ${statusLabel(item.status)}`,
    "",
    item.opportunityTitle,
    item.changeType,
    "",
    "Source chain",
    `  Secondary:  ${item.secondarySourceUrl}`,
    `  Official:   ${item.officialConfirmationUrl}`,
    "",
    "Evidence",
    `  "${item.officialEvidence.slice(0, 300).replace(/\n/g, " ").trim()}"`,
    "",
    "Confidence",
    `  Signal:         ${item.confidence.toFixed(2)}`,
  ];

  if (item.disambiguationScore) {
    lines.push(`  Disambiguation: ${item.disambiguationScore}`);
  }
  lines.push(`  Matched ID:     ${item.matchedIdentifier}`);

  lines.push("", "Proposed changes");
  if (item.fieldDiffs.length > 0) {
    for (const diff of item.fieldDiffs) {
      lines.push(`  ${diff.field}`);
      lines.push(`    CURRENT:  ${diff.canonicalValue}`);
      lines.push(`    PROPOSED: ${diff.observedValue}`);
    }
  } else {
    lines.push("  (no field diffs — informational change)");
  }

  // ── Consistency warnings (pre-approval preview or stored) ─────
  if (consistencyWarnings.length > 0) {
    lines.push(...formatConsistencyWarnings(consistencyWarnings, proposedForDisplay));
  }

  lines.push("", "Trust Gate");
  if (item.approvedChange) {
    const tg = item.approvedChange;
    lines.push(`  ${tg.trustGatePassed ? "✅ PASSED" : "❌ FAILED"}`);
    if (tg.trustGateErrors.length > 0) {
      lines.push(`  Errors:   ${tg.trustGateErrors.join("; ")}`);
    }
    lines.push(consistencyWarnings.length > 0
      ? `  Warnings: ${consistencyWarnings.length} — see CONSISTENCY WARNINGS above`
      : "  Warnings: none"
    );
    if (tg.skippedPaths.length > 0) {
      lines.push(`  Skipped paths:`);
      for (const p of tg.skippedPaths) lines.push(`    ${p}`);
    }
  } else {
    const tgLabel = opportunities
      ? consistencyWarnings.length > 0
        ? "⚠  Would PASS with warnings — see above"
        : "✅ Would PASS — no errors on proposed record"
      : "(not yet run — approve to generate proposal)";
    lines.push(`  ${tgLabel}`);
  }

  lines.push("", `Queued: ${item.queuedAt}`);
  lines.push(`Dedup:  ${item.dedupKey}`);

  if (item.reviewNotes) {
    lines.push(`Notes:  ${item.reviewNotes}`);
  }

  lines.push(DIVIDER, "");

  return { success: true, message: lines.join("\n"), item };
}

// ─── approve ──────────────────────────────────────────────────

/**
 * Approves a PENDING review item.
 *
 * Steps (per Phase 6 spec):
 *   1. Load the item
 *   2. Verify it is PENDING
 *   3. Resolve canonical opportunity
 *   4–6. Generate ProposedChange + run Trust Gate (via approveItem())
 *   7. Store proposal; change status to APPROVED
 *   8. Return result — does NOT write to src/data/
 */
export function approveReviewItem(
  idOrPrefix: string,
  opportunities: Opportunity[],
  notes?: string,
  queuePath = DEFAULT_QUEUE_PATH,
  acknowledgeWarnings: string[] = []
): CliResult {
  const queue = loadReviewQueue(queuePath);
  const item = queue.items.find(
    (i) => i.id === idOrPrefix || i.id.startsWith(idOrPrefix)
  );

  if (!item) {
    return {
      success: false,
      message: `No review item found with ID or prefix: ${idOrPrefix}`,
    };
  }

  if (item.status !== "PENDING") {
    return {
      success: false,
      message: `Cannot approve: item is already ${statusLabel(item.status)} — only PENDING items can be approved`,
    };
  }

  // Pre-validate supplied acknowledgements: each must exactly match an ACKNOWLEDGE-tier warning.
  // This catches typos at approve time rather than surfacing them later in the writer.
  if (acknowledgeWarnings.length > 0) {
    const opp = opportunities.find(
      (o) => o.id === item.opportunityId && o.type === "government"
    );
    if (opp && item.fieldDiffs.length > 0) {
      const { proposed } = generateProposedRecord(item, opp as GovernmentRecruitment);
      const tg = runTrustGateWithProposal(opportunities, proposed);
      const ackTierWarnings = tg.warnings
        .map((w) => w.message)
        .filter((msg) => classifyWarning(msg) === "ACKNOWLEDGE");

      for (const ack of acknowledgeWarnings) {
        if (!ackTierWarnings.includes(ack)) {
          const available = ackTierWarnings.length > 0
            ? `  Available ACKNOWLEDGE-tier warnings:\n${ackTierWarnings.map((w) => `    "${w}"`).join("\n")}`
            : "  This proposal has no ACKNOWLEDGE-tier warnings.";
          return {
            success: false,
            message: [
              "",
              `Cannot approve: acknowledgement does not match any ACKNOWLEDGE-tier warning.`,
              `  You supplied:  "${ack}"`,
              available,
              "",
              "Item left PENDING. Correct the acknowledgement text and re-run.",
            ].join("\n"),
          };
        }
      }
    }
  }

  // approveItem() handles steps 4–7: ProposedChange, Trust Gate, status → APPROVED
  const proposal = approveItem(item.id, opportunities, notes, queuePath, acknowledgeWarnings);

  if (!proposal) {
    return {
      success: false,
      message: "Approval failed: unable to generate proposal (item may have been removed)",
    };
  }

  const tgLine = proposal.trustGatePassed
    ? "✅ PASSED"
    : "⚠️  FAILED — writer will refuse to commit until Trust Gate passes";

  const lines: string[] = [
    "",
    `Approved: ${item.opportunityTitle} / ${item.changeType}`,
    `Applied diffs: ${proposal.appliedFieldDiffs.length}`,
  ];

  if (proposal.skippedPaths.length > 0) {
    lines.push(`Skipped paths: ${proposal.skippedPaths.length} (see \`show\` for details)`);
  }
  lines.push(`Trust Gate: ${tgLine}`);

  // Consistency warnings: surface prominently so the reviewer sees them at approve time
  if (proposal.trustGateWarnings.length > 0) {
    const opp = opportunities.find(
      (o) => o.id === item.opportunityId && o.type === "government"
    );
    const proposedRec = opp && item.fieldDiffs.length > 0
      ? generateProposedRecord(item, opp as GovernmentRecruitment).proposed
      : undefined;
    lines.push(...formatConsistencyWarnings(proposal.trustGateWarnings, proposedRec));
  }

  // Warn about any ACKNOWLEDGE-tier warnings still missing acknowledgement —
  // the writer will refuse to commit until they are supplied.
  const unacknowledged = (proposal.trustGateWarnings ?? []).filter(
    (w) => classifyWarning(w) === "ACKNOWLEDGE" &&
           !(proposal.acknowledgedWarnings ?? []).includes(w)
  );
  if (unacknowledged.length > 0) {
    lines.push("", "⚠ Writer will refuse to commit until acknowledged:");
    for (const w of unacknowledged) {
      lines.push(`    --acknowledge "${w}"`);
    }
    lines.push("  Re-approve with the --acknowledge flag(s) above.");
  }

  lines.push("productionWrites: 0 — no canonical data written");

  // Reload to get updated item with approvedChange
  const updated = loadReviewQueue(queuePath).items.find((i) => i.id === item.id);

  return { success: true, message: lines.join("\n"), item: updated };
}

// ─── reject ───────────────────────────────────────────────────

/**
 * Rejects a PENDING review item with a required reason.
 * Does not write to src/data/.
 */
export function rejectReviewItem(
  idOrPrefix: string,
  reason: string,
  queuePath = DEFAULT_QUEUE_PATH
): CliResult {
  if (!reason || !reason.trim()) {
    return {
      success: false,
      message: "Rejection requires a reason (--reason \"...\")",
    };
  }

  const queue = loadReviewQueue(queuePath);
  const item = queue.items.find(
    (i) => i.id === idOrPrefix || i.id.startsWith(idOrPrefix)
  );

  if (!item) {
    return {
      success: false,
      message: `No review item found with ID or prefix: ${idOrPrefix}`,
    };
  }

  if (item.status !== "PENDING") {
    return {
      success: false,
      message: `Cannot reject: item is already ${statusLabel(item.status)} — only PENDING items can be rejected`,
    };
  }

  const ok = setItemStatus(item.id, "REJECTED", reason.trim(), queuePath);
  if (!ok) {
    return { success: false, message: "Rejection failed: unable to update queue" };
  }

  const updated = loadReviewQueue(queuePath).items.find((i) => i.id === item.id);

  return {
    success: true,
    message: [
      "",
      `Rejected: ${item.opportunityTitle} / ${item.changeType}`,
      `Reason: ${reason.trim()}`,
      "productionWrites: 0 — no canonical data written",
    ].join("\n"),
    item: updated,
  };
}
