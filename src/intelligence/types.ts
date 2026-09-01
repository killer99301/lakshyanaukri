// ═══════════════════════════════════════════════════════════
// Career Campus — Recruitment Intelligence Engine Types
// Phase 1: Staleness Monitor & Source Verification Foundation
// ═══════════════════════════════════════════════════════════
// READ-ONLY phase. Zero production data changes.
//
// These types define the full pipeline contract.
// Phase 1 uses: SourceTier, MonitoredSource, FetchResult,
//               StalenessReport, VerificationState, CandidateChangeEvent,
//               IntelligenceRun, RunError.
// Phase 2+ progressively populates the candidate event fields.
// ═══════════════════════════════════════════════════════════

// ─── Disambiguation Score ────────────────────────────────────
//
// Phase 2C: Entity-level disambiguation within the same organization.
//
// STRONG:    The matched identifier is tightly bound (≤80 chars) to the change
//            keyword, AND no competing recruitment token is closer. High probability
//            this signal is specifically about our canonical recruitment.
//
// MODERATE:  The matched identifier is within the 150-char window but not tightly
//            bound to the keyword, and no competing token is closer. Plausible match
//            but could be a listing-style context rather than a direct change notice.
//
// AMBIGUOUS: A competing recruitment identifier (different ordinal, different CEN
//            code, different exam-code+year) is CLOSER to the change keyword than
//            our identifier. High probability the signal is about a different
//            recruitment of the same organization.
//
// All three scores produce DISCOVERED events with humanReviewRequired = true.
// The score helps reviewers prioritize and helps future Phase 3 auto-rejection
// logic target AMBIGUOUS signals without surfacing them to humans.

export type DisambiguationScore = "STRONG" | "MODERATE" | "AMBIGUOUS";

// ─── Source Tier ────────────────────────────────────────────
//
// Tier 1: Official PDFs (notification, corrigendum, exam notice, result)
// Tier 2: Official recruitment / application portal
// Tier 3: Official organization website
// Tier 4: Official adjacent (PIB press releases, verified official social)
// Tier 5: Secondary sources — aggregators, news (DISCOVERY TRIGGERS ONLY)
//
// A lower tier can never override a higher tier for the same field.
// A Tier 5 source may never directly produce a CandidateChangeEvent;
// it may only trigger an out-of-schedule Tier 1–3 check.

export type SourceTier = 1 | 2 | 3 | 4 | 5;

// ─── Phase 7: Discovery Mode ─────────────────────────────────
//
// OPPORTUNITY_MONITOR (default): watches specific canonical records
//   via linkedOpportunityIds. Existing pipeline behaviour.
//
// ORG_DISCOVERY: scans an organization's notification index page for
//   ANY new recruitment notice not yet in the canonical dataset.
//   linkedOpportunityIds is empty for this mode.
//   A discovered notice produces a CandidateNewRecruitment, never a
//   CandidateChangeEvent — the existing update pipeline is untouched.

export type DiscoveryMode = "OPPORTUNITY_MONITOR" | "ORG_DISCOVERY";

export type SourceDocumentType =
  | "NOTIFICATION_PDF"    // Tier 1: official recruitment notification PDF
  | "CORRIGENDUM_PDF"     // Tier 1: corrigendum amending a prior notification
  | "EXAM_NOTICE_PDF"     // Tier 1: admit card / exam date / result notice PDF
  | "RESULT_PDF"          // Tier 1: final result / merit list PDF
  | "PORTAL_PAGE"         // Tier 2: application or status portal page
  | "WEBSITE_INDEX"       // Tier 3: notifications / downloads index page
  | "WEBSITE_PAGE"        // Tier 3: general official website page
  | "SECONDARY_PAGE"      // Tier 5: aggregator or news article
  | "UNKNOWN";

// ─── Monitored Source ───────────────────────────────────────

export interface PollingConfig {
  baseIntervalMinutes: number;          // base check interval
  maxRequestsPerDayPerDomain: number;   // hard cap to protect official servers
  rateLimitDelayMs: number;             // minimum ms between requests to same domain
}

