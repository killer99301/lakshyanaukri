// ═══════════════════════════════════════════════════════════
// Importer routes: session, origin and switch, on the server
// ═══════════════════════════════════════════════════════════
//
// Every importer route calls this first. A switched-off importer answers 404,
// as if it did not exist. The check list and the decision routes do not use
// the switch: an imported job must stay checkable and publishable when the
// importer itself is off.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { importerEnabled } from "@/lib/cms/importer/switch";

export async function guardImporter(
  request: NextRequest,
  opts: { write: boolean; needsSwitch?: boolean },
): Promise<{ adminId: string } | NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (opts.write && !validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if ((opts.needsSwitch ?? true) && !(await importerEnabled())) {
    return NextResponse.json({ error: "The importer is switched off" }, { status: 404 });
  }
  return { adminId: auth.adminId };
}
