// ═══════════════════════════════════════════════════════════
// GET /api/admin/cms/records/[id]/held-tables
//
// The vacancy figures the job's Smart intake imports held rather than
// offered (I5), newest import first, each with the text the vacancy
// editor's paste box opens with and whether the job's saved table holds
// its rows (worked out now, never stored). Read only; admin only; works with
// the importer switched off, as the job's checks do.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { getRecruitmentById } from "@/lib/cms/repository";
import { heldTablesForJob } from "@/lib/cms/importer/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false, needsSwitch: false });
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const record = await getRecruitmentById(id);
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  return NextResponse.json({ held: await heldTablesForJob(record) });
}
