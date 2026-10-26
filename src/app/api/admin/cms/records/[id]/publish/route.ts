// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/publish
//
// Publishes an APPROVED CMS record.
//
// Pipeline (Phase E — locked):
//   1. Load record — must be APPROVED
//   2. Official evidence gate (hard): at least one CmsEvidence
//      with sourceType OFFICIAL_NOTIFICATION or OFFICIAL_CORRIGENDUM
//      OR at least one link with official=true
//      (Fail if neither is present)
//   3. Call projectToPublished() — deterministic, fail-closed
//   4. Call persistPublication() — atomic DB write
//   5. Return updated record
//
// Approve & Publish ({ approveFirst: true } on a DRAFT): the approval checks
// and every publish check above run on the draft first; only when all pass
// is it approved, then published. If the publish still fails after the
// approval, the approval is withdrawn (back to DRAFT, audited), so a failed
// publish never leaves a job Approved but not live.
//
// CSRF: validateOrigin required.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import {
  getRecruitmentById, persistApproval, persistApprovalWithdrawn, persistPublication, PUT_BACK_EVENT, StateConflictError,
} from "@/lib/cms/repository";
import { approveRecord } from "@/lib/cms/record-ops";
import { projectToPublished, PROJECTION_VERSION } from "@/lib/cms/projector";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { sql } from "@/lib/db";
import { buildJobAnnouncement, sendToChannel, type AnnouncementResult } from "@/lib/telegram";
import { CHANNEL_POST_EVENT, REPEAT_WINDOW_HOURS, decideChannelPost, messageHash, newsLine } from "@/lib/cms/channel-post";
import { todayInIndia } from "@/lib/cms/attention";
import { publishGateFor } from "@/lib/cms/importer/service";

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

  // { announce: true | false } says whether to post to the Telegram channel.
  // Without it, a first publish posts and a republish does not.
  // { approveFirst: true } is Approve & Publish (see the header).
  let requested: boolean | undefined;
  let approveFirst = false;
  try {
    const body = (await request.json()) as { announce?: unknown; approveFirst?: unknown };
    if (typeof body?.announce === "boolean") requested = body.announce;
    approveFirst = body?.approveFirst === true;
  } catch { /* no body: the defaults apply */ }

  let record = await getRecruitmentById(id);
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const approving = approveFirst && record.draftState === "DRAFT";
  if (!approving && record.draftState !== "APPROVED") {
    return NextResponse.json(
      { error: `Cannot publish: record is in state ${record.draftState} (must be APPROVED)` },
      { status: 409 },
    );
  }

  // ── Approve & Publish: everything is checked before the approval ──
  if (approving) {
    try {
      approveRecord(record, auth.adminId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err), code: "APPROVAL_CHECKS" },
        { status: 422 },
      );
    }
    const preflight = await checkPublishable({ ...record, draftState: "APPROVED" });
    if (!preflight.ok) return preflight.response;
    try {
      record = await persistApproval(record, auth.adminId);
    } catch (err) {
      if (err instanceof StateConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error("[CMS] approve before publish failed", err);
      return NextResponse.json({ error: "Failed to approve record" }, { status: 500 });
    }
  }

  // After an approval made here, any failure below withdraws it.
  const withdraw = async (reason: string): Promise<{ approvalWithdrawn?: true }> => {
    if (!approving) return {};
    try {
      if (await persistApprovalWithdrawn(id, auth.adminId, reason)) return { approvalWithdrawn: true };
    } catch (err) {
      console.error("[CMS] publish failed and the approval could not be withdrawn", err instanceof Error ? err.message : "error");
    }
    return {};
  };

  const ready = await checkPublishable(record);
  if (!ready.ok) {
    const body = { ...(await ready.response.json()), ...(await withdraw("publish checks failed")) };
    return NextResponse.json(body, { status: ready.response.status });
  }
  const { snapshot } = ready;

  // ── Persist ───────────────────────────────────────────────
  try {
    // Asked before the write, so the channel post can say "New" or "Updated".
    const earlier = await sql`SELECT 1 FROM published_recruitments WHERE recruitment_id = ${id} LIMIT 1`;
    const published = await persistPublication(record, snapshot, PROJECTION_VERSION, auth.adminId);
    // A job taken off the site goes back on it with this new version; say so in its history.
    if (record.takenDown) {
      try {
        await sql`
          INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
          VALUES (${id}, ${auth.adminId}, ${PUT_BACK_EVENT}, ${JSON.stringify({ via: "publish", takenDown: record.takenDown })})
        `;
      } catch (err) {
        console.error("[CMS] put back by publishing, but the history row was not written", err instanceof Error ? err.message : "error");
      }
    }

    // Public pages are statically cached. Without this, a new or updated job
    // stays invisible on the listing, home, sitemap and its own page until the
    // next deployment. Everything is re-rendered on its next visit.
    let revalidated = true;
    try {
      revalidatePath("/", "layout");
      // The sitemap is a route handler, not a page under the root layout, so
      // it has to be named on its own.
      revalidatePath("/sitemap.xml");
    } catch (err) {
      revalidated = false;
      console.error("[CMS] published, but public cache revalidation failed", err);
    }

    // The job is live at this point; a failed channel post never undoes that.
    const isNew = earlier.length === 0;
    const message = buildJobAnnouncement(snapshot, isNew ? "NEW" : "UPDATED", newsLine(snapshot.updates, todayInIndia()));
    const hash = messageHash(message);
    let announced: AnnouncementResult | "not-asked" | "duplicate";
    try {
      const recent = await sql`
        SELECT 1 FROM recruitment_audit_events
        WHERE recruitment_id = ${id} AND event_type = ${CHANNEL_POST_EVENT}
          AND metadata->>'hash' = ${hash}
          AND created_at > now() - make_interval(hours => ${REPEAT_WINDOW_HOURS})
        LIMIT 1
      `;
      const decision = decideChannelPost({ requested, isNew, sameMessageRecently: recent.length > 0 });
      if (decision.post) {
        announced = await sendToChannel(message);
        if (announced === "sent") {
          await sql`
            INSERT INTO recruitment_audit_events (recruitment_id, admin_id, event_type, metadata)
            VALUES (${id}, ${auth.adminId}, ${CHANNEL_POST_EVENT}, ${JSON.stringify({ hash, kind: isNew ? "NEW" : "UPDATED" })})
          `;
        }
      } else {
        announced = decision.reason;
      }
    } catch (err) {
      console.error("[CMS] channel post step failed", err instanceof Error ? err.message : "error");
      announced = "failed";
    }

    return NextResponse.json({ record: published, revalidated, announced });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("state") && msg.includes("APPROVED")) {
      return NextResponse.json({ error: "Record is no longer in APPROVED state" }, { status: 409 });
    }
    console.error("[CMS] persistPublication failed", err);
    return NextResponse.json({ error: "Failed to publish record", ...(await withdraw("publish failed")) }, { status: 500 });
  }
}

