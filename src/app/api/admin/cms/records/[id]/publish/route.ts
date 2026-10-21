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
// CSRF: validateOrigin required.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import { getRecruitmentById, persistPublication, PUT_BACK_EVENT } from "@/lib/cms/repository";
import { projectToPublished, PROJECTION_VERSION } from "@/lib/cms/projector";
import { sql } from "@/lib/db";
import { buildJobAnnouncement, sendToChannel, type AnnouncementResult } from "@/lib/telegram";
import { CHANNEL_POST_EVENT, REPEAT_WINDOW_HOURS, decideChannelPost, messageHash, newsLine } from "@/lib/cms/channel-post";
import { todayInIndia } from "@/lib/cms/attention";

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
  let requested: boolean | undefined;
  try {
    const body = (await request.json()) as { announce?: unknown };
    if (typeof body?.announce === "boolean") requested = body.announce;
  } catch { /* no body: the defaults apply */ }

  const record = await getRecruitmentById(id);
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  if (record.draftState !== "APPROVED") {
    return NextResponse.json(
      { error: `Cannot publish: record is in state ${record.draftState} (must be APPROVED)` },
      { status: 409 },
    );
  }

  // ── Official evidence hard gate ──────────────────────────
  // At least one official evidence source OR one official link required.
  const hasOfficialLink = record.links.some((l) => l.official);

  let hasOfficialEvidence = false;
  if (!hasOfficialLink) {
    const evidenceRows = await sql`
      SELECT 1 FROM recruitment_evidence
      WHERE recruitment_id = ${id}
        AND source_type IN ('OFFICIAL_NOTIFICATION', 'OFFICIAL_CORRIGENDUM', 'OFFICIAL_EXAM_NOTICE')
      LIMIT 1
    `;
    hasOfficialEvidence = evidenceRows.length > 0;
  }

  if (!hasOfficialLink && !hasOfficialEvidence) {
    return NextResponse.json(
      {
        error:
          "Cannot publish yet: add at least one link marked Official (for example the official notification) in the Links section.",
        code: "MISSING_OFFICIAL_EVIDENCE",
      },
      { status: 422 },
    );
  }

  // ── Project ───────────────────────────────────────────────
  let snapshot: ReturnType<typeof projectToPublished>;
  try {
    snapshot = projectToPublished(record);
  } catch (err) {
    console.error("[CMS] projection failed", err);
    return NextResponse.json(
      { error: `Projection failed: ${String(err)}` },
      { status: 500 },
    );
  }

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
    return NextResponse.json({ error: "Failed to publish record" }, { status: 500 });
  }
}
