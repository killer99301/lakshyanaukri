export const runtime = "nodejs";

// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/upload
//
// Issues a short-lived token that lets the signed-in admin's browser upload
// ONE PDF straight to Vercel Blob (the file never passes through this server,
// so the 4.5 MB request limit does not apply).
//
// Safety:
//   - Admin session + origin check before any token is issued
//   - Token is limited to PDFs, to MAX_SAVED_FILE_BYTES, and to a path under
//     documents/<job-slug>/
//   - No upload-completed callback is registered: the link is saved by the
//     admin through the normal links editor, which records a revision
//   - The storage token never leaves the server and is never logged
// ═══════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { isAllowedSavedFilePath, MAX_SAVED_FILE_BYTES, SAVED_FILE_CONTENT_TYPE } from "@/lib/cms/saved-files";

/** A refusal whose wording is ours and safe to show. */
class UploadRefused extends Error {}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "File storage is not set up yet. Create a Blob store for this project in Vercel, then redeploy." },
      { status: 503 },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only token requests are served here; nothing else has a reason to call this route.
  if (body?.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "Unsupported request" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!isAllowedSavedFilePath(pathname)) {
          throw new UploadRefused("Files can only be saved as documents/<job>/<name>.pdf");
        }
        return {
          allowedContentTypes: [SAVED_FILE_CONTENT_TYPE],
          maximumSizeInBytes: MAX_SAVED_FILE_BYTES,
          // Two files with the same name never overwrite each other.
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    // Storage errors are logged, not echoed: only our own refusals are shown.
    if (err instanceof UploadRefused) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[CMS upload] could not issue an upload token:", err instanceof Error ? err.name : "unknown error");
    return NextResponse.json({ error: "Upload could not be started. Check the Blob store is connected to this project." }, { status: 502 });
  }
}
