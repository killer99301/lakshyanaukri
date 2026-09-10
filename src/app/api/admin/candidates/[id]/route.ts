export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

// PATCH /api/admin/candidates/[id]
// Body: partial CandidateNewRecruitment fields the admin wants to override.
// Only editable content fields are allowed — lifecycle fields are protected.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const store = load();
  const idx = store.candidates.findIndex((c) => c.candidateId === id);
  if (idx < 0) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  let body: Partial<CandidateNewRecruitment>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Allowed editable fields only — never allow lifecycle/identity mutations
  const EDITABLE: (keyof CandidateNewRecruitment)[] = [
    "title",
    "notificationNumber",
    "notifPdfUrl",
    "postDate",
    "applicationOpenDate",
    "applicationCloseDate",
    "totalVacancies",
    "govType",
  ];

  const existing = store.candidates[idx];
  const updated = { ...existing };
  for (const field of EDITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (updated as any)[field] = (body as any)[field];
    }
  }

  store.candidates[idx] = updated;
  save(store);
  return NextResponse.json({ ok: true, candidate: updated });
}
