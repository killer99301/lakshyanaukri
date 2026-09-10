// ═══════════════════════════════════════════════════════════
// Phase 9A: RSS/Atom Discovery Adapter
// ═══════════════════════════════════════════════════════════
//
// Uses fast-xml-parser to handle RSS 2.0 and Atom feeds.
// Classifies each item by org keyword and filters to
// government recruitment notices only.
//
// NEVER uses regex to parse XML — fast-xml-parser only.

import { XMLParser } from "fast-xml-parser";
import { fetchHtmlContent } from "../../fetcher";
import {
  RECRUITMENT_KEYWORDS,
  OPERATIONAL_KEYWORDS,
  ORG_NAMES,
} from "../../org-registry";
import {
  normalizeNotificationNumber,
  normalizeSourceUrl,
  buildTitleSimilarityKey,
} from "../../dedup";
import { extractNotificationNumber } from "../../discovery";
import { detectOrgFromText } from "../org-classifier";
import type { DiscoveryAdapter, AdapterFetchResult } from "./base";
import type { MultiSourceConfig, RawDiscovery, SourceFetchResult } from "../types";

// ─── Keyword filter ───────────────────────────────────────────

function isRecruitmentItem(text: string): boolean {
  const lower = text.toLowerCase();
  const hasRecruitment = RECRUITMENT_KEYWORDS.some((kw) => lower.includes(kw));
  if (!hasRecruitment) return false;
  const isOperational = OPERATIONAL_KEYWORDS.some((kw) => lower.includes(kw));
  return !isOperational;
}

// ─── XML parsing helpers ──────────────────────────────────────

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "__cdata",
  isArray: (name) => name === "item" || name === "entry",
});

interface RssItem {
  title?: string | { __cdata?: string };
  link?: string | { "@_href"?: string };
  description?: string | { __cdata?: string };
  pubDate?: string;
  published?: string;
  updated?: string;
}

function coerceString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "__cdata" in val) return String((val as { __cdata?: string }).__cdata ?? "");
  return "";
}

function parseAtomLink(link: unknown): string {
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alternate = link.find((l: unknown) => typeof l === "object" && l !== null && (l as Record<string, string>)["@_rel"] === "alternate");
    if (alternate) return coerceString((alternate as Record<string, string>)["@_href"]);
    const first = link[0];
    if (first && typeof first === "object") return coerceString((first as Record<string, string>)["@_href"]);
  }
  if (link && typeof link === "object") return coerceString((link as Record<string, string>)["@_href"]);
  return "";
}

function extractItems(parsed: Record<string, unknown>): RssItem[] {
  const rss = parsed["rss"] as Record<string, unknown> | undefined;
  if (rss) {
    const channel = rss["channel"] as Record<string, unknown> | undefined;
    const items = channel?.["item"];
    return Array.isArray(items) ? items as RssItem[] : [];
  }
  const feed = parsed["feed"] as Record<string, unknown> | undefined;
  if (feed) {
    const entries = feed["entry"];
    return Array.isArray(entries) ? entries as RssItem[] : [];
  }
  return [];
}

// ─── Adapter ──────────────────────────────────────────────────

export class RssAdapter implements DiscoveryAdapter {
  readonly sourceId: string;

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  async fetch(config: MultiSourceConfig): Promise<AdapterFetchResult> {
    const fetchedAt = new Date().toISOString();

    const { fetchResult, htmlContent } = await fetchHtmlContent(config.url, {
      rateLimitDelayMs: config.rateLimitDelayMs,
    });

    const baseResult: SourceFetchResult = {
      sourceId: config.id,
      sourceName: config.name,
      sourceUrl: config.url,
      hitCount: 0,
      httpStatus: fetchResult.httpStatus,
      fetchedAt,
      status: "UNAVAILABLE",
    };

    if (fetchResult.status === "BLOCKED") {
      return { fetchResult: { ...baseResult, status: "BLOCKED" }, discoveries: [] };
    }
    if (fetchResult.status !== "OK" || !htmlContent) {
      return { fetchResult: { ...baseResult, status: "UNAVAILABLE", error: fetchResult.error }, discoveries: [] };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = XML_PARSER.parse(htmlContent) as Record<string, unknown>;
    } catch (err) {
      return {
        fetchResult: { ...baseResult, status: "PARSE_ERROR", error: String(err) },
        discoveries: [],
      };
    }

    const items = extractItems(parsed);
    if (items.length === 0) {
      return { fetchResult: { ...baseResult, status: "EMPTY" }, discoveries: [] };
    }

    const discoveries: RawDiscovery[] = [];
    const now = new Date().toISOString();

    for (const item of items) {
      const title = coerceString(item.title).trim();
      const href =
        typeof item.link === "string" ? item.link.trim() : parseAtomLink(item.link);
      const description = coerceString(item.description).trim();
      const pubDate = item.pubDate ?? item.published ?? item.updated;
      const nearbyDate = parseRssDate(typeof pubDate === "string" ? pubDate : "");

      if (!title || !href) continue;

      const combined = `${title} ${description}`.slice(0, 500);

      if (!isRecruitmentItem(combined)) continue;

      // Org identity comes from the title only — NOT the description.
      // Description may contain other org names in eligibility/context text
      // (e.g. "experience in any bank listed in Second Schedule of Reserve Bank of India").
      const orgId = detectOrgFromText(title, config.orgFilter);
      if (!orgId) continue;

      const orgName = ORG_NAMES[orgId] ?? orgId.toUpperCase();
      const notificationNumber = extractNotificationNumber(title);
      const notifTitle = notificationNumber ?? title;
      const normalizedNotifNumber = normalizeNotificationNumber(notifTitle);

      const pdfUrl = href.toLowerCase().includes(".pdf") ? href : undefined;
      const confidence = 0.4
        + (notificationNumber ? 0.2 : 0)
        + (nearbyDate ? 0.1 : 0)
        + (pdfUrl ? 0.2 : 0);

      discoveries.push({
        sourceId: config.id,
        sourceName: config.name,
        sourceTier: config.tier,
        sourceUrl: config.url,
        organizationId: orgId,
        organizationName: orgName,
        title,
        href,
        notificationNumber,
        normalizedNotifNumber,
        pdfUrl,
        nearbyDate,
        titleSimilarityKey: buildTitleSimilarityKey(title),
        sourceUrlFingerprint: normalizeSourceUrl(pdfUrl ?? href),
        confidence,
        discoveredAt: now,
        rawExcerpt: combined.slice(0, 300),
      });
    }

    return {
      fetchResult: {
        ...baseResult,
        status: discoveries.length > 0 ? "OK" : "EMPTY",
        hitCount: discoveries.length,
      },
      discoveries,
    };
  }
}

// ─── Date parsing ─────────────────────────────────────────────

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseRssDate(raw: string): string | undefined {
  if (!raw) return undefined;
  // RFC 2822: "Mon, 07 Sep 2026 10:00:00 +0000"
  const rfc = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(raw);
  if (rfc) {
    const m = MONTH_ABBR[rfc[2].toLowerCase()];
    if (m) {
      const iso = `${rfc[3]}-${m}-${rfc[1].padStart(2, "0")}`;
      if (!isNaN(new Date(iso).getTime())) return iso;
    }
  }
  // ISO 8601
  const iso8601 = /(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso8601) {
    if (!isNaN(new Date(iso8601[1]).getTime())) return iso8601[1];
  }
  return undefined;
}

// Re-export for testing
export { isRecruitmentItem, parseRssDate };