export interface MonitoredSource {
  id: string;                           // "bpsc-official-website"
  name: string;                         // "BPSC Official Website"
  url: string;                          // "https://bpsc.bih.nic.in"
  tier: SourceTier;
  documentType: SourceDocumentType;
  organizationId: string;               // FK → data/organizations.ts registry
  linkedOpportunityIds: string[];       // canonical record IDs this source covers
  enabled: boolean;                     // false = defined but not yet active
  polling: PollingConfig;
  notes?: string;
  mode?: DiscoveryMode;                 // defaults to OPPORTUNITY_MONITOR when absent
}

// ─── Source Adapter Interface ────────────────────────────────
// Each source type gets a specific adapter implementation.
// Phase 1: BaseSourceAdapter (reachability + content hash only).
// Phase 2: HTMLSourceAdapter (CSS-selector extraction).
// Phase 2: PDFSourceAdapter (digital PDF text + OCR fallback).
// Phase 2: LLMNormalizer (typed field extraction from raw text).

export interface SourceAdapterResult {
  source: MonitoredSource;
  fetchResult: FetchResult;
  candidateEvents: CandidateChangeEvent[];  // empty in Phase 1
}

export interface SourceAdapter {
  readonly sourceId: string;
  check(runId: string): Promise<SourceAdapterResult>;
}

// ─── Fetch Result ────────────────────────────────────────────

export type FetchStatus =
  | "OK"
  | "ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "REDIRECT_LOOP"
  | "SKIPPED";

export interface FetchResult {
  url: string;
  finalUrl: string;                 // URL after following redirects
  status: FetchStatus;
  httpStatus?: number;
  contentHash?: string;             // SHA-256 of response body (hex)
  contentType?: string;
  contentLengthBytes?: number;
  responseTimeMs: number;
  error?: string;
  fetchedAt: string;                // ISO datetime
  retryCount: number;
}

// ─── Staleness Assessment ────────────────────────────────────

export type MonitoringPriority =
  | "WATCH"       // 15–30 min: exam today/tomorrow, application deadline today
  | "HIGH"        // 90 min: exam within 3 days, deadline within 3 days
  | "NORMAL"      // 3 hours: application open, active recruitment, postponed
  | "LOW"         // 12 hours: application closed, awaiting next stage
  | "MINIMAL"     // 24–48 hours: result declared, all stages complete
  | "ARCHIVED";   // manual only: fully historical, 2+ years old

export interface StalenessReport {
  opportunityId: string;
  opportunityTitle: string;
  organizationId: string;
  lastVerifiedAt: string;           // from provenance.lastVerifiedAt
  daysSinceVerification: number;
  verificationStatus: string;       // from provenance.status

  primarySourceUrl?: string;        // from provenance.primarySourceUrl

  priority: MonitoringPriority;
  priorityReason: string;
  staleThresholdDays: number;       // days before this priority tier is stale
  isStale: boolean;                 // daysSinceVerification > staleThresholdDays

  fetchResult?: FetchResult;        // populated after source check
}

// ─── Phase 3: Official Source Confirmation ───────────────────
//
// CONFIRMED_CHANGE:       Identifier + change keyword both present and within
//                         200 chars of each other. Field diffs extracted.
//                         Event advances to OFFICIAL_SOURCE_FOUND.
//
// NOT_CONFIRMED:          Page is about our exam (identifier present) but the
//                         change type is absent. Discovery was likely a false positive.
//
// AMBIGUOUS_CONFIRMATION: One of (identifier, change keyword) is missing, OR
//                         both present but > 200 chars apart.
//                         Event stays DISCOVERED + humanReviewRequired.
//
// OFFICIAL_UNAVAILABLE:   Official source timed out / blocked during this run.
//                         Cannot confirm or deny.

export type ConfirmationOutcome =
  | "CONFIRMED_CHANGE"
  | "NOT_CONFIRMED"
  | "AMBIGUOUS_CONFIRMATION"
  | "OFFICIAL_UNAVAILABLE";

/**
 * One field that differs between observed official-source text and canonical record.
 * All extraction is REGEX — no LLM, no inference.
 */
