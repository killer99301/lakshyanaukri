// Phase 7: New record factory tests (NRF1–NRF12)
//
// Tests slug generation, draft record building, and PR body generation.
// No network I/O, no canonical data writes. productionWrites remains 0.

import assert from "node:assert";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import {
  generateSlug,
  generateRecordId,
  buildDraftGovernmentRecruitment,
  generatePrBody,
} from "@/intelligence/new-record-factory";
import { normalizeNotificationNumber, buildCandidateId, buildTitleSimilarityKey, normalizeSourceUrl } from "@/intelligence/dedup";

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function makeCandidate(overrides: Partial<CandidateNewRecruitment> = {}): CandidateNewRecruitment {
  const notif = normalizeNotificationNumber("Advt No. 01/2026");
  return {
    candidateId: buildCandidateId("ssc", notif),
    discoverySourceId: "ssc-org-discovery",
    discoverySourceUrl: "https://ssc.gov.in/home/latestNotices",
    discoverySourceTier: "TIER_1",
    discoveredAt: "2026-08-15T10:00:00.000Z",
    organizationId: "ssc",
    organizationName: "Staff Selection Commission",
    title: "SSC CGL Combined Graduate Level Examination 2026",
    notificationNumber: "Advt No. 01/2026",
    notifPdfUrl: "https://ssc.gov.in/docs/cgl-2026.pdf",
    postDate: "2026-01-15",
    applicationOpenDate: "2026-02-01",
    applicationCloseDate: "2026-03-01",
    normalizedNotifNumber: notif,
    sourceUrlFingerprint: normalizeSourceUrl("https://ssc.gov.in/docs/cgl-2026.pdf"),
    titleSimilarityKey: buildTitleSimilarityKey("SSC CGL Combined Graduate Level Examination 2026"),
    rawExcerpt: "SSC CGL 2026 notification",
    confidence: 0.8,
    status: "PENDING_REVIEW",
    ...overrides,
  };
}

// ─── NRF1-3: generateSlug ────────────────────────────────────

console.log("\nNRF1-3: generateSlug");

const slug1 = generateSlug("ssc", "Combined Graduate Level Examination 2026");
check("NRF1: slug starts with orgId", slug1.startsWith("ssc-"));
check("NRF1b: slug contains year", slug1.includes("2026"));
check("NRF1c: slug is kebab-case", /^[a-z0-9-]+$/.test(slug1));
check("NRF1d: slug max 80 chars", slug1.length <= 80);

// NRF2: collision safety
const existingSlugs = [slug1];
const slug2 = generateSlug("ssc", "Combined Graduate Level Examination 2026", "2026", existingSlugs);
check("NRF2: collision appends suffix to disambiguate", slug2 !== slug1);

// NRF3: stop words removed
const slugWithStopWords = generateSlug("rrb", "Recruitment of Posts in Railway 2026");
check("NRF3: stop words 'of', 'in', 'the' are excluded from slug", !slugWithStopWords.includes("-of-") && !slugWithStopWords.includes("-in-") && !slugWithStopWords.includes("-the-"));

// ─── NRF4-5: generateRecordId ────────────────────────────────

console.log("\nNRF4-5: generateRecordId");

const rid = generateRecordId("ssc", "ADVTNO012026");
check("NRF4: record ID starts with orgId", rid.startsWith("ssc-"));
check("NRF4b: record ID is lowercase", rid === rid.toLowerCase());
check("NRF5: same inputs → same ID (deterministic)", generateRecordId("ssc", "ADVTNO012026") === rid);
check("NRF5b: different org → different ID", generateRecordId("rrb", "ADVTNO012026") !== rid);

// ─── NRF6-9: buildDraftGovernmentRecruitment — complete candidate ──

console.log("\nNRF6-9: buildDraftGovernmentRecruitment — fully-extracted candidate");

const fullCandidate = makeCandidate({ totalVacancies: 17000 });
const { draft: fullDraft, missingFields: fullMissing } = buildDraftGovernmentRecruitment(fullCandidate);

check("NRF6: draft type is 'government'", fullDraft.type === "government");
check("NRF6b: draft provenance.status is NOT_VERIFIED", fullDraft.provenance.status === "NOT_VERIFIED");
check("NRF6c: draft id is non-empty", fullDraft.id.length > 0);
check("NRF6d: draft slug is non-empty", fullDraft.slug.length > 0);
check("NRF7: notification PDF link is set", fullDraft.links.notification === "https://ssc.gov.in/docs/cgl-2026.pdf");
check("NRF7b: application dates match candidate", fullDraft.application.openDate === "2026-02-01");
check("NRF8: totalVacancies matches candidate", fullDraft.totalVacancies === 17000);
check("NRF9: missingFields is empty for fully-extracted candidate", fullMissing.length === 0);

// ─── NRF10: buildDraftGovernmentRecruitment — incomplete candidate ─

console.log("\nNRF10: buildDraftGovernmentRecruitment — missing fields");

const notif2 = normalizeNotificationNumber("ADVT99");
const incompleteCandidate = makeCandidate({
  candidateId: buildCandidateId("rrb", notif2),
  organizationId: "rrb",
  organizationName: "Railway Recruitment Boards",
  title: undefined,
  notificationNumber: undefined,
  notifPdfUrl: undefined,
  applicationOpenDate: undefined,
  applicationCloseDate: undefined,
  totalVacancies: undefined,
  normalizedNotifNumber: notif2,
});

const { draft: incompleteDraft, missingFields: incompleteMissing } = buildDraftGovernmentRecruitment(incompleteCandidate);
check("NRF10: missing title is reported", incompleteMissing.includes("title"));
check("NRF10b: missing notificationNumber is reported", incompleteMissing.includes("notificationNumber"));
check("NRF10c: missing links.notification is reported", incompleteMissing.includes("links.notification"));
check("NRF10d: missing openDate is reported", incompleteMissing.includes("application.openDate"));
check("NRF10e: missing closeDate is reported", incompleteMissing.includes("application.closeDate"));
check("NRF10f: totalVacancies defaults to 0 (not fabricated)", incompleteDraft.totalVacancies === 0);
check("NRF10g: draft.type is still 'government'", incompleteDraft.type === "government");

// ─── NRF11: NOT_VERIFIED record is excluded from production ───

console.log("\nNRF11: NOT_VERIFIED provenance.status");

check("NRF11: draft provenance.status is NOT_VERIFIED", fullDraft.provenance.status === "NOT_VERIFIED");
// The actual exclusion is done by assembleVerifiedDataset() — we verify the field value
// so the exclusion guard has what it needs.

// ─── NRF12: generatePrBody ────────────────────────────────────

console.log("\nNRF12: generatePrBody");

const prBody = generatePrBody(fullCandidate, fullDraft, fullMissing);
check("NRF12: PR body contains organization name", prBody.includes("Staff Selection Commission"));
check("NRF12b: PR body contains reviewer checklist", prBody.includes("Reviewer checklist"));
check("NRF12c: PR body instructs reviewer to change provenance.status", prBody.includes("PARTIALLY_VERIFIED"));
check("NRF12d: PR body contains candidate ID", prBody.includes(fullCandidate.candidateId));
check("NRF12e: PR body contains raw excerpt", prBody.includes("SSC CGL 2026 notification"));
check("NRF12f: PR body contains missing fields section", prBody.includes("Missing fields"));

const incompleteBody = generatePrBody(incompleteCandidate, incompleteDraft, incompleteMissing);
check("NRF12g: incomplete candidate lists missing fields", incompleteBody.includes("title") && incompleteBody.includes("notificationNumber"));

console.log("\n✅ All NRF tests passed.\n");
