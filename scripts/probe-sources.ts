#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Phase 7G: Source Reachability Probe
// ═══════════════════════════════════════════════════════════
//
// Probes all ORG_DISCOVERY sources (enabled and disabled) from
// the current execution environment and reports:
//   - HTTP status code
//   - Response time
//   - Word count of extractable text
//   - Whether the content looks relevant to recruitment
//
// Run locally to test from your machine.
// Run via GitHub Actions source-probe workflow to test from Ubuntu runner.
//
// Results guide which sources to enable/disable in source-registry.ts.
// Never modifies canonical data.
// ═══════════════════════════════════════════════════════════

import { SOURCE_REGISTRY } from "@/intelligence/source-registry";
import { fetchHtmlContent } from "@/intelligence/fetcher";
import { extractTextFromHtml } from "@/intelligence/extractor";

const WAVE_FILTER = process.env.PROBE_WAVE ?? "all";

const WAVE1_IDS = ["ssc-org-discovery", "rrb-org-discovery", "upsc-org-discovery"];
const WAVE2_IDS = ["ibps-org-discovery", "sbi-org-discovery", "rbi-org-discovery", "nabard-org-discovery", "lic-org-discovery", "indiapost-org-discovery"];

const discoverySources = SOURCE_REGISTRY.filter((s) => s.mode === "ORG_DISCOVERY");

const toProbe = discoverySources.filter((s) => {
  if (WAVE_FILTER === "wave1") return WAVE1_IDS.includes(s.id);
  if (WAVE_FILTER === "wave2") return WAVE2_IDS.includes(s.id);
  return true;
});

console.log(`\n${"═".repeat(70)}`);
console.log(`  LakshyaNaukri Intelligence Engine — Source Probe`);
console.log(`  Environment: ${process.env.GITHUB_ACTIONS === "true" ? "GitHub Actions (Ubuntu)" : "Local"}`);
console.log(`  Wave filter: ${WAVE_FILTER}`);
console.log(`  Sources to probe: ${toProbe.length}`);
console.log(`${"═".repeat(70)}\n`);

const RECRUITMENT_KEYWORDS = ["notification", "advertisement", "advt", "recruitment", "vacancy", "vacancy"];

interface ProbeResult {
  id: string;
  name: string;
  url: string;
  currentlyEnabled: boolean;
  httpStatus?: number;
  responseTimeMs: number;
  wordCount: number;
  recruitmentKeywordsFound: string[];
  status: "REACHABLE" | "BLOCKED" | "ERROR" | "TIMEOUT";
  recommendation: string;
}

async function probeOne(source: typeof toProbe[0]): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const { fetchResult, htmlContent } = await fetchHtmlContent(source.url, {
      rateLimitDelayMs: 0,
    });
    const responseTimeMs = Date.now() - start;

    if (fetchResult.status !== "OK" || !htmlContent) {
      return {
        id: source.id,
        name: source.name,
        url: source.url,
        currentlyEnabled: source.enabled,
        httpStatus: fetchResult.httpStatus,
        responseTimeMs,
        wordCount: 0,
        recruitmentKeywordsFound: [],
        status: fetchResult.status === "BLOCKED" ? "BLOCKED" : "ERROR",
        recommendation: fetchResult.httpStatus === 403
          ? "HTTP 403 — bot-blocking detected. Keep disabled."
          : `Fetch failed (${fetchResult.status}). Keep disabled until resolved.`,
      };
    }

    const text = extractTextFromHtml(htmlContent).toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const keywordsFound = RECRUITMENT_KEYWORDS.filter((kw) => text.includes(kw));

    let recommendation: string;
    if (words.length < 20) {
      recommendation = `Too few words (${words.length}) — JS-rendered or gated. Keep disabled.`;
    } else if (keywordsFound.length === 0) {
      recommendation = `${words.length} words extracted but no recruitment keywords. Check page content.`;
    } else {
      recommendation = `ENABLE — ${words.length} words, keywords: [${keywordsFound.join(", ")}]`;
    }

    return {
      id: source.id,
      name: source.name,
      url: source.url,
      currentlyEnabled: source.enabled,
      httpStatus: fetchResult.httpStatus ?? 200,
      responseTimeMs,
      wordCount: words.length,
      recruitmentKeywordsFound: keywordsFound,
      status: "REACHABLE",
      recommendation,
    };
  } catch (e) {
    return {
      id: source.id,
      name: source.name,
      url: source.url,
      currentlyEnabled: source.enabled,
      responseTimeMs: Date.now() - start,
      wordCount: 0,
      recruitmentKeywordsFound: [],
      status: "TIMEOUT",
      recommendation: `Error: ${String(e).slice(0, 80)}`,
    };
  }
}

async function main() {
  const results: ProbeResult[] = [];

  for (const source of toProbe) {
    process.stdout.write(`Probing ${source.id}... `);
    const result = await probeOne(source);
    results.push(result);
    console.log(`${result.status} (${result.responseTimeMs}ms, ${result.wordCount} words)`);

    // Polite delay between requests
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`PROBE RESULTS`);
  console.log(`${"─".repeat(70)}\n`);

  for (const r of results) {
    const statusIcon = r.status === "REACHABLE" ? "✅" : r.status === "BLOCKED" ? "🚫" : "❌";
    console.log(`${statusIcon}  ${r.id}`);
    console.log(`    URL: ${r.url}`);
    console.log(`    HTTP: ${r.httpStatus ?? "N/A"} | ${r.responseTimeMs}ms | ${r.wordCount} words`);
    if (r.recruitmentKeywordsFound.length > 0) {
      console.log(`    Keywords: ${r.recruitmentKeywordsFound.join(", ")}`);
    }
    console.log(`    Currently enabled: ${r.currentlyEnabled}`);
    console.log(`    → ${r.recommendation}`);
    console.log();
  }

  console.log(`${"═".repeat(70)}`);
  console.log(`Update source-registry.ts based on the recommendations above.`);
  console.log(`Run probe again from GitHub Actions to confirm environment-specific reachability.`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch((e) => {
  console.error("[PROBE][FATAL]", e);
  process.exit(1);
});
