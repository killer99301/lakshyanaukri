// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]/checks
//
// The "Quality checks (optional)" list for an imported job: each critical
// field's class, its latest revision and the decision in force, and the
// documents that can support a decision. Admin only; works with the importer
// switched off (an imported job must stay checkable).
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { getRecruitmentById } from "@/lib/cms/repository";
import { checksFor } from "@/lib/cms/importer/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false, needsSwitch: false });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const record = await getRecruitmentById(id);
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  return NextResponse.json(await checksFor(record));
}
