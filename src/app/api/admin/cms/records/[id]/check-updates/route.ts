// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/check-updates
//
// Body: { url?: string }
//   with a url  → the AI reads that page (or PDF) and nothing else
//   without one → the AI searches the web
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let url = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    if (body.url !== undefined && typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be text" }, { status: 400 });
    }
    url = (body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

  let source: { url: string; text: string } | null = null;
  if (url) {
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
  });
  if (!answer.ok) return NextResponse.json({ error: answer.reason }, { status: 502 });

  const read = readProposals(answer.data, record, source ? { source } : { groundedHosts: answer.groundedHosts });
  return NextResponse.json({
    mode: source ? "page" : "search",
    sourceUrl: source?.url ?? null,
    searchedSites: answer.groundedHosts,
    summary: read.summary,
    proposals: read.proposals,
    dropped: read.dropped,
    recordRevision: record.recordRevision,
  });
}
