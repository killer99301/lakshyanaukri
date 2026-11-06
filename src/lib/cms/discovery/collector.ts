// ═══════════════════════════════════════════════════════════
// Discovery collector: portal listings → CMS discovery leads (N2)
// ═══════════════════════════════════════════════════════════
//
// Server only. For each enabled source (source-config.ts): fetch its one
// listing page or feed through the importer's safe fetch, if its robots.txt
// allows; read it with the existing adapter's parser, keeping update notices
// and leads whose organisation is not recognised; group the items by strong
// identity only (notice number, address); compare each group with the CMS's
// own jobs; save it as a lead with every place it was seen.
//
// Research only: no recruitment is created, changed, verified or published,
// no AI is used, nothing is followed past the listing page. A later run adds
// sources and refreshes the match, and never changes the admin's status,
// reason or notes. Nothing calls this yet: no route, button or schedule.

import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { fetchSource, type FetchedSource } from "@/lib/cms/importer/fetch-source";
import { hostOf } from "@/lib/cms/importer/trusted-domains";
import { officialHost, robotsAllows } from "@/lib/cms/importer/discover";
import { getEnabledSources } from "@/intelligence/multi-source/source-config";
import { parseHtmlLinks } from "@/intelligence/multi-source/adapters/html-link-adapter";
import { parseRssFeed } from "@/intelligence/multi-source/adapters/rss-adapter";
import { clusterDiscoveries } from "@/intelligence/multi-source/clusterer";
import { bigramJaccard } from "@/intelligence/dedup";
import type { DiscoveryCluster, MultiSourceConfig, RawDiscovery } from "@/intelligence/multi-source/types";
import { matchLead, noticeKey, relatedLeadTitles, type CmsJob, type LeadMatch } from "@/lib/cms/discovery/match";

export const MAX_ITEMS_PER_SOURCE = 100;
const MAX_SOURCES = 10;

export interface SourceOutcome { id: string; url: string; status: "OK" | "EMPTY" | "REFUSED" | "UNAVAILABLE" | "PARSE_ERROR"; items: number; error?: string }
export interface CollectedLead { id: string; key: string; kind: "NEW" | "UPDATE"; title: string; match: LeadMatch["kind"]; status: string; created: boolean; sourcesAdded: number }
export interface CollectorReport { sources: SourceOutcome[]; leads: CollectedLead[]; created: number; seenAgain: number; sourcesAdded: number }

