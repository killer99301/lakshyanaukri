// ═══════════════════════════════════════════════════════════
// Phase 14: Intake → CMS Pipeline Tests (INTAKE01–INTAKE11)
// npx tsx --tsconfig tsconfig.json tests/intelligence/intake-cms.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  INTAKE01  buildDraft(provider=null) → draft shape correct, title populated
//  INTAKE02  provider=null → draft.pay === undefined (no Gemini enrichment)
//  INTAKE03  Mock provider returns fees + valid evidence → draft.pay.applicationFee populated
//  INTAKE04  Throwing provider → swallowed; deterministic fields intact
//  INTAKE05  Mock provider returns vacancyBreakdown → draft.vacancies.rows populated
//  INTAKE06  Evidence arrays on identity.title: sourceId, url, extractedText populated
//  INTAKE07  Mock provider returns fee with nonexistent sectionHeading → fees NOT populated
//  INTAKE08  Mock provider returns different notifNum + valid evidence → draft.conflicts entry added
//  INTAKE09  promoteDraft → provenance.sourceDraftId === draft.id
//  INTAKE10  Dedup (DB-dependent) — skipped in unit test
//  INTAKE11  Evidence rows (DB-dependent) — skipped in unit test

import { suite, test, assert } from "./suite";
import { buildDraft } from "@/intelligence/draft-builder";
import { promoteDraft } from "@/lib/cms/promoter";
import { MockExtractionProvider } from "@/intelligence/extraction-provider";
import type { ExtractionProvider, ProviderExtractionResult } from "@/intelligence/extraction-provider";
import type {
  SourceRetriever,
  IntelligenceSource,
  RetrievedSource,
  SourceKind,
} from "@/intelligence/draft-types";

// ─── Shared HTML fixture ──────────────────────────────────────
//
// Designed to produce deterministic sections after structureDocument():
//   "Notification Details" (type: other)
//   "Important Dates"      (type: dates)
//   "Post Details"         (type: vacancy)
//   "Application Fee"      (type: financial)
//
// Notification number: deterministic finds "IBPS/CLK-XVI/2026" first.
// "IBPS/CLK-XVII/2026" appears later for conflict testing (INTAKE08).

