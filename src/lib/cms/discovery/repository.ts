// ═══════════════════════════════════════════════════════════
// Discovery leads: reading them, and the admin's review status (N1)
// ═══════════════════════════════════════════════════════════
//
// Server only. The collector writes leads and sources (collector.ts); the
// status, reason and notes here are the admin's own and no collector run
// changes them. Nothing here touches a recruitment.

import { sql } from "@/lib/db";

export const LEAD_STATUSES = ["NEW", "PROCESSING", "READY_FOR_REVIEW", "NEEDS_SOURCE", "NEEDS_CORRECTION", "DUPLICATE", "DISMISSED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadSource { sourceId: string; sourceName: string; tier: number; listingUrl: string; itemUrl: string; pdfUrl: string | null; titleSeen: string; nearbyDate: string | null; official: boolean; firstSeenAt: string; lastSeenAt: string; seenRuns: number }
export interface Lead {
  id: string; key: string; kind: "NEW" | "UPDATE"; title: string;
  organizationId: string | null; organizationName: string | null; notificationNumber: string | null;
  status: LeadStatus; statusReason: string | null; notes: string | null;
  match: { kind: string; recruitmentId: string | null; reason: string | null; confidence: number | null; candidates: Array<{ id: string; title: string; kind: string; reason: string }> };
  relatedLeads: Array<{ leadId: string; reason: string }>;
  firstSeenAt: string; lastSeenAt: string; seenRuns: number;
  sources: LeadSource[];
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export type LeadSort = "last_seen" | "first_seen";

export async function listLeads(filter: { status?: LeadStatus; kind?: "NEW" | "UPDATE"; id?: string; sort?: LeadSort } = {}): Promise<Lead[]> {
  const byFirst = filter.sort === "first_seen";
  const rows = await sql`
    SELECT * FROM discovery_leads
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null})
      AND (${filter.id ?? null}::uuid IS NULL OR id = ${filter.id ?? null}::uuid)
    ORDER BY CASE WHEN ${byFirst} THEN first_seen_at ELSE last_seen_at END DESC, first_seen_at DESC, id`;
  if (!rows.length) return [];
  const srcs = await sql`SELECT * FROM discovery_lead_sources WHERE lead_id = ANY(${rows.map((r) => String(r.id))}) ORDER BY source_tier, first_seen_at`;
  return rows.map((r) => ({
    id: String(r.id), key: String(r.lead_key), kind: r.kind as Lead["kind"], title: String(r.title),
    organizationId: (r.organization_id as string | null) ?? null, organizationName: (r.organization_name as string | null) ?? null,
    notificationNumber: (r.notification_number as string | null) ?? null,
    status: r.status as LeadStatus, statusReason: (r.status_reason as string | null) ?? null, notes: (r.notes as string | null) ?? null,
    match: { kind: String(r.match_kind), recruitmentId: r.match_recruitment_id ? String(r.match_recruitment_id) : null, reason: (r.match_reason as string | null) ?? null,
      confidence: r.match_confidence === null ? null : Number(r.match_confidence), candidates: (r.match_candidates as Lead["match"]["candidates"]) ?? [] },
    relatedLeads: (r.related_leads as Lead["relatedLeads"]) ?? [],
    firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at), seenRuns: Number(r.seen_runs),
    sources: srcs.filter((s) => String(s.lead_id) === String(r.id)).map((s) => ({
      sourceId: String(s.source_id), sourceName: String(s.source_name), tier: Number(s.source_tier), listingUrl: String(s.listing_url),
      itemUrl: String(s.item_url), pdfUrl: (s.pdf_url as string | null) ?? null, titleSeen: String(s.title_seen),
      nearbyDate: (s.nearby_date as string | null) ?? null, official: !!s.official,
      firstSeenAt: iso(s.first_seen_at), lastSeenAt: iso(s.last_seen_at), seenRuns: Number(s.seen_runs) })),
  }));
}

export async function getLead(id: string): Promise<Lead | null> {
  if (!UUID.test(id)) return null;
  return (await listLeads({ id }))[0] ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_REASON = 500;
export const MAX_NOTE = 2000;

/** What the admin can do to a lead in the New Jobs Found inbox (N3). */
export type LeadAction = "READY_FOR_REVIEW" | "NEEDS_SOURCE" | "NEEDS_CORRECTION" | "DUPLICATE" | "DISMISS" | "REOPEN";
export const LEAD_ACTIONS: LeadAction[] = ["READY_FOR_REVIEW", "NEEDS_SOURCE", "NEEDS_CORRECTION", "DUPLICATE", "DISMISS", "REOPEN"];

export class LeadReviewError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "LeadReviewError"; }
}