export interface FieldDiff {
  field: string;              // "examStages[0].status", "totalVacancies", "application.closeDate"
  canonicalValue: string;     // current value in the canonical record
  observedValue: string;      // value extracted from official source text
  confidence: number;         // 0.0–1.0
  extractionMethod: "REGEX";  // always REGEX in Phase 3
}

/**
 * Result of running the Phase 3 confirmation pipeline for one DISCOVERED event.
 * Produced by confirmer.ts. Never written to canonical data.
 */
export interface ConfirmationResult {
  opportunityId: string;
  outcome: ConfirmationOutcome;
  officialSourceId: string;
  officialSourceUrl: string;
  identifierConfirmed: boolean;   // official page contains the recruitment identifier
  changeTypeConfirmed: boolean;   // official page contains the change-type keyword
  proximityConfirmed: boolean;    // identifier + keyword within 200 chars of each other
  fieldDiffs: FieldDiff[];
  notes?: string;
}

// ─── Phase 4: Change Review Queue ────────────────────────────
//
// For every CONFIRMED_CHANGE, one ReviewItem is appended to the queue.
// Approval sets status to APPROVED but NEVER writes to canonical data.
// The queue lives in intelligence-runs/review-queue.json (not src/data/).

export type ReviewItemStatus = "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_REVIEW";

/**
 * What WOULD change if a APPROVED ReviewItem were applied to canonical data.
 * Generated by approveItem() when status transitions to APPROVED.
 * Never written to canonical data — this is a proposal only.
 */
export interface ProposedChange {
  reviewItemId: string;
  opportunityId: string;
  approvedAt: string;              // ISO datetime of approval
  appliedFieldDiffs: FieldDiff[];  // diffs that were successfully applied
  skippedPaths: string[];          // field paths explicitly skipped with reason (unsupported or invalid)
  trustGatePassed: boolean;        // did the Trust Gate accept the proposed record?
  trustGateErrors: string[];       // validation error messages, if any
  trustGateWarnings: string[];     // ALL warnings from Trust Gate at approve time
  acknowledgedWarnings?: string[]; // subset explicitly acknowledged by reviewer (exact strings)
  productionWriteAttempted: false; // always false — this is a proposal, not a write
}

export interface ReviewItem {
  id: string;              // UUID — stable reference for this queue entry
  dedupKey: string;        // opportunityId::changeType::matchedIdentifier (for dedup)
  queuedAt: string;        // ISO datetime
  status: ReviewItemStatus;
  statusUpdatedAt?: string; // ISO datetime of last status change

  // What changed
  opportunityId: string;
  opportunityTitle: string;
  changeType: CandidateEventType;
  oldValue?: string;       // canonical field value (from FieldDiff.canonicalValue)
  newValue?: string;       // observed value from official source (from FieldDiff.observedValue)

  // How we know
  matchedIdentifier: string;           // e.g. "72nd", "cen 05/2024"
  secondarySource: string;             // Tier 5 sourceId that discovered the change
  secondarySourceUrl: string;
  officialConfirmationSource: string;  // Tier 1–3 sourceId that confirmed it
  officialConfirmationUrl: string;
  officialEvidence: string;            // ≤500 char excerpt from official source text

  // Confidence
  confidence: number;
  disambiguationScore?: string;        // STRONG | MODERATE | AMBIGUOUS
  fieldDiffs: FieldDiff[];

  // Provenance
  runId: string;
  detectedAt: string;          // ISO datetime from CandidateChangeEvent
  eventId: string;             // CandidateChangeEvent.id
  preRunSnapshotRef: string;   // snapshot hash at time of run (enables rollback)

  humanReviewRequired: true;   // always true; approval does not write canonical data
  reviewNotes?: string;
  approvedChange?: ProposedChange; // set when status becomes APPROVED (proposal only)
}

export interface ChangeReviewQueue {
  version: "1";
  lastUpdatedAt: string;
  items: ReviewItem[];
}

// ─── Phase 7: Candidate New Recruitment ──────────────────────
//
// Created when an ORG_DISCOVERY source finds a notification not
// in the canonical dataset. Persisted to intelligence-runs/discovery-candidates.json.
//
// INVARIANT: A CandidateNewRecruitment is NEVER automatically inserted
//            into canonical data. It must pass Trust Gate AND receive
//            human approval (PR merge) before appendNewRecord() may write it.
//
// Missing fields must remain explicitly absent — never inferred or fabricated.
// The PR body will note which fields could not be extracted.

