// ═══════════════════════════════════════════════════════════
// /api/admin/cms/syllabus-library
//
// GET            → every library entry (exam, match words, source), no content
// GET ?id=…      → one entry with its content file
// POST { text }  → adds a library file, or replaces the one for the same exam
//
// The library only ever feeds the paste box in the record editor. Nothing
// here writes to a recruitment record.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getLibraryEntry, listLibrary, saveLibraryFile } from "@/lib/cms/syllabus-library-repository";
import { LIBRARY_LIMITS, LibraryFileError } from "@/lib/cms/syllabus-library";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function missingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /syllabus_library/.test(message) && /does not exist/.test(message);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const id = request.nextUrl.searchParams.get("id");
  try {
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const entry = await getLibraryEntry(id);
      return entry ? NextResponse.json({ entry }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ entries: await listLibrary() });
  } catch (err) {
    if (missingTable(err)) return NextResponse.json({ entries: [], notSetUp: true });
    console.error("[CMS] syllabus library read error", err);
    return NextResponse.json({ error: "Failed to load the syllabus library" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let text: unknown;
  try {
    text = (await request.json())?.text;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "Paste the library file first." }, { status: 400 });
  if (text.length > LIBRARY_LIMITS.content) return NextResponse.json({ error: "This file is too long for the library." }, { status: 400 });

  try {
    return NextResponse.json(await saveLibraryFile(text, auth.adminId));
  } catch (err) {
    if (missingTable(err)) return NextResponse.json({ error: "The syllabus library is not set up on this database yet." }, { status: 503 });
    if (err instanceof LibraryFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[CMS] syllabus library save error", err);
    return NextResponse.json({ error: "Failed to save the library file" }, { status: 500 });
  }
}
