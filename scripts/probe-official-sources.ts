#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Career Campus — Phase 3A: Official Source Probe
// ═══════════════════════════════════════════════════════════
// Tests candidate alternate official URLs for BPSC, IBPS, UPSC.
// Current state: bpsc.bih.nic.in (timeout), www.ibps.in (ERROR),
//               upsc.gov.in (403 BLOCKED).
//
// For each candidate, runs a single-attempt fetch (no retries, 12s timeout)
// and reports: HTTP status, response time, word count, identifier presence.
//
// READ-ONLY. productionWrites = 0. Does NOT modify source-registry.ts.
// ═══════════════════════════════════════════════════════════

import { fetchHtmlContent } from "@/intelligence/fetcher";
import { extractTextFromHtml } from "@/intelligence/extractor";

const R  = "\x1b[0m";
const B  = "\x1b[1m";
const DIM = "\x1b[2m";
const RED    = "\x1b[31m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";

const bold   = (s: string) => B + s + R;
const dim    = (s: string) => DIM + s + R;
const red    = (s: string) => RED + s + R;
const green  = (s: string) => GREEN + s + R;
const yellow = (s: string) => YELLOW + s + R;
const cyan   = (s: string) => CYAN + s + R;
const hr = () => "─".repeat(70);

interface Candidate {
  org: string;
  label: string;
  url: string;
  alreadyInRegistry: boolean;
  tier?: number;
  // Terms we expect to appear on a healthy official page for this org
  orgTerms: string[];
  identifierTerms: string[];
}

