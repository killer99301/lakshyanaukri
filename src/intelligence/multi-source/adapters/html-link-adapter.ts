// ═══════════════════════════════════════════════════════════
// Phase 9A: HTML Link Discovery Adapter
// ═══════════════════════════════════════════════════════════
//
// Fetches an HTML page and extracts recruitment notice links
// using the existing discovery.ts pipeline (extractLinks +
// isNewRecruitmentNotice + extractNotificationNumber).

import { fetchHtmlContent } from "../../fetcher";
import { ORG_NAMES } from "../../org-registry";
import {
  normalizeNotificationNumber,
  normalizeSourceUrl,
  buildTitleSimilarityKey,
} from "../../dedup";
import {
  extractLinks,
  isNewRecruitmentNotice,
  extractNotificationNumber,
} from "../../discovery";
import { detectOrgFromText } from "../org-classifier";
import type { DiscoveryAdapter, AdapterFetchResult } from "./base";
import type { MultiSourceConfig, RawDiscovery, SourceFetchResult } from "../types";

// ─── Adapter ──────────────────────────────────────────────────

export class HtmlLinkAdapter implements DiscoveryAdapter {
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
      return {
        fetchResult: { ...baseResult, status: "UNAVAILABLE", error: fetchResult.error },
        discoveries: [],
      };
    }

    const links = extractLinks(htmlContent, config.url);
    const now = new Date().toISOString();
    const discoveries: RawDiscovery[] = [];

    for (const link of links) {
      if (!isNewRecruitmentNotice(link.text)) continue;

      const orgId = detectOrgFromText(`${link.text} ${link.href}`, config.orgFilter);
      if (!orgId) continue;

      const orgName = ORG_NAMES[orgId] ?? orgId.toUpperCase();
      const notificationNumber = extractNotificationNumber(link.text);
      const notifTitle = notificationNumber ?? link.text;
      const normalizedNotifNumber = normalizeNotificationNumber(notifTitle);
      const pdfUrl = link.pdfUrl;

      const confidence = 0.4
        + (notificationNumber ? 0.2 : 0)
        + (link.nearbyDate ? 0.1 : 0)
        + (pdfUrl ? 0.2 : 0)
        + (config.tier <= 3 ? 0.1 : 0);

      discoveries.push({
        sourceId: config.id,
        sourceName: config.name,
        sourceTier: config.tier,
        sourceUrl: config.url,
        organizationId: orgId,
        organizationName: orgName,
        title: link.text,
        href: link.href,
        notificationNumber,
        normalizedNotifNumber,
        pdfUrl,
        nearbyDate: link.nearbyDate,
        titleSimilarityKey: buildTitleSimilarityKey(link.text),
        sourceUrlFingerprint: normalizeSourceUrl(pdfUrl ?? link.href),
        confidence,
        discoveredAt: now,
        rawExcerpt: `[${link.text}] ${link.nearbyDate ?? "no date"} ${pdfUrl ?? link.href}`.slice(0, 300),
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
