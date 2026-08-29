#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Review CLI
// ═══════════════════════════════════════════════════════════
//
// Usage:
//   npm run intelligence:review -- list
//   npm run intelligence:review -- show <item-id>
//   npm run intelligence:review -- approve <item-id> [--notes "..."]
//   npm run intelligence:review -- reject <item-id> --reason "..."
//
// INVARIANT: productionWrites = 0. This script never modifies
// src/data/. Approval only sets queue status + generates a
// ProposedChange for the writer to inspect. writer.ts is the
// only path that can commit to canonical data.
// ═══════════════════════════════════════════════════════════

import { getAllOpportunities } from "@/lib/repository";
import {
  listItems,
  showItem,
  approveReviewItem,
  rejectReviewItem,
} from "@/intelligence/review-cli";
import { DEFAULT_QUEUE_PATH } from "@/intelligence/review-queue";

function parseArgs(argv: string[]): {
  command: string;
  id?: string;
  flags: Record<string, string>;
  multiFlags: Record<string, string[]>;
} {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const id = args[1];
  const flags: Record<string, string> = {};
  const multiFlags: Record<string, string[]> = {};

  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      flags[key] = val;
      multiFlags[key] = [...(multiFlags[key] ?? []), val];
      i++;
    } else if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      flags[key] = "true";
    }
  }

  return { command, id, flags, multiFlags };
}

function printHelp(): void {
  console.log(`
Career Campus — Intelligence Review CLI

Usage:
  npm run intelligence:review -- list
  npm run intelligence:review -- show <item-id>
  npm run intelligence:review -- approve <item-id> [--notes "..."]
  npm run intelligence:review -- reject <item-id> --reason "..."

Commands:
  list      Show all PENDING review items
  show      Human-readable audit view of one item (read-only)
  approve   Mark PENDING item as APPROVED; generates ProposedChange
  reject    Mark PENDING item as REJECTED with a required reason

Note:
  approve does NOT write to canonical data.
  Use writer.ts (coming in Phase 6B) to commit an approved change.
`);
}

const { command, id, flags, multiFlags } = parseArgs(process.argv);

switch (command) {
  case "list": {
    const result = listItems();
    console.log(result.message);
    if (!result.success) process.exit(1);
    break;
  }

  case "show": {
    if (!id) {
      console.error("Usage: intelligence:review -- show <item-id>");
      process.exit(1);
    }
    const result = showItem(id, DEFAULT_QUEUE_PATH, getAllOpportunities());
    console.log(result.message);
    if (!result.success) process.exit(1);
    break;
  }

  case "approve": {
    if (!id) {
      console.error("Usage: intelligence:review -- approve <item-id> [--notes \"...\"]");
      process.exit(1);
    }
    const opportunities = getAllOpportunities();
    const acknowledgeWarnings = multiFlags.acknowledge ?? [];
    const result = approveReviewItem(id, opportunities, flags.notes, undefined, acknowledgeWarnings);
    console.log(result.message);
    if (!result.success) process.exit(1);
    break;
  }

  case "reject": {
    if (!id) {
      console.error("Usage: intelligence:review -- reject <item-id> --reason \"...\"");
      process.exit(1);
    }
    if (!flags.reason) {
      console.error("Error: --reason is required for reject");
      process.exit(1);
    }
    const result = rejectReviewItem(id, flags.reason);
    console.log(result.message);
    if (!result.success) process.exit(1);
    break;
  }

  default:
    printHelp();
    break;
}
