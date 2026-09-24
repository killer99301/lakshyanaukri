#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Phase 7E: PR Creation for Newly Discovered Recruitments
//           — RETIRED (G7D + intelligence pipeline cleanup)
// ═══════════════════════════════════════════════════════════
//
// This script previously:
//   1. Read intelligence-runs/discovery-candidates.json
//   2. Built a GovernmentRecruitment draft per PENDING_REVIEW candidate
//   3. Ran Trust Gate (must pass — no PR created on failure)
//   4. Created a git branch with the proposed government.ts change
//   5. Pushed the branch and opened a GitHub PR
//
// src/data/government.ts was retired in G7D (commit bf6b84f).
// The CMS (published_recruitments + recruitments) is now the sole
// source of truth. New records are promoted via:
//
//   POST /api/admin/cms/records/from-draft
//
// Full historical migration code is preserved in git history.
// ═══════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  create-pr-for-new-recruit — RETIRED");
  console.log("  government.ts retired in G7D (commit bf6b84f).");
  console.log("  Promote intelligence drafts via:");
  console.log("    POST /api/admin/cms/records/from-draft");
  console.log("═══════════════════════════════════════════════════════\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});

export {};
