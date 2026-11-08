// ═══════════════════════════════════════════════════════════
// Updates Needed: the Apply Online link to be released later
// ═══════════════════════════════════════════════════════════
//
// docs/apply-link-not-yet-open-design.md, revision 3, §5. A job is listed
// from the moment a "link not released yet" decision was first recorded on
// it, until its PUBLISHED page carries a verified Apply Online link. The
// steps between (decision in force, link added but not verified, decision
// withdrawn, link verified but not republished) each have their own words;
// the reminder is urgent from the link's release date, or from the
// applications' opening date when no release date was given.
//
// Read only: nothing is fetched, verified, published or unpublished here.

import { sql } from "@/lib/db";
import { getRecruitmentById } from "@/lib/cms/repository";
import { classifyField, effectiveDecision } from "@/lib/cms/importer/classify";
import { fieldStates, firstImportAt } from "@/lib/cms/importer/repository";
import { LINK_LATER_FIELD, linkLaterReminder, readLinkLater } from "@/lib/cms/importer/link-later";
import type { AttentionItem } from "@/lib/cms/attention";
import type { RecruitmentRecord } from "@/types/recruitment-record";

export interface LinkLaterReminderRow { record: RecruitmentRecord; item: AttentionItem }

/** Each job with a pending Apply Online link (or only the one asked for), with its reminder. */
export async function linkLaterReminders(todayIso: string, recordId?: string): Promise<LinkLaterReminderRow[]> {
  const ids = (recordId
    ? await sql`SELECT DISTINCT recruitment_id FROM recruitment_field_claims WHERE kind = 'ADMIN_NOT_YET_OPEN' AND recruitment_id = ${recordId}::uuid`
    : await sql`SELECT DISTINCT recruitment_id FROM recruitment_field_claims WHERE kind = 'ADMIN_NOT_YET_OPEN'`).map((r) => String(r.recruitment_id));
  const out: LinkLaterReminderRow[] = [];
  for (const id of ids) {
    const record = await getRecruitmentById(id);
    if (!record || record.draftState === "ARCHIVED") continue;
    const [state] = await fieldStates(record, [LINK_LATER_FIELD]);
    const latestClaim = [...state.claims].filter((c) => c.kind === "ADMIN_NOT_YET_OPEN").sort((a, b) => b.seq - a.seq)[0];
    const latest = latestClaim ? readLinkLater(latestClaim.value) : null;
    if (!latest) continue;
    const verdict = classifyField(state, await firstImportAt(record.id));
    const published = (await sql`SELECT snapshot FROM published_recruitments WHERE recruitment_id = ${record.id} ORDER BY published_at DESC LIMIT 1`)[0]?.snapshot as
      { links?: Array<{ type?: string }>; applyLinkLater?: unknown } | undefined;
    const reminder = linkLaterReminder({
      latest: { linkReleaseOn: latest.linkReleaseOn, applicationsOpenOn: latest.applicationsOpenOn, where: latest.where },
      inForce: effectiveDecision(state)?.kind === "ADMIN_NOT_YET_OPEN",
      cls: verdict.cls,
      hasLink: state.hasValue,
      publishedHasLink: !!published?.links?.some((l) => l.type === "APPLY_ONLINE"),
      publishedShowsLater: !!published?.applyLinkLater,
    }, todayIso);
    if (reminder) out.push({ record, item: { level: reminder.level, code: "APPLY_LINK_PENDING", message: reminder.message } });
  }
  return out;
}
