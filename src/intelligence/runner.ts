// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Runner
// Phase 2B: Targeted Source Resolution + Identifier Matching
// ═══════════════════════════════════════════════════════════
//
// Run sequence:
//   Step 1  Load canonical opportunities (read-only)
//   Step 2  Trust Gate baseline check
//   Step 3  Compute preRunSnapshotRef
//   Step 4  Load previous run hashes (cross-run deduplication)
//   Step 5  Fetch all enabled sources (official + secondary)
//           Skip extraction when content hash unchanged vs. last run
//   Step 6  For each official source (Tier 1–3):
//             Extract → detect signals → filter by isRelevant →
//             compare vs canonical → create OFFICIAL_SOURCE_FOUND events
//   Step 7  For each secondary source (Tier 5) — Phase 2B:
//             Extract → detect signals (with identifiers) →
//             filter by isOpportunityMatch (requires notification number / exam
//             code within 150 chars) → create DISCOVERED events (never higher)
//             Signals with org keyword only → REJECTED AMBIGUOUS (counted, not emitted)
//   Step 8  Assess staleness (Phase 1 logic)
//   Step 9  Write audit log
//
// Secondary source gate (Phase 2B):
//   isOpportunityMatch requires a specific identifier (notification number or
//   exam code token, e.g. "72/2026", "cgl 2026") within 150 chars of the match.
//   Signals with only an org name nearby are REJECTED AMBIGUOUS — we cannot
//   tell which specific exam the article refers to on a per-org page that
//   may list multiple exams.
//
// Official source gate (Phase 2A Refinement, unchanged):
//   isRelevant requires a 4+ char org keyword within 150 chars AND ≥8 context
//   words. The page is already org-specific, so org keyword is sufficient.
//
// INVARIANT: productionWrites = 0 always.
//            No file in src/data/ is touched.
//            Secondary source signals NEVER auto-upgrade to OFFICIAL_SOURCE_FOUND.
// ═══════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { getAllOpportunities } from "@/lib/repository";
import { fetchHtmlContent, computeSnapshotRef } from "./fetcher";
import { extractTextFromHtml, detectSignals, getOpportunityKeywords, getOpportunityIdentifiers } from "./extractor";
import { compareSignalsToCanonical } from "./comparator";
import { assessStaleness, sortByUrgency } from "./staleness";
import {
  createSignalEvent,
  createStalenessCandidateEvent,
} from "./candidate-event";
import { runTrustGateBaseline } from "./trust-gate";
import { writeRunLog, loadPreviousRunHashes } from "./audit-log";
import {
  getEnabledSources,
  getEnabledSourcesForOpportunity,
} from "./source-registry";
import { confirmChange, confirmUnavailable } from "./confirmer";
import {
  createReviewItem,
  appendToReviewQueue,
  isDuplicate,
} from "./review-queue";
import type {
  IntelligenceRun,
  RunMode,
  FetchResult,
  RunError,
  RunErrorType,
  FetchStatus,
  StalenessReport,
  CandidateChangeEvent,
  ContentComparison,
  ConfirmationResult,
} from "./types";

// ─── Public Types ─────────────────────────────────────────────

export interface RunOptions {
  mode?: RunMode;
  now?: Date;              // injectable for testing; defaults to real now
  fresh?: boolean;         // bypass cross-run deduplication (re-extract all sources)
}

export interface RunResult {
  run: IntelligenceRun;
  logPath: string;
}

// ─── Runner ───────────────────────────────────────────────────

