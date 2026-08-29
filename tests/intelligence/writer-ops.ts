// Phase 6B Writer Operational Validation
//
// Exercises the full pipeline on a TEMPORARY copy of canonical data.
// Analogous to Phase 5's scheduler-ops.ts — tests the one operation
// that can actually mutate production state, under controlled conditions.
//
// What this proves:
//   ✅ A genuine ReviewItem (built from real GOVERNMENT_RECRUITMENTS)
//      flows correctly through approveItem() → commitApprovedChange()
//   ✅ The intended field changes; nothing else does
//   ✅ The written file is a valid dataset (post-write Trust Gate passes)
//   ✅ A second commit on the same item is rejected (Guard 5)
//   ✅ A tampered ProposedChange (trustGatePassed=false) is rejected (Guard 3)
//   ✅ src/data/ is never modified — only the temp file is written
//
// What it does NOT prove (covered by unit tests W1–W8):
//   - Guards 1, 2, 4 (status/ProposedChange/opportunity checks)
//   - Individual field serialization edge cases (B1–B8)

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { GovernmentRecruitment, Opportunity } from "@/types";
import type { ReviewItem, ChangeReviewQueue, FieldDiff } from "@/intelligence/types";
import { GOVERNMENT_RECRUITMENTS } from "@/data/government";
import { getAllOpportunities } from "@/lib/repository";
import { appendToReviewQueue, approveItem, loadReviewQueue } from "@/intelligence/review-queue";
import { commitApprovedChange } from "@/intelligence/writer";
import { runTrustGateBaseline } from "@/intelligence/trust-gate";

// ─── Temp file setup ─────────────────────────────────────────

const TEMP_QUEUE = join(process.cwd(), "intelligence-runs", `ops-writer-queue-${randomUUID()}.json`);
const TEMP_DATA  = join(process.cwd(), "intelligence-runs", `ops-writer-data-${randomUUID()}.ts`);

