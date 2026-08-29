#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Secondary Source URL Verifier
// Phase 2B: Confirm each Tier 5 URL is truly org-specific.
// ═══════════════════════════════════════════════════════════
// Usage: npx tsx --tsconfig tsconfig.json scripts/verify-secondary-sources.ts
//
// For each enabled Tier 5 source:
//   1. Fetch the URL
//   2. Extract plain text
//   3. Check for org-specific signal terms (NOT just generic keywords)
//   4. Report RELEVANT | IRRELEVANT | GENERIC | UNREACHABLE | BLOCKED
//
// A GENERIC result means the page returned content (no 404/error) but
// is the aggregator's homepage or a catch-all page rather than an
// org-specific category page. GENERIC pages are disabled from the registry.
//
// This script does NOT create candidate events. Read-only.
// ═══════════════════════════════════════════════════════════

import { fetchHtmlContent } from "@/intelligence/fetcher";
import { extractTextFromHtml } from "@/intelligence/extractor";
import { SOURCE_REGISTRY } from "@/intelligence/source-registry";

// ─── Terminal colors ──────────────────────────────────────────
const R = "\x1b[0m";
const B = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

const bold = (s: string) => B + s + R;
const dim = (s: string) => DIM + s + R;
const red = (s: string) => RED + s + R;
const yellow = (s: string) => YELLOW + s + R;
const green = (s: string) => GREEN + s + R;
const cyan = (s: string) => CYAN + s + R;

function hr() { return "─".repeat(70); }

// ─── Org-specific verification terms ─────────────────────────
// These are terms that should appear on a page that genuinely covers
// the target organization. They are MORE specific than just the org name.
// Each list: [strongTerms[], weakTerms[]] — strong terms alone confirm RELEVANT,
// weak terms (without strong) suggest GENERIC.

const ORG_VERIFICATION: Record<string, {
  orgTerms: string[];          // must-have org-specific terms
  identifierTerms: string[];   // canonical identifiers or title fragments
  antiPatterns: string[];      // terms suggesting generic/wrong page
}> = {
  bpsc: {
    orgTerms: ["bpsc", "bihar public service", "bihar psc"],
    identifierTerms: ["72nd", "72/2026", "combined competitive"],
    antiPatterns: ["homepage", "all exam", "latest jobs"],
  },
  rrb: {
    orgTerms: ["railway recruitment", "rrb", "indian railways", "railway board"],
    identifierTerms: ["ntpc", "cen", "graduate level", "undergraduate"],
    antiPatterns: ["homepage", "all exam"],
  },
  ssc: {
    orgTerms: ["ssc", "staff selection commission"],
    identifierTerms: ["cgl", "combined graduate", "tier"],
    antiPatterns: ["homepage", "all exam"],
  },
  ibps: {
    orgTerms: ["ibps", "institute of banking", "banking personnel"],
    identifierTerms: ["po", "crp", "probationary officer", "xvi", "po/mt"],
    antiPatterns: ["homepage", "all exam"],
  },
  upsc: {
    orgTerms: ["upsc", "union public service", "civil services"],
    identifierTerms: ["cse", "ias", "mains", "prelims", "civil services examination"],
    antiPatterns: ["homepage", "all exam"],
  },
};

type VerificationResult =
  | "RELEVANT"       // page is org-specific and has identifier terms
  | "ORG_ONLY"       // page is org-specific but no identifier terms found
  | "GENERIC"        // page returned content but isn't org-specific (wrong URL, redirect to homepage)
  | "UNREACHABLE"    // fetch failed / timeout
  | "BLOCKED";       // HTTP 403 or bot-detection

interface SourceVerification {
  sourceId: string;
  sourceName: string;
  url: string;
  organizationId: string;
  result: VerificationResult;
  fetchStatus: string;
  httpStatus?: number;
  responseTimeMs: number;
  contentHash?: string;
  wordCount: number;
  orgTermsFound: string[];
  identifierTermsFound: string[];
  sampleText: string;          // first 200 chars of extracted text
  notes: string;
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log();
  console.log(bold(cyan("Secondary Source URL Verification")));
  console.log(dim("Phase 2B — checking that each Tier 5 URL is genuinely org-specific"));
  console.log(hr());
  console.log();

