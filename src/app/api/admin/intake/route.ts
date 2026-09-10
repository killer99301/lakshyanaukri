// ═══════════════════════════════════════════════════════════
// Phase 9D: Admin Intake API Route — Multi-Source
// ═══════════════════════════════════════════════════════════
//
// POST /api/admin/intake
// Content-Type: multipart/form-data
//
// Fields:
//   urls      JSON array of URL strings
//   notes     optional admin note
//   dry_run   "true" to skip saving to queue
//
// Files (optional):
//   pdf_0, pdf_1, ...  PDF binary files
//
// Returns:
//   { groups: EntityGroup[], rawResults: IntakeResult[], saved: boolean }
//
// Authentication: proxy.ts (ADMIN_SECRET cookie/header).
// Node.js runtime — filesystem access required.
//
// INVARIANTS:
//   - Never writes to government.ts or canonical data
//   - GitHub token NEVER returned to client
//   - Local PDF paths NEVER persisted as provenance
//   - Saving is always to discovery-candidates.json only
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Opportunity } from "@/types";
import { getAllOpportunities } from "@/lib/repository";
import { runIntake } from "@/intelligence/intake";
import { extractPdfFromBuffer } from "@/intelligence/pdf-extractor";
import type { FetchPdfFn } from "@/intelligence/pdf-extractor";
import { resolveEntities } from "@/intelligence/entity-resolver";
import type { CandidateNewRecruitment } from "@/intelligence/types";

const CANDIDATES_PATH = join(process.cwd(), "intelligence-runs", "discovery-candidates.json");

function loadCandidates(): { generatedAt: string; candidates: CandidateNewRecruitment[] } {
  if (!existsSync(CANDIDATES_PATH)) return { generatedAt: new Date().toISOString(), candidates: [] };
  return JSON.parse(readFileSync(CANDIDATES_PATH, "utf-8"));
}

function saveCandidates(store: { generatedAt: string; candidates: CandidateNewRecruitment[] }) {
  const dir = join(process.cwd(), "intelligence-runs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  store.generatedAt = new Date().toISOString();
  writeFileSync(CANDIDATES_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  // Parse URLs
  const urlsRaw = formData.get("urls");
  let urls: string[] = [];
  if (typeof urlsRaw === "string" && urlsRaw.trim()) {
    try {
      const parsed = JSON.parse(urlsRaw);
      urls = Array.isArray(parsed)
        ? parsed.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        : [];
    } catch {
      return NextResponse.json({ error: "urls must be a JSON array" }, { status: 400 });
    }
  }

  const adminNote = typeof formData.get("notes") === "string" ? (formData.get("notes") as string).trim() : undefined;
  const dryRun = formData.get("dry_run") === "true";

  // Extract PDF texts from uploaded files
  const pdfTexts: string[] = [];
  const pdfNames: string[] = [];
  let pdfIndex = 0;
  while (true) {
    const pdfFile = formData.get(`pdf_${pdfIndex}`);
    if (!pdfFile || !(pdfFile instanceof Blob)) break;
    const arrayBuffer = await pdfFile.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const result = await extractPdfFromBuffer(buf);
    if (result.ok && result.text) {
      pdfTexts.push(result.text);
      const nameRaw = formData.get(`pdf_${pdfIndex}_name`);
      pdfNames.push(typeof nameRaw === "string" ? nameRaw : `document_${pdfIndex}.pdf`);
    } else {
      const nameRaw = formData.get(`pdf_${pdfIndex}_name`);
      const name = typeof nameRaw === "string" ? nameRaw : `pdf_${pdfIndex}`;
      console.warn(`[admin/intake] PDF extraction failed for ${name}: ${result.error}`);
    }
    pdfIndex++;
  }

  if (urls.length === 0 && pdfTexts.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one URL or upload at least one PDF" },
      { status: 400 }
    );
  }

  if (urls.length === 0 && pdfTexts.length > 0) {
    return NextResponse.json(
      { error: "PDF upload requires at least one official URL to establish provenance. Add the official recruitment page URL." },
      { status: 400 }
    );
  }

  // Build fetchPdfFn from uploaded PDFs (returns first available PDF text for any URL)
  let fetchPdfFn: FetchPdfFn | undefined;
  if (pdfTexts.length > 0) {
    let pdfCursor = 0;
    fetchPdfFn = async () => {
      const text = pdfTexts[pdfCursor % pdfTexts.length];
      if (!text) return { ok: false, text: null, error: "No PDF text extracted from upload" };
      // Advance cursor so subsequent Stage C calls use next PDF (for multi-PDF round-robin)
      pdfCursor++;
      return { ok: true, text };
    };
  }

  // Load canonical records and existing candidates for dedup
  let canonicalRecords: Opportunity[] = [];
  try {
    canonicalRecords = getAllOpportunities();
  } catch (e) {
    console.warn("[admin/intake] Could not load canonical records:", e);
  }

  const store = loadCandidates();
  const existingSlugs = canonicalRecords.map((o) => o.slug);

  // Run intake for each URL
  const rawResults = await Promise.all(
    urls.map((url) =>
      runIntake(url, {
        fetchPdfFn,
        canonicalRecords,
        existingCandidates: store.candidates,
        existingSlugs,
      })
    )
  );

  // Entity resolution: group by (orgId, notificationNumber)
  const groups = resolveEntities(rawResults);

  // Save non-duplicate, non-dry-run candidates to queue
  const savedIds: string[] = [];
  if (!dryRun) {
    for (const raw of rawResults) {
      if (!raw.isDuplicate && !raw.error && raw.candidate) {
        const cand = raw.candidate;
        // Attach admin note if provided
        if (adminNote) {
          (cand as CandidateNewRecruitment & { adminNote?: string }).adminNote = adminNote;
        }
        const idx = store.candidates.findIndex((c) => c.candidateId === cand.candidateId);
        if (idx >= 0) {
          store.candidates[idx] = cand;
        } else {
          store.candidates.push(cand);
        }
        savedIds.push(cand.candidateId);
      }
    }
    if (savedIds.length > 0) {
      saveCandidates(store);
    }
  }

  return NextResponse.json({
    groups,
    rawResults,
    savedIds,
    dryRun,
    pdfCount: pdfTexts.length,
    pdfNames,
    urlCount: urls.length,
  });
}