export async function executeRun(options: RunOptions = {}): Promise<RunResult> {
  const mode: RunMode = options.mode ?? "DRY_RUN";
  const fresh = options.fresh ?? false;
  const now = options.now ?? new Date();
  const runId = randomUUID();
  const startedAt = now.toISOString();
  const startMs = Date.now();

  const errors: RunError[] = [];
  const stalenessReports: StalenessReport[] = [];
  const candidateEvents: CandidateChangeEvent[] = [];
  const contentComparisons: ContentComparison[] = [];

  // ── Step 1: Load canonical data (read-only) ──────────────
  const opportunities = getAllOpportunities();

  // ── Step 2: Trust Gate baseline ─────────────────────────
  const baselineResult = runTrustGateBaseline(opportunities);
  if (!baselineResult.passed) {
    for (const tge of baselineResult.errors) {
      errors.push({
        timestamp: new Date().toISOString(),
        errorType: "INTERNAL",
        opportunityId: tge.recordId,
        message: `Trust Gate baseline: [${tge.field}] ${tge.message}`,
      });
    }
  }

  // ── Step 3: Snapshot ref ─────────────────────────────────
  const preRunSnapshotRef = computeSnapshotRef(opportunities);

  // ── Step 4: Load previous run hashes for cross-run dedup ─
  // When fresh=true, start with an empty map so all sources are re-extracted.
  // Historical audit logs are preserved; only this run's deduplication is bypassed.
  const previousHashes = fresh ? {} : loadPreviousRunHashes();

  // ── Step 5: Fetch all enabled sources ───────────────────
  // Both official (Tier 1–3) and secondary (Tier 5) sources are
  // fetched once. HTML content is cached in memory for extraction.
  // Sources whose content hash matches the previous run are skipped
  // (duplicatesSuppressed) — same page, no new information.

  const enabledSources = getEnabledSources();
  const fetchResultBySourceId = new Map<string, FetchResult>();
  const htmlBySourceId = new Map<string, string>();
  const extractedTextBySourceId = new Map<string, string>(); // Phase 3: plain text keyed by sourceId
  const sourceContentHashes: Record<string, string> = {};

  let sourcesReachable = 0;
  let sourcesFailed = 0;
  let extractionsAttempted = 0;
  let extractionsSuccessful = 0;
  let rawSignals = 0;
  let relevantSignals = 0;
  let duplicatesSuppressed = 0;
  let unconfirmedSignals = 0;
  let opportunityMatches = 0;   // Phase 2B: secondary signals with identifier in 150 chars
  let rejectedAmbiguous = 0;    // Phase 2B: secondary signals without identifier match
  const rejectedSignalExamples: IntelligenceRun["rejectedSignalExamples"] = [];
  let strongMatches    = 0;     // Phase 2C: identifier tightly bound to keyword, no closer competitor
  let moderateMatches  = 0;     // Phase 2C: identifier in zone but not tightly bound
  let ambiguousMatches = 0;     // Phase 2C: competing recruitment term is closer to keyword

  for (const source of enabledSources) {
    try {
      const { fetchResult, htmlContent } = await fetchHtmlContent(source.url, {
        rateLimitDelayMs: source.polling.rateLimitDelayMs,
      });

      fetchResultBySourceId.set(source.id, fetchResult);

      if (fetchResult.status === "OK") {
        sourcesReachable++;

        // Record hash so next run can detect unchanged sources
        if (fetchResult.contentHash) {
          sourceContentHashes[source.id] = fetchResult.contentHash;
        }

        // Cross-run dedup: if hash matches previous run, skip extraction
        const prevHash = previousHashes[source.id];
        if (prevHash && prevHash === fetchResult.contentHash) {
          duplicatesSuppressed++;
          // htmlBySourceId left empty for this source — extraction skipped
        } else if (htmlContent) {
          htmlBySourceId.set(source.id, htmlContent);
        }
      } else {
        sourcesFailed++;
        errors.push({
          timestamp: new Date().toISOString(),
          errorType: mapFetchStatus(fetchResult.status),
          sourceId: source.id,
          message:
            `${source.name}: ${fetchResult.status} — ` +
            (fetchResult.error ?? `HTTP ${fetchResult.httpStatus ?? "??"}`),
        });
      }
    } catch (err) {
      sourcesFailed++;
      errors.push({
        timestamp: new Date().toISOString(),
        errorType: "INTERNAL",
        sourceId: source.id,
        message: `Unexpected error fetching ${source.name}: ${String(err)}`,
      });
    }
  }

  // ── Steps 6 & 8: Per-opportunity processing ──────────────
  for (const opp of opportunities) {
    const linkedSources = getEnabledSourcesForOpportunity(opp.id);
    const keywords = getOpportunityKeywords(opp);

    // Phase 1 staleness assessment
    const officialSources = linkedSources.filter((s) => s.tier <= 3);
    const primaryFetchResult =
      officialSources.length > 0
        ? fetchResultBySourceId.get(officialSources[0].id)
        : undefined;

    const stalenessReport = assessStaleness(opp, now, primaryFetchResult);
    stalenessReports.push(stalenessReport);

    // Phase 1 staleness event (CANDIDATE — source reachable but stale)
    if (officialSources.length > 0) {
      const staleEvent = createStalenessCandidateEvent(
        stalenessReport,
        officialSources[0].id,
        runId
      );
      if (staleEvent !== null) {
        candidateEvents.push(staleEvent);
      }
    }

    // ── Step 6: Extract from official sources (Tier 1–3) ──
    for (const source of officialSources) {
      const htmlContent = htmlBySourceId.get(source.id);
      if (!htmlContent) continue; // skips failed fetches AND deduped sources

      extractionsAttempted++;
      const plainText = extractTextFromHtml(htmlContent);
      const wordCount = plainText.split(/\s+/).filter(Boolean).length;

      if (wordCount < 20) {
        errors.push({
          timestamp: new Date().toISOString(),
          errorType: "PARSE_ERROR",
          sourceId: source.id,
          opportunityId: opp.id,
          message: `Extracted text too short (${wordCount} words) — page may be gated or redirecting`,
        });
        continue;
      }

      extractionsSuccessful++;
      extractedTextBySourceId.set(source.id, plainText); // Phase 3: cache for confirmation pass
      const allSignals = detectSignals(plainText, keywords);
      rawSignals += allSignals.length;

      // Only relevant signals proceed to comparison and event creation.
      // isRelevant requires a 4+ char opportunity keyword within 150 chars
      // of the match AND at least 8 words of context (filters nav/headers).
      const filteredSignals = allSignals.filter((s) => s.isRelevant);
      relevantSignals += filteredSignals.length;

      const comparison = compareSignalsToCanonical(filteredSignals, opp, source.id);
      contentComparisons.push(comparison);
      if (comparison.outcome === "UNCONFIRMED") unconfirmedSignals++;

      // Emit OFFICIAL_SOURCE_FOUND events for signals that suggest change
      const fetchResult = fetchResultBySourceId.get(source.id);
      for (const signal of filteredSignals) {
        if (
          comparison.outcome === "SIGNAL_SUGGESTS_CHANGE" ||
          comparison.outcome === "UNCONFIRMED"
        ) {
          candidateEvents.push(
            createSignalEvent({
              runId,
              opportunityId: opp.id,
              sourceId: source.id,
              sourceUrl: source.url,
              sourceTier: source.tier,
              signal,
              snapshotHash: fetchResult?.contentHash,
              verificationState: "OFFICIAL_SOURCE_FOUND",
            })
          );
        }
      }
    }

    // ── Step 7: Extract from secondary sources (Tier 5) — Phase 2B ──
    // Secondary source signals are capped at DISCOVERED state.
    // Gate: isOpportunityMatch — signal must have a specific identifier
    // (notification number / exam code) within 150 chars of the pattern match.
    // Signals with org keyword only are REJECTED AMBIGUOUS.
    const secondarySources = linkedSources.filter((s) => s.tier === 5);
    const identifiers = getOpportunityIdentifiers(opp);

    for (const source of secondarySources) {
      const htmlContent = htmlBySourceId.get(source.id);
      if (!htmlContent) continue;

      extractionsAttempted++;
      const plainText = extractTextFromHtml(htmlContent);
      const wordCount = plainText.split(/\s+/).filter(Boolean).length;

      if (wordCount < 20) continue;

      extractionsSuccessful++;
      // Pass identifiers so detectSignals can compute isOpportunityMatch
      const allSignals = detectSignals(plainText, keywords, identifiers);
      rawSignals += allSignals.length;

      const fetchResult = fetchResultBySourceId.get(source.id);
      for (const signal of allSignals) {
        if (signal.isOpportunityMatch) {
          // Specific identifier found in strict zone — emit DISCOVERED event
          opportunityMatches++;
          // Phase 2C: track disambiguation breakdown
          if      (signal.disambiguationScore === "STRONG")   strongMatches++;
          else if (signal.disambiguationScore === "MODERATE") moderateMatches++;
          else if (signal.disambiguationScore === "AMBIGUOUS") ambiguousMatches++;
          candidateEvents.push(
            createSignalEvent({
              runId,
              opportunityId: opp.id,
              sourceId: source.id,
              sourceUrl: source.url,
              sourceTier: source.tier,         // Tier 5 enforces DISCOVERED in factory
              signal,
              snapshotHash: fetchResult?.contentHash,
              verificationState: "DISCOVERED", // cap; factory also enforces this
            })
          );
        } else {
          // Org keyword nearby but no specific identifier — REJECTED AMBIGUOUS.
          // We cannot tell which exam this article covers; do not emit an event.
          rejectedAmbiguous++;
          if (rejectedSignalExamples.length < 5) {
            rejectedSignalExamples.push({
              opportunityId: opp.id,
              sourceId: source.id,
              sourceUrl: source.url,
              signalType: signal.signalType,
              matchedText: signal.matchedText.slice(0, 250),
            });
          }
        }
      }
    }
  }

  // ── Step 8.5: Phase 3 — Official confirmation for DISCOVERED events ──
  // For each DISCOVERED event from Step 7, check whether the official source
  // for the same opportunity confirms the change.
  // Uses already-extracted text from Step 6 — no new network requests.
  //
  // INVARIANT: productionWrites remains 0. Canonical data is not modified.
  //            If CONFIRMED_CHANGE: event.verificationState advances to
  //            OFFICIAL_SOURCE_FOUND (but src/data/ is never touched).

  const officialConfirmations: ConfirmationResult[] = [];
  let confirmedChanges = 0;
  let notConfirmed = 0;
  let ambiguousConfirmations = 0;
  let officiallyUnavailable = 0;

  const discoveredEvents = candidateEvents.filter(
    (e) => e.verificationState === "DISCOVERED"
  );

  for (const event of discoveredEvents) {
    const opp = opportunities.find((o) => o.id === event.opportunityId);
    if (!opp) continue;

    // Sort official sources by tier ascending so most-authoritative is tried first
    const officialSrcs = getEnabledSourcesForOpportunity(opp.id)
      .filter((s) => s.tier <= 3)
      .sort((a, b) => a.tier - b.tier);

    if (officialSrcs.length === 0) continue;

    let eventHandled = false;
    for (const officialSrc of officialSrcs) {
      const officialText = extractedTextBySourceId.get(officialSrc.id);
      if (!officialText) {
        // Official source was unavailable (timeout, block, or deduped) during Step 6
        const result = confirmUnavailable(event, opp, officialSrc.id, officialSrc.url);
        officialConfirmations.push(result);
        event.confirmationResult = result;
        officiallyUnavailable++;
        // Don't break — try next official source if available
        continue;
      }

      const result = confirmChange({
        discoveredEvent: event,
        opportunity: opp,
        officialSourceText: officialText,
        officialSourceId: officialSrc.id,
        officialSourceUrl: officialSrc.url,
      });

      officialConfirmations.push(result);
      event.confirmationResult = result;

      if (result.outcome === "CONFIRMED_CHANGE") {
        confirmedChanges++;
        // Advance verification state — still read-only relative to canonical data
        event.verificationState = "OFFICIAL_SOURCE_FOUND";
        eventHandled = true;
        break; // confirmed — no need to check other official sources
      } else if (result.outcome === "NOT_CONFIRMED") {
        notConfirmed++;
        eventHandled = true;
        break;
      } else if (result.outcome === "AMBIGUOUS_CONFIRMATION") {
        ambiguousConfirmations++;
        eventHandled = true;
        break;
      }
    }
    void eventHandled;
  }

  // ── Step 8.6: Phase 4 — Build Change Review Queue ───────
  // For each CONFIRMED_CHANGE event, create a ReviewItem and append it
  // to intelligence-runs/review-queue.json — unless an item with the
  // same dedupKey already exists (same logical change from a prior run).
  //
  // INVARIANT: productionWrites remains 0. src/data/ is never touched.
  //            APPROVED status on a ReviewItem is a human annotation only.

  let reviewItemsAdded = 0;
  let reviewDuplicatesSuppressed = 0;

  const confirmedEvents = candidateEvents.filter(
    (e) => e.verificationState === "OFFICIAL_SOURCE_FOUND"
  );

  for (const event of confirmedEvents) {
    const found = opportunities.find((o) => o.id === event.opportunityId);
    if (!found || found.type !== "government" || !event.confirmationResult) continue;
    const opp = found;

    const officialSrc = getEnabledSourcesForOpportunity(opp.id)
      .filter((s) => s.tier <= 3)
      .sort((a, b) => a.tier - b.tier)[0];
    const officialText = officialSrc
      ? (extractedTextBySourceId.get(officialSrc.id) ?? "")
      : "";

    const item = createReviewItem({
      event,
      opportunity: opp,
      confirmation: event.confirmationResult,
      preRunSnapshotRef,
      officialText,
    });

    if (isDuplicate(item.dedupKey)) {
      reviewDuplicatesSuppressed++;
    } else {
      appendToReviewQueue(item);
      reviewItemsAdded++;
    }
  }

  // ── Step 9: Finalize run record ─────────────────────────
  const sorted = sortByUrgency(stalenessReports);
  const staleRecords = sorted.filter((r) => r.isStale);
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const run: IntelligenceRun = {
    runId,
    startedAt,
    completedAt,
    durationMs,
    mode,
    status:
      sourcesFailed > 0 && sourcesReachable === 0 ? "FAILED" : "COMPLETED",

    preRunSnapshotRef,

    sourcesConfigured: enabledSources.length,
    sourcesEnabled: enabledSources.length,
    sourcesChecked: enabledSources.length,
    sourcesReachable,
    sourcesFailed,

    opportunitiesChecked: opportunities.length,
    staleRecords: staleRecords.length,
    staleRecordIds: staleRecords.map((r) => r.opportunityId),

    candidateEventsDetected: candidateEvents.length,
    candidateEventsVerified: confirmedChanges,
    candidateEventsRejected: 0,

    productionWrites: 0,          // always 0 in Phase 1 & 2A

    extractionsAttempted,
    extractionsSuccessful,
    contentComparisons,

    sourceContentHashes,
    rawSignals,
    relevantSignals,
    duplicatesSuppressed,
    unconfirmedSignals,
    opportunityMatches,
    rejectedAmbiguous,
    rejectedSignalExamples,
    strongMatches,
    moderateMatches,
    ambiguousMatches,

    officialConfirmations,
    confirmedChanges,
    notConfirmed,
    ambiguousConfirmations,
    officiallyUnavailable,

    reviewItemsAdded,
    reviewDuplicatesSuppressed,

    errors,
    stalenessReports: sorted,
    candidateEvents,
  };

  // ── Step 10: Write audit log ─────────────────────────────
  const logPath = writeRunLog(run);

  return { run, logPath };
}

// ─── Helpers ──────────────────────────────────────────────────

function mapFetchStatus(status: FetchStatus): RunErrorType {
  switch (status) {
    case "TIMEOUT":      return "FETCH_TIMEOUT";
    case "BLOCKED":      return "FETCH_BLOCKED";
    case "RATE_LIMITED": return "RATE_LIMITED";
    default:             return "FETCH_FAILED";
  }
}