export interface CollectorOptions {
  sources?: MultiSourceConfig[];
  fetchSourceFn?: (url: string) => Promise<FetchedSource>;
  /** Pause between two sources (their rateLimitDelayMs); tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}

/** One source's listing page or feed, read; or why it was not. */
async function readSource(config: MultiSourceConfig, fetchOne: (url: string) => Promise<FetchedSource>, now: string): Promise<{ outcome: SourceOutcome; items: RawDiscovery[] }> {
  const fail = (status: SourceOutcome["status"], error: string) => ({ outcome: { id: config.id, url: config.url, status, items: 0, error }, items: [] as RawDiscovery[] });
  let page: URL;
  try { page = new URL(config.url); } catch { return fail("REFUSED", "not a web address"); }
  if (page.protocol !== "https:" && page.protocol !== "http:") return fail("REFUSED", "only web pages are read");
  const robots = await fetchOne(`${page.origin}/robots.txt`);
  if (robots.ok && /text\/plain/i.test(robots.contentType) && !robotsAllows(robots.bytes.toString("utf8"), page.pathname + page.search)) {
    return fail("REFUSED", `${page.host} asks crawlers not to read this page (robots.txt)`);
  }
  const got = await fetchOne(page.toString());
  // A private or non-public address (also after a redirect) is refused by the safe fetch itself.
  if (!got.ok) return fail(got.refused ? "REFUSED" : "UNAVAILABLE", got.error);
  if (!/html|xml/i.test(got.contentType)) return fail("UNAVAILABLE", `not a listing page (${got.contentType || "no content type"})`);
  const text = got.bytes.toString("utf8");
  const opts = { keepUnknownOrg: true, keepUpdates: true, now };
  let items: RawDiscovery[];
  if (config.type === "RSS") {
    const read = parseRssFeed(config, text, opts);
    if (read.status === "PARSE_ERROR") return fail("PARSE_ERROR", read.error ?? "the feed could not be read");
    items = read.discoveries;
  } else {
    items = parseHtmlLinks(config, text, opts);
  }
  items = items.slice(0, MAX_ITEMS_PER_SOURCE).map((d) => ({
    ...d,
    // A notice number is identity only when one was printed; never the title standing in for it.
    normalizedNotifNumber: d.notificationNumber && d.organizationId ? noticeKey(d.notificationNumber) ?? "" : "",
  }));
  return { outcome: { id: config.id, url: config.url, status: items.length ? "OK" : "EMPTY", items: items.length }, items };
}

const fingerprint = (d: RawDiscovery) => d.sourceUrlFingerprint || createHash("sha256").update(d.href).digest("hex").slice(0, 24);

function leadKey(c: DiscoveryCluster, kind: "NEW" | "UPDATE"): string {
  const p = c.primaryHit;
  const notice = p.organizationId && p.normalizedNotifNumber ? `n:${p.normalizedNotifNumber}` : `u:${fingerprint(p)}`;
  return `${kind}:${p.organizationId || "?"}:${notice}`;
}

async function cmsJobs(): Promise<CmsJob[]> {
  const rows = await sql`
    SELECT id, organization_id, organization_name, coalesce(title_text, identity->'title'->>'value', '') AS title,
           identity->'notificationNumber'->>'value' AS notification_number,
           CASE WHEN identity->>'recruitmentYear' ~ '^[0-9]{4}$' THEN (identity->>'recruitmentYear')::int END AS year
    FROM recruitments WHERE draft_state <> 'ARCHIVED'`;
  return rows.map((r) => ({ id: String(r.id), organizationId: String(r.organization_id), organizationName: (r.organization_name as string | null) ?? null, title: String(r.title),
    notificationNumber: (r.notification_number as string | null) ?? null, year: (r.year as number | null) ?? null }));
}

/** Save one group as a lead (or as the lead it already is), with every place it was seen. */
async function saveLead(c: DiscoveryCluster, kind: "NEW" | "UPDATE", jobs: CmsJob[], now: string): Promise<CollectedLead> {
  const hits = [c.primaryHit, ...c.additionalHits];
  const p = c.primaryHit;
  const key = leadKey(c, kind);
  const org = hits.find((h) => h.organizationId)?.organizationId || null;
  const orgName = hits.find((h) => h.organizationName)?.organizationName || null;
  const notice = hits.find((h) => h.notificationNumber)?.notificationNumber ?? null;
  const match = matchLead({ organizationId: org, organizationName: orgName, title: p.title, notificationNumber: notice }, jobs);
  const fps = hits.map(fingerprint);
  const found = await sql`
    SELECT l.id, l.status FROM discovery_leads l
    WHERE l.lead_key = ${key}
       OR (l.kind = ${kind} AND EXISTS (SELECT 1 FROM discovery_lead_sources s WHERE s.lead_id = l.id AND s.item_fingerprint = ANY(${fps})))
    ORDER BY l.first_seen_at, l.id LIMIT 1`;
  let id: string;
  let status: string;
  let created = false;
  if (found.length) {
    id = String(found[0].id);
    status = String(found[0].status);
    // Seen again: the match is worked out again; the admin's status, reason and notes are left alone.
    await sql`
      UPDATE discovery_leads SET last_seen_at = ${now}, seen_runs = seen_runs + 1,
        organization_id = coalesce(organization_id, ${org}), organization_name = coalesce(organization_name, ${orgName}),
        notification_number = coalesce(notification_number, ${notice}),
        match_kind = ${match.kind}, match_recruitment_id = ${match.recruitmentId}, match_reason = ${match.reason},
        match_confidence = ${match.confidence}, match_candidates = ${JSON.stringify(match.candidates)}::jsonb
      WHERE id = ${id}`;
  } else {
    // A new announcement the CMS already has (same notice number, same organisation) starts as a duplicate.
    const dup = kind === "NEW" && match.kind === "DUPLICATE";
    status = dup ? "DUPLICATE" : "NEW";
    const reason = dup ? `the CMS already has this job: ${match.candidates[0].title} (${match.reason})` : null;
    const rows = await sql`
      INSERT INTO discovery_leads (lead_key, kind, title, organization_id, organization_name, notification_number, status, status_reason,
        match_kind, match_recruitment_id, match_reason, match_confidence, match_candidates, first_seen_at, last_seen_at)
      VALUES (${key}, ${kind}, ${p.title.slice(0, 500)}, ${org}, ${orgName}, ${notice}, ${status}, ${reason},
        ${match.kind}, ${match.recruitmentId}, ${match.reason}, ${match.confidence}, ${JSON.stringify(match.candidates)}::jsonb, ${now}, ${now})
      ON CONFLICT (lead_key) DO NOTHING RETURNING id`;
    if (rows.length) { id = String(rows[0].id); created = true; }
    else {
      const again = await sql`SELECT id, status FROM discovery_leads WHERE lead_key = ${key}`;
      id = String(again[0].id);
      status = String(again[0].status);
    }
  }
  let sourcesAdded = 0;
  for (const h of hits) {
    const r = await sql`
      INSERT INTO discovery_lead_sources (lead_id, source_id, source_name, source_tier, listing_url, item_url, item_fingerprint, pdf_url,
        title_seen, nearby_date, official, first_seen_at, last_seen_at)
      VALUES (${id}, ${h.sourceId}, ${h.sourceName}, ${h.sourceTier}, ${h.sourceUrl}, ${h.href}, ${fingerprint(h)}, ${h.pdfUrl ?? null},
        ${h.title.slice(0, 500)}, ${h.nearbyDate ?? null}, ${officialHost(hostOf(h.pdfUrl ?? h.href))}, ${now}, ${now})
      ON CONFLICT (lead_id, item_fingerprint) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, seen_runs = discovery_lead_sources.seen_runs + 1
      RETURNING (xmax = 0) AS inserted`;
    if (r[0]?.inserted) sourcesAdded++;
  }
  return { id, key, kind, title: p.title, match: match.kind, status, created, sourcesAdded };
}

/** Leads of this run that may be the same recruitment by title only: said on both, never merged. */
async function relate(groups: Array<{ cluster: DiscoveryCluster; lead: CollectedLead }>) {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (a.lead.id === b.lead.id || a.lead.kind !== b.lead.kind) continue;
      const pa = a.cluster.primaryHit, pb = b.cluster.primaryHit;
      // A recognised organisation and closely alike titles, as before; or, for any two leads, the same body,
      // exam, year and post count or exam wording (relatedLeadTitles: Stage 1, the same job on two portals
      // whose organisation is not recognised). Never merged.
      const sim = pa.organizationId && pa.organizationId === pb.organizationId ? bigramJaccard(pa.titleSimilarityKey, pb.titleSimilarityKey) : 0;
      const reason = sim >= 0.75
        ? `titles ${Math.round(sim * 100)}% alike (not merged: no shared notice number or address)`
        : relatedLeadTitles({ title: pa.title, organizationId: pa.organizationId || null }, { title: pb.title, organizationId: pb.organizationId || null });
      if (!reason) continue;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        await sql`
          UPDATE discovery_leads SET related_leads = related_leads || ${JSON.stringify([{ leadId: y.lead.id, reason }])}::jsonb
          WHERE id = ${x.lead.id} AND NOT related_leads @> ${JSON.stringify([{ leadId: y.lead.id }])}::jsonb`;
      }
    }
  }
}

