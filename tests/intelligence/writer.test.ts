// Phase 6B: Writer tests (W1–W8)
//
// All tests inject a temp dataPath and small governmentRecords array.
// The real src/data/government.ts is never touched.
// productionWrites in the intelligence engine sense remains 0;
// writer.ts itself is the one production path — tested here in isolation.

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";

import type { GovernmentRecruitment, ExamStageStatus } from "@/types";
import type { ReviewItem, FieldDiff, ProposedChange } from "@/intelligence/types";
import { commitApprovedChange } from "@/intelligence/writer";

// ─── Helpers ─────────────────────────────────────────────────

const TMP_DIR = join(process.cwd(), "intelligence-runs");

function tmpPath(ext = "ts"): string {
  return join(TMP_DIR, `test-writer-${randomUUID()}.${ext}`);
}

const tempFiles: string[] = [];
function track(p: string): string { tempFiles.push(p); return p; }

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function fd(field: string, canonical: string, observed: string): FieldDiff {
  return { field, canonicalValue: canonical, observedValue: observed, confidence: 0.95, extractionMethod: "REGEX" };
}

// Minimal GovernmentRecruitment for tests
// Uses a registered organizationId ("bpsc") and includes primarySourceUrl
// so the Trust Gate passes without touching real records.
function makeGov(id = "test-gov-001"): GovernmentRecruitment {
  return {
    id,
    slug: id,
    type: "government",
    title: "BPSC Writer Test Exam",
    organizationId: "bpsc",
    organizationName: "Bihar Public Service Commission (BPSC)",
    notificationNumber: `Writer-Test/${id}`,
    govType: "State Govt",
    shortDescription: "Test record used by writer.test.ts — not a real recruitment.",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-01-01",
    totalVacancies: 1000,
    vacanciesDisplay: "1,000 Vacancies",
    examStages: [
      { name: "Preliminary", order: 1, status: "SCHEDULED" as ExamStageStatus, dateIso: "2026-09-15", dateDisplay: "15 Sep 2026" },
    ],
    application: { notificationDate: "2026-01-01", openDate: "2026-01-15", closeDate: "2026-03-31" },
    links: { apply: "https://bpsc.bih.nic.in/apply", website: "https://bpsc.bih.nic.in" },
    provenance: {
      status: "VERIFIED",
      lastVerifiedAt: "2026-08-01",
      primarySourceType: "OFFICIAL_NOTIFICATION",
      primarySourceUrl: "https://bpsc.bih.nic.in/notice/writer-test",
    },
  };
}

// Build a ReviewItem that is already APPROVED with a ProposedChange
function makeApprovedItem(
  govId: string,
  fieldDiffs: FieldDiff[],
  overrides: Partial<ReviewItem> = {}
): ReviewItem {
  const id = randomUUID();

  // Pre-approved ProposedChange (simulates what approveItem() would set)
  const approvedChange: ProposedChange = {
    reviewItemId: id,
    opportunityId: govId,
    approvedAt: new Date().toISOString(),
    appliedFieldDiffs: fieldDiffs,
    skippedPaths: [],
    trustGatePassed: true,
    trustGateErrors: [],
    trustGateWarnings: [],
    productionWriteAttempted: false,
  };

  return {
    id,
    dedupKey: `${govId}::EXAM_DATE_CHANGE::advt-01-2026`,
    queuedAt: new Date().toISOString(),
    status: "APPROVED",
    opportunityId: govId,
    opportunityTitle: "Test Recruitment Board Exam",
    changeType: "EXAM_DATE_CHANGE",
    matchedIdentifier: "Advt No. 01/2026",
    secondarySource: "sarkari-result",
    secondarySourceUrl: "https://sarkariresult.com/example",
    officialConfirmationSource: "official-site",
    officialConfirmationUrl: "https://example.gov.in/notice.pdf",
    officialEvidence: "The exam previously scheduled for 15 Sep 2026 is now on 20 Oct 2026.",
    confidence: 0.95,
    fieldDiffs,
    runId: randomUUID(),
    detectedAt: new Date().toISOString(),
    eventId: randomUUID(),
    approvedChange,
    ...overrides,
  };
}

// ─── W1: PENDING item → refused ──────────────────────────────

console.log("\nW1: commitApprovedChange — PENDING item refused");
{
  const gov = makeGov();
  const item = makeApprovedItem(gov.id, [], { status: "PENDING", approvedChange: undefined });
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [gov], { dataPath, governmentRecords: [gov] });
  check("committed=false", !r.committed);
  check("refuseReason mentions PENDING", r.refuseReason?.includes("PENDING") ?? false);
  check("data file not created", !existsSync(dataPath));
}

// ─── W2: APPROVED but no ProposedChange → refused ────────────

console.log("\nW2: commitApprovedChange — no ProposedChange");
{
  const gov = makeGov();
  const item = makeApprovedItem(gov.id, [], { approvedChange: undefined });
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [gov], { dataPath, governmentRecords: [gov] });
  check("committed=false", !r.committed);
  check("refuseReason mentions ProposedChange", r.refuseReason?.toLowerCase().includes("proposedchange") ?? false);
  check("data file not created", !existsSync(dataPath));
}

// ─── W3: Trust Gate failed → refused ─────────────────────────

