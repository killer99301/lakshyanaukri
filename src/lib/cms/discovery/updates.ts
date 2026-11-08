// ═══════════════════════════════════════════════════════════
// Updates Needed (U1–U2): update leads and the jobs' own date reminders
// ═══════════════════════════════════════════════════════════
//
// Server only. Puts together what already exists: the update leads the
// collector saved (results, admit cards, extensions… found on portals) and
// the date-based attention items worked out from each live job's own dates.
// Neither is a confirmed change: a lead is research found on a portal, an
// attention item is a reminder from the job's dates. Nothing here changes a
// job, runs an AI request or fetches anything.

import { sql } from "@/lib/db";
import { getRecruitmentById, listLiveRecruitments } from "@/lib/cms/repository";
import { attentionFor, buildAttentionList, isLive, todayInIndia, type AttentionItem, type JobAttention } from "@/lib/cms/attention";
import { listLeads, type Lead } from "@/lib/cms/discovery/repository";
import { tieOf } from "@/app/admin/cms/discovery/lead-view";
import { linkLaterReminders, type LinkLaterReminderRow } from "@/lib/cms/importer/link-later-reminders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVEL: Record<AttentionItem["level"], number> = { NOW: 0, SOON: 1, CHECK: 2 };

/** The pending Apply Online link reminders (revision 3, §5); none where the importer's tables are not in the database yet. */
async function pendingLinks(today: string, recordId?: string): Promise<LinkLaterReminderRow[]> {
  try {
    return await linkLaterReminders(today, recordId);
  } catch (err) {
    if (/recruitment_field_claims/.test(err instanceof Error ? err.message : "")) return [];
    throw err;
  }
}

/** The job lists with each pending-link reminder added: on its job's entry, or as a job of its own (live or not). */
function withPendingLinks(list: JobAttention[], rows: LinkLaterReminderRow[]): JobAttention[] {
  const out = list.map((j) => ({ ...j, items: [...j.items] }));
  for (const { record, item } of rows) {
    const entry = out.find((j) => j.id === record.id);
    if (entry) { entry.items.push(item); entry.items.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]); continue; }
    out.push({ id: record.id, slug: record.slug, title: record.identity.shortTitle?.value || record.identity.title.value || record.slug,
      organizationName: record.identity.organizationName, items: [item] });
  }
  return out.sort((a, b) => LEVEL[a.items[0].level] - LEVEL[b.items[0].level] || a.title.localeCompare(b.title));
}


export interface UpdatesOverview { today: string; leads: Lead[]; attention: JobAttention[]; liveCount: number }

/** U1: every update lead (each with its tie) and every live job's date reminders. */
export async function updatesOverview(): Promise<UpdatesOverview> {
  const today = todayInIndia();
  const [leads, live, links] = await Promise.all([listLeads({ kind: "UPDATE" }), listLiveRecruitments(), pendingLinks(today)]);
  return { today, leads, attention: withPendingLinks(buildAttentionList(live, today), links), liveCount: live.length };
}

export interface JobUpdates {
  today: string;
  job: { id: string; title: string; live: boolean };
  /** Update leads matched to this job. */
  matched: Lead[];
  /** Update leads that may be about this job: not this job's until the admin says so. */
  possible: Lead[];
  attention: AttentionItem[];
}

/** U2: one job's update leads (matched, and possible ones kept apart) and its date reminders. */
export async function updatesForJob(recordId: string): Promise<JobUpdates | null> {
  if (!UUID.test(recordId)) return null;
  const record = await getRecruitmentById(recordId);
  if (!record) return null;
  const ids = (await sql`
    SELECT id FROM discovery_leads
    WHERE kind = 'UPDATE' AND (match_recruitment_id = ${recordId}::uuid OR match_candidates @> ${JSON.stringify([{ id: recordId }])}::jsonb)`).map((r) => String(r.id));
  const leads = ids.length ? (await listLeads({ kind: "UPDATE" })).filter((l) => ids.includes(l.id)) : [];
  const today = todayInIndia();
  const links = await pendingLinks(today, recordId);
  return {
    today,
    job: { id: record.id, title: record.identity.title.value ?? "", live: isLive(record) },
    matched: leads.filter((l) => tieOf(l) === "MATCHED" && l.match.recruitmentId === recordId),
    possible: leads.filter((l) => !(tieOf(l) === "MATCHED" && l.match.recruitmentId === recordId)),
    attention: [...(isLive(record) ? attentionFor(record, today) : []), ...links.map((l) => l.item)].sort((a, b) => LEVEL[a.level] - LEVEL[b.level]),
  };
}