/**
 * The admin's review of a lead (N3). Changes the lead only, never a recruitment; a collector run never
 * changes what is recorded here. The previous status and its reason are kept in the notes, with the date.
 *   DUPLICATE names the CMS job, which must be one the lead was matched to and still in the CMS.
 *   DISMISS needs a reason. REOPEN brings a dismissed or duplicate lead back to New.
 */
export async function reviewLead(opts: { id: string; adminId: string; action: LeadAction; reason?: string | null; note?: string | null; recruitmentId?: string | null }): Promise<Lead> {
  if (!LEAD_ACTIONS.includes(opts.action)) throw new LeadReviewError("Unknown action");
  const lead = await getLead(opts.id);
  if (!lead) throw new LeadReviewError("Lead not found", 404);
  const reason = (opts.reason ?? "").trim();
  const note = (opts.note ?? "").trim();
  if (reason.length > MAX_REASON) throw new LeadReviewError(`Keep the reason under ${MAX_REASON} characters`);
  if (note.length > MAX_NOTE) throw new LeadReviewError(`Keep the note under ${MAX_NOTE} characters`);

  let status: LeadStatus;
  let statusReason: string | null = reason || null;
  switch (opts.action) {
    case "DISMISS":
      if (reason.length < 3) throw new LeadReviewError("Say why the lead is dismissed");
      status = "DISMISSED";
      break;
    case "REOPEN":
      if (lead.status !== "DISMISSED" && lead.status !== "DUPLICATE") throw new LeadReviewError("Only a dismissed or duplicate lead is reopened");
      status = "NEW";
      break;
    case "DUPLICATE": {
      const job = opts.recruitmentId ?? "";
      const known = new Set([lead.match.recruitmentId, ...lead.match.candidates.map((c) => c.id)].filter(Boolean));
      if (!UUID.test(job) || !known.has(job)) throw new LeadReviewError("Choose the CMS job it duplicates from the jobs it was matched to");
      const rows = await sql`SELECT coalesce(title_text, '') AS title FROM recruitments WHERE id = ${job}::uuid AND draft_state <> 'ARCHIVED'`;
      if (!rows.length) throw new LeadReviewError("That CMS job is not in the CMS any more");
      status = "DUPLICATE";
      statusReason = `duplicate of “${String(rows[0].title)}” (${job})${reason ? ` — ${reason}` : ""}`;
      break;
    }
    default:
      status = opts.action;
  }
  // The earlier status and reason are not lost: they go into the notes, dated.
  const day = new Date().toISOString().slice(0, 10);
  const history = lead.status !== status || (lead.statusReason && lead.statusReason !== statusReason)
    ? `${day}: was ${lead.status}${lead.statusReason ? ` — ${lead.statusReason}` : ""}` : null;
  const notes = [lead.notes, history, note ? `${day}: ${note}` : null].filter(Boolean).join("\n").slice(-20_000) || null;
  await sql`
    UPDATE discovery_leads SET status = ${status}, status_reason = ${statusReason}, notes = ${notes},
      status_changed_at = now(), status_changed_by = ${opts.adminId}
    WHERE id = ${opts.id}::uuid`;
  return (await getLead(opts.id))!;
}

/** The admin's review of a lead. Changes only the lead: never a recruitment. */
export async function setLeadStatus(opts: { id: string; adminId: string; status: LeadStatus; reason?: string | null; notes?: string | null }): Promise<boolean> {
  if (!LEAD_STATUSES.includes(opts.status)) throw new Error("Unknown lead status");
  const rows = await sql`
    UPDATE discovery_leads SET status = ${opts.status}, status_reason = ${opts.reason ?? null},
      notes = coalesce(${opts.notes ?? null}, notes), status_changed_at = now(), status_changed_by = ${opts.adminId}
    WHERE id = ${opts.id} RETURNING id`;
  return rows.length > 0;
}