const CANDIDATES: Candidate[] = [
  // ── BPSC ───────────────────────────────────────────────────
  // bpsc.bih.nic.in consistently times out (56s in live run).
  // Testing: onlinebpsc.bihar.gov.in (different server, different host dept).
  {
    org: "BPSC",
    label: "onlinebpsc.bihar.gov.in (application portal)",
    url: "https://onlinebpsc.bihar.gov.in",
    alreadyInRegistry: true,
    tier: 2,
    orgTerms: ["bpsc", "bihar public service", "bihar"],
    identifierTerms: ["72nd", "72/2026", "combined competitive"],
  },
  {
    org: "BPSC",
    label: "onlinebpsc.bihar.gov.in/main/home",
    url: "https://onlinebpsc.bihar.gov.in/main/home",
    alreadyInRegistry: false,
    orgTerms: ["bpsc", "bihar public service", "bihar"],
    identifierTerms: ["72nd", "72/2026", "combined competitive"],
  },
  {
    org: "BPSC",
    label: "bpsc.bih.nic.in (existing — expected TIMEOUT)",
    url: "https://bpsc.bih.nic.in",
    alreadyInRegistry: true,
    tier: 3,
    orgTerms: ["bpsc", "bihar public service"],
    identifierTerms: ["72nd"],
  },

  // ── IBPS ───────────────────────────────────────────────────
  // www.ibps.in returns ERROR. Testing ibps.in without www,
  // ibpsonline.ibps.in (portal), and specific CRP XVI page.
  {
    org: "IBPS",
    label: "ibps.in (without www)",
    url: "https://ibps.in",
    alreadyInRegistry: false,
    orgTerms: ["ibps", "institute of banking", "banking personnel"],
    identifierTerms: ["crp", "xvi", "po/mt", "probationary"],
  },
  {
    org: "IBPS",
    label: "www.ibps.in (existing — expected ERROR)",
    url: "https://www.ibps.in",
    alreadyInRegistry: true,
    tier: 3,
    orgTerms: ["ibps", "institute of banking"],
    identifierTerms: ["crp", "xvi"],
  },
  {
    org: "IBPS",
    label: "ibpsonline.ibps.in (portal)",
    url: "https://ibpsonline.ibps.in",
    alreadyInRegistry: true,
    tier: 2,
    orgTerms: ["ibps", "banking"],
    identifierTerms: ["crp", "xvi"],
  },
  {
    org: "IBPS",
    label: "www.ibps.in/crp-po-mt-xvi/ (specific exam page)",
    url: "https://www.ibps.in/crp-po-mt-xvi/",
    alreadyInRegistry: false,
    orgTerms: ["ibps"],
    identifierTerms: ["crp", "xvi", "po/mt"],
  },

  // ── UPSC ───────────────────────────────────────────────────
  // upsc.gov.in returns HTTP 403. Testing upsconline.nic.in
  // (different NIC subdomain) and specific exam subpages.
  {
    org: "UPSC",
    label: "upsconline.nic.in (online portal)",
    url: "https://upsconline.nic.in",
    alreadyInRegistry: true,
    tier: 2,
    orgTerms: ["upsc", "union public service", "civil services"],
    identifierTerms: ["cse", "mains", "prelims", "civil services examination"],
  },
  {
    org: "UPSC",
    label: "upsc.gov.in (existing — expected 403)",
    url: "https://upsc.gov.in",
    alreadyInRegistry: true,
    tier: 3,
    orgTerms: ["upsc", "union public service"],
    identifierTerms: ["cse", "mains"],
  },
  {
    org: "UPSC",
    label: "upsc.gov.in/examinations/active-examinations/",
    url: "https://upsc.gov.in/examinations/active-examinations/",
    alreadyInRegistry: false,
    orgTerms: ["upsc", "civil services"],
    identifierTerms: ["cse", "mains", "civil services examination"],
  },
];

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log();
  console.log(bold(cyan("Phase 3A — Official Source Probe")));
  console.log(dim("Testing alternate official URLs for BPSC, IBPS, UPSC"));
  console.log(dim("Single-attempt fetch (no retries). READ-ONLY. productionWrites = 0."));
  console.log(hr());
  console.log();

  const results: Array<{
    candidate: Candidate;
    status: string;
    httpStatus?: number;
    responseTimeMs: number;
    wordCount: number;
    orgTermsFound: string[];
    identifierTermsFound: string[];
    sampleText: string;
    verdict: "REACHABLE_RELEVANT" | "REACHABLE_ORG" | "REACHABLE_GENERIC" | "BLOCKED" | "TIMEOUT" | "ERROR";
  }> = [];

  let lastOrg = "";

  for (const candidate of CANDIDATES) {
    if (candidate.org !== lastOrg) {
      console.log(bold(`── ${candidate.org} ──`));
      lastOrg = candidate.org;
    }

    const regLabel = candidate.alreadyInRegistry
      ? dim(` [tier ${candidate.tier ?? "?"} in registry]`)
      : dim(" [not in registry]");
    console.log(`  ${bold(candidate.label)}${regLabel}`);
    console.log(`  ${dim(candidate.url)}`);

    const t0 = Date.now();
    let wordCount = 0;
    let orgTermsFound: string[] = [];
    let identifierTermsFound: string[] = [];
    let sampleText = "";
    let verdict: (typeof results)[0]["verdict"] = "ERROR";

    try {
      const { fetchResult, htmlContent } = await fetchHtmlContent(candidate.url, {
        maxRetries: 0,        // single attempt — we just need to know if it responds
        rateLimitDelayMs: 1_000,
      });

      const elapsed = Date.now() - t0;

      if (fetchResult.status === "BLOCKED") {
        verdict = "BLOCKED";
        console.log(`  → ${red("BLOCKED")}  HTTP ${fetchResult.httpStatus ?? "?"}  (${elapsed}ms)`);
      } else if (fetchResult.status === "TIMEOUT") {
        verdict = "TIMEOUT";
        console.log(`  → ${red("TIMEOUT")}  (${elapsed}ms)`);
      } else if (fetchResult.status !== "OK" || !htmlContent) {
        verdict = "ERROR";
        console.log(`  → ${red("ERROR")}  status=${fetchResult.status}  HTTP ${fetchResult.httpStatus ?? "?"}  (${elapsed}ms)`);
        if (fetchResult.error) console.log(`     ${dim(fetchResult.error.slice(0, 120))}`);
      } else {
        // Reachable — analyse content
        const plainText = extractTextFromHtml(htmlContent);
        const lowerText = plainText.toLowerCase();
        wordCount = plainText.split(/\s+/).filter(Boolean).length;
        sampleText = plainText.slice(0, 200).replace(/\s+/g, " ").trim();

        orgTermsFound = candidate.orgTerms.filter(t => lowerText.includes(t.toLowerCase()));
        identifierTermsFound = candidate.identifierTerms.filter(t => lowerText.includes(t.toLowerCase()));

        if (orgTermsFound.length === 0) {
          verdict = "REACHABLE_GENERIC";
          console.log(`  → ${yellow("REACHABLE_GENERIC")}  (${elapsed}ms, ${wordCount} words)`);
        } else if (identifierTermsFound.length > 0) {
          verdict = "REACHABLE_RELEVANT";
          console.log(`  → ${green("REACHABLE_RELEVANT")}  (${elapsed}ms, ${wordCount} words)`);
        } else {
          verdict = "REACHABLE_ORG";
          console.log(`  → ${yellow("REACHABLE_ORG")}  (${elapsed}ms, ${wordCount} words)`);
        }

        if (orgTermsFound.length > 0) {
          console.log(`     Org terms  : ${green(orgTermsFound.join(", "))}`);
        }
        if (identifierTermsFound.length > 0) {
          console.log(`     Identifiers: ${cyan(identifierTermsFound.join(", "))}`);
        }
        if (sampleText) {
          console.log(`     Sample     : ${dim(sampleText.slice(0, 150))}`);
        }
      }

      results.push({
        candidate,
        status: fetchResult.status,
        httpStatus: fetchResult.httpStatus,
        responseTimeMs: fetchResult.responseTimeMs,
        wordCount,
        orgTermsFound,
        identifierTermsFound,
        sampleText,
        verdict,
      });
    } catch (err) {
      console.log(`  → ${red("EXCEPTION")}  ${String(err).slice(0, 120)}`);
      results.push({
        candidate,
        status: "EXCEPTION",
        responseTimeMs: Date.now() - t0,
        wordCount: 0,
        orgTermsFound: [],
        identifierTermsFound: [],
        sampleText: "",
        verdict: "ERROR",
      });
    }

    console.log();
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log(bold("PROBE SUMMARY"));
  console.log(hr());
  console.log();

  const reachableRelevant = results.filter(r => r.verdict === "REACHABLE_RELEVANT");
  const reachableOrg      = results.filter(r => r.verdict === "REACHABLE_ORG");
  const reachableGeneric  = results.filter(r => r.verdict === "REACHABLE_GENERIC");
  const blocked           = results.filter(r => r.verdict === "BLOCKED");
  const timedOut          = results.filter(r => r.verdict === "TIMEOUT");
  const errored           = results.filter(r => r.verdict === "ERROR");

  console.log(`  ${green("REACHABLE_RELEVANT")} : ${reachableRelevant.length}`);
  console.log(`  ${yellow("REACHABLE_ORG")}     : ${reachableOrg.length}`);
  console.log(`  ${yellow("REACHABLE_GENERIC")} : ${reachableGeneric.length}`);
  console.log(`  ${red("BLOCKED")}           : ${blocked.length}`);
  console.log(`  ${red("TIMEOUT")}           : ${timedOut.length}`);
  console.log(`  ${red("ERROR")}             : ${errored.length}`);
  console.log();

  if (reachableRelevant.length > 0 || reachableOrg.length > 0) {
    console.log(bold("Recommended for source-registry.ts:"));
    console.log();
    for (const r of [...reachableRelevant, ...reachableOrg]) {
      const action = r.candidate.alreadyInRegistry
        ? yellow("ENABLE (already in registry)")
        : green("ADD (new entry)");
      console.log(`  ${action}: ${r.candidate.org} — ${r.candidate.label}`);
      console.log(`    URL: ${r.candidate.url}`);
      if (r.orgTermsFound.length > 0) console.log(`    Org terms: ${r.orgTermsFound.join(", ")}`);
      if (r.identifierTermsFound.length > 0) console.log(`    Identifiers: ${r.identifierTermsFound.join(", ")}`);
      console.log();
    }
  } else {
    console.log(red("  No reachable official sources found for BPSC/IBPS/UPSC."));
    console.log(yellow("  All confirmed blocks/timeouts — external network or server-side restriction."));
    console.log();
  }

  console.log(dim("  productionWrites = 0. No registry changes made."));
  console.log(dim("  Update source-registry.ts manually based on findings above."));
  console.log();
}

main().catch((err) => {
  console.error("\x1b[1m\x1b[31mUnhandled error:\x1b[0m", String(err));
  process.exit(1);
});
