// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/decisions
//
// { action: "decide", fieldPath, kind, retrievalId, page?, quote?, tableCell?,
//   reviewScope?, justification?, publicNote?, seen: { revisionId, decisionId } }
// { action: "revoke", fieldPath, decisionId }
//
// Records a person's decision on one field: verified against a document,
// not applicable, or not stated in the notice; or withdraws one. Each
// decision is bound to the field's exact revision. Admin only; works with
// the importer switched off.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { decide, ImportInputError, revoke } from "@/lib/cms/importer/service";
import { DecisionConflictError } from "@/lib/cms/importer/repository";

const KINDS = ["ADMIN_VERIFIED", "ADMIN_NOT_APPLICABLE", "ADMIN_NOT_STATED"] as const;
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true, needsSwitch: false });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const fieldPath = str(b.fieldPath, 120);
  if (!fieldPath) return NextResponse.json({ error: "Which field?" }, { status: 400 });

  try {
    if (b.action === "revoke") {
      const decisionId = str(b.decisionId, 40);
      if (!decisionId) return NextResponse.json({ error: "Which decision?" }, { status: 400 });
      return NextResponse.json({ revocationId: await revoke({ recruitmentId: id, adminId: guard.adminId, fieldPath, decisionId }) });
    }
    const kind = KINDS.find((k) => k === b.kind);
    const retrievalId = str(b.retrievalId, 40);
    if (!kind || !retrievalId) return NextResponse.json({ error: "Choose what to record and the document" }, { status: 400 });
    const seen = (b.seen ?? {}) as { revisionId?: unknown; decisionId?: unknown };
    const page = Number.isInteger(b.page) && (b.page as number) > 0 ? (b.page as number) : null;
    const scope = b.reviewScope && typeof b.reviewScope === "object" ? (b.reviewScope as { whole_document?: boolean; pages?: number[]; sections?: string[] }) : null;
    const cell = b.tableCell && typeof b.tableCell === "object" && typeof (b.tableCell as { text?: unknown }).text === "string" ? (b.tableCell as { text: string }) : null;
    const result = await decide({
      recruitmentId: id, adminId: guard.adminId, fieldPath, kind, retrievalId, page,
      quote: str(b.quote, 1000), tableCell: cell, reviewScope: scope,
      justification: str(b.justification, 500), publicNote: str(b.publicNote, 160),
      seen: { revisionId: typeof seen.revisionId === "string" ? seen.revisionId : null, decisionId: typeof seen.decisionId === "string" ? seen.decisionId : null },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportInputError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof DecisionConflictError) return NextResponse.json({ error: err.message, code: "CHANGED" }, { status: 409 });
    if (err instanceof Error && /check constraint|must refer|not brought in|page number|confirmed or attested|recruiting body/i.test(err.message)) {
      return NextResponse.json({ error: "That decision is missing something it needs: a page, the exact words, a reason, or what was read." }, { status: 400 });
    }
    console.error("[importer] decision failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The decision could not be recorded" }, { status: 500 });
  }
}
