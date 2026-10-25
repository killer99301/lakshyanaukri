// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/preview
//
// Multipart form: mode ("NEW" | "EXISTING"), recruitmentId (EXISTING),
// newJob (JSON, NEW), sources (JSON array of up to four
// {declaredKind, method: "url"|"upload"|"paste", url?, text?, attestation?,
// versionLabel?, documentDate?, file?: "file0".."file3"}), file0..file3.
//
// Reads every source, extracts what each says, and stores an immutable
// preview. Changes no job.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { ImportInputError, MAX_SOURCES, previewImport, type NewJobInput, type SourceInput } from "@/lib/cms/importer/service";
import type { DeclaredKind } from "@/lib/cms/importer/proposal";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const KINDS: DeclaredKind[] = ["OFFICIAL_NOTIFICATION", "OFFICIAL_CORRIGENDUM", "OFFICIAL_PAGE", "RESEARCH", "OTHER"];

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Could not read the form" }, { status: 400 }); }

  const mode = form.get("mode") === "EXISTING" ? "EXISTING" : "NEW";
  let newJob: NewJobInput | undefined;
  let rawSources: Array<Record<string, unknown>>;
  try {
    newJob = mode === "NEW" ? JSON.parse(String(form.get("newJob") ?? "null")) ?? undefined : undefined;
    rawSources = JSON.parse(String(form.get("sources") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "Could not read the sources" }, { status: 400 });
  }
  if (!Array.isArray(rawSources) || rawSources.length === 0 || rawSources.length > MAX_SOURCES) {
    return NextResponse.json({ error: `Add between 1 and ${MAX_SOURCES} sources` }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const sources: SourceInput[] = [];
  for (const s of rawSources) {
    const declaredKind = KINDS.includes(s.declaredKind as DeclaredKind) ? (s.declaredKind as DeclaredKind) : null;
    const method = s.method === "url" || s.method === "upload" || s.method === "paste" ? s.method : null;
    if (!declaredKind || !method) return NextResponse.json({ error: "Each source needs a kind and a way in" }, { status: 400 });
    let bytes: Buffer | undefined;
    if (method === "upload") {
      const file = form.get(String(s.file ?? ""));
      if (!(file instanceof File)) return NextResponse.json({ error: "A file is missing" }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "A file is larger than 4 MB" }, { status: 413 });
      bytes = Buffer.from(await file.arrayBuffer());
    }
    const date = str(s.documentDate);
    sources.push({
      declaredKind, method, bytes, url: str(s.url), text: typeof s.text === "string" ? s.text : undefined,
      attestation: str(s.attestation), versionLabel: str(s.versionLabel)?.slice(0, 120),
      documentDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    });
  }

  try {
    const result = await previewImport({
      adminId: guard.adminId, mode, recruitmentId: String(form.get("recruitmentId") ?? "") || undefined,
      newJob: newJob ? { ...newJob, recruitmentYear: Number(newJob.recruitmentYear) } : undefined,
      sources, apiKey: process.env.GEMINI_API_KEY,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportInputError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[importer] preview failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The preview could not be made. Nothing was saved." }, { status: 500 });
  }
}