console.log("\nW3: commitApprovedChange — Trust Gate failed at approve time");
{
  const gov = makeGov();
  const item = makeApprovedItem(gov.id, [], {
    approvedChange: {
      reviewItemId: randomUUID(),
      opportunityId: gov.id,
      approvedAt: new Date().toISOString(),
      appliedFieldDiffs: [],
      skippedPaths: [],
      trustGatePassed: false,           // ← failed TG
      trustGateErrors: ["Record lacks required provenance.primarySourceUrl"],
      trustGateWarnings: [],
      productionWriteAttempted: false,
    },
  });
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [gov], { dataPath, governmentRecords: [gov] });
  check("committed=false", !r.committed);
  check("refuseReason mentions Trust Gate", r.refuseReason?.toLowerCase().includes("trust gate") ?? false);
  check("data file not created", !existsSync(dataPath));
}

// ─── W4: unknown opportunityId → refused ─────────────────────

console.log("\nW4: commitApprovedChange — opportunity not in dataset");
{
  const gov = makeGov("real-gov-001");
  const item = makeApprovedItem("ghost-gov-999", []);
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [gov], { dataPath, governmentRecords: [gov] });
  check("committed=false", !r.committed);
  check("refuseReason mentions opportunityId", r.refuseReason?.includes("ghost-gov-999") ?? false);
  check("data file not created", !existsSync(dataPath));
}

// ─── W5: already committed → refused ─────────────────────────

console.log("\nW5: commitApprovedChange — already committed (duplicate)");
{
  const gov = makeGov();
  const item = makeApprovedItem(gov.id, []);
  const commitId = `rie-${item.id.slice(0, 8)}`;

  // Inject the commitId into the existing updates to simulate a prior commit
  const govWithUpdate: GovernmentRecruitment = {
    ...gov,
    updates: [{
      id: commitId,
      date: "2026-08-20",
      type: "GENERAL_NOTICE",
      title: "Prior commit",
      description: "committed earlier",
    }],
  };
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [govWithUpdate], { dataPath, governmentRecords: [govWithUpdate] });
  check("committed=false", !r.committed);
  check("refuseReason mentions already committed", r.refuseReason?.includes("already been committed") ?? false);
  check("data file not created", !existsSync(dataPath));
}

// ─── W6: successful commit — stage date change ───────────────

console.log("\nW6: commitApprovedChange — successful commit, exam date field");
{
  const gov = makeGov();
  const diffs = [fd("examStages[0].date", "2026-09-15", "2026-10-20")];
  const item = makeApprovedItem(gov.id, diffs);
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [gov], { dataPath, governmentRecords: [gov] });
  check("committed=true", r.committed);
  check("no refuseReason", !r.refuseReason);
  check("fieldsWritten includes examStages[0].date", r.fieldsWritten.includes("examStages[0].date"));
  check("data file created", existsSync(dataPath));

  // Verify file content
  const content = readFileSync(dataPath, "utf-8");
  check("file contains 2026-10-20 (new date)", content.includes("2026-10-20"));
  check("file has GovernmentRecruitment import", content.includes('import type { GovernmentRecruitment }'));
  check("file has export const GOVERNMENT_RECRUITMENTS", content.includes("export const GOVERNMENT_RECRUITMENTS"));

  // Verify UpdateRecord was added
  const arrStart = content.indexOf("= [");
  const jsonStr = content.slice(arrStart + 2).replace(/;\s*$/, "").trim();
  const parsed = JSON.parse(jsonStr) as GovernmentRecruitment[];
  const updatedRec = parsed.find((r) => r.id === gov.id)!
  check("UpdateRecord added", (updatedRec.updates ?? []).length > 0);
  check("UpdateRecord id matches commitId", updatedRec.updates[0].id === `rie-${item.id.slice(0, 8)}`);
  check("UpdateRecord type = RESCHEDULE", updatedRec.updates[0].type === "RESCHEDULE");
}

// ─── W7: successful commit — vacancy change ──────────────────

console.log("\nW7: commitApprovedChange — successful commit, vacancy field");
{
  const gov = makeGov();
  const diffs = [fd("totalVacancies", "1000", "1200")];
  const item = makeApprovedItem(gov.id, diffs, { changeType: "VACANCY_CHANGE" });
  const dataPath = track(tmpPath());

  const r = commitApprovedChange(item, [gov], { dataPath, governmentRecords: [gov] });
  check("committed=true", r.committed);
  check("fieldsWritten includes totalVacancies", r.fieldsWritten.includes("totalVacancies"));

  const content = readFileSync(dataPath, "utf-8");
  check("file contains 1200 (new vacancy count)", content.includes("1200"));

  const arrStart2 = content.indexOf("= [");
  const jsonStr2 = content.slice(arrStart2 + 2).replace(/;\s*$/, "").trim();
  const parsed2 = JSON.parse(jsonStr2) as GovernmentRecruitment[];
  const rec = parsed2.find((r) => r.id === gov.id)!;
  check("totalVacancies updated to 1200", rec.totalVacancies === 1200);
  check("UpdateRecord type = VACANCY_REVISION", rec.updates[0].type === "VACANCY_REVISION");
}

// ─── W8: src/data/government.ts not touched during all tests ──

console.log("\nW8: src/data/government.ts not modified by writer tests");
{
  const realPath = "src/data/government.ts";
  if (existsSync(realPath)) {
    const ageMs = Date.now() - statSync(realPath).mtimeMs;
    check(`real government.ts not modified in last 30s (age=${Math.round(ageMs/1000)}s)`, ageMs > 30_000);
  } else {
    check("real government.ts path checked", true);
  }
}

// ─── Cleanup ─────────────────────────────────────────────────

for (const f of tempFiles) {
  if (existsSync(f)) unlinkSync(f);
}

console.log("\n✅ All W1–W8 writer tests passed\n");
