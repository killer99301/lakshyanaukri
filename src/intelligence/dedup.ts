// ═══════════════════════════════════════════════════════════
// Phase 7: Duplicate Detection for New Recruitment Candidates
// ═══════════════════════════════════════════════════════════
//
// Uses 5 signals to determine whether a discovered notice is
// already represented in the canonical dataset or already queued
// as an in-flight candidate from an earlier run or source.
//
// Signal priority (strongest to weakest):
//   1. Candidate ID   — sha256(orgId + "::" + normalizedNotifNumber)[:16]
//   2. Notification number — same org + same normalized notification number
//   3. Official PDF/notice URL — same normalized URL
//   4. PDF content hash — same SHA-256 of PDF bytes (if fetched)
//   5. Title bigram similarity ≥ 0.75 within same organization
//
// Rationale: "SSC CGL 2026", "Combined Graduate Level 2026", and
// "CGL Examination 2026" must resolve to ONE candidate, not three PRs.
// ═══════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import type { GovernmentRecruitment } from "@/types";
import type { CandidateNewRecruitment } from "./types";

// ─── Normalization ────────────────────────────────────────────

/**
 * Strips all non-alphanumeric characters and uppercases.
 * "Advt No. 72/2024" → "ADVTNO722024"
 * "CEN-05/2024" → "CEN052024"
 */
export function normalizeNotificationNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Strips protocol and trailing slash for URL fingerprinting.
 * "https://ssc.gov.in/docs/cgl-2026.pdf" → "ssc.gov.in/docs/cgl-2026.pdf"
 */
export function normalizeSourceUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * Lowercase alphanumeric only, max 80 chars.
 * Used for bigram-based title similarity.
 * "SSC CGL 2026 — Combined Graduate Level" → "ssccgl2026combinedgraduatelevel"
 */
export function buildTitleSimilarityKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 80);
}

/**
 * Stable 16-char hex candidate ID from orgId + normalized notification number.
 * Deterministic across runs: same notification from same org → same ID.
 */
export function buildCandidateId(orgId: string, normalizedNotifNumber: string): string {
  return createHash("sha256")
    .update(`${orgId}::${normalizedNotifNumber}`)
    .digest("hex")
    .slice(0, 16);
}

// ─── Bigram Jaccard Similarity ────────────────────────────────

function bigramSet(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

export function bigramJaccard(a: string, b: string): number {
  if (!a || !b || a.length < 2 || b.length < 2) return 0;
  const setA = bigramSet(a);
  const setB = bigramSet(b);
  let intersection = 0;
  for (const g of setA) {
    if (setB.has(g)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Canonical dataset duplicate check ───────────────────────

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason: string;              // which signal fired
  matchedRecordId?: string;    // canonical record.id if matched
}

/**
 * Checks whether a candidate notice is already represented in the
 * canonical GovernmentRecruitment dataset.
 *
 * Returns { isDuplicate: true } on the FIRST signal match.
 * Multiple signals are checked in priority order.
 */
export function isDuplicateOfCanonical(
  candidate: {
    candidateId: string;
    organizationId: string;
    normalizedNotifNumber: string;
    sourceUrlFingerprint: string;
    pdfContentHash?: string;
    titleSimilarityKey: string;
  },
  canonicalRecords: GovernmentRecruitment[]
): DuplicateCheckResult {
  for (const record of canonicalRecords) {
    const recNorm = normalizeNotificationNumber(record.notificationNumber);

    // Signal 1: candidate ID (inherently includes org identity via hash input)
    const recCandidateId = buildCandidateId(record.organizationId, recNorm);
    if (recCandidateId === candidate.candidateId) {
      return { isDuplicate: true, reason: "candidate-id-match", matchedRecordId: record.id };
    }

    // Signal 2: same org + same normalized notification number
    if (
      record.organizationId === candidate.organizationId &&
      recNorm === candidate.normalizedNotifNumber
    ) {
      return { isDuplicate: true, reason: "notification-number-match", matchedRecordId: record.id };
    }

    // Signal 3: official PDF/notice URL fingerprint
    if (record.links.notification && candidate.sourceUrlFingerprint) {
      const recUrl = normalizeSourceUrl(record.links.notification);
      if (recUrl === candidate.sourceUrlFingerprint && recUrl !== "") {
        return { isDuplicate: true, reason: "notification-url-match", matchedRecordId: record.id };
      }
    }

    // Signal 4: PDF content hash (only useful if we fetched the PDF for both)
    // Canonical records don't store PDF hashes, so this only fires cross-candidate.
    // Kept here for future extension; currently a no-op against canonical records.

    // Signal 5: title bigram similarity ≥ 0.75 (same org only)
    if (record.organizationId === candidate.organizationId) {
      const recKey = buildTitleSimilarityKey(record.title);
      if (bigramJaccard(candidate.titleSimilarityKey, recKey) >= 0.75) {
        return { isDuplicate: true, reason: "title-similarity", matchedRecordId: record.id };
      }
    }
  }

  return { isDuplicate: false, reason: "" };
}

/**
 * Checks whether a candidate is already in the in-flight candidates list
 * (from the same or a prior run in the same GitHub Actions job).
 *
 * Uses the same 5-signal logic but with a stricter title similarity
 * threshold (0.85 vs 0.75) since in-flight candidates may be from
 * different pages of the same organization.
 */
export function isDuplicateCandidate(
  candidate: CandidateNewRecruitment,
  existingCandidates: CandidateNewRecruitment[]
): boolean {
  for (const existing of existingCandidates) {
    // Signal 1: same candidate ID
    if (existing.candidateId === candidate.candidateId) return true;

    // Signal 2: same org + same normalized notification number
    if (
      existing.organizationId === candidate.organizationId &&
      existing.normalizedNotifNumber === candidate.normalizedNotifNumber &&
      existing.normalizedNotifNumber !== ""
    ) return true;

    // Signal 3: same PDF URL fingerprint (non-empty)
    if (
      existing.sourceUrlFingerprint &&
      candidate.sourceUrlFingerprint &&
      existing.sourceUrlFingerprint === candidate.sourceUrlFingerprint
    ) return true;

    // Signal 4: same PDF content hash
    if (
      existing.pdfContentHash &&
      candidate.pdfContentHash &&
      existing.pdfContentHash === candidate.pdfContentHash
    ) return true;

    // Signal 5: title bigram ≥ 0.85 within same org (stricter than canonical check)
    if (existing.organizationId === candidate.organizationId) {
      if (bigramJaccard(existing.titleSimilarityKey, candidate.titleSimilarityKey) >= 0.85) {
        return true;
      }
    }
  }

  return false;
}