export interface CandidateNewRecruitment {
  candidateId: string;                // sha256(orgId + "::" + normalizedNotifNumber)[:16]

  // Source information
  discoverySourceId: string;          // MonitoredSource.id
  discoverySourceUrl: string;         // URL where this notice was found
  discoverySourceTier: SourceTier;
  discoveredAt: string;               // ISO timestamp

  // Organization (from source registry)
  organizationId: string;
  organizationName: string;

  // Extracted fields — absent means extraction failed, not that the value is zero/empty
  title?: string;
  notificationNumber?: string;        // raw string as found on the page
  notifPdfUrl?: string;               // direct link to notification PDF
  postDate?: string;                  // ISO date of the notice
  applicationOpenDate?: string;       // ISO date
  applicationCloseDate?: string;      // ISO date
  totalVacancies?: number;
  govType?: "Central Govt" | "State Govt" | "PSU Bank";

  // Dedup fingerprints — always set (fallback to title-derived values if necessary)
  normalizedNotifNumber: string;      // uppercase, stripped, for dedup
  sourceUrlFingerprint: string;       // normalized PDF/notice URL
  pdfContentHash?: string;            // SHA-256 of PDF content if fetched
  titleSimilarityKey: string;         // lowercase alphanum, for bigram fuzzy match

  // Evidence
  rawExcerpt: string;                 // ≤500 chars of surrounding context
  confidence: number;                 // 0–1 composite confidence

  // Lifecycle
  status: "PENDING_REVIEW" | "PR_CREATED" | "APPROVED" | "REJECTED";
  prNumber?: number;                  // GitHub PR number once created
  prUrl?: string;                     // GitHub PR URL
  rejectionReason?: string;
}

// ─── Verification State Machine ──────────────────────────────
//
// DISCOVERED → CANDIDATE → OFFICIAL_SOURCE_FOUND → VERIFIED → PUBLISHED
//
// Tier 5 (secondary) sources: may only reach CANDIDATE.
//   They trigger an out-of-schedule check; they never modify data.
// Tier 3 (official website): can reach OFFICIAL_SOURCE_FOUND.
// Tier 1–2 (PDFs, portals): required to reach VERIFIED.
// PUBLISHED: requires human approval + Trust Gate pass (Phase 3+).
// REJECTED: discarded at any stage. Logged, never silently dropped.

export type VerificationState =
  | "DISCOVERED"              // signal from secondary source or staleness check
  | "CANDIDATE"               // plausible event, awaiting official source check
  | "OFFICIAL_SOURCE_FOUND"   // Tier 1–3 source checked, relevant content found
  | "VERIFIED"                // facts extracted, diff computed against canonical
  | "REJECTED"                // discarded: unreachable / low-confidence / TG fail
  | "PUBLISHED";              // applied to canonical record (Phase 3+)

// ─── Candidate Change Event ──────────────────────────────────
// An observed signal that MAY indicate a change to a recruitment.
// Does NOT modify any canonical data.
// Must progress through the verification state machine before any publish.
//
// Phase 1: events are created with verificationState = CANDIDATE,
//          no confidence or proposed field values (requires Phase 2 extraction).
//
// Trust rule: a CandidateChangeEvent from a Tier 5 source MUST be confirmed
// by a Tier 1–3 source before reaching OFFICIAL_SOURCE_FOUND.
// A newspaper or aggregator alone can never produce a VERIFIED event.

export type CandidateEventType =
  | "NEW_NOTICE"
  | "CORRIGENDUM"
  | "VACANCY_CHANGE"
  | "APPLICATION_DEADLINE_CHANGE"
  | "EXAM_DATE_CHANGE"
  | "EXAM_POSTPONED"
  | "EXAM_CANCELLED"
  | "RE_EXAM"
  | "ADMIT_CARD_RELEASED"
  | "RESULT_RELEASED"
  | "ANSWER_KEY_RELEASED"
  | "OTHER_OFFICIAL_UPDATE";

export interface CandidateChangeEvent {
  id: string;
  runId: string;

