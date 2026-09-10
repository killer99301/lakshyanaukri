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

      // Org identity comes from the document title only — NOT the hosting URL.
      // ibpsreg.ibps.in can host NMDFC/IOB/RCF notices; the href domain must not override the title org.
      //
      // Truncate to first 150 chars: aggregator pages (e.g. GovtJobGuru) include eligibility
      // body text in the link text (e.g. "...listed in Second Schedule of Reserve Bank of India"),
      // which would falsely classify a Bank of Baroda listing as "rbi". The org name always
      // appears in the leading title portion; 150 chars is a safe upper bound for the title.
      let orgId = detectOrgFromText(link.text.slice(0, 150), config.orgFilter);

      // Official-source fallback (tier ≤ 3, single orgFilter):
      // When text detection fails on an official source's own hostname, use the configured org.
      // Example: "Notification for CRP-RRB-XV" on ibps.in doesn't mention "IBPS" by name, but
      // ibps.in is the authoritative IBPS source. The fallback applies ONLY when the link href
      // is on the source's own hostname — ibpsreg.ibps.in (a third-party registration subdomain)
      // has a different hostname and does not qualify, preventing NMDFC/IOB/RCF false positives.
      if (!orgId && config.tier <= 3 && config.orgFilter?.length === 1) {
        try {
          const sourceHost = new URL(config.url).hostname;
          const linkHost = new URL(link.href).hostname;
          if (linkHost === sourceHost) {
            orgId = config.orgFilter[0];
          }
        } catch {
          // malformed link URL — no fallback
        }
      }

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
