// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/read-scan
//
// Form with a scanned PDF `file` and the job's `subject`. The AI reads the
// scan and the text is returned; nothing is saved. The importer then sends the
// same file with that text as an upload source. Same reader as AI Assist's.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { readScannedNotice } from "@/lib/cms/scan-reader";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Could not read the uploaded file" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "This PDF is larger than 4 MB" }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return NextResponse.json({ error: "That file is not a PDF" }, { status: 400 });
  const reading = await readScannedNotice({ data: bytes.toString("base64"), subject: String(form.get("subject") ?? "").slice(0, 300), apiKey: process.env.GEMINI_API_KEY });
  return reading.ok ? NextResponse.json({ text: reading.text }) : NextResponse.json({ error: reading.reason }, { status: 422 });
}
