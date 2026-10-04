export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/ai-assist
//
// On-demand extraction for a single CMS record from a web page or PDF.
//
// Safety invariants:
//   - Auth + origin validation required (same as all mutation routes)
//   - Only DRAFT/APPROVED records may be modified
//   - All applied values use PENDING status — never VERIFIED
//   - Does not publish, approve, or change lifecycle
//   - Never overwrites an occupied field
//   - Gemini runs only inside this user-triggered request, only on fee text,
//     and every fee it returns must pass evidence verification
//   - Gemini failures are non-fatal: deterministic results still apply
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistFieldUpdate, OccConflictError } from "@/lib/cms/repository";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import type { ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import {
  isEmpty,
  pending,
  readField,
  resolveSourceContent,
  buildAssistCandidates,
  buildFeeSections,
  extractFees,
  type AssistCandidate,
  type AssistFlag,
  type FeeOutcome,
  compareIdentity,
  type IdentityCheck,
  type SourceKind,
} from "@/lib/cms/ai-assist";
import { aiAssistReason } from "@/lib/cms/ai-assist-apply";

interface AiAssistRequest {
  url: string;
}

export interface AiAssistFilledEntry {
  fieldPath: string;
  label: string;
  value: unknown;
}

export interface AiAssistSuggestedEntry {
  fieldPath: string;
  label: string;
  aiValue: unknown;
  existingValue: unknown;
  // Carried so Apply keeps the field's existing evidence links.
  existingEvidenceIds: string[];
}

export interface AiAssistResponse {
  record: RecruitmentRecord;
  filled: AiAssistFilledEntry[];
  suggested: AiAssistSuggestedEntry[];
  // Labels whose extracted value equals the value already on the record.
  confirmed: string[];
  notFound: string[];
  flagged: AssistFlag[];
  // Read-only comparison — organisation and year are never written by AI Assist.
  identityCheck: IdentityCheck;
  sourceUrl: string;
  sourceKind: SourceKind;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: AiAssistRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return NextResponse.json({ error: "URL must use http or https" }, { status: 400 });
  }

  let record = await getRecruitmentById(id);
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  if (record.draftState === "PUBLISHED" || record.draftState === "ARCHIVED") {
    return NextResponse.json(
      { error: `Cannot edit a ${record.draftState} record` },
      { status: 409 },
    );
  }

  // Fetch the source, then resolve it to HTML or PDF text
  let source;
  try {
    const { fetchHtmlContent } = await import("@/intelligence/fetcher");
    const { fetchResult, htmlContent } = await fetchHtmlContent(url, { maxRetries: 1 });
    source = await resolveSourceContent(
      {
        ok: fetchResult.status === "OK",
        contentType: fetchResult.contentType,
        error: fetchResult.error,
        htmlContent,
      },
      url,
    );
  } catch (err) {
    return NextResponse.json({ error: `Fetch failed: ${String(err)}` }, { status: 422 });
  }
  if (!source.ok) {
    return NextResponse.json({ error: source.error }, { status: 422 });
  }

  const { candidates: baseCandidates, flagged, detected } = buildAssistCandidates(source.content, source.kind, url);
  const identityCheck = compareIdentity(record.identity, detected);

  const fees = await extractFees({
    sections: buildFeeSections(source.content, source.kind, url),
    url,
    apiKey: process.env.GEMINI_API_KEY,
  });

  const notFound: string[] = [];
  const candidates: AssistCandidate[] = [...baseCandidates];

  const addFee = (fieldPath: string, label: string, outcome: FeeOutcome) => {
    if (outcome.status === "accepted") {
      candidates.push({ fieldPath, label, value: outcome.value });
    } else if (outcome.status === "rejected") {
      flagged.push({ label, value: outcome.value, reason: `${outcome.reason} — not applied` });
    } else if (outcome.status === "skipped") {
      notFound.push(`${label} (${outcome.reason})`);
    } else {
      notFound.push(label);
    }
  };
  addFee("financial.feeGeneral", "Application Fee (General/OBC)", fees.general);
  addFee("financial.feeSCST", "Application Fee (SC/ST/PwBD)", fees.scst);

  const filled: AiAssistFilledEntry[] = [];
  const suggested: AiAssistSuggestedEntry[] = [];
  const confirmed: string[] = [];

  for (const { fieldPath, label, value } of candidates) {
    if (value === null || value === undefined) {
      notFound.push(label);
      continue;
    }

    const currentField = readField(record, fieldPath);

    if (isEmpty(currentField)) {
      try {
        const result = routeFieldUpdate(
          record,
          fieldPath,
          pending(value) as ProvenanceField<unknown>,
          auth.adminId,
          aiAssistReason(url, "filled"),
        );
        const { record: saved } = await persistFieldUpdate(result, record.recordRevision);
        record = saved;
        filled.push({ fieldPath, label, value });
      } catch (err) {
        if (err instanceof OccConflictError) {
          return NextResponse.json(
            { error: "Record was modified concurrently — please reload and try again" },
            { status: 409 },
          );
        }
        notFound.push(`${label} (could not apply: ${String(err)})`);
      }
    } else if (JSON.stringify(currentField?.value) === JSON.stringify(value)) {
      // Source agrees with what is already recorded — nothing to apply.
      confirmed.push(label);
    } else {
      suggested.push({
        fieldPath,
        label,
        aiValue: value,
        existingValue: currentField?.value,
        existingEvidenceIds: currentField?.evidenceIds ?? [],
      });
    }
  }

  return NextResponse.json({
    record,
    filled,
    suggested,
    confirmed,
    notFound,
    flagged,
    identityCheck,
    sourceUrl: url,
    sourceKind: source.kind,
  } satisfies AiAssistResponse);
}