  eventType: CandidateEventType;
  opportunityId: string;            // canonical record this may affect
  sourceId: string;                 // MonitoredSource.id
  sourceUrl: string;                // URL where signal was detected
  sourceTier: SourceTier;

  detectedAt: string;               // ISO datetime
  verificationState: VerificationState;

  // Evidence (populated progressively as pipeline advances)
  rawSignal?: string;               // text snippet suggesting a change
  matchedIdentifier?: string;       // specific identifier that triggered isOpportunityMatch (Phase 2B)
  disambiguationScore?: DisambiguationScore; // Phase 2C: entity disambiguation result
  competitorTerm?: string;          // competing recruitment term closer to keyword (when AMBIGUOUS)
  sourceSnapshotHash?: string;      // SHA-256 of fetched source at detection time
  confirmationResult?: ConfirmationResult; // Phase 3: result of official source check

  // Populated at VERIFIED state (Phase 2+: extraction + diff)
  confidence?: number;              // 0.0–1.0 composite field confidence
  extractionMethod?: "HTML" | "PDF_DIGITAL" | "PDF_OCR" | "LLM_NORMALIZED";
  proposedField?: string;           // "examStages[0].status"
  proposedPreviousValue?: string;   // "SCHEDULED"
  proposedNewValue?: string;        // "POSTPONED"

  // Review decision (Phase 3+)
  humanReviewRequired: boolean;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | "AUTO_APPROVED";
  rejectionReason?: string;

  // Publish outcome (Phase 3+)
  publishedAt?: string;
  publishedUpdateRecordId?: string;
}

// ─── Run Errors ──────────────────────────────────────────────

export type RunErrorType =
  | "FETCH_FAILED"
  | "FETCH_TIMEOUT"
  | "FETCH_BLOCKED"
  | "RATE_LIMITED"
  | "PARSE_ERROR"
  | "INTERNAL";

export interface RunError {
  timestamp: string;              // ISO datetime
  errorType: RunErrorType;
  opportunityId?: string;
  sourceId?: string;
  message: string;
}

// ─── Intelligence Run (Audit Record) ─────────────────────────
// One record per invocation. Written to intelligence-runs/ directory.
// Never written to src/data/ or any file the website reads.

// ─── Phase 2A: Content Extraction ────────────────────────────

/**
 * One detected keyword pattern in extracted page text.
 * matchedText is a ≤200-char window around the matched keyword.
 */
export interface ContentSignal {
  patternId: string;                    // e.g. "POSTPONED", "CANCELLED"
  matchedText: string;                  // surrounding text window (≤300 chars)
  signalType: CandidateEventType;
  confidence: number;                   // 0.0–1.0 rough estimate
  charPosition: number;                 // byte offset in cleaned text
  contextWordCount: number;             // word count of matchedText window
  isRelevant: boolean;                  // 4+ char org keyword within 150-char window AND context ≥8 words
  isOpportunityMatch: boolean;          // specific identifier (notification number / exam code) within 150-char window
  matchedIdentifier?: string;           // the specific identifier that triggered isOpportunityMatch
  disambiguationScore?: DisambiguationScore; // Phase 2C: how tightly the identifier is bound to the keyword
  competitorTerm?: string;             // competing recruitment term closer to keyword (when AMBIGUOUS)
  identifierProximity?: number;        // chars between keyword center and matched identifier in strict zone
}

export interface ExtractionResult {
  url: string;
  fetchedAt: string;
  extractionMethod: "HTML" | "PDF_DIGITAL" | "PDF_OCR" | "LLM_NORMALIZED";
  wordCount: number;
  signals: ContentSignal[];
  snapshotHash: string;                 // SHA-256 of raw response
}

// ─── Phase 2A: Comparison ────────────────────────────────────

export type ComparisonOutcome =
  | "NO_SIGNAL"                         // text extracted but no relevant keywords
  | "SIGNAL_CONFIRMS_CURRENT_STATE"     // keyword matches what canonical already says
  | "SIGNAL_SUGGESTS_CHANGE"            // keyword diverges from canonical state
  | "HASH_CHANGED_NO_SIGNAL"            // content hash differs but no keywords found
  | "UNCONFIRMED";                      // could not extract meaningful text

