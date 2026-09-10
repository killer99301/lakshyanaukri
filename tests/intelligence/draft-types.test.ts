// ═══════════════════════════════════════════════════════════
// Phase 10: RecruitmentIntelligenceDraft schema tests
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  DT1  FieldValue: official evidence wins over secondary on conflict
//  DT2  VacancyData: derivedTotal computation from rows
//  DT3  resolveSourceAuthority: correct authority ranking
//  DT4  IntelligenceConflict: conflicting vacancy values are preserved
//  DT5  RecruitmentIntelligenceDraft: BOI golden draft construction
//  DT6  RecruitmentIntelligenceDraft: UIIC draft with derived vacancy total
//  DT7  DraftReadiness: blocking issue when official source absent
//  DT8  FieldValue: manuallyEdited tracks override without erasing evidence

import { suite, test, assert } from "./suite";
import type {
  RecruitmentIntelligenceDraft,
  IntelligenceSource,
  FieldValue,
  FieldEvidence,
  VacancyData,
  VacancyRow,
  IntelligenceConflict,
  DraftReadiness,
} from "@/intelligence/draft-types";
import { resolveSourceAuthority } from "@/intelligence/draft-types";

suite("RecruitmentIntelligenceDraft Schema (Phase 10)");

// ─── Helpers ─────────────────────────────────────────────────

function makeSource(
  id: string,
  kind: IntelligenceSource["kind"],
  url: string
): IntelligenceSource {
  return {
    id,
    url,
    domain: new URL(url).hostname,
    kind,
    retrievedAt: "2026-09-10T14:00:00.000Z",
    success: true,
  };
}

function makeEvidence(
  sourceId: string,
  url: string,
  value: unknown,
  authorityRank: number,
  confidence: number
): FieldEvidence {
  return {
    sourceId,
    url,
    value,
    confidence,
    authorityRank,
    extractionMethod: "STRUCTURED",
    extractedAt: "2026-09-10T14:00:00.000Z",
  };
}

function makeField<T>(
  value: T,
  sourceId: string,
  url: string,
  authorityRank: number,
  confidence: number,
  allEvidence?: FieldEvidence[]
): FieldValue<T> {
  const primary = makeEvidence(sourceId, url, value, authorityRank, confidence);
  return {
    value,
    confidence,
    selectedSourceId: sourceId,
    evidence: allEvidence ?? [primary],
    manuallyEdited: false,
    conflict: false,
  };
}

// ─── DT1: FieldValue conflict resolution ─────────────────────

test("DT1: official evidence wins over secondary on conflict", () => {
  const officialEvidence = makeEvidence(
    "boi-official",
    "https://bankofindia.co.in/recruitment",
    205,
    4,
    0.95
  );
  const secondaryEvidence = makeEvidence(
    "govtjobguru",
    "https://govtjobguru.in/boi-so-2026",
    207,
    1,
    0.70
  );

  const field: FieldValue<number> = {
    value: 205,
    confidence: 0.95,
    selectedSourceId: "boi-official",
    evidence: [officialEvidence, secondaryEvidence],
    manuallyEdited: false,
    conflict: true,
  };

  assert.equal(field.value, 205, "official value should win");
  assert.equal(field.selectedSourceId, "boi-official");
  assert.equal(field.conflict, true, "conflict flag must be set");
  assert.equal(field.evidence.length, 2, "all evidence preserved — never discard");

  const secondaryInEvidence = field.evidence.find(
    (e) => e.sourceId === "govtjobguru"
  );
  assert.ok(secondaryInEvidence, "conflicting secondary evidence must be retained");
  assert.equal(secondaryInEvidence!.value, 207, "conflicting value preserved");
});

// ─── DT2: VacancyData derived total ──────────────────────────