/**
 * Every check a publish needs, and the snapshot it would store: an official
 * source, the import gate for imported jobs, and the projection. Nothing is
 * written. The record must be APPROVED (or, for the Approve & Publish
 * preflight, a DRAFT presented as APPROVED).
 */
async function checkPublishable(
  record: RecruitmentRecord,
): Promise<{ ok: true; snapshot: ReturnType<typeof projectToPublished> } | { ok: false; response: NextResponse }> {
  // ── Official evidence hard gate ──────────────────────────
  // At least one official evidence source OR one official link required.
  const hasOfficialLink = record.links.some((l) => l.official);

  let hasOfficialEvidence = false;
  if (!hasOfficialLink) {
    const evidenceRows = await sql`
      SELECT 1 FROM recruitment_evidence
      WHERE recruitment_id = ${record.id}
        AND source_type IN ('OFFICIAL_NOTIFICATION', 'OFFICIAL_CORRIGENDUM', 'OFFICIAL_EXAM_NOTICE')
      LIMIT 1
    `;
    hasOfficialEvidence = evidenceRows.length > 0;
  }

  if (!hasOfficialLink && !hasOfficialEvidence) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Cannot publish yet: add at least one link marked Official (for example the official notification) in the Links section.",
          code: "MISSING_OFFICIAL_EVIDENCE",
        },
        { status: 422 },
      ),
    };
  }

  // ── Imported jobs: every critical field checked by a person ──
  // Jobs that were never imported skip this and publish exactly as before.
  const gate = await publishGateFor(record);
  if (!gate.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Check these before publishing: ${gate.blockers.map((b) => b.label).join(", ")}.`,
          code: "IMPORT_CHECKS_PENDING",
          blockers: gate.blockers.map((b) => ({ fieldPath: b.fieldPath, label: b.label, class: b.cls, reason: b.reason })),
        },
        { status: 422 },
      ),
    };
  }

  // ── Project ───────────────────────────────────────────────
  try {
    let snapshot = projectToPublished(record);
    if (gate.gated) {
      const words = (cls: string) => Object.fromEntries(gate.verdicts
        .filter((v) => v.cls === cls)
        .map((v) => [v.fieldPath, v.publicNote ?? ""]));
      // The gate passed (it refused above otherwise): say so on the public page.
      snapshot = { ...snapshot, notApplicable: words("NOT_APPLICABLE"), notStated: words("NOT_STATED"), keyDetailsChecked: gate.ok };
    }
    return { ok: true, snapshot };
  } catch (err) {
    console.error("[CMS] projection failed", err);
    return {
      ok: false,
      response: NextResponse.json({ error: `Projection failed: ${String(err)}` }, { status: 500 }),
    };
  }
}