process.on("exit", () => {
  for (const f of [TEMP_QUEUE, TEMP_DATA]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

// ─── Helpers ─────────────────────────────────────────────────

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  if (!cond) process.exitCode = 1;
}

function parseWrittenFile(path: string): GovernmentRecruitment[] {
  const content = readFileSync(path, "utf-8");
  const arrStart = content.indexOf("= [");
  const jsonStr = content.slice(arrStart + 2).replace(/;\s*$/, "").trim();
  return JSON.parse(jsonStr);
}

function buildReviewItem(
  bpsc: GovernmentRecruitment,
  fieldDiffs: FieldDiff[]
): ReviewItem {
  const id = randomUUID();
  return {
    id,
    dedupKey: `${bpsc.id}::VACANCY_CHANGE::${bpsc.notificationNumber}`,
    queuedAt: new Date().toISOString(),
    status: "PENDING",
    opportunityId: bpsc.id,
    opportunityTitle: (bpsc as GovernmentRecruitment & { title?: string }).title ?? bpsc.id,
    changeType: "VACANCY_CHANGE",
    oldValue: fieldDiffs[0]?.canonicalValue,
    newValue: fieldDiffs[0]?.observedValue,
    matchedIdentifier: bpsc.notificationNumber,
    secondarySource: "ops-test-sarkari",
    secondarySourceUrl: "https://sarkariresult.com/bpsc/",
    officialConfirmationSource: "bpsc-application-portal",
    officialConfirmationUrl: "https://onlinebpsc.bihar.gov.in/main/home",
    officialEvidence: `Vacancy count revised from ${fieldDiffs[0]?.canonicalValue} to ${fieldDiffs[0]?.observedValue} as per official corrigendum.`,
    confidence: 0.97,
    disambiguationScore: "STRONG",
    fieldDiffs,
    runId: randomUUID(),
    detectedAt: new Date().toISOString(),
    eventId: randomUUID(),
    preRunSnapshotRef: "sha256:a688aa69d42eed56c02e2238c26f9c94792346f1429d7f1c2c6a162fa8994862",
    humanReviewRequired: true,
  };
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("\n── Phase 6B Writer Operational Validation ──────────────────────\n");

  // ── STEP 1: Target record ─────────────────────────────────────
  console.log("STEP 1: Target record from real GOVERNMENT_RECRUITMENTS\n");

  const bpsc = GOVERNMENT_RECRUITMENTS.find((r) => r.id === "bpsc-72nd-cce-2026");
  check("BPSC 72nd record found in GOVERNMENT_RECRUITMENTS", !!bpsc);
  if (!bpsc) { process.exitCode = 1; return; }

  const originalVacancies = bpsc.totalVacancies;
  const proposedVacancies = originalVacancies + 100;
  const fieldDiffs: FieldDiff[] = [{
    field: "totalVacancies",
    canonicalValue: String(originalVacancies),
    observedValue: String(proposedVacancies),
    confidence: 0.97,
    extractionMethod: "REGEX",
  }];

  console.log(`  Target:   ${bpsc.id}`);
  console.log(`  Field:    totalVacancies`);
  console.log(`  Change:   ${originalVacancies} → ${proposedVacancies} (fictional ops-test revision)\n`);

  // ── STEP 2: ReviewItem → temp queue ──────────────────────────
  console.log("STEP 2: Create ReviewItem and push to temp queue\n");

  const item = buildReviewItem(bpsc, fieldDiffs);
  appendToReviewQueue(item, TEMP_QUEUE);

  const afterQueue = loadReviewQueue(TEMP_QUEUE);
  check("Item in temp queue (1 entry)", afterQueue.items.length === 1);
  check("Item status is PENDING", afterQueue.items[0].status === "PENDING");
  check("Item has correct opportunityId", afterQueue.items[0].opportunityId === bpsc.id);
  check("Item has correct fieldDiff", afterQueue.items[0].fieldDiffs[0]?.field === "totalVacancies");

  // ── STEP 3: Human APPROVE ─────────────────────────────────────
  console.log("\nSTEP 3: approveItem() — runs Trust Gate against real dataset\n");

  const opportunities = getAllOpportunities();
  const proposal = approveItem(item.id, opportunities, "ops-test review approval", TEMP_QUEUE);

  check("Proposal generated", !!proposal);
  check("trustGatePassed = true", proposal?.trustGatePassed === true);
  check("appliedFieldDiffs contains totalVacancies", proposal?.appliedFieldDiffs.some((d) => d.field === "totalVacancies") ?? false);
  check("productionWriteAttempted = false", proposal?.productionWriteAttempted === false);
  check("skippedPaths is empty", (proposal?.skippedPaths.length ?? -1) === 0);
  check("No Trust Gate errors", (proposal?.trustGateErrors.length ?? -1) === 0);

  const afterApprove = loadReviewQueue(TEMP_QUEUE).items[0];
  check("Item status → APPROVED in queue", afterApprove.status === "APPROVED");
  check("Item has approvedChange stored", !!afterApprove.approvedChange);
  console.log(`  trustGateWarnings: ${proposal?.trustGateWarnings.length ?? 0} (not blocking)\n`);

  // ── STEP 4: commitApprovedChange → temp file ──────────────────
  console.log("STEP 4: commitApprovedChange() to temp file\n");

  const result = commitApprovedChange(afterApprove, opportunities, {
    dataPath: TEMP_DATA,
    governmentRecords: GOVERNMENT_RECRUITMENTS,
  });

  check("committed = true", result.committed);
  check("no refuseReason", !result.refuseReason);
  check("fieldsWritten includes totalVacancies", result.fieldsWritten.includes("totalVacancies"));
  check("temp data file was created", existsSync(TEMP_DATA));
  if (result.refuseReason) console.log(`  refuseReason: ${result.refuseReason}`);
  const mtimeAfterCommit = statSync(TEMP_DATA).mtimeMs;

  // ── STEP 5: Verify written file ───────────────────────────────
  console.log("\nSTEP 5: Verify file content — target field changed correctly\n");

  const written = parseWrittenFile(TEMP_DATA);
  const updatedBpsc = written.find((r) => r.id === "bpsc-72nd-cce-2026")!;

  check("BPSC record present in output", !!updatedBpsc);
  check(`totalVacancies updated to ${proposedVacancies}`, updatedBpsc?.totalVacancies === proposedVacancies);
  const displayFormatted = proposedVacancies.toLocaleString();
  check(
    `vacanciesDisplay updated (contains "${displayFormatted}")`,
    updatedBpsc?.vacanciesDisplay?.includes(displayFormatted) ?? false
  );
  check("UpdateRecord added to updates[]", (updatedBpsc?.updates?.length ?? 0) > 0);

  const updateRec = updatedBpsc?.updates?.[updatedBpsc.updates.length - 1];
  const expectedCommitId = `rie-${afterApprove.id.slice(0, 8)}`;
  check(`UpdateRecord.id = ${expectedCommitId}`, updateRec?.id === expectedCommitId);
  check("UpdateRecord.type = VACANCY_REVISION", updateRec?.type === "VACANCY_REVISION");
  check("UpdateRecord.field = totalVacancies", updateRec?.field === "totalVacancies");
  check(`UpdateRecord.previousValue = "${originalVacancies}"`, updateRec?.previousValue === String(originalVacancies));
  check(`UpdateRecord.newValue = "${proposedVacancies}"`, updateRec?.newValue === String(proposedVacancies));

  // ── STEP 6: Unrelated records byte-for-byte unchanged ─────────
  console.log("\nSTEP 6: Unrelated records unchanged\n");

  const otherOriginals = GOVERNMENT_RECRUITMENTS.filter((r) => r.id !== bpsc.id);
  check(`${otherOriginals.length} other record(s) to verify`, otherOriginals.length > 0);

  for (const orig of otherOriginals) {
    const inOutput = written.find((r) => r.id === orig.id);
    check(`${orig.id}: present in output`, !!inOutput);
    if (inOutput) {
      const match = JSON.stringify(orig) === JSON.stringify(inOutput);
      check(`${orig.id}: content unchanged`, match);
    }
  }

  // ── STEP 7: Post-write Trust Gate ─────────────────────────────
  console.log("\nSTEP 7: Post-write Trust Gate on written dataset\n");

  const writtenAsOpps: Opportunity[] = written;
  const tg = runTrustGateBaseline(writtenAsOpps);
  check("Trust Gate passes on written dataset", tg.passed);
  check("Zero Trust Gate errors", tg.errors.length === 0);
  if (tg.warnings.length > 0) {
    console.log(`  (${tg.warnings.length} warning(s) — not blocking):`);
    for (const w of tg.warnings) console.log(`    ⚠️  ${w.message}`);
  }

  // ── STEP 8: Second commit rejected (Guard 5) ──────────────────
  console.log("\nSTEP 8: Second commit rejected — Guard 5 (already committed)\n");

  // Build an updated opportunities array where the BPSC record has the UpdateRecord
  const opportunitiesWithUpdate = opportunities.map((o): Opportunity =>
    o.id === bpsc.id ? (updatedBpsc as Opportunity) : o
  );

  const secondResult = commitApprovedChange(afterApprove, opportunitiesWithUpdate, {
    dataPath: TEMP_DATA,
    governmentRecords: written,
  });

  check("Second commit: committed = false", !secondResult.committed);
  check(
    "Second commit: refuseReason mentions 'already been committed'",
    secondResult.refuseReason?.includes("already been committed") ?? false
  );
  check("Second commit: temp file mtime unchanged (not re-written)", statSync(TEMP_DATA).mtimeMs === mtimeAfterCommit);

  // ── STEP 9: Tampered ProposedChange rejected (Guard 3) ────────
  console.log("\nSTEP 9: Tampered ProposedChange rejected — Guard 3\n");

  const tamperedItem: ReviewItem = {
    ...afterApprove,
    id: randomUUID(),        // new id so Guard 5 doesn't fire
    dedupKey: `${bpsc.id}::VACANCY_CHANGE::tampered`,
    approvedChange: afterApprove.approvedChange
      ? {
          ...afterApprove.approvedChange,
          trustGatePassed: false,
          trustGateErrors: ["Tampered in ops test — should be refused"],
        }
      : undefined,
  };

  const tamperedResult = commitApprovedChange(tamperedItem, opportunities, {
    dataPath: TEMP_DATA,
    governmentRecords: GOVERNMENT_RECRUITMENTS,
  });

  check("Tampered commit: committed = false", !tamperedResult.committed);
  check(
    "Tampered commit: refuseReason mentions Trust Gate",
    tamperedResult.refuseReason?.toLowerCase().includes("trust gate") ?? false
  );

  // ── STEP 10: Real src/data/ untouched ─────────────────────────
  console.log("\nSTEP 10: Real src/data/ untouched throughout\n");

  const srcFiles = [
    "src/data/government.ts",
    "src/data/homepage.ts",
    "src/data/private.ts",
  ];
  for (const f of srcFiles) {
    if (existsSync(f)) {
      const ageMs = Date.now() - statSync(f).mtimeMs;
      check(`${f} not modified (last write ${Math.round(ageMs / 1000)}s ago)`, ageMs > 30_000);
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n── Writer Operational Validation Complete ───────────────────────");
  if (process.exitCode !== 1) {
    console.log("✅ All checks passed");
    console.log(`   BPSC totalVacancies: ${originalVacancies} → ${proposedVacancies} (written + verified)`);
    console.log(`   Post-write Trust Gate: ${tg.errors.length} errors, ${tg.warnings.length} warnings`);
    console.log("   Second commit: correctly refused (Guard 5 — already committed)");
    console.log("   Tampered ProposedChange: correctly refused (Guard 3 — Trust Gate not passed)");
    console.log("   src/data/: untouched throughout");
  } else {
    console.error("\n❌ Some checks failed");
  }
  console.log("");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