test("DT2: derivedTotal is computed from rows when no explicit total", () => {
  const evidence = makeEvidence(
    "uiic-official",
    "https://uiic.co.in/web/recruitment/details/1620",
    200,
    4,
    0.92
  );

  const rows: VacancyRow[] = [
    {
      id: "row-1",
      postName: "Administrative Officer – Generalist",
      total: 200,
      sourceEvidence: [evidence],
      manuallyEdited: false,
    },
    {
      id: "row-2",
      postName: "Administrative Officer – Hindi Officer",
      total: 25,
      sourceEvidence: [
        makeEvidence(
          "uiic-official",
          "https://uiic.co.in/web/recruitment/details/1620",
          25,
          4,
          0.90
        ),
      ],
      manuallyEdited: false,
    },
  ];

  const derivedTotal = rows.reduce((sum, r) => sum + (r.total ?? 0), 0);

  const vacancies: VacancyData = {
    rows,
    derivedTotal,
    derivedTotalExplanation: "Sum of 2 post rows: Generalist (200) + Hindi Officer (25)",
    isIndicative: false,
  };

  assert.equal(derivedTotal, 225, "derived total must equal sum of rows");
  assert.equal(vacancies.derivedTotal, 225);
  assert.ok(!vacancies.total, "explicit total must not be set when source didn't state it");
  assert.ok(
    vacancies.derivedTotalExplanation?.includes("200"),
    "explanation must reference component values"
  );
});

// ─── DT3: resolveSourceAuthority ─────────────────────────────

test("DT3: resolveSourceAuthority returns correct ranks", () => {
  assert.equal(resolveSourceAuthority("OFFICIAL"), 4);
  assert.equal(resolveSourceAuthority("APPLICATION_PORTAL"), 3);
  assert.equal(resolveSourceAuthority("RESULT_PORTAL"), 3);
  assert.equal(resolveSourceAuthority("SECONDARY"), 1);
  assert.equal(resolveSourceAuthority("OTHER"), 0);

  // Official always beats secondary
  assert.ok(
    resolveSourceAuthority("OFFICIAL") > resolveSourceAuthority("SECONDARY"),
    "official rank must exceed secondary"
  );
});

// ─── DT4: Conflict model preserves all values ─────────────────

test("DT4: IntelligenceConflict preserves all conflicting values", () => {
  const conflict: IntelligenceConflict = {
    field: "vacancies.total",
    values: [
      {
        value: 225,
        sourceId: "uiic-official",
        url: "https://uiic.co.in/web/recruitment/details/1620",
        sourceKind: "OFFICIAL",
        confidence: 0.95,
      },
      {
        value: 237,
        sourceId: "adda247",
        url: "https://www.adda247.com/jobs/uiic-ao-recruitment/",
        sourceKind: "SECONDARY",
        confidence: 0.70,
      },
    ],
    resolution: {
      selectedValue: 225,
      reason: "Official source has higher authority",
      selectedSourceId: "uiic-official",
    },
    severity: "WARNING",
  };

  assert.equal(conflict.values.length, 2, "all conflicting values must be stored");
  assert.equal(conflict.resolution?.selectedValue, 225, "official value selected");
  assert.equal(conflict.severity, "WARNING");

  // The secondary value must still be in the conflict record
  const secondaryValue = conflict.values.find((v) => v.sourceId === "adda247");
  assert.ok(secondaryValue, "secondary conflicting value must be preserved");
  assert.equal(secondaryValue!.value, 237);
});

// ─── DT5: BOI golden draft ────────────────────────────────────

