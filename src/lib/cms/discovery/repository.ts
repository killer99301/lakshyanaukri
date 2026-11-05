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

export async function listLeads(filter: { status?: LeadStatus; kind?: "NEW" | "UPDATE" } = {}): Promise<Lead[]> {
  const rows = await sql`
    SELECT * FROM discovery_leads
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null})
    ORDER BY last_seen_at DESC, first_seen_at DESC`;
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

/** The admin's review of a lead. Changes only the lead: never a recruitment. */
export async function setLeadStatus(opts: { id: string; adminId: string; status: LeadStatus; reason?: string | null; notes?: string | null }): Promise<boolean> {
  if (!LEAD_STATUSES.includes(opts.status)) throw new Error("Unknown lead status");
  const rows = await sql`
    UPDATE discovery_leads SET status = ${opts.status}, status_reason = ${opts.reason ?? null},
      notes = coalesce(${opts.notes ?? null}, notes), status_changed_at = now(), status_changed_by = ${opts.adminId}
    WHERE id = ${opts.id} RETURNING id`;
  return rows.length > 0;
}