export interface ContentComparison {
  opportunityId: string;
  sourceId: string;
  outcome: ComparisonOutcome;
  signals: ContentSignal[];
  suggestedEventTypes: CandidateEventType[];
  notes?: string;
}

// ─── Run Modes and Status ─────────────────────────────────────

export type RunMode = "DRY_RUN" | "LIVE";
export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL";

export interface IntelligenceRun {
  runId: string;
  startedAt: string;                  // ISO datetime
  completedAt?: string;               // ISO datetime
  durationMs?: number;
  mode: RunMode;
  status: RunStatus;

  // SHA-256 of JSON.stringify(getAllOpportunities()) before any run action.
  // Enables rollback: if Phase 2+ automation ever produces a bad write,
  // this hash identifies the exact pre-run canonical state for restoration.
  preRunSnapshotRef: string;

  // Counts
  sourcesConfigured: number;
  sourcesEnabled: number;
  sourcesChecked: number;
  sourcesReachable: number;
  sourcesFailed: number;

  opportunitiesChecked: number;
  staleRecords: number;
  staleRecordIds: string[];

  candidateEventsDetected: number;    // raw signals (Phase 2+)
  candidateEventsVerified: number;    // confirmed by official source (Phase 2+)
  candidateEventsRejected: number;    // discarded

  productionWrites: number;           // always 0 in DRY_RUN and Phase 1

  // Phase 2A+
  extractionsAttempted: number;       // sources where HTML extraction was tried
  extractionsSuccessful: number;      // sources that yielded extractable text
  contentComparisons: ContentComparison[];

  // Phase 2A Refinement: signal quality metrics
  sourceContentHashes: Record<string, string>;  // sourceId → contentHash (for cross-run dedup)
  rawSignals: number;           // all keyword matches before any filter
  relevantSignals: number;      // matches with org keyword in strict 150-char window (official sources)
  duplicatesSuppressed: number; // sources whose content hash matched the previous run
  unconfirmedSignals: number;   // official source comparisons with UNCONFIRMED outcome

  // Phase 2B: Targeted Source Resolution
  opportunityMatches: number;   // secondary source signals with identifier in 150-char window
  rejectedAmbiguous: number;    // secondary source signals without identifier match
  rejectedSignalExamples: Array<{   // up to 5 examples of rejected-ambiguous signals for reporting
    opportunityId: string;
    sourceId: string;
    sourceUrl: string;
    signalType: CandidateEventType;
    matchedText: string;
  }>;

  // Phase 2C: Entity Disambiguation breakdown
  strongMatches: number;    // DISCOVERED signals where identifier is tightly bound to keyword (≤80 chars, no closer competitor)
  moderateMatches: number;  // DISCOVERED signals where identifier is in zone but not tightly bound
  ambiguousMatches: number; // DISCOVERED signals where a competing recruitment term is closer to the keyword

  // Phase 3: Official Source Confirmation
  officialConfirmations: ConfirmationResult[];
  confirmedChanges: number;       // DISCOVERED events confirmed by official source → OFFICIAL_SOURCE_FOUND
  notConfirmed: number;           // official source is about our exam but change type absent
  ambiguousConfirmations: number; // identifier or keyword missing, or too far apart
  officiallyUnavailable: number;  // official source not fetchable during this run

  // Phase 4: Change Review Queue
  reviewItemsAdded: number;          // CONFIRMED_CHANGE events appended to queue this run
  reviewDuplicatesSuppressed: number; // CONFIRMED_CHANGE events already in queue (dedup)

  // Phase 7: New Recruitment Discovery
  discoverySourcesScanned: number;      // ORG_DISCOVERY sources with extractable HTML
  newRecruitmentsDiscovered: number;    // notices found that are not in canonical dataset
  newRecruitmentDuplicatesSkipped: number; // notices already in canonical data or in-flight candidates
  newRecruitmentCandidates: CandidateNewRecruitment[]; // full list for audit

  errors: RunError[];

  // Full detail (included in audit log)
  stalenessReports: StalenessReport[];
  candidateEvents: CandidateChangeEvent[];
}