test("DT5: BOI Specialist Officer Recruitment 2026 draft construction", () => {
  const boiOfficial = makeSource(
    "boi-official",
    "OFFICIAL",
    "https://bankofindia.co.in/web/guestuser/so-recruitment-2026-27-02"
  );
  const govtjobguru = makeSource(
    "govtjobguru",
    "SECONDARY",
    "https://govtjobguru.in/boi-specialist-officer-2026"
  );
  const adda247 = makeSource(
    "adda247",
    "SECONDARY",
    "https://www.adda247.com/jobs/boi-so-recruitment-2026/"
  );

  const draft: RecruitmentIntelligenceDraft = {
    id: "draft-boi-so-2026",
    createdAt: "2026-09-10T14:00:00.000Z",
    updatedAt: "2026-09-10T14:00:00.000Z",

    sources: [boiOfficial, govtjobguru, adda247],

    identity: {
      title: makeField(
        "Specialist Officer Recruitment 2026",
        "boi-official",
        boiOfficial.url,
        4,
        0.97
      ),
      shortTitle: makeField("BOI SO Recruitment 2026", "govtjobguru", govtjobguru.url, 1, 0.85),
      organizationId: makeField("boi", "boi-official", boiOfficial.url, 4, 0.99),
      organizationName: makeField("Bank of India", "boi-official", boiOfficial.url, 4, 0.99),
      recruitmentYear: makeField(2026, "boi-official", boiOfficial.url, 4, 0.99),
      notificationNumber: makeField("2026-27/02", "boi-official", boiOfficial.url, 4, 0.95),
      advertisementNumber: makeField("2026-27/02", "boi-official", boiOfficial.url, 4, 0.95),
      recruitmentType: makeField("new_notice", "boi-official", boiOfficial.url, 4, 0.90),
    },

    dates: {
      applicationOpenDate: {
        date: "2026-09-10",
        certainty: "CONFIRMED",
        sourceEvidence: [
          makeEvidence("boi-official", boiOfficial.url, "2026-09-10", 4, 0.97),
        ],
        manuallyEdited: false,
      },
      applicationCloseDate: {
        date: "2026-09-25",
        certainty: "CONFIRMED",
        sourceEvidence: [
          makeEvidence("boi-official", boiOfficial.url, "2026-09-25", 4, 0.97),
        ],
        manuallyEdited: false,
      },
      examDate: {
        certainty: "TBA",
        sourceEvidence: [],
        manuallyEdited: false,
      },
    },

    vacancies: {
      total: makeField(205, "boi-official", boiOfficial.url, 4, 0.95),
      isIndicative: false,
      rows: [
        {
          id: "row-cm-fullstack",
          postName: "Chief Manager – Full-Stack Engineering",
          total: 2,
          sourceEvidence: [makeEvidence("boi-official", boiOfficial.url, 2, 4, 0.90)],
          manuallyEdited: false,
        },
        {
          id: "row-cm-digital",
          postName: "Chief Manager – Digital Platforms",
          total: 1,
          sourceEvidence: [makeEvidence("boi-official", boiOfficial.url, 1, 4, 0.90)],
          manuallyEdited: false,
        },
      ],
    },

    posts: [],
    eligibility: undefined,
    postEligibility: [],
    pay: undefined,
    selection: undefined,

    links: [
      {
        type: "OFFICIAL_NOTIFICATION",
        label: "Official Notification PDF",
        url: "https://bankofindia.co.in/notification-2026-27-02.pdf",
        sourceId: "boi-official",
        official: true,
      },
      {
        type: "APPLY_ONLINE",
        label: "Apply Online",
        url: "https://ibpsonline.ibps.in/boisoaug26/",
        sourceId: "boi-official",
        official: false,
      },
    ],

    lifecycle: [],

    conflicts: [],

    missingFields: ["dates.examDate"],

    overallConfidence: 0.93,

    readiness: {
      readyForReview: true,
      blockingIssues: [],
      warnings: ["Examination date not yet published"],
    },
  };

  // Structural assertions
  assert.equal(draft.sources.length, 3);
  assert.equal(
    draft.sources.filter((s) => s.kind === "OFFICIAL").length,
    1,
    "exactly one official source"
  );
  assert.equal(draft.identity.organizationName.value, "Bank of India");
  assert.equal(draft.vacancies.total?.value, 205);
  assert.equal(draft.vacancies.rows.length, 2);
  assert.equal(draft.conflicts.length, 0, "no conflicts in golden path");
  assert.ok(draft.readiness.readyForReview, "draft should be ready for review");
  assert.ok(draft.missingFields.includes("dates.examDate"), "missing exam date flagged");
  assert.ok(
    draft.links.some((l) => l.type === "OFFICIAL_NOTIFICATION" && l.official),
    "official notification link present"
  );
});

// ─── DT6: UIIC draft with derived vacancy ─────────────────────

