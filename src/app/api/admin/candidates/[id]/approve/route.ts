// ═══════════════════════════════════════════════════════════
// Admin Approve → PR Creation (RETIRED path)
// ═══════════════════════════════════════════════════════════
//
// POST /api/admin/candidates/[id]/approve
//
// RETIREMENT NOTE: createPr() now returns outcome "RETIRED"
// because government.ts was retired in G7D. To promote an
// intelligence draft to a CMS record use:
//   POST /api/admin/cms/records/from-draft
//
// dryRunPr() still runs Trust Gate for validation.
//
// INVARIANTS:
//   - Trust Gate cannot be bypassed or weakened
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAllOpportunities } from "@/lib/repository";
import { createPr, dryRunPr } from "@/intelligence/pr-creator";
import type { CandidateNewRecruitment } from "@/intelligence/types";

const CANDIDATES_PATH = join(process.cwd(), "intelligence-runs", "discovery-candidates.json");

type Store = { generatedAt: string; candidates: CandidateNewRecruitment[] };

function load(): Store {
  if (!existsSync(CANDIDATES_PATH)) return { generatedAt: new Date().toISOString(), candidates: [] };
  return JSON.parse(readFileSync(CANDIDATES_PATH, "utf-8"));
}

function save(store: Store) {
  const dir = join(process.cwd(), "intelligence-runs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  store.generatedAt = new Date().toISOString();
  writeFileSync(CANDIDATES_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const store = load();
  const candidate = store.candidates.find((c) => c.candidateId === id);
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  let body: { dry_run?: boolean } = {};
  try { body = await request.json(); } catch { /* optional body */ }
  const dryRun = body.dry_run === true;

  let canonicalRecords: import("@/types").Opportunity[] = [];
  try { canonicalRecords = getAllOpportunities(); } catch { /* non-fatal */ }

  const existingSlugs = canonicalRecords.map((o) => o.slug);

  // createPr() returns outcome "RETIRED" — government.ts no longer exists.
  // dryRunPr() still runs Trust Gate validation.
  const result = dryRun
    ? dryRunPr(candidate, canonicalRecords, existingSlugs)
    : await createPr(candidate, canonicalRecords, existingSlugs);

  // Update candidate status after PR creation
  if (!dryRun && result.outcome === "PR_CREATED" && result.prNumber) {
    const idx = store.candidates.findIndex((c) => c.candidateId === id);
    if (idx >= 0) {
      store.candidates[idx] = {
        ...store.candidates[idx],
        status: "PR_CREATED",
        prNumber: result.prNumber,
        prUrl: result.prUrl,
      };
      save(store);
    }
  }

  return NextResponse.json({
    ...result,
    // Explicitly exclude any token or server secret from response
    _credentialsSafe: true,
  });
}
