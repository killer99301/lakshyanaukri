export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateNewRecruitment } from "@/intelligence/types";

const CANDIDATES_PATH = join(process.cwd(), "intelligence-runs", "discovery-candidates.json");

function loadCandidates(): { generatedAt: string; candidates: CandidateNewRecruitment[] } {
  if (!existsSync(CANDIDATES_PATH)) return { generatedAt: new Date().toISOString(), candidates: [] };
  return JSON.parse(readFileSync(CANDIDATES_PATH, "utf-8"));
}

export async function GET(): Promise<NextResponse> {
  const store = loadCandidates();
  return NextResponse.json(store);
}
