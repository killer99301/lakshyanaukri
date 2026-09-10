// ═══════════════════════════════════════════════════════════
// Admin Approve → PR Creation
// ═══════════════════════════════════════════════════════════
//
// POST /api/admin/candidates/[id]/approve
//
// Reads GITHUB_TOKEN and GITHUB_REPOSITORY from server env.
// These are NEVER exposed to the client.
//
// Creates a PR via the existing createPr() pipeline.
// Trust Gate must pass — no bypass.
//
// INVARIANTS:
//   - Never writes to government.ts directly
//   - Trust Gate cannot be bypassed or weakened
//   - GitHub credentials stay server-side only
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

  // Credentials are server-side only — never sent to client
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepository = process.env.GITHUB_REPOSITORY ?? "LakshyaNaukri/career-campus";

  if (!githubToken && !dryRun) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN not set. Set it in .env.local or environment." },
      { status: 500 }
    );
  }

  let canonicalRecords: import("@/types").Opportunity[] = [];
  try { canonicalRecords = getAllOpportunities(); } catch { /* non-fatal */ }

  const existingSlugs = canonicalRecords.map((o) => o.slug);
  const options = {
    githubToken: githubToken ?? "",
    githubRepository,
  };

  const result = dryRun
    ? dryRunPr(candidate, canonicalRecords, existingSlugs)
    : await createPr(candidate, canonicalRecords, existingSlugs, options);

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
