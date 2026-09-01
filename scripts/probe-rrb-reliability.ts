#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// RRB Domain Reliability Investigation
// ═══════════════════════════════════════════════════════════
//
// Tests three fetch patterns to diagnose why indianrailways.gov.in
// fails inside the intelligence runner but succeeds in source-probe.
//
// Hypotheses under test:
//   H1: Domain is consistently unreachable from this runner IP (IP block)
//   H2: Sequential fetches to the same domain cause rate-limiting failure
//   H3: Lack of delay between fetches causes failure
//   H4: Timeout (12s) is too short for this domain from GH Actions
//
// Experiments:
//   E1: Recruitment page fetched in isolation — no prior domain state
//       Tests H1: if this fails, the domain is blocked regardless of sequence
//   E2: Homepage → 5s wait → recruitment page (mirrors runner order)
//       Tests H2: if E1 succeeds but E2b fails, sequential fetches are the issue
//   E3: Homepage → immediate → recruitment page (no delay)
//       Tests H3: if E3b fails but E2b succeeds, the 5s delay is essential
//
// Each fetch is direct (no module-level domain state, no retries).
// At most 5 HTTP requests total — minimal traffic.
// Never modifies canonical data.
// ═══════════════════════════════════════════════════════════

const HOMEPAGE_URL     = "https://indianrailways.gov.in";
const RECRUITMENT_URL  = "https://indianrailways.gov.in/railwayboard/view_section.jsp?lang=0&id=0,1,304,366,554";
const TIMEOUT_MS       = 20_000;  // 20s — 67% above current 12s limit; tests H4

// ─── Raw fetch (no module state, no retry) ───────────────────

interface RawResult {
  label: string;
  url: string;
  status: "OK" | "TIMEOUT" | "ERROR" | "BLOCKED";
  httpStatus: number | null;
  responseTimeMs: number;
  wordCount: number;
  error: string | null;
}

