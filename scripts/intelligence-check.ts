#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine CLI
// npm run intelligence:check
// ═══════════════════════════════════════════════════════════
// Phase 2B: Targeted Source Resolution + Identifier Matching
//
// Output sections:
//   RUN SUMMARY
//   SOURCE HEALTH
//   TARGETED DISCOVERY       (per-org Tier 5 sources — raw vs opportunity match)
//   IDENTIFIER MATCHING      (signal-level: opportunity matches vs rejected ambiguous)
//   OFFICIAL CONFIRMATIONS   (Tier 1–3 comparison outcomes)
//   OFFICIAL SOURCE RESOLUTION  (which official source was checked per opportunity)
//   CHANGE DETECTION         (comparison outcome breakdown)
//   DUPLICATES SUPPRESSED    (sources with unchanged content hash)
//   UNCONFIRMED
//   CANDIDATE EVENTS
//   STALENESS REPORT
//   ERRORS / WARNINGS
//   PRODUCTION WRITE GUARD
//   AUDIT LOG
//
// INVARIANT: productionWrites = 0 always printed at the end.
// ═══════════════════════════════════════════════════════════

import { executeRun } from "@/intelligence/runner";
import { formatRunSummaryLine } from "@/intelligence/audit-log";
import { getSourceById } from "@/intelligence/source-registry";
import { getAllOpportunities } from "@/lib/repository";
import { loadReviewQueue } from "@/intelligence/review-queue";
import type { StalenessReport } from "@/intelligence/types";

// ─── Terminal colors ──────────────────────────────────────────

