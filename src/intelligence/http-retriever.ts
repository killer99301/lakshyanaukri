// ─── Phase 10: HTTP Source Retriever ─────────────────────────
//
// HttpRetriever is the production SourceRetriever implementation.
// It wraps the existing safe fetcher (timeout, retry, rate limiting)
// and returns a RetrievedSource ready for the draft-builder pipeline.
//
// Browser fallback (JS-rendered pages) is intentionally deferred:
// the interface exists in draft-types.ts; a BrowserRetriever would
// implement it separately without touching this module.

import { classifySourceUrl } from "./intake";
import { fetchHtmlContent } from "./fetcher";
import { extractLinks } from "./discovery";
import type {
  SourceRetriever,
  RetrievedSource,
  IntelligenceSource,
  SourceKind,
  DiscoveredLink,
  RecruitmentLinkType,
} from "./draft-types";
import type { ExtractedLink } from "./discovery";

function inferLinkType(link: ExtractedLink): RecruitmentLinkType {
  const url = link.href.toLowerCase();
  const text = link.text.toLowerCase();
  if (link.pdfUrl ?? url.endsWith(".pdf")) {
    if (text.includes("corrigendum") || text.includes("erratum")) return "CORRIGENDUM";
    if (text.includes("admit") || text.includes("hall ticket")) return "ADMIT_CARD";
    if (text.includes("result")) return "RESULT";
    if (text.includes("answer") || text.includes("key")) return "ANSWER_KEY";
    if (text.includes("apply") || text.includes("application form")) return "APPLY_ONLINE";
    if (text.includes("short") || text.includes("summary")) return "SHORT_NOTICE";
    return "OFFICIAL_NOTIFICATION";
  }
  if (text.includes("apply") || text.includes("register") || url.includes("apply")) return "APPLY_ONLINE";
  if (text.includes("login") || url.includes("login")) return "LOGIN";
  if (text.includes("result")) return "RESULT";
  if (text.includes("admit") || text.includes("hall ticket")) return "ADMIT_CARD";
  return "OTHER";
}

export class HttpRetriever implements SourceRetriever {
  canHandle(url: URL): boolean {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  async retrieve(url: URL, sourceId: string, kind: SourceKind): Promise<RetrievedSource> {
    const urlString = url.toString();
    const retrievedAt = new Date().toISOString();
    const classification = classifySourceUrl(urlString);

    const { fetchResult, htmlContent } = await fetchHtmlContent(urlString);

    const source: IntelligenceSource = {
      id: sourceId,
      url: urlString,
      canonicalUrl:
        fetchResult.finalUrl && fetchResult.finalUrl !== urlString
          ? fetchResult.finalUrl
          : undefined,
      domain: classification.domain,
      kind,
      organizationId: classification.orgId,
      retrievalMethod: "HTML",
      retrievedAt,
      httpStatus: fetchResult.httpStatus,
      contentHash: fetchResult.contentHash,
      success: fetchResult.status === "OK" && htmlContent !== null,
    };

    if (fetchResult.status !== "OK" || !htmlContent) {
      return {
        source: { ...source, success: false },
        success: false,
        links: [],
        error: fetchResult.error ?? `HTTP ${fetchResult.status}`,
      };
    }

    const rawLinks = extractLinks(htmlContent, urlString);
    const links: DiscoveredLink[] = rawLinks.map((l) => ({
      url: l.href,
      label: l.text,
      type: inferLinkType(l),
    }));

    return {
      source: { ...source, success: true },
      success: true,
      html: htmlContent,
      links,
    };
  }
}
