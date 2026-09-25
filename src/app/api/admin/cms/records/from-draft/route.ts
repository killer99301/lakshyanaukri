// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/from-draft
//
// Promotes a RecruitmentIntelligenceDraft → RecruitmentRecord (DRAFT).
//
// Idempotent: if this draft was already promoted, returns the
// existing record ID (detected via provenance.sourceDraftId).
//
// Contract (Phase E — locked):
//   - Load draft snapshot from intelligence_drafts
//   - Map FieldValue<T> → ProvenanceField<T> via promoter.ts
//   - Create RecruitmentRecord in DRAFT state
//   - Never delete the intelligence draft
//   - Return { recordId, slug, alreadyExisted }
//
// CSRF: validateOrigin required (mutating endpoint).
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { sql } from "@/lib/db";
import { createRecruitment } from "@/lib/cms/repository";
import { promoteDraft } from "@/lib/cms/promoter";
import type { RecruitmentIntelligenceDraft } from "@/intelligence/draft-types";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { draftId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { draftId } = body;
  if (!draftId || typeof draftId !== "string") {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  // ── Load draft ───────────────────────────────────────────
  const draftRows = await sql`
    SELECT id, status, snapshot
    FROM intelligence_drafts
    WHERE id = ${draftId}::uuid
  `;

  if (draftRows.length === 0) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const draftRow = draftRows[0];
  const draft = draftRow.snapshot as RecruitmentIntelligenceDraft;

  // ── Idempotency check ────────────────────────────────────
  // If a CMS record already exists with provenance.sourceDraftId = this draft,
  // return it without creating a duplicate.
  const existingRows = await sql`
    SELECT id, slug FROM recruitments
    WHERE provenance->>'sourceDraftId' = ${draftId}
    LIMIT 1
  `;

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    return NextResponse.json({
      recordId:       existing.id as string,
      slug:           existing.slug as string,
      alreadyExisted: true,
    });
  }

  // ── Promote ───────────────────────────────────────────────
  try {
    const fields = promoteDraft({ draft, adminId: auth.adminId });

    const record = await createRecruitment({
      slug:       fields.slug,
      identity:   fields.identity,
      dates:      fields.dates,
      vacancies:  fields.vacancies,
      financial:  fields.financial,
      provenance: fields.provenance,
      adminId:    auth.adminId,
    });

    // Patch in links — createRecruitment starts with [] links; update inline
    if (fields.links.length > 0) {
      await sql`
        UPDATE recruitments
        SET links = ${JSON.stringify(fields.links)}
        WHERE id = ${record.id}
      `;
    }

    // Persist evidence rows from intelligence sources into recruitment_evidence.
    // Each IntelligenceSource → one row; FieldEvidence.extractedText values
    // are collected per source as excerpts so the CMS editor can display them.
    if (draft.sources.length > 0) {
      const excerptsBySource = new Map<string, string[]>();
      for (const [, fieldValue] of Object.entries({
        title: draft.identity.title,
        notificationNumber: draft.identity.notificationNumber,
        organizationId: draft.identity.organizationId,
        ...Object.fromEntries(
          Object.entries(draft.dates ?? {}).filter(([, v]) => v != null),
        ),
      })) {
        const fv = fieldValue as { evidence?: Array<{ sourceId: string; extractedText?: string }> };
        for (const ev of fv?.evidence ?? []) {
          if (!ev.extractedText) continue;
          const arr = excerptsBySource.get(ev.sourceId) ?? [];
          arr.push(ev.extractedText.slice(0, 300));
          excerptsBySource.set(ev.sourceId, arr);
        }
      }

      for (const src of draft.sources) {
        const excerpts = excerptsBySource.get(src.id) ?? [];
        await sql`
          INSERT INTO recruitment_evidence
            (recruitment_id, url, title, source_type, authority_rank, fetched_at, excerpts)
          VALUES (
            ${record.id}::uuid,
            ${src.url},
            ${src.domain},
            ${src.kind},
            ${src.kind === "OFFICIAL" ? 8 : src.kind === "SECONDARY" ? 4 : 5},
            ${src.retrievedAt}::timestamptz,
            ${JSON.stringify(excerpts)}::jsonb
          )
        `;
      }
    }

    return NextResponse.json({
      recordId:       record.id,
      slug:           record.slug,
      alreadyExisted: false,
    }, { status: 201 });
  } catch (err) {
    console.error("[CMS] from-draft promotion error", err);
    const msg = String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "A record with this slug already exists. Retry or change the draft title." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Promotion failed" }, { status: 500 });
  }
}

