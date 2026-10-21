// GET /api/admin/cms/import/[importId] — a stored preview and its status.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { getImport } from "@/lib/cms/importer/service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ importId: string }> }): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false });
  if (guard instanceof NextResponse) return guard;
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  const imp = await getImport(importId);
  if (!imp) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  return NextResponse.json({ import: imp });
}
