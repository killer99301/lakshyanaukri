// ═══════════════════════════════════════════════════════════
// GET  /api/admin/cms/import/switch — whether the importer is on
// POST /api/admin/cms/import/switch — { on: boolean, confirm: true }
//
// Admin only; each change is written to the admin audit log. Not behind the
// switch itself, or it could never be turned on.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guardImporter } from "@/lib/cms/importer/route-guard";
import { importerEnabled, setImporterEnabled } from "@/lib/cms/importer/switch";
import { audit } from "@/lib/auth/audit";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: false, needsSwitch: false });
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ on: await importerEnabled() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardImporter(request, { write: true, needsSwitch: false });
  if (guard instanceof NextResponse) return guard;
  let body: { on?: unknown; confirm?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof body.on !== "boolean" || body.confirm !== true) return NextResponse.json({ error: "Say on or off, and confirm" }, { status: 400 });
  try {
    await setImporterEnabled(body.on);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The switch could not be changed" }, { status: 503 });
  }
  await audit(body.on ? "IMPORTER_SWITCHED_ON" : "IMPORTER_SWITCHED_OFF", { adminId: guard.adminId });
  return NextResponse.json({ on: await importerEnabled() });
}
