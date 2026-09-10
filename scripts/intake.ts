#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Phase 8: Recruitment Intake CLI
// ═══════════════════════════════════════════════════════════
//
// Accepts an official notification URL, official page URL,
// or third-party job listing URL and runs the full intake
// pipeline: fetch → classify → extract → dedup → Trust Gate.
//
// Usage:
//   npx tsx scripts/intake.ts <URL>
//   npx tsx scripts/intake.ts <URL> --pasted-text "..."
//   npx tsx scripts/intake.ts <URL> --local-pdf <path>
//   npx tsx scripts/intake.ts <URL> --dry-run
//
// Flags:
//   --dry-run           Run analysis but do not save candidate
//   --pasted-text TEXT  Supplement extraction with pasted text content
//   --local-pdf PATH    Supply a local PDF file instead of fetching it live.
//                       The official URL remains the provenance anchor.
//
// Output:
//   Prints a structured analysis report.
//   On success (non-duplicate, non-dry-run): saves candidate
//   to intelligence-runs/discovery-candidates.json.
//
// PR creation:
//   Run create-pr-for-new-recruit.ts after saving.
//   Trust Gate must pass for a PR to be created.
// ═══════════════════════════════════════════════════════════

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Opportunity } from "@/types";
import { getAllOpportunities } from "@/lib/repository";
import { runIntake } from "@/intelligence/intake";
import type { CandidateNewRecruitment } from "@/intelligence/types";
import { extractPdfFromBuffer } from "@/intelligence/pdf-extractor";
import type { FetchPdfFn } from "@/intelligence/pdf-extractor";

// ─── Config ──────────────────────────────────────────────────

const CANDIDATES_PATH = join(process.cwd(), "intelligence-runs", "discovery-candidates.json");

// ─── Helpers ─────────────────────────────────────────────────

function hr(char = "─", len = 72): string {
  return char.repeat(len);
}

function badge(label: string, ok: boolean): string {
  return ok ? `✓ ${label}` : `✗ ${label}`;
}

