// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/updates
//
// Appends an announcement-only UpdateRecord to the record's updates[].
// Does NOT modify structural fields or record_revision.
// Only on a job open for editing (DRAFT or APPROVED): the entry goes live with
// the job's next publish, through the owner's publication review. A PUBLISHED
// job is refused (409): it is put back to draft first, and the public keeps
// the last published version meanwhile (update-workflow safety fix, 11 Nov
// 2026: entries used to go onto a live job's public page at once).
// Concurrent appends from different sessions both succeed.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistUpdateAppend, persistUpdatesNote, UpdatesChangedError } from "@/lib/cms/repository";
import { supersede, restore, updatesFingerprint } from "@/lib/cms/announcements";
import { todayInIndia } from "@/lib/cms/attention";
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
    if (record.draftState === "PUBLISHED") {
      return NextResponse.json(
        { error: "This job is live. Open it for editing first: the announcement then goes live with your reviewed publish, and the public keeps the current version until then.", code: "LIVE_JOB" },
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
    // Nothing public changed: the entry waits for the job's reviewed publish.
    return NextResponse.json({ record: saved, revision, update: entry, live: false });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("not open for editing")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[CMS] update append error", err);
    return NextResponse.json({ error: "Failed to append update" }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════
// PATCH /api/admin/cms/records/[id]/updates
//
// Mark announcements superseded by newer verified information, or make them
// current again (maintenance batch, Nov 2026; docs/announcement-supersession-
// design.md). Body: { action: "supersede" | "restore", ids, reason,
// replacedBy?, sourceUrl?, expected } where `expected` is the fingerprint of
// the announcement list the editor showed (updatesFingerprint).
// Same rules as an append: signed-in admin, own origin, job open for editing;
// nothing public changes until the owner's reviewed publish. Never creates,
// deletes or rewrites an announcement's own text; never posts anywhere.
// ═══════════════════════════════════════════════════════════

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  if (!validateOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let body: { action?: unknown; ids?: unknown; reason?: unknown; replacedBy?: unknown; sourceUrl?: unknown; expected?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action;
  if (action !== "supersede" && action !== "restore") return NextResponse.json({ error: "action must be supersede or restore" }, { status: 400 });
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  const reason = typeof body.reason === "string" ? body.reason : "";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  try {
    const record = await getRecruitmentById(id);
    if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    if (record.draftState === "PUBLISHED") {
      return NextResponse.json({ error: "This job is live. Open it for editing first: the change then goes live with your reviewed publish.", code: "LIVE_JOB" }, { status: 409 });
    }
    if (record.draftState === "ARCHIVED") return NextResponse.json({ error: "Cannot change an ARCHIVED record" }, { status: 409 });
    const before = record.updates ?? [];
    if (typeof body.expected !== "string" || body.expected !== updatesFingerprint(before)) {
      return NextResponse.json({ error: "The announcements changed since this page was loaded. Reload the page and try again.", code: "STALE" }, { status: 409 });
    }

    const result = action === "supersede"
      ? supersede(before, { ids, reason, replacedBy: str(body.replacedBy), sourceUrl: str(body.sourceUrl), on: todayInIndia(), by: auth.adminId })
      : restore(before, ids, reason);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const titles = before.filter((u) => ids.includes(u.id)).map((u) => `“${u.title}”`).join(", ");
    const why = `${action === "supersede" ? "Marked superseded" : "Made current again"}: ${titles}. ${reason.replace(/\s+/g, " ").trim()}`;
    const { record: saved, revision } = await persistUpdatesNote(id, before, result.list, auth.adminId, why.slice(0, 500));
    return NextResponse.json({ record: saved, revision, live: false });
  } catch (err) {
    if (err instanceof UpdatesChangedError) return NextResponse.json({ error: err.message, code: "STALE" }, { status: 409 });
    console.error("[CMS] announcement supersede error", err);
    return NextResponse.json({ error: "Failed to save the announcements" }, { status: 500 });
  }
}
