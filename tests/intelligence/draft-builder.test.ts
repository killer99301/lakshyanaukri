// ═══════════════════════════════════════════════════════════
// Phase 10: Draft Builder — URL-First Pipeline Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/draft-builder.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  DB1  Single official source maps title, notifNum, dates, vacancies to FieldValue<T>
//  DB2  Derived vacancy total (UIIC-like: 200+25=225) sets derivedTotal, not total
//  DB3  Conflict: official 205 vs secondary 207 — official wins, conflict=true, both preserved
//  DB4  Missing data — missingFields populated, readyForReview=false when no title
//  DB5  HttpRetriever.canHandle() accepts http/https, rejects other schemes
//  DB6  Failed retrieval — draft has source but no extraction, all key fields missing
//  DB7  Multi-source dedup — same PDF link from two sources appears once in links[]
//  DB8  Conflict severity — WARNING by default; all ConflictValue entries preserved

import { suite, test, assert } from "./suite";
import { mapExtractionsToDraft, buildDraft } from "@/intelligence/draft-builder";
import { HttpRetriever } from "@/intelligence/http-retriever";
import type { IntelligenceSource, SourceRetriever, RetrievedSource } from "@/intelligence/draft-types";
import type { IntakeExtraction } from "@/intelligence/intake";

// ─── Test harness helpers ─────────────────────────────────────

function makeSource(id: string, kind: "OFFICIAL" | "SECONDARY" | "OTHER" = "OFFICIAL"): IntelligenceSource {
  return {
    id,
    url: `https://example.com/${id}`,
    domain: "example.com",
    kind,
    retrievedAt: new Date().toISOString(),
    success: true,
  };
}

function makeExtraction(
  overrides: Partial<IntakeExtraction> = {},
  sourceKind: IntakeExtraction["sourceKind"] = "OFFICIAL_SPECIFIC",
): IntakeExtraction {
  return {
    officialLinksFound: [],
    rawExcerpt: "Test excerpt",
    confidence: 0.85,
    specificity: 0.9,
    sourceKind,
    ...overrides,
  };
}

// A mock retriever that returns static HTML for any URL
class StaticHtmlRetriever implements SourceRetriever {
  constructor(
    private readonly html: string,
    private readonly kind: "OFFICIAL" | "SECONDARY" | "OTHER" = "OFFICIAL",
  ) {}

  canHandle(url: URL): boolean { void url; return true; }

