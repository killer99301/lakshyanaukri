// ═══════════════════════════════════════════════════════════
// /api/admin/cms/import/jobs — readings of long documents (stage B2.3)
//
// GET: the admin's own readings not yet finished, to reopen.
// POST (JSON): starts a reading: { mode, recruitmentId?, newJob?, sources:
// [{ declaredKind, fileName, pages, byteSize, sha256, url?, attestation?,
// versionLabel?, documentDate?, pastedText?, prepared? }] }. A PDF's pieces then come to
// /jobs/:jobId/parts. Changes no job.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { JobError, createReadingJob, listOpenJobs, type JobSourceInput } from "@/lib/cms/importer/jobs";
import type { DeclaredKind } from "@/lib/cms/importer/proposal";

const KINDS: DeclaredKind[] = ["OFFICIAL_NOTIFICATION", "OFFICIAL_CORRIGENDUM", "OFFICIAL_PAGE", "RESEARCH", "OTHER"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false });
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ jobs: await listOpenJobs(guard.adminId) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Could not read the request" }, { status: 400 }); }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const raw = Array.isArray(body.sources) ? (body.sources as Array<Record<string, unknown>>) : [];
  const sources: JobSourceInput[] = [];
  for (const s of raw) {
    if (!KINDS.includes(s.declaredKind as DeclaredKind)) return NextResponse.json({ error: "Each source needs a kind" }, { status: 400 });
    const date = str(s.documentDate);
    sources.push({
      declaredKind: s.declaredKind as DeclaredKind, fileName: str(s.fileName) ?? "document.pdf", pages: Number(s.pages), byteSize: Number(s.byteSize),
      sha256: String(s.sha256 ?? "").toLowerCase(), url: str(s.url), attestation: str(s.attestation), versionLabel: str(s.versionLabel),
      documentDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      ...(typeof s.pastedText === "string" ? { pastedText: s.pastedText } : {}),
      ...(s.prepared === true ? { prepared: true } : {}),
    });
  }
  const mode = body.mode === "EXISTING" ? "EXISTING" : "NEW";
  try {
    const newJob = mode === "NEW" && body.newJob && typeof body.newJob === "object" ? body.newJob as Record<string, unknown> : undefined;
    const result = await createReadingJob({
      adminId: guard.adminId, mode, recruitmentId: str(body.recruitmentId), sources,
      newJob: newJob ? { ...newJob, recruitmentYear: Number(newJob.recruitmentYear) } as never : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof JobError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[importer] reading not started", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The reading could not be started" }, { status: 500 });
  }
}
