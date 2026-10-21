// POST /api/admin/cms/import/[importId]/discard — closes a preview without applying it.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { discardImport } from "@/lib/cms/importer/service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ importId: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true });
  if (guard instanceof NextResponse) return guard;
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  const ok = await discardImport(importId);
  return ok ? NextResponse.json({ discarded: true }) : NextResponse.json({ error: "Only a preview that was not applied can be discarded" }, { status: 409 });
}