const R  = "\x1b[0m";
const B  = "\x1b[1m";
const DIM = "\x1b[2m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN  = "\x1b[32m";
const CYAN   = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const WHITE  = "\x1b[37m";

const c = (...codes: string[]) => (text: string) => codes.join("") + text + R;

const bold    = c(B);
const dim     = c(DIM);
const red     = c(RED);
const yellow  = c(YELLOW);
const green   = c(GREEN);
const cyan    = c(CYAN);
const magenta = c(MAGENTA);
const boldRed    = c(B, RED);
const boldGreen  = c(B, GREEN);
const boldYellow = c(B, YELLOW);
const boldCyan   = c(B, CYAN);

void WHITE; // suppress unused warning

function hr(char = "─", width = 70): string { return char.repeat(width); }

function priorityLabel(priority: string): string {
  switch (priority) {
    case "WATCH":    return boldRed(priority);
    case "HIGH":     return boldYellow(priority);
    case "NORMAL":   return c(WHITE)(priority);
    case "LOW":
    case "MINIMAL":
    case "ARCHIVED": return dim(priority);
    default:         return priority;
  }
}

function staleLabel(report: StalenessReport): string {
  return report.isStale
    ? boldRed(`STALE (${report.daysSinceVerification}d > ${report.staleThresholdDays}d)`)
    : green(`OK (${report.daysSinceVerification}d ≤ ${report.staleThresholdDays}d)`);
}

function sourceLabel(report: StalenessReport): string {
  if (!report.fetchResult) return dim("NO FETCH");
  const s = report.fetchResult.status;
  if (s === "OK") return green(`OK (${report.fetchResult.responseTimeMs}ms)`);
  return yellow(s);
}

function disambiguationLabel(score: string | undefined): string {
  switch (score) {
    case "STRONG":   return boldGreen("STRONG");
    case "MODERATE": return yellow("MODERATE");
    case "AMBIGUOUS": return boldRed("AMBIGUOUS");
    default: return dim("(unscored)");
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case "OFFICIAL_SOURCE_FOUND": return boldCyan(state);
    case "DISCOVERED":            return magenta(state);
    case "CANDIDATE":             return yellow(state);
    case "VERIFIED":              return boldGreen(state);
    case "REJECTED":              return dim(state);
    default:                      return state;
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "SIGNAL_SUGGESTS_CHANGE":        return boldRed("SUGGESTS CHANGE");
    case "SIGNAL_CONFIRMS_CURRENT_STATE": return green("CONFIRMS CURRENT STATE");
    case "HASH_CHANGED_NO_SIGNAL":        return yellow("HASH CHANGED — NO KEYWORD");
    case "UNCONFIRMED":                   return yellow("UNCONFIRMED");
    case "NO_SIGNAL":                     return dim("NO SIGNAL");
    default:                              return outcome;
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh");

  console.log();
  console.log(boldCyan("Career Campus — Recruitment Intelligence Engine"));
  console.log(dim("Phase 3: Official Source Confirmation + Field-Level Change Detection (DRY_RUN — READ ONLY)"));
  if (fresh) {
    console.log(boldYellow("  ⚑ --fresh: deduplication bypassed — all sources re-extracted (historical logs preserved)"));
  }
  console.log(hr("═"));
  console.log();

  let result;
  try {
    result = await executeRun({ mode: "DRY_RUN", fresh });
  } catch (err) {
    console.error(boldRed(`\nFATAL: Runner threw an unexpected error: ${String(err)}`));
    process.exit(1);
  }

  const { run, logPath } = result;

  // Build opportunity lookup for rich reporting
  const opportunities = getAllOpportunities();
  const oppById = new Map(opportunities.map((o) => [o.id, o]));

  const officialEvents = run.candidateEvents.filter(
    (e) => e.verificationState === "OFFICIAL_SOURCE_FOUND"
  );
  const discoveredEvents = run.candidateEvents.filter(
    (e) => e.verificationState === "DISCOVERED"
  );
  const stalenessEvents = run.candidateEvents.filter(
    (e) => e.verificationState === "CANDIDATE"
  );

  // ── RUN SUMMARY ──────────────────────────────────────────
  console.log(bold("RUN SUMMARY"));
  console.log(hr());
  console.log(`  Run ID    : ${run.runId}`);
  console.log(`  Mode      : ${bold(run.mode)}`);
  console.log(`  Status    : ${run.status === "COMPLETED" ? green(run.status) : yellow(run.status)}`);
  console.log(`  Started   : ${run.startedAt}`);
  console.log(`  Duration  : ${((run.durationMs ?? 0) / 1000).toFixed(1)}s`);
  console.log(`  Snapshot  : ${dim(run.preRunSnapshotRef)}`);
  console.log();

  // ── SOURCE HEALTH ─────────────────────────────────────────
  console.log(bold("SOURCE HEALTH"));
  console.log(hr());
  console.log(`  Enabled   : ${run.sourcesEnabled}`);
  console.log(`  Reachable : ${
    run.sourcesReachable === run.sourcesEnabled
      ? green(String(run.sourcesReachable))
      : yellow(String(run.sourcesReachable))
  } / ${run.sourcesEnabled}`);
  console.log(`  Failed    : ${
    run.sourcesFailed > 0 ? yellow(String(run.sourcesFailed)) : green("0")
  }`);
  console.log(`  Deduped   : ${
    run.duplicatesSuppressed > 0
      ? dim(`${run.duplicatesSuppressed} source(s) had unchanged content — extraction skipped`)
      : green("0 (all sources have fresh content)")
  }`);
  console.log();

  // ── TARGETED DISCOVERY (secondary Tier 5) ────────────────
  console.log(bold("TARGETED DISCOVERY"));
  console.log(hr());
  console.log(dim("  Secondary sources (Tier 5) — per-org targeted pages, raw signal counts"));
  console.log();

  const secondaryRawCount = run.rawSignals;
  const secondaryMatchCount = run.opportunityMatches;    // identifier matched
  const secondaryRejectedCount = run.rejectedAmbiguous;  // org keyword only

  console.log(`  Raw secondary signals    : ${secondaryRawCount > 0 ? yellow(String(secondaryRawCount)) : "0"}`);
  console.log(`  Opportunity matches      : ${
    secondaryMatchCount > 0 ? magenta(String(secondaryMatchCount)) : green("0")
  } (identifier found in 150-char strict zone — DISCOVERED events emitted)`);
  console.log(`  Rejected ambiguous       : ${
    secondaryRejectedCount > 0
      ? dim(`${secondaryRejectedCount} (org keyword present but no specific identifier in 150-char zone)`)
      : green("0")
  }`);
  console.log();

  if (discoveredEvents.length === 0) {
    console.log(dim("  No opportunity-matched discovery signals this run"));
  } else {
    for (const ev of discoveredEvents) {
      const opp = oppById.get(ev.opportunityId);
      const src = getSourceById(ev.sourceId);
      console.log(`  ${magenta("⬡")} ${bold("OPPORTUNITY MATCH")}`);
      console.log(`    Organization  : ${opp?.organizationName ?? ev.opportunityId}`);
      console.log(`    Opportunity   : ${opp?.title ?? ev.opportunityId}`);
      console.log(`    Identifier    : ${ev.matchedIdentifier ? magenta(ev.matchedIdentifier) : dim("(not recorded)")}`);
      console.log(`    Source URL    : ${cyan(ev.sourceUrl)}`);
      console.log(`      Source name : ${src?.name ?? ev.sourceId} (Tier ${ev.sourceTier})`);
      console.log(`    Signal type   : ${yellow(ev.eventType)}`);
      console.log(`    Confidence    : ${(ev.confidence ?? 0).toFixed(2)}`);
      console.log(`    State         : ${stateLabel(ev.verificationState)}`);
      if (ev.disambiguationScore) {
        const disamNote = ev.disambiguationScore === "AMBIGUOUS" && ev.competitorTerm
          ? ` — competitor "${ev.competitorTerm}" is closer to the keyword`
          : ev.disambiguationScore === "MODERATE"
          ? " — identifier in window but not tightly bound"
          : "";
        console.log(`    Disambiguation: ${disambiguationLabel(ev.disambiguationScore)}${disamNote}`);
      }
      console.log(`    Review        : ${yellow("PENDING")} — human review required`);
      if (ev.rawSignal) {
        console.log(`    Context:`);
        console.log(`      ${dim(ev.rawSignal.slice(0, 220))}`);
      }
      console.log();
    }
  }

  // ── IDENTIFIER MATCHING ───────────────────────────────────
  console.log(bold("IDENTIFIER MATCHING"));
  console.log(hr());
  console.log(dim("  Phase 2B gate: secondary source signal accepted only when a specific"));
  console.log(dim("  identifier (notification number / exam code) appears within 150 chars."));
  console.log(dim("  Signals with org keyword only → REJECTED AMBIGUOUS (not emitted)."));
  console.log();
  console.log(`  Opportunity matches (accepted) : ${
    secondaryMatchCount > 0 ? boldCyan(String(secondaryMatchCount)) : green("0")
  }`);
  console.log(`  Rejected ambiguous             : ${
    secondaryRejectedCount > 0 ? dim(String(secondaryRejectedCount)) : green("0")
  }`);
  if (secondaryRawCount > 0) {
    const matchPct = secondaryRawCount > 0
      ? ((secondaryMatchCount / secondaryRawCount) * 100).toFixed(0)
      : "0";
    console.log(`  Precision                      : ${matchPct}% of raw secondary signals became events`);
  }
  console.log();

  // ── REJECTED AMBIGUOUS EXAMPLES ───────────────────────────
  if (run.rejectedSignalExamples.length > 0) {
    console.log(bold("REJECTED SIGNAL EXAMPLES"));
    console.log(hr());
    console.log(dim("  These signals had an org keyword in context but NO specific identifier"));
    console.log(dim("  in the 150-char window. They were counted but not emitted as events."));
    console.log(dim("  Example: 'BPSC postponed' without '72nd' or '72/2026' nearby."));
    console.log();
    for (const ex of run.rejectedSignalExamples) {
      const opp = oppById.get(ex.opportunityId);
      const src = getSourceById(ex.sourceId);
      console.log(`  ${dim("✗")} ${yellow(ex.signalType)}`);
      console.log(`    Opportunity : ${opp?.title ?? ex.opportunityId}`);
      console.log(`    Source      : ${src?.name ?? ex.sourceId}`);
      console.log(`    Context     : ${dim(ex.matchedText.slice(0, 200))}`);
      console.log();
    }
  }

  // ── PHASE 3: OFFICIAL SOURCE CONFIRMATION ────────────────
  console.log(bold("PHASE 3: OFFICIAL SOURCE CONFIRMATION"));
  console.log(hr());
  console.log(dim("  For each DISCOVERED event (Tier 5), checked whether the Tier 1–3 official"));
  console.log(dim("  source confirms the change — identifier + change keyword within 200 chars."));
  console.log();

  const confirmedLabel = (n: number) =>
    n > 0 ? boldGreen(String(n)) : dim("0");

  console.log(`  DISCOVERED events         : ${discoveredEvents.length > 0 ? magenta(String(discoveredEvents.length)) : dim("0")}`);
  console.log(`  Confirmed changes         : ${confirmedLabel(run.confirmedChanges)}`);
  console.log(`  Not confirmed             : ${run.notConfirmed > 0 ? yellow(String(run.notConfirmed)) : dim("0")} (official page is about our exam but change absent)`);
  console.log(`  Ambiguous confirmations   : ${run.ambiguousConfirmations > 0 ? yellow(String(run.ambiguousConfirmations)) : dim("0")} (identifier or keyword missing, or > 200 chars apart)`);
  console.log(`  Official unavailable      : ${run.officiallyUnavailable > 0 ? yellow(String(run.officiallyUnavailable)) : dim("0")} (official source not fetchable)`);
  console.log();

  if (run.officialConfirmations.length === 0) {
    console.log(dim("  No confirmation attempts this run"));
  } else {
    for (const conf of run.officialConfirmations) {
      const opp = oppById.get(conf.opportunityId);
      const outcomeStr =
        conf.outcome === "CONFIRMED_CHANGE"   ? boldGreen("CONFIRMED_CHANGE") :
        conf.outcome === "NOT_CONFIRMED"      ? yellow("NOT_CONFIRMED") :
        conf.outcome === "AMBIGUOUS_CONFIRMATION" ? yellow("AMBIGUOUS") :
        dim("OFFICIAL_UNAVAILABLE");
      console.log(`  ${outcomeStr}`);
      console.log(`    Opportunity      : ${opp?.title ?? conf.opportunityId}`);
      console.log(`    Official source  : ${conf.officialSourceId}`);
      console.log(`    Identifier found : ${conf.identifierConfirmed ? green("yes") : red("no")}`);
      console.log(`    Change confirmed : ${conf.changeTypeConfirmed ? green("yes") : red("no")}`);
      console.log(`    Proximity (200c) : ${conf.proximityConfirmed ? green("yes") : dim("no")}`);
      if (conf.fieldDiffs.length > 0) {
        console.log(`    Field diffs      : ${boldCyan(String(conf.fieldDiffs.length))}`);
        for (const diff of conf.fieldDiffs) {
          console.log(`      ${cyan(diff.field)}`);
          console.log(`        canonical : ${dim(diff.canonicalValue)}`);
          console.log(`        observed  : ${boldYellow(diff.observedValue)}`);
          console.log(`        confidence: ${diff.confidence.toFixed(2)}`);
        }
      } else if (conf.outcome === "CONFIRMED_CHANGE") {
        console.log(`    Field diffs      : ${dim("0 — structural change confirmed but no field value extracted")}`);
      }
      if (conf.notes) {
        console.log(`    Notes            : ${dim(conf.notes)}`);
      }
      console.log();
    }
  }

  // ── OFFICIAL CONFIRMATIONS (Tier 1–3) ────────────────────
  console.log(bold("OFFICIAL CONTENT COMPARISONS"));
  console.log(hr());
  console.log(dim("  Official sources (Tier 1–3) — relevant signals compared to canonical records"));
  console.log();
  console.log(`  Extractions attempted  : ${run.extractionsAttempted}`);
  console.log(`  Extractions successful : ${
    run.extractionsSuccessful === run.extractionsAttempted
      ? green(String(run.extractionsSuccessful))
      : yellow(String(run.extractionsSuccessful))
  }`);
  console.log();

  if (run.contentComparisons.length === 0) {
    console.log(dim("  No content comparisons (no reachable official sources produced extractable text)"));
  } else {
    for (const cmp of run.contentComparisons) {
      const label = outcomeLabel(cmp.outcome);
      const src = getSourceById(cmp.sourceId);
      console.log(`  ${bold(cmp.opportunityId)}`);
      console.log(`    Source  : ${src?.name ?? cmp.sourceId}`);
      console.log(`    Outcome : ${label}`);
      if (cmp.signals.length > 0) {
        for (const sig of cmp.signals) {
          const relevanceTag = sig.isRelevant ? "" : dim(" [GENERIC]");
          console.log(`    Signal  : ${yellow(sig.signalType)} [${sig.patternId}] conf=${sig.confidence.toFixed(2)}${relevanceTag}`);
          console.log(`    Snippet : ${dim(sig.matchedText.slice(0, 120))}`);
        }
      }
      if (cmp.notes) {
        console.log(`    Notes   : ${dim(cmp.notes.slice(0, 100))}`);
      }
      console.log();
    }
  }

  // ── OFFICIAL SOURCE RESOLUTION ───────────────────────────
  console.log(bold("OFFICIAL SOURCE RESOLUTION"));
  console.log(hr());
  console.log(dim("  Which Tier 1–3 source was checked per opportunity, and its reach state."));
  console.log();
  if (run.stalenessReports.length === 0) {
    console.log(dim("  No staleness reports available"));
  } else {
    for (const rep of run.stalenessReports) {
      const fetchStatus = rep.fetchResult?.status ?? "NOT_FETCHED";
      const statusLabel =
        fetchStatus === "OK" ? green("OK") : yellow(fetchStatus);
      console.log(`  ${bold(rep.opportunityId)}`);
      console.log(`    Official source : ${rep.primarySourceUrl ?? dim("unknown")}`);
      console.log(`    Fetch status    : ${statusLabel}`);
      if (rep.fetchResult?.responseTimeMs !== undefined) {
        console.log(`    Response time   : ${rep.fetchResult.responseTimeMs}ms`);
      }
      console.log();
    }
  }

  // ── CHANGE DETECTION ──────────────────────────────────────
  console.log(bold("CHANGE DETECTION"));
  console.log(hr());
  console.log(dim("  Comparison outcome breakdown across all official source checks."));
  console.log();
  const outcomeCounts: Record<string, number> = {};
  for (const cmp of run.contentComparisons) {
    outcomeCounts[cmp.outcome] = (outcomeCounts[cmp.outcome] ?? 0) + 1;
  }
  if (Object.keys(outcomeCounts).length === 0) {
    console.log(dim("  No comparisons performed"));
  } else {
    for (const [outcome, count] of Object.entries(outcomeCounts)) {
      console.log(`  ${outcomeLabel(outcome).padEnd(50)} × ${count}`);
    }
  }
  console.log();

  // ── DUPLICATES SUPPRESSED ─────────────────────────────────
  console.log(bold("DUPLICATES SUPPRESSED"));
  console.log(hr());
  if (run.duplicatesSuppressed === 0) {
    console.log(green("  0 — all sources returned fresh content (no hash matches from previous run)"));
  } else {
    console.log(`  ${yellow(String(run.duplicatesSuppressed))} source(s) had identical content vs. previous run`);
    console.log(dim("  Extraction skipped — same page, no new information. Signals from last run still apply."));
  }
  console.log();

  // ── UNCONFIRMED ───────────────────────────────────────────
  console.log(bold("UNCONFIRMED"));
  console.log(hr());
  const unconfirmedComps = run.contentComparisons.filter((c) => c.outcome === "UNCONFIRMED");
  if (unconfirmedComps.length === 0) {
    console.log(dim("  0 — no official source signals with UNCONFIRMED comparison outcome"));
  } else {
    console.log(`  ${yellow(String(unconfirmedComps.length))} official signal(s) could not be matched to a canonical field:`);
    for (const cmp of unconfirmedComps) {
      console.log(`    ${cmp.opportunityId} — ${cmp.suggestedEventTypes.join(", ")}`);
    }
  }
  console.log();

  // ── CANDIDATE EVENTS ──────────────────────────────────────
  console.log(bold("CANDIDATE EVENTS"));
  console.log(hr());
  console.log(`  Official source events : ${officialEvents.length > 0 ? boldYellow(String(officialEvents.length)) : green("0")}`);
  console.log(`  Discovery events       : ${discoveredEvents.length > 0 ? magenta(String(discoveredEvents.length)) : green("0")}`);
  console.log(`  Staleness events       : ${stalenessEvents.length > 0 ? yellow(String(stalenessEvents.length)) : "0"}`);
  console.log(`  Total detected         : ${run.candidateEventsDetected > 0 ? boldYellow(String(run.candidateEventsDetected)) : green("0")}`);
  console.log();

  if (run.candidateEvents.length > 0) {
    for (const ev of run.candidateEvents) {
      console.log(`  ${stateLabel(ev.verificationState)} ${dim(ev.id.slice(4, 12))}`);
      console.log(`    Type      : ${ev.eventType}`);
      console.log(`    Record    : ${ev.opportunityId}`);
      console.log(`    Source    : ${ev.sourceId} (Tier ${ev.sourceTier})`);
      console.log(`    Confidence: ${ev.confidence !== undefined ? ev.confidence.toFixed(2) : "—"}`);
      console.log(`    Review    : ${yellow("PENDING")} — human review required`);
      if (ev.rawSignal) {
        console.log(`    Signal    : ${dim(ev.rawSignal.slice(0, 120))}`);
      }
      console.log();
    }
  }

  // ── STALENESS REPORT ──────────────────────────────────────
  console.log(bold("STALENESS REPORT"));
  console.log(hr());
  console.log(`  Records checked : ${run.opportunitiesChecked}`);
  console.log(`  Stale records   : ${run.staleRecords > 0 ? boldRed(String(run.staleRecords)) : green("0")}`);
  console.log();

  for (const rep of run.stalenessReports) {
    const dot = rep.isStale ? boldRed("●") : dim("○");
    console.log(`  ${dot} ${bold(rep.opportunityTitle)}`);
    console.log(`      Priority : ${priorityLabel(rep.priority)} — ${rep.priorityReason}`);
    console.log(`      Staleness: ${staleLabel(rep)}`);
    console.log(`      Source   : ${sourceLabel(rep)}`);
    console.log();
  }

  // ── ERRORS ────────────────────────────────────────────────
  if (run.errors.length > 0) {
    console.log(bold("ERRORS / WARNINGS"));
    console.log(hr());
    for (const err of run.errors) {
      const tag =
        err.errorType === "INTERNAL"
          ? red(`[${err.errorType}]`)
          : yellow(`[${err.errorType}]`);
      console.log(`  ${tag} ${err.message}`);
    }
    console.log();
  }

  // ── PHASE 4: CHANGE REVIEW QUEUE ─────────────────────────
  console.log(bold("PHASE 4: CHANGE REVIEW QUEUE"));
  console.log(hr());
  console.log(dim("  Confirmed changes queued for human review."));
  console.log(dim("  APPROVE / REJECT / NEEDS_REVIEW — approval does NOT write to canonical data."));
  console.log();

  const reviewQueue = loadReviewQueue();
  const queuePending   = reviewQueue.items.filter((i) => i.status === "PENDING");
  const queueApproved  = reviewQueue.items.filter((i) => i.status === "APPROVED");
  const queueRejected  = reviewQueue.items.filter((i) => i.status === "REJECTED");
  const queueNeedsReview = reviewQueue.items.filter((i) => i.status === "NEEDS_REVIEW");

  console.log(`  This run added      : ${run.reviewItemsAdded > 0 ? boldGreen(String(run.reviewItemsAdded)) : dim("0")}`);
  console.log(`  Duplicates skipped  : ${run.reviewDuplicatesSuppressed > 0 ? dim(String(run.reviewDuplicatesSuppressed)) : dim("0")}`);
  console.log();
  console.log(`  Queue total         : ${reviewQueue.items.length}`);
  console.log(`    PENDING           : ${queuePending.length > 0 ? boldYellow(String(queuePending.length)) : dim("0")}`);
  console.log(`    APPROVED          : ${queueApproved.length > 0 ? boldGreen(String(queueApproved.length)) : dim("0")} (note: approval does not write canonical data)`);
  console.log(`    REJECTED          : ${queueRejected.length > 0 ? dim(String(queueRejected.length)) : dim("0")}`);
  console.log(`    NEEDS_REVIEW      : ${queueNeedsReview.length > 0 ? yellow(String(queueNeedsReview.length)) : dim("0")}`);
  console.log();

  if (queuePending.length > 0) {
    console.log(dim("  Pending items:"));
    for (const item of queuePending) {
      const opp = oppById.get(item.opportunityId);
      console.log(`  ${boldYellow("⧖")} ${bold(item.changeType)}`);
      console.log(`    Opportunity : ${opp?.title ?? item.opportunityTitle}`);
      console.log(`    Identifier  : ${magenta(item.matchedIdentifier)}`);
      if (item.oldValue && item.newValue) {
        console.log(`    Change      : ${dim(item.oldValue)} → ${boldYellow(item.newValue)}`);
      }
      console.log(`    Confidence  : ${(item.confidence).toFixed(2)}`);
      console.log(`    Official src: ${cyan(item.officialConfirmationSource)}`);
      console.log(`    Evidence    : ${dim(item.officialEvidence.slice(0, 200))}`);
      console.log(`    Queued at   : ${item.queuedAt}`);
      console.log(`    ID          : ${dim(item.id)}`);
      console.log();
    }
  } else {
    console.log(dim("  No pending review items"));
  }
  console.log();

  // ── PRODUCTION WRITE GUARD ────────────────────────────────
  console.log(bold("PRODUCTION WRITE GUARD"));
  console.log(hr());
  if (run.productionWrites === 0) {
    console.log(boldGreen("  ✓ productionWrites = 0"));
    console.log(green("  ✓ No file in src/data/ was modified"));
    console.log(green("  ✓ No canonical record was changed"));
    console.log(green("  ✓ No database update was performed"));
    console.log(green("  ✓ No website change was triggered"));
    console.log(green("  ✓ Secondary source signals capped at DISCOVERED"));
    console.log(green("  ✓ Secondary signals without specific identifier → REJECTED AMBIGUOUS (not emitted)"));
    console.log(green("  ✓ Official source gate: org keyword in 150 chars (isRelevant)"));
    console.log(green("  ✓ Secondary source gate: notification number / exam code in 150 chars (isOpportunityMatch)"));
    console.log(green("  ✓ All candidate events require human review"));
    console.log(green("  ✓ Phase 3 confirmation: field diffs are hypotheses only — no canonical write"));
    console.log(green("  ✓ Phase 4 queue: review items are audit state only — APPROVE does not write canonical data"));
  } else {
    console.error(boldRed(`  ✗ UNEXPECTED: productionWrites = ${run.productionWrites}`));
    process.exit(1);
  }
  console.log();

  // ── SIGNAL QUALITY SUMMARY ────────────────────────────────
  console.log(bold("SIGNAL QUALITY SUMMARY"));
  console.log(hr());
  console.log(`  Raw signals (all sources)  : ${run.rawSignals}`);
  console.log();
  console.log(dim("  Official sources (Tier 1–3) — isRelevant gate:"));
  console.log(`    Relevant signals         : ${
    run.relevantSignals > 0 ? green(String(run.relevantSignals)) : dim("0")
  } (4+ char keyword in 150-char window, ≥8 context words)`);
  console.log();
  console.log(dim("  Secondary sources (Tier 5) — isOpportunityMatch gate:"));
  console.log(`    Opportunity matches      : ${
    run.opportunityMatches > 0 ? boldCyan(String(run.opportunityMatches)) : dim("0")
  } (identifier found in 150-char zone → DISCOVERED)`);
  console.log(`    Rejected ambiguous       : ${
    run.rejectedAmbiguous > 0 ? dim(String(run.rejectedAmbiguous)) : green("0")
  } (org keyword only — cannot identify specific exam)`);
  console.log();
  console.log(dim("  Phase 2C — entity disambiguation breakdown (of opportunity matches):"));
  console.log(`    Strong (identifier tightly bound)  : ${
    run.strongMatches    > 0 ? boldGreen(String(run.strongMatches))    : dim("0")
  }`);
  console.log(`    Moderate (identifier in zone)      : ${
    run.moderateMatches  > 0 ? yellow(String(run.moderateMatches))     : dim("0")
  }`);
  console.log(`    Ambiguous (competitor term closer) : ${
    run.ambiguousMatches > 0 ? boldRed(String(run.ambiguousMatches))   : dim("0")
  }`);
  console.log();
  console.log(`  Deduped sources            : ${run.duplicatesSuppressed} (content hash unchanged vs. last run)`);
  console.log(`  Unconfirmed                : ${run.unconfirmedSignals} (no canonical field to compare)`);
  console.log(`  Events emitted             : ${run.candidateEventsDetected}`);
  console.log();
  console.log(dim("  Phase 3 — official confirmation of DISCOVERED events:"));
  console.log(`    Confirmed changes        : ${run.confirmedChanges > 0 ? boldGreen(String(run.confirmedChanges)) : dim("0")} (identifier + keyword within 200 chars → OFFICIAL_SOURCE_FOUND)`);
  console.log(`    Not confirmed            : ${run.notConfirmed > 0 ? yellow(String(run.notConfirmed)) : dim("0")}`);
  console.log(`    Ambiguous                : ${run.ambiguousConfirmations > 0 ? yellow(String(run.ambiguousConfirmations)) : dim("0")}`);
  console.log(`    Official unavailable     : ${run.officiallyUnavailable > 0 ? yellow(String(run.officiallyUnavailable)) : dim("0")}`);
  console.log(`  productionWrites           : ${boldGreen("0")}`);
  console.log();

  // ── AUDIT LOG ─────────────────────────────────────────────
  console.log(bold("AUDIT LOG"));
  console.log(hr());
  console.log(`  Written to : ${cyan(logPath)}`);
  console.log();
  console.log(dim(formatRunSummaryLine(run)));
  console.log();

  if (run.status === "FAILED") process.exit(2);
}

main().catch((err) => {
  console.error(boldRed(`\nUnhandled error: ${String(err)}`));
  process.exit(1);
});
