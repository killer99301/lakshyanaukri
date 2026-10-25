// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/import/[importId]/apply
//
// Body: { selected: string[], confirmReplaceVerified?: boolean,
//         override?: { reason: string } }
// Only ids are accepted; every value comes from the stored preview. One
// database transaction; applying twice returns the first result.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { applyImportFlow, ImportInputError } from "@/lib/cms/importer/service";
import { ImportApplyError } from "@/lib/cms/importer/repository";
import { ApplySelectionError } from "@/lib/cms/importer/apply-build";

export async function POST(request: NextRequest, { params }: { params: Promise<{ importId: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  let body: { selected?: unknown; confirmReplaceVerified?: unknown; override?: { reason?: unknown } };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const selected = Array.isArray(body.selected) ? body.selected.filter((s): s is string => typeof s === "string").slice(0, 500) : [];
  const reason = typeof body.override?.reason === "string" ? body.override.reason.trim().slice(0, 500) : "";

  try {
    const result = await applyImportFlow({
      importId, adminId: guard.adminId, selected, confirmReplaceVerified: body.confirmReplaceVerified === true,
      override: reason ? { reason } : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ImportInputError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof ApplySelectionError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ImportApplyError) {
      const status = err.code === "STALE" || err.code === "DUPLICATE" || err.code === "IMPORT_NOT_PREVIEWED" ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code, ...(err.detail ? { duplicates: err.detail } : {}) }, { status });
    }
    // The editor's own rules refused a value (the same rules as a manual save).
    if (err instanceof Error && /invariant:/.test(err.message)) {
      return NextResponse.json({ error: `A ticked value breaks the editor's rules, so nothing was saved: ${err.message.replace(/^[\w.]+ invariant: /, "")}. Untick it and apply again.` }, { status: 400 });
    }
    console.error("[importer] apply failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The import could not be applied. Nothing was saved." }, { status: 500 });
  }
}
