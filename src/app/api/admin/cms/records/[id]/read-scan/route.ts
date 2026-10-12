// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/read-scan
//
// Form with a scanned PDF `file`. The AI reads the scan and writes out the
// notice in English; the text is returned and nothing is saved. The admin
// page then sends that text to AI Assist, which fills the draft as it would
// from any other notice.
//
// A step of its own because reading a scan takes most of a request's time
// limit, and AI Assist needs the rest.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById } from "@/lib/cms/repository";
import { readScannedNotice } from "@/lib/cms/scan-reader";

// Vercel refuses request bodies over 4.5 MB before they reach this route.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF file to upload" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "This PDF is larger than 4 MB, which is the most that can be uploaded here" }, { status: 413 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return NextResponse.json({ error: "That file is not a PDF" }, { status: 400 });

  const record = await getRecruitmentById(id);
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  if (record.draftState === "PUBLISHED" || record.draftState === "ARCHIVED") {
    return NextResponse.json({ error: `Cannot edit a ${record.draftState} record` }, { status: 409 });
  }

  const reading = await readScannedNotice({
    data: bytes.toString("base64"),
    subject: `${record.identity.title.value ?? ""} — ${record.identity.organizationName}`,
    apiKey: process.env.GEMINI_API_KEY,
  });
  if (!reading.ok) return NextResponse.json({ error: reading.reason }, { status: 502 });
  return NextResponse.json({ text: reading.text });
}