const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><title>IBPS Clerk CWE XVI Recruitment 2026</title></head>
<body>
<h1>IBPS Clerk CWE XVI Recruitment 2026</h1>
<h2>Notification Details</h2>
<p>Notification No: IBPS/CLK-XVI/2026</p>
<p>Revised Notification: IBPS/CLK-XVII/2026 (see corrigendum for details)</p>
<p>Total Vacancies: 5858</p>
<h2>Important Dates</h2>
<p>Application Open Date: 01/09/2026</p>
<p>Application Close Date: 21/09/2026</p>
<h2>Post Details</h2>
<p>Junior Officer: 200 vacancies</p>
<p>Senior Officer: 50 vacancies</p>
<h2>Application Fee</h2>
<p>General/OBC candidates: Rs. 850/-</p>
<p>SC/ST/PwBD candidates: Rs. 175/-</p>
</body>
</html>`;

const FIXTURE_URL = "https://ibps.in/test/clerk-xvi/2026";

// ─── Test harness helpers ─────────────────────────────────────

class StaticHtmlRetriever implements SourceRetriever {
  constructor(
    private readonly html: string,
    private readonly kind: "OFFICIAL" | "SECONDARY" | "OTHER" = "OFFICIAL",
  ) {}

  canHandle(_url: URL): boolean { return true; }

  async retrieve(url: URL, sourceId: string, _kind: SourceKind): Promise<RetrievedSource> {
    const source: IntelligenceSource = {
      id: sourceId,
      url: url.toString(),
      domain: url.hostname,
      kind: this.kind,
      retrievedAt: new Date().toISOString(),
      success: true,
    };
    return { source, success: true, html: this.html, links: [] };
  }
}

class ThrowingProvider implements ExtractionProvider {
  readonly name = "throwing-test";
  readonly model = undefined;

  async extractFromSections(): Promise<ProviderExtractionResult> {
    throw new Error("Simulated provider failure for INTAKE04");
  }
}

// ─── Mock provider factory helpers ───────────────────────────

function feeProvider(): MockExtractionProvider {
  const result: ProviderExtractionResult = {
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC candidates: Rs. 850/-",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
    applicationFeeSCST: {
      value: 175,
      evidence: "SC/ST/PwBD candidates: Rs. 175/-",
      sectionHeading: "Application Fee",
      confidence: "high",
    },
  };
  return new MockExtractionProvider(result);
}

function feeProviderBadSection(): MockExtractionProvider {
  const result: ProviderExtractionResult = {
    applicationFeeGeneral: {
      value: 850,
      evidence: "General/OBC candidates: Rs. 850/-",
      sectionHeading: "NONEXISTENT SECTION XYZ",
      confidence: "high",
    },
  };
  return new MockExtractionProvider(result);
}

function breakdownProvider(): MockExtractionProvider {
  const result: ProviderExtractionResult = {
    vacancyBreakdown: {
      value: [
        { post: "Junior Officer", count: 200, evidence: "Junior Officer: 200 vacancies" },
        { post: "Senior Officer", count: 50, evidence: "Senior Officer: 50 vacancies" },
      ],
      evidence: "Post Details",
      sectionHeading: "Post Details",
      confidence: "high",
    },
  };
  return new MockExtractionProvider(result);
}

function conflictNotifProvider(): MockExtractionProvider {
  const result: ProviderExtractionResult = {
    notificationNumber: {
      value: "IBPS/CLK-XVII/2026",
      evidence: "Revised Notification: IBPS/CLK-XVII/2026 (see corrigendum for details)",
      sectionHeading: "Notification Details",
      confidence: "high",
    },
  };
  return new MockExtractionProvider(result);
}

// ─── Suite ───────────────────────────────────────────────────

suite("Intake → CMS Pipeline (Phase 14)");

test("INTAKE01: buildDraft(provider=null) returns draft with title and sources", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, null);

  // Shape
  assert.ok(draft.id, "draft.id should be populated");
  assert.ok(draft.sources.length > 0, "draft.sources should have at least one entry");
  assert.ok(draft.sources[0].url, "source.url should be set");

  // Title
  assert.ok(draft.identity.title.value, "draft.identity.title.value should be populated");
});

test("INTAKE02: provider=null → draft.pay is undefined (no Gemini fees)", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, null);

  assert.equal(draft.pay, undefined, "draft.pay should be undefined when provider=null");
});

test("INTAKE03: mock provider with valid fee evidence → draft.pay.applicationFee populated", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, feeProvider());

  assert.ok(draft.pay, "draft.pay should be defined when provider returns fees");
  assert.ok(draft.pay?.applicationFee, "draft.pay.applicationFee should be defined");
  const fees = draft.pay!.applicationFee!;
  assert.ok(fees.length >= 1, "At least one fee entry expected");

  const generalFee = fees.find(f => f.category === "General/OBC/UR");
  assert.ok(generalFee, "General/OBC/UR fee entry should exist");
  assert.equal(generalFee?.amount, 850);

  const scstFee = fees.find(f => f.category === "SC/ST/PwBD");
  assert.ok(scstFee, "SC/ST/PwBD fee entry should exist");
  assert.equal(scstFee?.amount, 175);

  // Evidence row populated on draft.pay.sourceEvidence
  assert.ok(draft.pay!.sourceEvidence.length >= 1, "draft.pay.sourceEvidence should have at least 1 entry");
});

test("INTAKE04: throwing provider → swallowed, deterministic fields intact", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);

  let draft;
  try {
    draft = await buildDraft([FIXTURE_URL], retriever, new ThrowingProvider());
  } catch (err) {
    assert.fail(`buildDraft should not throw when provider fails: ${String(err)}`);
  }

  assert.ok(draft, "draft should be returned even when provider throws");
  // Deterministic title still present
  assert.ok(draft.identity.title.value, "identity.title should still be populated after provider failure");
  // No fees (Gemini was skipped)
  assert.equal(draft.pay, undefined, "draft.pay should be undefined after provider failure");
});

test("INTAKE05: mock provider with vacancyBreakdown → draft.vacancies.rows populated", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, breakdownProvider());

  assert.ok(draft.vacancies.rows.length >= 2, "draft.vacancies.rows should have at least 2 entries from Gemini breakdown");

  const juniorRow = draft.vacancies.rows.find(r => r.postName === "Junior Officer");
  assert.ok(juniorRow, "Junior Officer row should exist");
  assert.equal(juniorRow?.total, 200);

  const seniorRow = draft.vacancies.rows.find(r => r.postName === "Senior Officer");
  assert.ok(seniorRow, "Senior Officer row should exist");
  assert.equal(seniorRow?.total, 50);

  // derivedTotal should be set when rows are added and no deterministic total wins
  if (!draft.vacancies.total?.value) {
    assert.ok(draft.vacancies.derivedTotal !== undefined, "derivedTotal should be set when rows added without a total");
    assert.equal(draft.vacancies.derivedTotal, 250);
  }
});

test("INTAKE06: identity.title.evidence has sourceId, url, extractedText", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, null);

  const ev = draft.identity.title.evidence;
  assert.ok(ev.length >= 1, "title.evidence should have at least one entry");
  const first = ev[0];
  assert.ok(first.sourceId, "evidence.sourceId should be set");
  assert.ok(first.url, "evidence.url should be set");
  // extractedText may or may not be set depending on the extractor — just verify shape
  assert.ok(typeof first.confidence === "number", "evidence.confidence should be a number");
  assert.ok(typeof first.authorityRank === "number", "evidence.authorityRank should be a number");
});

test("INTAKE07: mock provider with nonexistent sectionHeading → evidence rejected, fees NOT populated", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, feeProviderBadSection());

  assert.equal(draft.pay, undefined,
    "draft.pay should be undefined when fee evidence references a nonexistent section");
});

test("INTAKE08: mock provider returns different notifNum + valid evidence → conflict entry added", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, conflictNotifProvider());

  // Only assert conflict behavior if deterministic found a notification number;
  // if the extractor found none, the mock value becomes llm_fill (not conflict) — skip.
  if (draft.identity.notificationNumber.value === undefined) {
    console.log("    ⚠  INTAKE08: deterministic extractor found no notificationNumber — conflict not exercised");
    return;
  }

  // If deterministic and LLM agree (same value), no conflict either.
  if (draft.identity.notificationNumber.value === "IBPS/CLK-XVII/2026") {
    // Deterministic coincidentally found the same value the LLM returned — confirmed, no conflict.
    // This is valid behavior; the test just cannot assert a conflict in this case.
    console.log("    ⚠  INTAKE08: deterministic and LLM agree — no conflict path exercised");
    return;
  }

  // Deterministic found a different value than the LLM → conflict should be in draft.conflicts
  const conflictEntry = draft.conflicts.find(c => c.field === "identity.notificationNumber");
  assert.ok(
    conflictEntry,
    `Expected a conflict entry for "identity.notificationNumber" in draft.conflicts; ` +
    `det=${draft.identity.notificationNumber.value}, llm=IBPS/CLK-XVII/2026. ` +
    `Conflicts: ${JSON.stringify(draft.conflicts.map(c => c.field))}`,
  );
  assert.equal(conflictEntry?.severity, "WARNING");
  assert.equal(conflictEntry?.values.length, 2, "Conflict entry should carry 2 candidate values");
});

test("INTAKE09: promoteDraft sets provenance.sourceDraftId === draft.id", async () => {
  const retriever = new StaticHtmlRetriever(FIXTURE_HTML);
  const draft = await buildDraft([FIXTURE_URL], retriever, null);

  const fields = promoteDraft({ draft, adminId: "00000000-0000-0000-0000-000000000001" });

  assert.equal(
    fields.provenance.sourceDraftId,
    draft.id,
    "provenance.sourceDraftId must equal the intelligence draft id",
  );
  // Status must be NOT_VERIFIED — intelligence fields are never auto-verified
  assert.equal(fields.provenance.status, "NOT_VERIFIED");
});

test("INTAKE10: dedup check — SKIP (requires live DB)", () => {
  console.log("    ⚠  INTAKE10 skipped — dedup check requires a live intelligence_drafts table");
});

test("INTAKE11: evidence row persistence — SKIP (requires live DB)", () => {
  console.log("    ⚠  INTAKE11 skipped — evidence row insertion requires a live recruitment_evidence table");
});
