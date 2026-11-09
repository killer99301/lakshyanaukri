// ═══════════════════════════════════════════════════════════
// POST /api/admin/cms/records/[id]/publish
//
// Publishes an APPROVED CMS record, on the owner's explicit approval
// (owner-controlled publication: docs/owner-controlled-publication-design.md,
// revision 3, Stage 1).
//
// Body: { ownerApproval: { acknowledged, reviewHash, recordRevision, claimSeq,
//         retrievals, conflictsAcknowledged[] }, announce?, approveFirst? }
//
//   1. Only an authorised publisher (CMS_PUBLISHERS, admin IDs) may publish.
//   2. The review is rebuilt on the server, from the database alone
//      (GET …/publication-review shows the same). Its hard rules block
//      whatever the owner decides: an invalid record, unresolved conflicts,
//      a non-http link, a job-news site as the Apply link.
//   3. The approval must match this review exactly: acknowledged, same
//      fingerprint and freshness, and one acknowledgement per material
//      disagreement (never a blanket override).
//   4. The official-source gate and the ten-field import check no longer
//      block: they are warnings in the review. Official checks remain
//      available as quality checks and still decide keyDetailsChecked.
//   5. persistPublication() publishes in one statement: state, snapshot, the
//      PUBLISHED row and the OWNER_PUBLICATION_APPROVAL row, only if the job
//      is still exactly as reviewed (revision, latest claim, documents).
//
// Every refusal is recorded on its own (PUBLICATION_REFUSED), after the
// refused step, never with it. Telegram: posted only when asked, as before.
//
// Approve & Publish ({ approveFirst: true } on a DRAFT): every check above
// runs first; only then is the draft approved, then published. If the
// publish still fails after the approval, the approval is withdrawn.
//
// CSRF: validateOrigin required.
// ═══════════════════════════════════════════════════════════

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin, validateOrigin } from "@/lib/auth/guard";
import {
  getRecruitmentById, persistApproval, persistApprovalWithdrawn, persistPublication, PUT_BACK_EVENT, StaleReviewError, StateConflictError,
} from "@/lib/cms/repository";
import { approveRecord } from "@/lib/cms/record-ops";
import { projectToPublished, PROJECTION_VERSION } from "@/lib/cms/projector";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { sql } from "@/lib/db";
import { buildJobAnnouncement, sendToChannel, type AnnouncementResult } from "@/lib/telegram";
import { CHANNEL_POST_EVENT, REPEAT_WINDOW_HOURS, decideChannelPost, messageHash, newsLine } from "@/lib/cms/channel-post";
import { todayInIndia } from "@/lib/cms/attention";
import { publishGateFor } from "@/lib/cms/importer/service";
import { isPublisher, logPublicationRefusal, notAPublisherMessage, OWNER_APPROVAL_EVENT, type RefusalReason } from "@/lib/cms/publication-policy";
import { approvalMetadata, approvalProblem, buildPublicationReview, readOwnerApproval } from "@/lib/cms/publication-review";

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
  // Without it, nothing is posted: posting is an explicit opt-in (the box starts unticked).
  // { approveFirst: true } is Approve & Publish (see the header).
  let requested: boolean | undefined;
  let approveFirst = false;
  let rawApproval: unknown = null;
  try {
    const body = (await request.json()) as { announce?: unknown; approveFirst?: unknown; ownerApproval?: unknown };
    if (typeof body?.announce === "boolean") requested = body.announce;
    approveFirst = body?.approveFirst === true;
    rawApproval = body?.ownerApproval ?? null;
  } catch { /* no body: the defaults apply */ }

  let record = await getRecruitmentById(id);
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const earlier = await sql`SELECT 1 FROM published_recruitments WHERE recruitment_id = ${id} LIMIT 1`;
  const isNew = earlier.length === 0;
  const action = isNew ? "PUBLISH" as const : "REPUBLISH" as const;
  const refuse = async (status: number, reason: RefusalReason, body: Record<string, unknown>, extra: { fieldPaths?: string[]; ruleCodes?: string[] } = {}) => {
    await logPublicationRefusal({ recruitmentId: id, adminId: auth.adminId, action, reason, recordRevision: record?.recordRevision ?? null, ...extra });
    return NextResponse.json(body, { status });
  };

  // ── 1. Who may publish ──
  if (!isPublisher(auth.adminId)) {
    return refuse(403, "NOT_A_PUBLISHER", { error: notAPublisherMessage(auth.adminId), code: "NOT_A_PUBLISHER", adminId: auth.adminId });
  }

  const approving = approveFirst && record.draftState === "DRAFT";
  if (!approving && record.draftState !== "APPROVED") {
    return refuse(409, "STATE", { error: `Cannot publish: record is in state ${record.draftState} (must be APPROVED)` });
  }

  // ── 2–3. The review, rebuilt here, and the owner's approval of it ──
  const review = await buildPublicationReview(record, todayInIndia());
  if (review.hardRules.length > 0) {
    return refuse(422, "HARD_RULE", {
      error: `Cannot publish: ${review.hardRules.map((r) => r.message).join(" ")}`, code: "HARD_RULE", hardRules: review.hardRules, review,
    }, { ruleCodes: review.hardRules.map((r) => r.code), fieldPaths: review.hardRules.flatMap((r) => r.fieldPaths ?? []) });
  }
  const approval = readOwnerApproval(rawApproval);
  const problem = approvalProblem(review, approval);
  if (problem) {
    const words = {
      OWNER_REVIEW_REQUIRED: "Review the job and confirm that you accept editorial responsibility before publishing.",
      REVIEW_CHANGED: "The job changed after it was reviewed: review it again before publishing.",
      CONFLICT_NOT_ACKNOWLEDGED: "Each disagreement between sources must be edited or acknowledged on its own before publishing.",
    }[problem.reason];
    return refuse(problem.reason === "REVIEW_CHANGED" ? 409 : 422, problem.reason,
      { error: words, code: problem.reason, review, ...(problem.fieldPaths ? { fieldPaths: problem.fieldPaths } : {}) },
      { fieldPaths: problem.fieldPaths });
  }

  // ── Approve & Publish: everything above passed before the approval ──
  if (approving) {
    try {
      approveRecord(record, auth.adminId);
    } catch (err) {
      return refuse(422, "HARD_RULE", { error: err instanceof Error ? err.message : String(err), code: "APPROVAL_CHECKS" }, { ruleCodes: ["APPROVAL_CHECKS"] });
    }
    try {
      record = await persistApproval(record, auth.adminId);
    } catch (err) {
      if (err instanceof StateConflictError) return refuse(409, "STATE", { error: err.message });
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

  const ready = await projectForPublication(record);
  if (!ready.ok) {
    const body = { ...(await ready.response.json()), ...(await withdraw("publish checks failed")) };
    return NextResponse.json(body, { status: ready.response.status });
  }
  const { snapshot } = ready;

  // ── 5. Persist: published only if the job is still exactly as reviewed ──
  try {
    const published = await persistPublication(record, snapshot, PROJECTION_VERSION, auth.adminId, {
      freshness: review.freshness,
      approval: approvalMetadata(review, auth.adminId, isNew ? "FIRST_PUBLISH" : "REPUBLISH", requested === true),
      eventType: OWNER_APPROVAL_EVENT,
    });
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
      const decision = decideChannelPost({ requested: requested ?? false, isNew, sameMessageRecently: recent.length > 0 });
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
    if (err instanceof StaleReviewError) {
      const w = await withdraw("the job changed after it was reviewed");
      return refuse(409, "REVIEW_CHANGED", { error: err.message, code: "REVIEW_CHANGED", ...w });
    }
    const msg = String(err);
    if (msg.includes("state") && msg.includes("APPROVED")) {
      return refuse(409, "STATE", { error: "Record is no longer in APPROVED state" });
    }
    console.error("[CMS] persistPublication failed", err);
    return NextResponse.json({ error: "Failed to publish record", ...(await withdraw("publish failed")) }, { status: 500 });
  }
}

/**
 * The snapshot a publish stores. The official checks no longer block here (they are warnings in the owner's
 * review); for imported jobs they still decide what the snapshot records: decisions made, and whether every
 * key detail was checked (keyDetailsChecked: true only when they all were). Nothing is written.
 */
async function projectForPublication(
  record: RecruitmentRecord,
): Promise<{ ok: true; snapshot: ReturnType<typeof projectToPublished> } | { ok: false; response: NextResponse }> {
  try {
    const gate = await publishGateFor(record);
    let snapshot = projectToPublished(record);
    if (gate.gated) {
      const words = (cls: string) => Object.fromEntries(gate.verdicts
        .filter((v) => v.cls === cls)
        .map((v) => [v.fieldPath, v.publicNote ?? ""]));
      // The day the latest check in force was recorded: what "checked on" means, never the publish time.
      const decisionIds = gate.verdicts.map((v) => v.decisionId).filter((id): id is string => !!id);
      const checkedOn = gate.ok && decisionIds.length > 0
        ? ((await sql`SELECT max(claimed_at) AS at FROM recruitment_field_claims WHERE id = ANY(${decisionIds}::uuid[])`)[0]?.at as string | Date | null) ?? null
        : null;
      // The application link to be released later (revision 3): what the notice announced, never a link.
      const later = gate.verdicts.find((v) => v.cls === "NOT_YET_OPEN" && v.fieldPath === "links#APPLY_ONLINE")?.linkLater;
      snapshot = { ...snapshot, ...(later ? { applyLinkLater: later } : {}),
        notApplicable: words("NOT_APPLICABLE"), notStated: words("NOT_STATED"), keyDetailsChecked: gate.ok,
        ...(gate.ok && checkedOn ? { keyDetailsCheckedOn: new Date(checkedOn).toISOString().slice(0, 10) } : {}) };
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
