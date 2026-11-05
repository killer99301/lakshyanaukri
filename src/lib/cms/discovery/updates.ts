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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export interface UpdatesOverview { today: string; leads: Lead[]; attention: JobAttention[]; liveCount: number }

/** U1: every update lead (each with its tie) and every live job's date reminders. */
export async function updatesOverview(): Promise<UpdatesOverview> {
  const today = todayInIndia();
  const [leads, live] = await Promise.all([listLeads({ kind: "UPDATE" }), listLiveRecruitments()]);
  return { today, leads, attention: buildAttentionList(live, today), liveCount: live.length };
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
  return {
    today,
    job: { id: record.id, title: record.identity.title.value ?? "", live: isLive(record) },
    matched: leads.filter((l) => tieOf(l) === "MATCHED" && l.match.recruitmentId === recordId),
    possible: leads.filter((l) => !(tieOf(l) === "MATCHED" && l.match.recruitmentId === recordId)),
    attention: isLive(record) ? attentionFor(record, today) : [],
  };
}