  const tier5Sources = SOURCE_REGISTRY.filter(
    (s) => s.tier === 5 && s.enabled && s.linkedOpportunityIds.length > 0
  );

  console.log(`  ${tier5Sources.length} enabled Tier 5 sources to verify`);
  console.log();

  const results: SourceVerification[] = [];

  for (const source of tier5Sources) {
    console.log(`  Fetching ${bold(source.name)} ...`);
    console.log(`  ${dim(source.url)}`);

    const verification = await checkSource(source.id, source.name, source.url, source.organizationId);
    results.push(verification);

    const icon =
      verification.result === "RELEVANT"      ? green("✓ RELEVANT")  :
      verification.result === "ORG_ONLY"      ? yellow("~ ORG_ONLY") :
      verification.result === "GENERIC"       ? red("✗ GENERIC")    :
      verification.result === "UNREACHABLE"   ? red("✗ UNREACHABLE"):
                                               red("✗ BLOCKED");

    console.log(`  → ${icon}  (${verification.responseTimeMs}ms, ${verification.wordCount} words)`);
    if (verification.orgTermsFound.length > 0) {
      console.log(`    Org terms   : ${green(verification.orgTermsFound.join(", "))}`);
    }
    if (verification.identifierTermsFound.length > 0) {
      console.log(`    Identifiers : ${cyan(verification.identifierTermsFound.join(", "))}`);
    }
    if (verification.sampleText) {
      console.log(`    Sample text : ${dim(verification.sampleText.slice(0, 160))}`);
    }
    if (verification.notes) {
      console.log(`    Notes       : ${yellow(verification.notes)}`);
    }
    console.log();
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(bold("VERIFICATION SUMMARY"));
  console.log(hr());
  console.log();

  const byResult: Record<VerificationResult, SourceVerification[]> = {
    RELEVANT: [],
    ORG_ONLY: [],
    GENERIC: [],
    UNREACHABLE: [],
    BLOCKED: [],
  };
  for (const r of results) byResult[r.result].push(r);

  console.log(`  RELEVANT     : ${green(String(byResult.RELEVANT.length))} (org-specific + identifier terms found)`);
  console.log(`  ORG_ONLY     : ${yellow(String(byResult.ORG_ONLY.length))} (org-specific page but no identifier in excerpt)`);
  console.log(`  GENERIC      : ${red(String(byResult.GENERIC.length))} (page not org-specific — disable)`);
  console.log(`  UNREACHABLE  : ${red(String(byResult.UNREACHABLE.length))} (fetch failed — disable)`);
  console.log(`  BLOCKED      : ${red(String(byResult.BLOCKED.length))} (403/bot-gated — disable)`);
  console.log();

  if (byResult.GENERIC.length > 0 || byResult.UNREACHABLE.length > 0 || byResult.BLOCKED.length > 0) {
    console.log(yellow("  ACTION REQUIRED: The following sources returned unusable content."));
    console.log(yellow("  Disable them in source-registry.ts or replace their URLs."));
    console.log();
    for (const r of [...byResult.GENERIC, ...byResult.UNREACHABLE, ...byResult.BLOCKED]) {
      console.log(`    ${red("✗")} ${r.sourceId}  (${r.url})`);
      console.log(`      → ${r.notes}`);
    }
    console.log();
  }

  if (byResult.ORG_ONLY.length > 0) {
    console.log(yellow("  ORG_ONLY sources: Page is correct org but identifier tokens not in excerpt."));
    console.log(yellow("  This means category-page excerpts don't carry notification numbers."));
    console.log(yellow("  Identifier matching may need title-derived tokens (e.g. '72nd') to work."));
    console.log();
    for (const r of byResult.ORG_ONLY) {
      console.log(`    ${yellow("~")} ${r.sourceId}  (${r.url})`);
    }
    console.log();
  }

  console.log(dim("  This verification report does not modify source-registry.ts."));
  console.log(dim("  Apply changes manually based on the findings above."));
  console.log();
}

// ─── Source checker ───────────────────────────────────────────

async function checkSource(
  sourceId: string,
  sourceName: string,
  url: string,
  organizationId: string
): Promise<SourceVerification> {
  const orgSpec = ORG_VERIFICATION[organizationId] ?? {
    orgTerms: [organizationId],
    identifierTerms: [],
    antiPatterns: [],
  };

  let fetchStatus = "UNKNOWN";
  let httpStatus: number | undefined;
  let responseTimeMs = 0;
  let contentHash: string | undefined;
  let wordCount = 0;
  let orgTermsFound: string[] = [];
  let identifierTermsFound: string[] = [];
  let sampleText = "";
  let result: VerificationResult = "GENERIC";
  let notes = "";

  try {
    const { fetchResult, htmlContent } = await fetchHtmlContent(url, {
      rateLimitDelayMs: 2_000,
    });

    fetchStatus = fetchResult.status;
    httpStatus = fetchResult.httpStatus;
    responseTimeMs = fetchResult.responseTimeMs;
    contentHash = fetchResult.contentHash;

    if (fetchResult.status === "BLOCKED") {
      result = "BLOCKED";
      notes = `HTTP ${fetchResult.httpStatus ?? "?"} — bot detection / access denied`;
      return { sourceId, sourceName, url, organizationId, result, fetchStatus, httpStatus, responseTimeMs, contentHash, wordCount, orgTermsFound, identifierTermsFound, sampleText, notes };
    }

    if (fetchResult.status !== "OK" || !htmlContent) {
      result = "UNREACHABLE";
      notes = fetchResult.error ?? `Status ${fetchResult.status}, HTTP ${fetchResult.httpStatus ?? "?"}`;
      return { sourceId, sourceName, url, organizationId, result, fetchStatus, httpStatus, responseTimeMs, contentHash, wordCount, orgTermsFound, identifierTermsFound, sampleText, notes };
    }

    const plainText = extractTextFromHtml(htmlContent);
    const lowerText = plainText.toLowerCase();
    wordCount = plainText.split(/\s+/).filter(Boolean).length;
    sampleText = plainText.slice(0, 300);

    // Check org terms
    orgTermsFound = orgSpec.orgTerms.filter((t) => lowerText.includes(t.toLowerCase()));

    // Check identifier terms
    identifierTermsFound = orgSpec.identifierTerms.filter((t) => lowerText.includes(t.toLowerCase()));

    // Classify
    const hasOrgTerms = orgTermsFound.length >= 1;
    const hasIdentifierTerms = identifierTermsFound.length >= 1;
    const looksGeneric = orgSpec.antiPatterns.some((p) => lowerText.slice(0, 500).includes(p.toLowerCase()));

    if (!hasOrgTerms || looksGeneric) {
      result = "GENERIC";
      notes = !hasOrgTerms
        ? `No org-specific terms found. Page may be generic/redirected.`
        : `Anti-pattern match suggests generic page.`;
    } else if (hasIdentifierTerms) {
      result = "RELEVANT";
      notes = `Org-specific page with identifier terms. Can produce opportunity-matched signals.`;
    } else {
      result = "ORG_ONLY";
      notes = `Org page confirmed but identifier terms (${orgSpec.identifierTerms.slice(0, 3).join(", ")}) not found in excerpt. ` +
              `Category page may not expose notification numbers. ` +
              `Identifier matching needs title-derived tokens (ordinals, exam codes).`;
    }
  } catch (err) {
    result = "UNREACHABLE";
    notes = `Exception: ${String(err)}`;
  }

  return {
    sourceId,
    sourceName,
    url,
    organizationId,
    result,
    fetchStatus,
    httpStatus,
    responseTimeMs,
    contentHash,
    wordCount,
    orgTermsFound,
    identifierTermsFound,
    sampleText,
    notes,
  };
}

main().catch((err) => {
  console.error("\x1b[1m\x1b[31mUnhandled error:\x1b[0m", String(err));
  process.exit(1);
});
