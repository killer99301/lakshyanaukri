export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AUDIT_PATH = join(process.cwd(), "intelligence-runs", "scheduled-intake-audit.jsonl");
const CANDIDATES_PATH = join(process.cwd(), "intelligence-runs", "discovery-candidates.json");

export async function GET(): Promise<NextResponse> {
  // Audit log entries
  const auditEntries: unknown[] = [];
  if (existsSync(AUDIT_PATH)) {
    const lines = readFileSync(AUDIT_PATH, "utf-8").split("\n").filter(Boolean);
    for (const line of lines.slice(-200)) { // last 200 entries
      try { auditEntries.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  }

  // Candidate statuses from queue
  let candidates = [];
  if (existsSync(CANDIDATES_PATH)) {
    try {
      const store = JSON.parse(readFileSync(CANDIDATES_PATH, "utf-8"));
      candidates = store.candidates ?? [];
    } catch { /* ignore */ }
  }

  return NextResponse.json({ auditEntries: auditEntries.reverse(), candidates });
}