function printResult(result: Awaited<ReturnType<typeof runIntake>>, localPdfPath?: string): void {
  console.log("\n" + hr("═"));
  console.log("  RECRUITMENT INTAKE ANALYSIS");
  console.log("  " + result.sourceUrl);
  console.log(hr("═") + "\n");

  // Evidence chain
  console.log("── Evidence Chain ────────────────────────────────────");
  if (result.evidenceChain.length === 0) {
    console.log("  (no evidence chain — URL was invalid or fetch failed)");
  } else {
    for (let i = 0; i < result.evidenceChain.length; i++) {
      const step = result.evidenceChain[i];
      const arrow = i === 0 ? "   " : " → ";
      console.log(`${arrow}[${step.sourceKind}] ${step.label}`);
      if (step.fieldsContributed.length > 0) {
        console.log(`       Fields: ${step.fieldsContributed.join(", ")}`);
      }
    }
  }

  // Source classification
  const c = result.classification;
  console.log("\n── Source Classification ─────────────────────────────");
  console.log(`  Kind:        ${c.kind}`);
  console.log(`  Domain:      ${c.domain}`);
  if (c.orgId) console.log(`  Org ID:      ${c.orgId} (${c.orgName ?? ""})`);
  if (c.aggregatorName) console.log(`  Aggregator:  ${c.aggregatorName}`);
  if (c.isDiscoveryLeadOnly) {
    console.log(`  ⚠  DISCOVERY LEAD — values are not authoritative until official source confirmed`);
  }

  // Official source
  console.log("\n── Official Source ───────────────────────────────────");
  const os = result.officialSource;
  console.log(`  Found:  ${badge("official source", os.found)}`);
  if (os.url) console.log(`  URL:    ${os.url}`);
  console.log(`  Method: ${os.method}`);
  console.log(`  Note:   ${os.note}`);

  // Document acquisition (only shown when local PDF was supplied)
  if (localPdfPath) {
    console.log("\n── Document Acquisition ──────────────────────────────");
    console.log(`  Acquisition method: LOCAL_FILE`);
    console.log(`  ⚑  Local PDF supplied; official URL remains the provenance anchor.`);
    if (!result.pdfExtraction) {
      console.log(`  ⚠  Local PDF was provided but Stage C did not run — no official PDF URL was discovered.`);
    }
  }

  // Extracted fields
  const ex = result.extraction;
  console.log("\n── Extracted Fields ──────────────────────────────────");
  const field = (name: string, value: string | number | undefined) =>
    console.log(`  ${name.padEnd(22)} ${value !== undefined ? String(value) : "(not extracted)"}`);
  const src = (f: string) => {
    const s = result.fieldSources[f];
    return s ? `  [${s}]` : "";
  };
  field("Title:", ex.title !== undefined ? `${ex.title}${src("title")}` : undefined);
  field("Notification number:", ex.notificationNumber !== undefined ? `${ex.notificationNumber}${src("notificationNumber")}` : undefined);
  field("Total vacancies:", ex.totalVacancies !== undefined ? `${ex.totalVacancies}${src("totalVacancies")}` : undefined);
  field("Notification date:", ex.postDate !== undefined ? `${ex.postDate}${src("postDate")}` : undefined);
  field("Application open:", ex.applicationOpenDate !== undefined ? `${ex.applicationOpenDate}${src("applicationOpenDate")}` : undefined);
  field("Application close:", ex.applicationCloseDate !== undefined ? `${ex.applicationCloseDate}${src("applicationCloseDate")}` : undefined);
  field("Notification PDF:", ex.notifPdfUrl !== undefined ? `${ex.notifPdfUrl}${src("notifPdfUrl")}` : undefined);
  if (ex.ambiguousPdfCandidates?.length) {
    console.log(`  ⚠ PDF ambiguous (${ex.ambiguousPdfCandidates.length} equally ranked — specify via --pasted-text):`);
    for (const c of ex.ambiguousPdfCandidates.slice(0, 3)) {
      console.log(`    • ${c}`);
    }
  }
  console.log(`  Confidence:            ${Math.round(ex.confidence * 100)}%  (specificity: ${Math.round(ex.specificity * 100)}%)`);
  if (ex.officialLinksFound.length > 0) {
    console.log(`  Official links found:`);
    for (const link of ex.officialLinksFound.slice(0, 3)) {
      console.log(`    • ${link}`);
    }
  }

  // Duplicate check
  console.log("\n── Duplicate Check ───────────────────────────────────");
  if (result.isDuplicate) {
    console.log(`  ${badge("NOT a duplicate", false)}`);
    console.log(`  Reason: ${result.duplicateReason}`);
    if (result.duplicateMatchId) console.log(`  Match:  ${result.duplicateMatchId}`);
    console.log("\n  → Candidate not saved (already in queue or canonical dataset)");
    console.log(hr("═") + "\n");
    return;
  }
  console.log(`  ${badge("No duplicate found", true)}`);

  // Missing fields
  if (result.missingFields.length > 0) {
    console.log("\n── Missing Fields ────────────────────────────────────");
    console.log("  These fields could not be extracted and must be filled before PR creation:");
    for (const f of result.missingFields) {
      console.log(`    • ${f}`);
    }
  }

  // Trust Gate
  console.log("\n── Trust Gate Pre-check ──────────────────────────────");
  if (result.trustGatePassed) {
    console.log(`  ${badge("PASSED", true)} — ready for PR creation`);
    if (result.trustGateWarnings.length > 0) {
      for (const w of result.trustGateWarnings) {
        console.log(`  ⚠ [${w.field ?? "?"}] ${w.message}`);
      }
    }
  } else {
    console.log(`  ${badge("FAILED", false)} — resolve errors before running create-pr-for-new-recruit.ts`);
    for (const e of result.trustGateErrors) {
      console.log(`  ✗ [${e.field ?? "?"}] ${e.message}`);
    }
    if (result.missingFields.includes("provenance.primarySourceUrl")) {
      console.log(`\n  → Primary cause: no official source URL found.`);
      console.log(`    Find the official notification and re-run with that URL.`);
    }
  }

  // Analysis notes
  if (result.analysisNotes.length > 0) {
    console.log("\n── Analysis Notes ────────────────────────────────────");
    for (const note of result.analysisNotes) {
      console.log(`  ${note}`);
    }
  }

  // Draft preview
  if (result.draft) {
    console.log("\n── Draft Record Preview ──────────────────────────────");
    const d = result.draft;
    console.log(`  ID:     ${d.id}`);
    console.log(`  Slug:   ${d.slug}`);
    console.log(`  Org:    ${d.organizationName}`);
    console.log(`  Status: ${d.provenance.status}`);
    console.log(`  Notification#: ${d.notificationNumber || "(empty — Trust Gate will fail)"}`);
    console.log(`  Open date:     ${d.application.openDate}`);
    console.log(`  Close date:    ${d.application.closeDate}`);
    console.log(`  Vacancies:     ${d.vacanciesDisplay}`);
  }

  // Save status
  console.log("\n── Save Status ───────────────────────────────────────");
  if (result.candidateSaved) {
    console.log(`  ${badge("Candidate saved", true)} → ${CANDIDATES_PATH}`);
    console.log(`  Candidate ID: ${result.candidate?.candidateId}`);
    if (!result.trustGatePassed) {
      console.log(`\n  Next steps:`);
      console.log(`    1. Edit intelligence-runs/discovery-candidates.json to fill missing fields`);
      console.log(`    2. Run: npx tsx scripts/create-pr-for-new-recruit.ts --dry-run`);
      console.log(`    3. If Trust Gate passes, run without --dry-run to create the PR`);
    } else {
      console.log(`\n  Next steps:`);
      console.log(`    Run: npx tsx scripts/create-pr-for-new-recruit.ts --dry-run`);
    }
  } else {
    console.log(`  Candidate not saved (dry-run or error)`);
  }

  console.log("\n" + hr("═") + "\n");
}