export async function collectLeads(opts: CollectorOptions = {}): Promise<CollectorReport> {
  const fetchOne = opts.fetchSourceFn ?? ((u: string) => fetchSource(u));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = (opts.now ?? new Date()).toISOString();
  const sources = (opts.sources ?? getEnabledSources()).filter((s) => s.enabled).slice(0, MAX_SOURCES);

  const outcomes: SourceOutcome[] = [];
  const items: RawDiscovery[] = [];
  for (const [i, config] of sources.entries()) {
    if (i > 0 && config.rateLimitDelayMs) await sleep(config.rateLimitDelayMs);
    try {
      const r = await readSource(config, fetchOne, now);
      outcomes.push(r.outcome);
      items.push(...r.items);
    } catch (err) {
      outcomes.push({ id: config.id, url: config.url, status: "UNAVAILABLE", items: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const jobs = await cmsJobs();
  const groups: Array<{ cluster: DiscoveryCluster; lead: CollectedLead }> = [];
  for (const kind of ["NEW", "UPDATE"] as const) {
    for (const cluster of clusterDiscoveries(items.filter((d) => (d.kind ?? "NEW") === kind), { strongOnly: true })) {
      groups.push({ cluster, lead: await saveLead(cluster, kind, jobs, now) });
    }
  }
  await relate(groups);
  const leads = groups.map((g) => g.lead);
  return {
    sources: outcomes, leads,
    created: leads.filter((l) => l.created).length,
    seenAgain: leads.filter((l) => !l.created).length,
    sourcesAdded: leads.reduce((n, l) => n + l.sourcesAdded, 0),
  };
}