  async retrieve(url: URL, sourceId: string, kind: import("@/intelligence/draft-types").SourceKind): Promise<RetrievedSource> {
    void kind;
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

class FailingRetriever implements SourceRetriever {
  canHandle(url: URL): boolean { void url; return true; }
  async retrieve(url: URL, sourceId: string, kind: import("@/intelligence/draft-types").SourceKind): Promise<RetrievedSource> {
    const source: IntelligenceSource = {
      id: sourceId, url: url.toString(), domain: url.hostname,
      kind, retrievedAt: new Date().toISOString(), success: false,
    };
    return { source, success: false, links: [], error: "Connection refused" };
  }
}

// ─── Suite ───────────────────────────────────────────────────

suite("Draft Builder — Phase 10 URL-First Pipeline");

test("DB1: single official source maps scalar fields to FieldValue<T>", async () => {
  const BOI_HTML = `<html><head><title>Bank of India - AO Recruitment 2026</title></head>
<body>
<h1>Bank of India Recruitment for Acquisition Officers 2026</h1>
<p>Notification No: BOI/AO/2026/01</p>
<p>Total Vacancies: 205</p>
<p>Application Open Date: 01/09/2026</p>
<p>Last Date to Apply: 30/09/2026</p>
</body></html>`;

  const draft = await buildDraft(
    ["https://bankofindia.co.in/recruitment/ao2026"],
    new StaticHtmlRetriever(BOI_HTML, "OFFICIAL"),
  );

  // Sources recorded
  assert.equal(draft.sources.length, 1, "should have 1 source");
  assert.equal(draft.sources[0].kind, "OFFICIAL");

  // Title extracted and wrapped in FieldValue
  assert.ok(draft.identity.title.value, "should have a title");
  assert.ok(
    draft.identity.title.value!.toLowerCase().includes("bank of india") ||
    draft.identity.title.value!.toLowerCase().includes("acquisition"),
    `unexpected title: ${draft.identity.title.value}`,
  );
  assert.ok(draft.identity.title.confidence > 0, "title confidence should be positive");
  assert.equal(draft.identity.title.manuallyEdited, false);
  assert.equal(draft.identity.title.conflict, false, "single source → no conflict");
  assert.equal(draft.identity.title.evidence.length, 1, "one piece of evidence");

  // Vacancies extracted
  if (draft.vacancies.total?.value !== undefined) {
    assert.equal(draft.vacancies.total.value, 205, "should extract 205 vacancies");
    assert.equal(draft.vacancies.total.conflict, false);
  } else if (draft.vacancies.derivedTotal !== undefined) {
    assert.equal(draft.vacancies.derivedTotal, 205);
  } else {
    assert.fail("expected vacancies to be extracted");
  }

  // Application dates
  assert.ok(draft.dates.applicationCloseDate?.date, "should have close date");
  assert.match(draft.dates.applicationCloseDate!.date!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(draft.dates.applicationCloseDate!.certainty, "CONFIRMED");

  // Overall
  assert.ok(draft.overallConfidence > 0, "overall confidence > 0");
  assert.equal(draft.conflicts.length, 0, "no conflicts from single source");
});

test("DB2: derived vacancy total (UIIC-like 200+25=225) → derivedTotal set, total absent", () => {
  const sourceId = "uiic-src-1";
  const source = makeSource(sourceId, "OFFICIAL");

  const extraction = makeExtraction({
    title: "UIIC AO Recruitment 2026",
    notificationNumber: "UIIC/AO/2026/01",
    totalVacancies: 225,
    vacancyDerived: true,
    vacancyRows: [
      { label: "Assistant Officers (Scale-I)", count: 200 },
      { label: "Generalist Officers", count: 25 },
    ],
    applicationOpenDate: "2026-08-01",
    applicationCloseDate: "2026-08-31",
    confidence: 0.9,
    sourceKind: "OFFICIAL_PDF",
  });

  const draft = mapExtractionsToDraft([source], [{ source, extraction }]);

  // derivedTotal must be set; total must be absent (not source-stated)
  assert.equal(draft.vacancies.derivedTotal, 225, "derivedTotal must equal 225");
  assert.equal(draft.vacancies.total, undefined, "total must be absent for derived vacancies");
  assert.equal(draft.vacancies.isIndicative, false, "isIndicative=false when total is derived");

  // Rows must be present
  assert.equal(draft.vacancies.rows.length, 2, "should have 2 vacancy rows");
  assert.equal(draft.vacancies.rows[0].postName, "Assistant Officers (Scale-I)");
  assert.equal(draft.vacancies.rows[0].total, 200);
  assert.equal(draft.vacancies.rows[1].postName, "Generalist Officers");
  assert.equal(draft.vacancies.rows[1].total, 25);

  // Explanation should describe the derivation
  assert.ok(
    draft.vacancies.derivedTotalExplanation?.includes("2"),
    `derivedTotalExplanation should mention row count: ${draft.vacancies.derivedTotalExplanation}`,
  );

  // Identity still mapped
  assert.equal(draft.identity.title.value, "UIIC AO Recruitment 2026");
  assert.equal(draft.identity.notificationNumber.value, "UIIC/AO/2026/01");
});

test("DB3: conflict — official says 205, secondary says 207; official wins, both preserved", () => {
  const officialId = "src-official";
  const secondaryId = "src-secondary";

  const officialSource = makeSource(officialId, "OFFICIAL");
  const secondarySource = makeSource(secondaryId, "SECONDARY");

  const officialExtraction = makeExtraction({
    title: "Bank of India AO Recruitment 2026",
    notificationNumber: "BOI/AO/2026",
    totalVacancies: 205,
    applicationCloseDate: "2026-09-30",
    confidence: 0.88,
    sourceKind: "OFFICIAL_SPECIFIC",
  });

  const secondaryExtraction = makeExtraction({
    title: "Bank of India AO Recruitment 2026",
    notificationNumber: "BOI/AO/2026",
    totalVacancies: 207,
    applicationCloseDate: "2026-09-30",
    confidence: 0.65,
    sourceKind: "THIRD_PARTY",
  });

  const draft = mapExtractionsToDraft(
    [officialSource, secondarySource],
    [
      { source: officialSource, extraction: officialExtraction },
      { source: secondarySource, extraction: secondaryExtraction },
    ],
  );

  // Official wins
  assert.equal(draft.vacancies.total?.value, 205, "official value must win");
  assert.equal(draft.vacancies.total?.selectedSourceId, officialId, "official source must be selected");

  // Conflict is flagged
  assert.equal(draft.vacancies.total?.conflict, true, "conflict must be true");

  // Both values are preserved in evidence
  const evidence = draft.vacancies.total!.evidence;
  assert.equal(evidence.length, 2, "both sources' evidence must be preserved");
  const values = evidence.map((e) => e.value as number).sort((a, b) => a - b);
  assert.deepEqual(values, [205, 207], "both values 205 and 207 must be in evidence");

  // IntelligenceConflict entry created
  const vacConflict = draft.conflicts.find((c) => c.field === "vacancies.total");
  assert.ok(vacConflict, "conflicts[] must contain a vacancies.total entry");
  assert.equal(vacConflict!.severity, "WARNING");
  assert.equal(vacConflict!.values.length, 2, "conflict must record both values");
  assert.ok(
    vacConflict!.resolution?.selectedValue === 205,
    "resolution must select 205",
  );

  // Title has no conflict (both sources agree)
  assert.equal(draft.identity.title.conflict, false);
});

test("DB4: missing data — missingFields populated, readyForReview=false when title absent", () => {
  const source = makeSource("sparse-src");
  const extraction = makeExtraction({
    // no title, no notifNum, no vacancies, no dates
    title: undefined,
    notificationNumber: undefined,
    totalVacancies: undefined,
    applicationOpenDate: undefined,
    applicationCloseDate: undefined,
    officialLinksFound: [],
    confidence: 0.2,
    sourceKind: "UNKNOWN",
  });

  const draft = mapExtractionsToDraft([source], [{ source, extraction }]);

  // Key fields absent
  assert.equal(draft.identity.title.value, undefined);
  assert.equal(draft.identity.notificationNumber.value, undefined);

  // Missing fields recorded
  assert.ok(draft.missingFields.includes("identity.title"), "identity.title must be in missingFields");
  assert.ok(
    draft.missingFields.includes("identity.notificationNumber"),
    "identity.notificationNumber must be in missingFields",
  );
  assert.ok(
    draft.missingFields.includes("vacancies.total"),
    "vacancies.total must be in missingFields",
  );

  // Readiness blocks when title is missing
  assert.equal(draft.readiness.readyForReview, false);
  assert.ok(
    draft.readiness.blockingIssues.some((i) => i.toLowerCase().includes("title")),
    `expected title in blockingIssues: ${draft.readiness.blockingIssues}`,
  );
});

test("DB5: HttpRetriever.canHandle() accepts http/https, rejects other schemes", () => {
  const retriever = new HttpRetriever();

  assert.equal(retriever.canHandle(new URL("https://example.com/page")), true);
  assert.equal(retriever.canHandle(new URL("http://example.com/page")), true);
  assert.equal(retriever.canHandle(new URL("ftp://example.com/file")), false);
  assert.equal(retriever.canHandle(new URL("data:text/html,hello")), false);
});

test("DB6: failed retrieval — source recorded, extraction skipped, all key fields missing", async () => {
  const draft = await buildDraft(
    ["https://example.com/recruitment"],
    new FailingRetriever(),
  );

  // Source is recorded even though retrieval failed
  assert.equal(draft.sources.length, 1, "source should be recorded");
  assert.equal(draft.sources[0].success, false, "source.success should be false");

  // No extraction was possible → all key fields missing
  assert.ok(draft.missingFields.includes("identity.title"));
  assert.ok(draft.missingFields.includes("vacancies.total"));

  // Ready for review = false (title blocking)
  assert.equal(draft.readiness.readyForReview, false);
});

test("DB7: same PDF link from two sources appears once in links[]", () => {
  const src1 = makeSource("src-1", "OFFICIAL");
  const src2 = makeSource("src-2", "SECONDARY");
  const PDF_URL = "https://bankofindia.co.in/ao2026/notification.pdf";

  const ext1 = makeExtraction({
    title: "BOI AO 2026",
    notifPdfUrl: PDF_URL,
    sourceKind: "OFFICIAL_SPECIFIC",
  });
  const ext2 = makeExtraction({
    title: "BOI AO 2026",
    notifPdfUrl: PDF_URL,
    sourceKind: "THIRD_PARTY",
  });

  const draft = mapExtractionsToDraft(
    [src1, src2],
    [
      { source: src1, extraction: ext1 },
      { source: src2, extraction: ext2 },
    ],
  );

  const pdfLinks = draft.links.filter((l) => l.url === PDF_URL);
  assert.equal(pdfLinks.length, 1, "duplicate PDF link must be deduplicated");
  assert.equal(pdfLinks[0].type, "OFFICIAL_NOTIFICATION");
  assert.equal(pdfLinks[0].official, true, "link from OFFICIAL source is marked official");
});

test("DB9: organization mapping — UIIC source → organizationId and name populated", () => {
  const sourceId = "uiic-src";
  const source: IntelligenceSource = {
    ...makeSource(sourceId, "OFFICIAL"),
    organizationId: "uiicl",
  };

  const extraction = makeExtraction({
    title: "UIIC AO Recruitment 2026",
    notificationNumber: "UIIC/AO/2026/01",
    sourceKind: "OFFICIAL_SPECIFIC",
    confidence: 0.9,
  });

  const draft = mapExtractionsToDraft(
    [source],
    [{ source, extraction, orgName: "United India Insurance Company Limited" }],
  );

  assert.equal(draft.identity.organizationId.value, "uiicl", "organizationId must be uiicl");
  assert.equal(
    draft.identity.organizationName.value,
    "United India Insurance Company Limited",
    "organizationName must be full UIIC name",
  );
  assert.equal(draft.identity.organizationId.conflict, false, "single source → no conflict");
  assert.equal(draft.identity.organizationId.evidence.length, 1);
  assert.equal(draft.identity.organizationId.evidence[0].sourceId, sourceId);
  assert.equal(draft.identity.organizationId.confidence, 1.0, "org from official domain is certain");
});

test("DB10: date conflict — official Sep 25, secondary Sep 30 → both preserved, official wins", () => {
  const officialSrc = makeSource("src-off", "OFFICIAL");
  const secondarySrc = makeSource("src-sec", "SECONDARY");

  const officialExt = makeExtraction({
    applicationCloseDate: "2026-09-25",
    sourceKind: "OFFICIAL_SPECIFIC",
    confidence: 0.85,
  });
  const secondaryExt = makeExtraction({
    applicationCloseDate: "2026-09-30",
    sourceKind: "THIRD_PARTY",
    confidence: 0.60,
  });

  const draft = mapExtractionsToDraft(
    [officialSrc, secondarySrc],
    [
      { source: officialSrc, extraction: officialExt },
      { source: secondarySrc, extraction: secondaryExt },
    ],
  );

  // Official date selected as winner
  assert.equal(draft.dates.applicationCloseDate?.date, "2026-09-25", "official date must win");
  assert.equal(draft.dates.applicationCloseDate?.selectedSourceId, officialSrc.id);

  // Conflict flagged directly on the date field
  assert.equal(
    draft.dates.applicationCloseDate?.conflict,
    true,
    "conflict must be true on the date object",
  );

  // Both date values preserved in evidence (not discarded)
  const evidence = draft.dates.applicationCloseDate!.sourceEvidence;
  assert.equal(evidence.length, 2, "both sources' evidence must be present");
  const dateValues = evidence.map((e) => e.value as string).sort();
  assert.deepEqual(dateValues, ["2026-09-25", "2026-09-30"], "both dates must be in evidence");

  // IntelligenceConflict entry created
  const dateConflict = draft.conflicts.find((c) => c.field === "dates.applicationCloseDate");
  assert.ok(dateConflict, "conflicts[] must contain applicationCloseDate conflict");
  assert.equal(dateConflict!.severity, "WARNING");
  assert.equal(dateConflict!.values.length, 2, "both conflicting values must be listed");
  assert.ok(
    dateConflict!.resolution?.selectedValue === "2026-09-25",
    "resolution must select the official date",
  );
});

test("DB11: multi-source BOI (official + 2 secondary) → org, vacancies, dates, conflict", () => {
  const BOI_ORG_ID = "boi";
  const BOI_ORG_NAME = "Bank of India";

  const officialSrc: IntelligenceSource = {
    ...makeSource("boi-official", "OFFICIAL"),
    organizationId: BOI_ORG_ID,
  };
  const gjjSrc = makeSource("gjj-secondary", "SECONDARY");
  const addaSrc = makeSource("adda-secondary", "SECONDARY");

  const officialExt = makeExtraction({
    title: "Bank of India Specialist Officer Recruitment 2026",
    notificationNumber: "BOI/SO/2026/01",
    totalVacancies: 205,
    applicationOpenDate: "2026-09-10",
    applicationCloseDate: "2026-09-25",
    sourceKind: "OFFICIAL_SPECIFIC",
    confidence: 0.9,
  });
  const gjjExt = makeExtraction({
    title: "Bank of India Specialist Officer Recruitment 2026",
    notificationNumber: "BOI/SO/2026/01",
    totalVacancies: 207,                   // disagrees on vacancies
    applicationOpenDate: "2026-09-10",
    applicationCloseDate: "2026-09-25",    // agrees on close date
    sourceKind: "THIRD_PARTY",
    confidence: 0.65,
  });
  const addaExt = makeExtraction({
    title: "BOI SO Recruitment 2026",
    totalVacancies: 207,
    applicationOpenDate: "2026-09-10",
    applicationCloseDate: "2026-09-30",    // disagrees on close date
    sourceKind: "THIRD_PARTY",
    confidence: 0.55,
  });

  const draft = mapExtractionsToDraft(
    [officialSrc, gjjSrc, addaSrc],
    [
      { source: officialSrc, extraction: officialExt, orgName: BOI_ORG_NAME },
      { source: gjjSrc, extraction: gjjExt },
      { source: addaSrc, extraction: addaExt },
    ],
  );

  // ── Sources ───────────────────────────────────────────────
  assert.equal(draft.sources.length, 3);
  assert.equal(
    draft.sources.filter((s) => s.kind === "OFFICIAL").length,
    1,
    "exactly 1 official source",
  );
  assert.equal(
    draft.sources.filter((s) => s.kind === "SECONDARY").length,
    2,
    "exactly 2 secondary sources",
  );

  // ── Organization ──────────────────────────────────────────
  assert.equal(draft.identity.organizationId.value, BOI_ORG_ID);
  assert.equal(draft.identity.organizationName.value, BOI_ORG_NAME);

  // ── Vacancies: official 205 wins over secondary 207 ───────
  assert.equal(draft.vacancies.total?.value, 205, "official vacancy count must win");
  assert.equal(draft.vacancies.total?.conflict, true, "vacancy conflict must be flagged");

  const vacEvidence = draft.vacancies.total!.evidence;
  assert.ok(vacEvidence.length >= 2, "vacancy evidence must span multiple sources");
  const vacValues = [...new Set(vacEvidence.map((e) => e.value as number))].sort((a, b) => a - b);
  assert.deepEqual(vacValues, [205, 207], "both vacancy values preserved");

  // ── Dates: official/GJJ Sep 25 wins over Adda Sep 30 ─────
  assert.equal(
    draft.dates.applicationCloseDate?.date,
    "2026-09-25",
    "official close date must win",
  );
  assert.equal(
    draft.dates.applicationCloseDate?.conflict,
    true,
    "close date conflict must be flagged",
  );

  const closeDateConflict = draft.conflicts.find(
    (c) => c.field === "dates.applicationCloseDate",
  );
  assert.ok(closeDateConflict, "date conflict must be in conflicts[]");

  // Open date: all 3 agree — no conflict
  assert.equal(draft.dates.applicationOpenDate?.date, "2026-09-10");
  assert.ok(
    !draft.dates.applicationOpenDate?.conflict,
    "open date has no conflict (all agree)",
  );

  // ── Field-level provenance ────────────────────────────────
  assert.ok(
    draft.identity.title.evidence.length >= 1,
    "title must have source evidence",
  );
  assert.ok(
    draft.vacancies.total!.evidence.every((e) => e.sourceId && e.url),
    "all vacancy evidence must have sourceId and url",
  );

  // ── Draft readiness ───────────────────────────────────────
  assert.equal(
    draft.readiness.readyForReview,
    true,
    "draft with title must be ready for review",
  );
});

test("DB8: ConflictValue entries preserve sourceKind from their source", () => {
  const officialId = "src-off";
  const secondaryId = "src-sec";

  const draft = mapExtractionsToDraft(
    [makeSource(officialId, "OFFICIAL"), makeSource(secondaryId, "SECONDARY")],
    [
      {
        source: makeSource(officialId, "OFFICIAL"),
        extraction: makeExtraction({ totalVacancies: 100, sourceKind: "OFFICIAL_SPECIFIC" }),
      },
      {
        source: makeSource(secondaryId, "SECONDARY"),
        extraction: makeExtraction({ totalVacancies: 102, sourceKind: "THIRD_PARTY" }),
      },
    ],
  );

  const conflict = draft.conflicts.find((c) => c.field === "vacancies.total");
  assert.ok(conflict, "conflict entry must exist");

  const kinds = conflict!.values.map((v) => v.sourceKind);
  assert.ok(kinds.includes("OFFICIAL"), "conflict values must include OFFICIAL kind");
  assert.ok(kinds.includes("SECONDARY"), "conflict values must include SECONDARY kind");
});