// ─── Candidate file I/O ───────────────────────────────────────

function loadCandidates(): { generatedAt: string; candidates: CandidateNewRecruitment[] } {
  if (!existsSync(CANDIDATES_PATH)) {
    return { generatedAt: new Date().toISOString(), candidates: [] };
  }
  return JSON.parse(readFileSync(CANDIDATES_PATH, "utf-8"));
}

function saveCandidate(candidate: CandidateNewRecruitment): void {
  const dir = join(process.cwd(), "intelligence-runs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const store = loadCandidates();
  // Replace if candidateId already exists (re-intake of same record)
  const idx = store.candidates.findIndex((c) => c.candidateId === candidate.candidateId);
  if (idx >= 0) {
    store.candidates[idx] = candidate;
  } else {
    store.candidates.push(candidate);
  }
  store.generatedAt = new Date().toISOString();
  writeFileSync(CANDIDATES_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: npx tsx scripts/intake.ts <URL> [options]

Options:
  --dry-run           Analyse only — do not save candidate
  --pasted-text TEXT  Supplement extraction with pasted text content
  --local-pdf PATH    Use a local PDF file instead of fetching it live.
                      The official URL remains the provenance anchor.

Examples:
  npx tsx scripts/intake.ts https://ssc.gov.in/documents/notification.pdf
  npx tsx scripts/intake.ts https://govtjobguru.com/ssc-cgl-2026/ --dry-run
  npx tsx scripts/intake.ts https://ssc.gov.in/cgl --pasted-text "Advt. No. 01/2026, Total Vacancies: 17000"
  npx tsx scripts/intake.ts https://ibps.in/rrb-xv --local-pdf ./CRP-RRBs-XV-notification.pdf
`);
    process.exit(0);
  }

  const sourceUrl = args[0];
  const dryRun = args.includes("--dry-run");
  const pastedIdx = args.indexOf("--pasted-text");
  const pastedText = pastedIdx >= 0 ? args[pastedIdx + 1] : undefined;
  const localPdfIdx = args.indexOf("--local-pdf");
  const localPdfPath = localPdfIdx >= 0 ? args[localPdfIdx + 1] : undefined;

  console.log(`\n[INTAKE] Analysing: ${sourceUrl}`);
  if (dryRun) console.log("[INTAKE] Dry-run mode — candidate will NOT be saved");

  // Build fetchPdfFn from local PDF when --local-pdf is provided
  let fetchPdfFn: FetchPdfFn | undefined;
  if (localPdfPath) {
    if (!existsSync(localPdfPath)) {
      console.error(`[INTAKE][ERROR] Local PDF not found: ${localPdfPath}`);
      process.exit(1);
    }
    const pdfBuffer = readFileSync(localPdfPath);
    console.log(`[INTAKE] Local PDF: ${localPdfPath} (${pdfBuffer.byteLength.toLocaleString()} bytes)`);
    console.log("[INTAKE] Local PDF supplied; official URL remains the provenance anchor.");
    fetchPdfFn = async () => {
      const r = await extractPdfFromBuffer(pdfBuffer);
      return { ok: r.ok, text: r.text, error: r.error };
    };
  }

  // Load canonical records and existing candidates for dedup
  let canonicalRecords: Opportunity[];
  try {
    canonicalRecords = getAllOpportunities();
  } catch (e) {
    console.warn(`[INTAKE] Warning: could not load canonical records: ${e}`);
    canonicalRecords = [];
  }

  const store = loadCandidates();
  const existingSlugs = canonicalRecords.map((o) => o.slug);

  const result = await runIntake(sourceUrl, {
    pastedText,
    fetchPdfFn,
    canonicalRecords,
    existingCandidates: store.candidates,
    existingSlugs,
  });

  // Save if appropriate
  if (!dryRun && !result.isDuplicate && !result.error && result.candidate) {
    saveCandidate(result.candidate);
    result.candidateSaved = true;
  }

  printResult(result, localPdfPath);

  // Exit code: 0 = success or duplicate, 1 = error
  process.exit(result.error ? 1 : 0);
}

main().catch((e) => {
  console.error("[INTAKE][FATAL]", e);
  process.exit(1);
});
