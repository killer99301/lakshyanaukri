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
  buildAiSections,
  extractWithAi,
  mergeAiDates,
  mergeAiNotificationNumber,
  type AssistCandidate,
  type AssistFlag,
  type FeeOutcome,
  compareIdentity,
  type IdentityCheck,
  type SourceKind,
} from "@/lib/cms/ai-assist";
import { aiAssistReason } from "@/lib/cms/ai-assist-apply";
import { buildSyllabusSections, extractPatternAndSyllabus, SYLLABUS_FIELDS } from "@/lib/cms/ai-assist-syllabus";
import {
  buildDetailSections,
  extractDetails,
  extractOfficialLinks,
  deriveListingDetails,
  DETAIL_FIELDS,
  type SuggestedLink,
} from "@/lib/cms/ai-assist-details";

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
  // Links to official domains found on the source page; never added automatically.
  suggestedLinks: SuggestedLink[];
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

  const base = buildAssistCandidates(source.content, source.kind, url);
  const identityCheck = compareIdentity(record.identity, base.detected);

  // Up to three AI requests per click, run together: (1) fees, dates and
  // notification number; (2) eligibility, age, selection, how to apply and pay
  // scale; (3) exam pattern and syllabus, sent only if the source has any.
  // Every item is evidence-checked. Any can fail without affecting the others.
  const apiKey = process.env.GEMINI_API_KEY;
  // Tells the model which recruitment this is, so other jobs on the page are ignored.
  const subject = `${record.identity.title.value ?? ""} — ${record.identity.organizationName}`;
  const [ai, details, pattern] = await Promise.all([
    extractWithAi({ sections: buildAiSections(source.content, source.kind, url), url, apiKey }),
    extractDetails({ sections: buildDetailSections(source.content, source.kind, url, subject), url, apiKey, subject }),
    extractPatternAndSyllabus({ sections: buildSyllabusSections(source.content, source.kind, url, subject), url, apiKey, subject }),
  ]);
  const fees = ai.fees;
  const merged = mergeAiDates(mergeAiNotificationNumber(base, ai.notificationNumber), ai.dates);
  const flagged = merged.flagged;

  const notFound: string[] = [];
  const candidates: AssistCandidate[] = [...merged.candidates];

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

  for (const { key, fieldPath, label } of DETAIL_FIELDS) {
    const outcome = details[key];
    if (outcome.status === "accepted") {
      candidates.push({ fieldPath, label, value: outcome.value });
      if (outcome.dropped > 0) {
        flagged.push({
          label,
          value: `${outcome.dropped} item${outcome.dropped === 1 ? "" : "s"} left out`,
          reason: "could not be matched to the source text — check this section against the notification",
        });
      }
    } else if (outcome.status === "rejected") {
      flagged.push({ label, value: "not applied", reason: outcome.reason });
    } else if (outcome.status === "skipped") {
      notFound.push(`${label} (${outcome.reason})`);
    } else {
      notFound.push(label);
    }
  }

  for (const { key, fieldPath, label } of SYLLABUS_FIELDS) {
    const outcome = pattern[key];
    if (outcome.status === "accepted") {
      candidates.push({ fieldPath, label, value: outcome.value });
      if (outcome.dropped > 0) {
        flagged.push({
          label,
          value: `${outcome.dropped} item${outcome.dropped === 1 ? "" : "s"} left out`,
          reason: "not found word for word in the source — compare this section with the notification",
        });
      }
    } else if (outcome.status === "rejected") {
      flagged.push({ label, value: "not applied", reason: outcome.reason });
    } else if (outcome.status === "skipped") {
      notFound.push(`${label} (${outcome.reason})`);
    } else {
      notFound.push(label);
    }
  }

  // Links to official domains found on the page. Suggested only — the admin adds them.
  const suggestedLinks =
    source.kind === "html" ? extractOfficialLinks(source.content, url, record.links.map((l) => l.url)) : [];

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

  // Listing details (header boxes and filters), derived from the record's own
  // facts once the fields above are in. Only empty sub-fields are filled.
  const listing = deriveListingDetails(record, details.summary);
  if (listing.added.length > 0) {
    try {
      const result = routeFieldUpdate(
        record,
        "classification",
        pending(listing.value) as ProvenanceField<unknown>,
        auth.adminId,
        aiAssistReason(url, "filled"),
      );
      const { record: saved } = await persistFieldUpdate(result, record.recordRevision);
      record = saved;
      filled.push({ fieldPath: "classification", label: "Listing details", value: listing.added.join("\n") });
    } catch (err) {
      if (err instanceof OccConflictError) {
        return NextResponse.json(
          { error: "Record was modified concurrently — please reload and try again" },
          { status: 409 },
        );
      }
      notFound.push(`Listing details (could not apply: ${String(err)})`);
    }
  }

  return NextResponse.json({
    record,
    filled,
    suggested,
    confirmed,
    notFound,
    flagged,
    suggestedLinks,
    identityCheck,
    sourceUrl: url,
    sourceKind: source.kind,
  } satisfies AiAssistResponse);
}
