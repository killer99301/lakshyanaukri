// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/check-updates
//
// Body: { url?: string, text?: string }, or a form with a `file` (+ `url`)
//   nothing          → the AI searches the web
//   a url            → the server fetches that page or PDF and the AI reads only it
//   text or a PDF    → the AI reads only what the admin supplied; `url` then
//                      just records where it came from
//   a photo, or a    → the AI reads the picture itself: a newspaper cutting,
//   scanned PDF        an e-paper page, a printed notice
//
// Returns proposed changes for the admin to tick. Read-only: this route never
// changes a record. Accepted proposals are saved afterwards through the
// ordinary field route, as Pending, and published by the ordinary publish
// route.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById } from "@/lib/cms/repository";
import { resolveSourceContent } from "@/lib/cms/ai-assist";
import { askForUpdates } from "@/lib/cms/update-check-ai";
import { buildUpdatePrompt, pageTextForCheck, readProposals } from "@/lib/cms/update-check";
import { todayInIndia } from "@/lib/cms/attention";

// Enough of a page to hold its notices; the rest is menus and footers.
const PAGE_TEXT_LIMIT = 24_000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MIN_PASTED_CHARS = 40;
const MAX_PASTED_CHARS = 200_000;

/** The kind of file an upload really is, told from its first bytes, never from its name. */
function uploadKind(bytes: Buffer): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  // Three ways in: nothing (search the web), an address to fetch, or the
  // content itself (pasted text, or an uploaded PDF) with an optional address
  // saying where it came from. The last exists because many official sites
  // refuse requests from the server.
  let url = "";
  let pasted = "";
  let upload: Buffer | null = null;
  let kind: ReturnType<typeof uploadKind> = null;
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Could not read the uploaded file" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF or a photo to upload" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "This file is larger than 4 MB, which is the most that can be uploaded here" }, { status: 413 });
    }
    upload = Buffer.from(await file.arrayBuffer());
    kind = uploadKind(upload);
    if (!kind) return NextResponse.json({ error: "That file is not a PDF or a photo (JPG, PNG or WebP)" }, { status: 400 });
    const given = form.get("url");
    url = typeof given === "string" ? given.trim() : "";
  } else {
    try {
      const body = (await request.json()) as { url?: unknown; text?: unknown };
      if ((body.url !== undefined && typeof body.url !== "string") || (body.text !== undefined && typeof body.text !== "string")) {
        return NextResponse.json({ error: "url and text must be text" }, { status: 400 });
      }
      url = (body.url ?? "").trim();
      pasted = (body.text ?? "").trim();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (pasted && pasted.length < MIN_PASTED_CHARS) {
      return NextResponse.json({ error: "That is too little text to check. Paste the whole notice or the section about this recruitment." }, { status: 400 });
    }
    if (pasted.length > MAX_PASTED_CHARS) {
      return NextResponse.json({ error: "That is too much text. Paste only the notice or the section about this recruitment." }, { status: 400 });
    }
  }
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "That is not a web address" }, { status: 400 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "The address must start with http or https" }, { status: 400 });
    }
  }

  const record = await getRecruitmentById(id);
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  if (record.draftState === "ARCHIVED") {
    return NextResponse.json({ error: "An archived record cannot be checked for updates" }, { status: 409 });
  }

  let source: { url: string; text: string; supplied?: boolean; attached?: boolean } | null = null;
  let attachment: { mimeType: string; data: string } | undefined;
  if (upload && kind) {
    let pdfText = "";
    if (kind === "application/pdf") {
      const { extractPdfFromBuffer } = await import("@/intelligence/pdf-extractor");
      const pdf = await extractPdfFromBuffer(upload);
      if (pdf.ok && pdf.text && pdf.text.trim().length >= MIN_PASTED_CHARS) pdfText = pdf.text;
    }
    if (pdfText) {
      source = { url, text: pdfText.slice(0, PAGE_TEXT_LIMIT), supplied: true };
    } else {
      // A photo, or a PDF that is only scanned pages: there is no text to hand
      // over, so the AI is given the file and reads it itself.
      attachment = { mimeType: kind, data: upload.toString("base64") };
      source = { url, text: "", supplied: true, attached: true };
    }
  } else if (pasted) {
    source = { url, text: pasted.slice(0, PAGE_TEXT_LIMIT), supplied: true };
  } else if (url) {
    try {
      const { fetchHtmlContent } = await import("@/intelligence/fetcher");
      const { fetchResult, htmlContent } = await fetchHtmlContent(url, { maxRetries: 1 });
      const resolved = await resolveSourceContent(
        { ok: fetchResult.status === "OK", contentType: fetchResult.contentType, error: fetchResult.error, htmlContent },
        url,
      );
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 422 });
      source = {
        url,
        text: resolved.kind === "html" ? pageTextForCheck(resolved.content, url, PAGE_TEXT_LIMIT) : resolved.content.slice(0, PAGE_TEXT_LIMIT),
      };
    } catch {
      return NextResponse.json({ error: "That page could not be fetched" }, { status: 422 });
    }
  }

  const answer = await askForUpdates({
    prompt: buildUpdatePrompt(record, todayInIndia(), source),
    apiKey: process.env.GEMINI_API_KEY,
    search: !source,
    attachment,
  });
  if (!answer.ok) return NextResponse.json({ error: answer.reason }, { status: 502 });

  const read = readProposals(answer.data, record, source ? { source } : { groundedHosts: answer.groundedHosts });
  return NextResponse.json({
    mode: !source ? "search" : attachment ? (kind === "application/pdf" ? "scan" : "photo") : upload ? "pdf" : pasted ? "text" : "page",
    sourceUrl: source?.url || null,
    searchedSites: answer.groundedHosts,
    summary: read.summary,
    proposals: read.proposals,
    dropped: read.dropped,
    droppedNotes: read.droppedNotes,
    recordRevision: record.recordRevision,
  });
}