test("DT6: UIIC AO 2026 draft with derived total (200+25=225)", () => {
  const uiicOfficial = makeSource(
    "uiic-official",
    "OFFICIAL",
    "https://uiic.co.in/web/recruitment/details/1620"
  );

  const rows: VacancyRow[] = [
    {
      id: "uiic-gen",
      postName: "Administrative Officer – Generalist",
      total: 200,
      sourceEvidence: [makeEvidence("uiic-official", uiicOfficial.url, 200, 4, 0.92)],
      manuallyEdited: false,
    },
    {
      id: "uiic-hindi",
      postName: "Administrative Officer – Hindi Officer",
      total: 25,
      sourceEvidence: [makeEvidence("uiic-official", uiicOfficial.url, 25, 4, 0.90)],
      manuallyEdited: false,
    },
  ];

  const derivedTotal = rows.reduce((sum, r) => sum + (r.total ?? 0), 0);
  assert.equal(derivedTotal, 225);

  const draft: RecruitmentIntelligenceDraft = {
    id: "draft-uiic-ao-2026",
    createdAt: "2026-09-10T14:00:00.000Z",
    updatedAt: "2026-09-10T14:00:00.000Z",
    sources: [uiicOfficial],
    identity: {
      title: makeField(
        "UIIC Administrative Officer Recruitment 2026",
        "uiic-official",
        uiicOfficial.url,
        4,
        0.95
      ),
      shortTitle: makeField("UIIC AO 2026", "uiic-official", uiicOfficial.url, 4, 0.90),
      organizationId: makeField("uiicl", "uiic-official", uiicOfficial.url, 4, 0.99),
      organizationName: makeField(
        "United India Insurance Company Limited",
        "uiic-official",
        uiicOfficial.url,
        4,
        0.99
      ),
      recruitmentYear: makeField(2026, "uiic-official", uiicOfficial.url, 4, 0.99),
      notificationNumber: makeField("AO/2026", "uiic-official", uiicOfficial.url, 4, 0.92),
      advertisementNumber: { value: undefined, confidence: 0, evidence: [], manuallyEdited: false, conflict: false },
      recruitmentType: makeField("new_notice", "uiic-official", uiicOfficial.url, 4, 0.90),
    },
    dates: {
      applicationOpenDate: {
        date: "2026-08-20",
        certainty: "CONFIRMED",
        sourceEvidence: [makeEvidence("uiic-official", uiicOfficial.url, "2026-08-20", 4, 0.93)],
        manuallyEdited: false,
      },
      applicationCloseDate: {
        date: "2026-09-10",
        certainty: "CONFIRMED",
        sourceEvidence: [makeEvidence("uiic-official", uiicOfficial.url, "2026-09-10", 4, 0.93)],
        manuallyEdited: false,
      },
    },
    vacancies: {
      rows,
      derivedTotal,
      derivedTotalExplanation: "Generalist (200) + Hindi Officer (25) = 225",
      isIndicative: false,
    },
    posts: [],
    postEligibility: [],
    links: [],
    lifecycle: [],
    conflicts: [],
    missingFields: [],
    overallConfidence: 0.91,
    readiness: {
      readyForReview: true,
      blockingIssues: [],
      warnings: [],
    },
  };

  assert.equal(draft.vacancies.derivedTotal, 225);
  assert.ok(!draft.vacancies.total, "no explicit total — only derived");
  assert.ok(
    draft.vacancies.derivedTotalExplanation?.includes("225"),
    "explanation must mention the derived total"
  );
  assert.equal(draft.identity.organizationId.value, "uiicl");
});

// ─── DT7: DraftReadiness blocking when no official source ─────

test("DT7: readiness is blocked when no official source is present", () => {
  const readiness: DraftReadiness = {
    readyForReview: false,
    blockingIssues: ["No official source identified — cannot verify organization or vacancy data"],
    warnings: [],
  };

  assert.equal(readiness.readyForReview, false);
  assert.ok(readiness.blockingIssues.length > 0);
  assert.ok(
    readiness.blockingIssues[0].toLowerCase().includes("official"),
    "blocking issue must mention official source"
  );
});

// ─── DT8: manuallyEdited preserves original evidence ──────────

test("DT8: manual edit tracks override without erasing evidence", () => {
  const machineEvidence = makeEvidence(
    "govtjobguru",
    "https://govtjobguru.in/boi-so-2026",
    "Specialist Officer Recruitment",
    1,
    0.80
  );

  // Admin manually corrects the title after machine extracted it wrong
  const field: FieldValue<string> = {
    value: "Specialist Officer Recruitment 2026-27/02",
    confidence: 1.0,
    selectedSourceId: undefined,  // manual edit — no source
    evidence: [machineEvidence],  // original evidence preserved
    manuallyEdited: true,
    conflict: false,
  };

  assert.equal(field.manuallyEdited, true);
  assert.equal(field.value, "Specialist Officer Recruitment 2026-27/02");
  assert.equal(field.evidence.length, 1, "machine evidence is preserved alongside the override");
  assert.equal(field.evidence[0].value, "Specialist Officer Recruitment", "original extracted value still present");
});