async function rawFetch(label: string, url: string): Promise<RawResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":       "Career-Campus-Bot/1.0 (+https://careercampus.in/bot; bot@careercampus.in)",
        "Accept":           "text/html,*/*;q=0.8",
        "Accept-Language":  "en-IN,en;q=0.9",
        "Cache-Control":    "no-cache",
      },
    });

    clearTimeout(tid);
    const ms = Date.now() - start;
    const text = await response.text().catch(() => "");

    let status: RawResult["status"];
    if (response.status === 200 || response.status === 304) {
      status = "OK";
    } else if (response.status === 403 || response.status === 401) {
      status = "BLOCKED";
    } else {
      status = "ERROR";
    }

    // Crude word count (no HTML parser needed — just rough signal)
    const words = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length > 0);

    return {
      label,
      url,
      status,
      httpStatus: response.status,
      responseTimeMs: ms,
      wordCount: words.length,
      error: null,
    };
  } catch (e) {
    clearTimeout(tid);
    const ms = Date.now() - start;
    const isAbort = e instanceof Error && e.name === "AbortError";
    return {
      label,
      url,
      status: isAbort ? "TIMEOUT" : "ERROR",
      httpStatus: null,
      responseTimeMs: ms,
      wordCount: 0,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(r: RawResult): string {
  const icon = r.status === "OK" ? "✅" : r.status === "TIMEOUT" ? "⏱" : "❌";
  const detail = r.status === "OK"
    ? `HTTP ${r.httpStatus}, ${r.responseTimeMs}ms, ${r.wordCount} words`
    : `${r.status} after ${r.responseTimeMs}ms — ${r.error ?? `HTTP ${r.httpStatus}`}`;
  return `  ${icon}  ${r.label}: ${detail}`;
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const isGHA = process.env.GITHUB_ACTIONS === "true";
  console.log("\n" + "═".repeat(70));
  console.log("  RRB Domain Reliability Investigation");
  console.log(`  Environment: ${isGHA ? "GitHub Actions (Ubuntu)" : "Local"}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`  Timeout per attempt: ${TIMEOUT_MS}ms`);
  console.log(`  Retries: 0 (raw fetch — diagnostic only)`);
  console.log("═".repeat(70) + "\n");

  const results: RawResult[] = [];

  // ── E1: Isolated fetch of recruitment page ────────────────
  console.log("E1 — Isolated single fetch of recruitment page");
  console.log("     (no prior fetch to indianrailways.gov.in in this process)");
  const e1 = await rawFetch("E1 recruitment page (isolated)", RECRUITMENT_URL);
  results.push(e1);
  console.log(fmt(e1));

  console.log("\nWaiting 8s before E2 (clear any server-side window)...");
  await sleep(8_000);

  // ── E2: Homepage → 5s delay → recruitment page ───────────
  console.log("\nE2 — Homepage first, then 5s delay, then recruitment page");
  console.log("     (mirrors runner order: rrb-official-website → rrb-org-discovery)");
  const e2a = await rawFetch("E2a homepage", HOMEPAGE_URL);
  results.push(e2a);
  console.log(fmt(e2a));

  console.log("  Waiting 5s (simulating DEFAULT_TIER3_POLLING.rateLimitDelayMs)...");
  await sleep(5_000);

  const e2b = await rawFetch("E2b recruitment page (after 5s)", RECRUITMENT_URL);
  results.push(e2b);
  console.log(fmt(e2b));

  console.log("\nWaiting 8s before E3...");
  await sleep(8_000);

  // ── E3: Homepage → immediate → recruitment page ───────────
  console.log("\nE3 — Homepage first, then recruitment page immediately (no delay)");
  console.log("     (tests whether 5s delay is load-bearing)");
  const e3a = await rawFetch("E3a homepage (no delay)", HOMEPAGE_URL);
  results.push(e3a);
  console.log(fmt(e3a));

  const e3b = await rawFetch("E3b recruitment page (immediate)", RECRUITMENT_URL);
  results.push(e3b);
  console.log(fmt(e3b));

  // ── Summary ───────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("SUMMARY");
  console.log("─".repeat(70));
  for (const r of results) console.log(fmt(r));

  // ── Hypothesis verdicts ───────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log("HYPOTHESIS VERDICTS");
  console.log("─".repeat(70));

  const e1ok = e1.status === "OK";
  const e2aok = e2a.status === "OK";
  const e2bok = e2b.status === "OK";
  const e3aok = e3a.status === "OK";
  const e3bok = e3b.status === "OK";

  // H1: IP block — E1 fails
  if (!e1ok) {
    console.log("H1 CONFIRMED: Domain unreachable in isolation → IP-level block.");
    console.log("  Implication: All fetches to indianrailways.gov.in will fail from this runner IP.");
    console.log("  No code change (delay, dedup, timeout) can fix this.");
    console.log("  Recommendation: Disable rrb-org-discovery; use manual discovery for RRB.");
  } else {
    console.log("H1 REJECTED: Isolated fetch succeeded → domain is reachable from this IP.");
  }

  // H2: Sequential fetches cause failure
  if (e1ok && e2aok && !e2bok) {
    console.log("H2 CONFIRMED: Homepage succeeded, then recruitment page failed after 5s delay.");
    console.log("  Implication: Sequential same-domain fetches trigger rate-limiting even with 5s gap.");
    console.log("  Fix: Consolidate to a single indianrailways.gov.in fetch per run.");
    console.log("  Fix: Increase rateLimitDelayMs for the rrb-official-website source.");
  } else if (e1ok && e2aok && e2bok) {
    console.log("H2 REJECTED: Both fetches in E2 succeeded — sequential fetching is not the issue.");
  } else if (e1ok && !e2aok) {
    console.log("H2 UNDETERMINED: Homepage itself failed — different failure mode than E1.");
    console.log("  The homepage URL may be unreachable even though the recruitment page URL is.");
  }

  // H3: Lack of delay causes failure
  if (e1ok && e2bok && !e3bok) {
    console.log("H3 CONFIRMED: Immediate sequential fetch failed; 5s delay was required.");
    console.log("  Fix: Keep or increase DEFAULT_TIER3_POLLING.rateLimitDelayMs for RRB sources.");
  } else if (e1ok && e2bok && e3bok) {
    console.log("H3 REJECTED: Immediate sequential fetch also succeeded — delay is not load-bearing.");
  }

  // H4: Timeout too short — check if TIMEOUT_MS needed
  const anyTimeout = results.some((r) => r.status === "TIMEOUT");
  const anySlow   = results.filter((r) => r.status === "OK").some((r) => r.responseTimeMs > 12_000);
  if (anySlow) {
    console.log("H4 CONFIRMED: At least one successful fetch took >12s — current TIMEOUT_MS too low.");
    console.log("  Fix: Increase TIMEOUT_MS in fetcher.ts to at least 20s.");
  } else if (anyTimeout) {
    console.log("H4 PARTIAL: Some fetches timed out at 20s — domain is slow but not blocked.");
    console.log("  Fix: Increase TIMEOUT_MS in fetcher.ts; may resolve flaky behavior.");
  } else {
    console.log("H4 REJECTED: All successful fetches completed well under 12s.");
  }

  // Overall recommendation
  console.log("\n" + "─".repeat(70));
  console.log("RECOMMENDATION");
  console.log("─".repeat(70));
  if (!e1ok) {
    console.log("STOP: IP-level block detected. RRB automation from GH Actions is not reliable.");
    console.log("  → Keep rrb-org-discovery disabled.");
    console.log("  → Do NOT enable the 3-hour schedule for RRB discovery.");
    console.log("  → Recommend manual discovery: periodically check indianrailways.gov.in/railwayboard.");
  } else if (!e2bok || !e3bok) {
    const failedStep = !e2bok ? "E2b (after 5s delay)" : "E3b (immediate)";
    console.log(`PARTIAL: Isolated fetch works but ${failedStep} failed.`);
    console.log("  → Sequential same-domain fetches are the problem.");
    console.log("  → Consider URL dedup: change rrb-official-website URL to match rrb-org-discovery URL.");
    console.log("  → This reduces indianrailways.gov.in fetches per run from 2 to 1.");
  } else {
    console.log("ALL EXPERIMENTS PASSED: indianrailways.gov.in is reliably reachable from this IP.");
    console.log("  → The prior failure (intelligence-check run) was a transient runner IP issue.");
    console.log("  → rrb-org-discovery can remain enabled.");
    console.log("  → Monitor the next intelligence-check run for recurrence.");
    console.log("  → Consider enabling 3-hour schedule after 2 consecutive successful dry runs.");
  }

  console.log("═".repeat(70) + "\n");
}

main().catch((e) => {
  console.error("[RRB-PROBE][FATAL]", e);
  process.exit(1);
});
