// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/updates
//
// Appends an announcement-only UpdateRecord to the record's updates[].
// Does NOT modify structural fields or record_revision.
// Concurrent appends from different sessions both succeed.
//
// Guard: record must not be ARCHIVED.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistUpdateAppend } from "@/lib/cms/repository";
import { randomUUID } from "node:crypto";
import type { UpdateRecord, UpdateType } from "@/types";

const VALID_UPDATE_TYPES: UpdateType[] = [
  "CORRIGENDUM",
  "VACANCY_REVISION",
  "DEADLINE_EXTENSION",
  "POSTPONEMENT",
  "RESCHEDULE",
  "EXAM_NOTICE",
  "CANCELLATION",
  "GENERAL_NOTICE",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (!validateOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: {
    update: {
      type: UpdateType;
      date: string;
      title: string;
      description: string;
      sourceUrl?: string;
      field?: string;
      previousValue?: string;
      newValue?: string;
    };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { update } = body;
  if (!update) {
    return NextResponse.json({ error: "update is required" }, { status: 400 });
  }
  if (!update.type || !VALID_UPDATE_TYPES.includes(update.type)) {
    return NextResponse.json(
      { error: `update.type must be one of: ${VALID_UPDATE_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!update.date) {
    return NextResponse.json({ error: "update.date is required (ISO date)" }, { status: 400 });
  }
  if (!update.title?.trim()) {
    return NextResponse.json({ error: "update.title is required" }, { status: 400 });
  }
  if (!update.description?.trim()) {
    return NextResponse.json({ error: "update.description is required" }, { status: 400 });
  }

  try {
    const record = await getRecruitmentById(id);
    if (!record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    if (record.draftState === "ARCHIVED") {
      return NextResponse.json(
        { error: "Cannot add updates to an ARCHIVED record" },
        { status: 409 },
      );
    }

    const entry: UpdateRecord = {
      id: randomUUID(),
      type: update.type,
      date: update.date,
      title: update.title.trim(),
      description: update.description.trim(),
      ...(update.sourceUrl ? { sourceUrl: update.sourceUrl } : {}),
      ...(update.field ? { field: update.field } : {}),
      ...(update.previousValue !== undefined ? { previousValue: update.previousValue } : {}),
      ...(update.newValue !== undefined ? { newValue: update.newValue } : {}),
    };

    const { record: saved, revision } = await persistUpdateAppend(id, entry, auth.adminId);
    return NextResponse.json({ record: saved, revision, update: entry });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not found or is ARCHIVED")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[CMS] update append error", err);
    return NextResponse.json({ error: "Failed to append update" }, { status: 500 });
  }
}
