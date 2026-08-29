// ═══════════════════════════════════════════════════════════
// Career Campus — Intelligence Engine Safe Fetcher
// ═══════════════════════════════════════════════════════════
// All HTTP requests from the intelligence engine go through
// this module. No source adapter may fetch directly.
//
// Guarantees:
//   - Timeout: 12 seconds per request
//   - Retry: up to 3 attempts with exponential backoff
//   - Rate limiting: minimum delay between requests to same domain
//   - User-Agent: identified bot (Career-Campus-Bot/1.0)
//   - FETCH_FAILED is NEVER interpreted as a status change
//   - No uncontrolled crawling: only explicit URL arguments
// ═══════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import type { FetchResult, FetchStatus } from "./types";

// ─── Config ──────────────────────────────────────────────────

const USER_AGENT =
  "Career-Campus-Bot/1.0 (+https://careercampus.in/bot; bot@careercampus.in)";

const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 3;

// Exponential backoff delays (ms) for each retry attempt
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

// Default minimum delay between requests to the same domain
const DEFAULT_RATE_LIMIT_MS = 5_000;

// ─── Domain Rate Limiter ─────────────────────────────────────
// Tracks the timestamp of the last successful request per domain.
// Module-level so it persists across calls within a single run.

const domainLastFetchAt = new Map<string, number>();

async function waitForRateLimit(domain: string, minDelayMs: number): Promise<void> {
  const last = domainLastFetchAt.get(domain);
  if (last === undefined) return;

  const elapsed = Date.now() - last;
  if (elapsed < minDelayMs) {
    await sleep(minDelayMs - elapsed);
  }
}

function recordFetch(domain: string): void {
  domainLastFetchAt.set(domain, Date.now());
}

// ─── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function parseHttpStatus(status: number): FetchStatus {
  if (status === 200 || status === 304) return "OK";
  if (status === 301 || status === 302 || status === 307 || status === 308) return "REDIRECT_LOOP";
  if (status === 403 || status === 401) return "BLOCKED";
  if (status === 429) return "RATE_LIMITED";
  return "ERROR";
}

// ─── Core Fetch ──────────────────────────────────────────────

interface SingleFetchOutcome {
  ok: boolean;
  status: FetchStatus;
  httpStatus?: number;
  contentHash?: string;
  contentType?: string;
  contentLengthBytes?: number;
  finalUrl: string;
  error?: string;
  rawContent?: string;          // populated only when includeContent:true + text/html
}

async function attemptFetch(
  url: string,
  includeContent = false
): Promise<SingleFetchOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/pdf,application/json,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const finalUrl = response.url || url;

    // Read body for content hash (limit to 1 MB to avoid memory issues)
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const truncated = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 1_048_576));
    const body = Buffer.from(truncated);
    const contentHash = sha256Hex(body);
    const contentType = response.headers.get("content-type") ?? undefined;
    const contentLength = blob.size;

    const parsedStatus = parseHttpStatus(response.status);

    // Decode HTML content when caller requested it (for text extraction)
    const rawContent =
      includeContent && contentType?.includes("text/html")
        ? body.toString("utf-8")
        : undefined;

    return {
      ok: response.ok,
      status: parsedStatus,
      httpStatus: response.status,
      contentHash,
      contentType,
      contentLengthBytes: contentLength,
      finalUrl,
      rawContent,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isAbort =
      err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"));

    return {
      ok: false,
      status: isAbort ? "TIMEOUT" : "ERROR",
      finalUrl: url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Public API ──────────────────────────────────────────────

export interface SafeFetchOptions {
  rateLimitDelayMs?: number;    // override default 5s domain rate limit
  maxRetries?: number;          // override default 3
}

/**
 * Safely fetch a URL with timeout, retry, and rate limiting.
 *
 * IMPORTANT: A non-OK result (ERROR, TIMEOUT, BLOCKED) must NEVER be
 * interpreted as a change in recruitment status by callers.
 * Fetch failures are operational noise, not data signals.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<FetchResult> {
  const rateLimitMs = options.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const domain = extractDomain(url);

  const fetchedAt = new Date().toISOString();
  const startMs = Date.now();

  // Wait for domain rate limit before first attempt
  await waitForRateLimit(domain, rateLimitMs);

  let lastOutcome: SingleFetchOutcome = {
    ok: false,
    status: "ERROR",
    finalUrl: url,
    error: "No attempt made",
  };
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff between retries
      const backoffMs = RETRY_DELAYS_MS[attempt - 1] ?? 8_000;
      await sleep(backoffMs);
      retryCount++;
    }

    const outcome = await attemptFetch(url, false);
    lastOutcome = outcome;

    if (outcome.ok) {
      recordFetch(domain);
      break;
    }

    // Do not retry on BLOCKED (403) — it won't change with retries
    if (outcome.status === "BLOCKED") {
      break;
    }

    // For RATE_LIMITED (429), wait longer before retry
    if (outcome.status === "RATE_LIMITED") {
      if (attempt < maxRetries) {
        await sleep(30_000); // 30 seconds for 429
      }
    }
  }

  const responseTimeMs = Date.now() - startMs;

  return {
    url,
    finalUrl: lastOutcome.finalUrl,
    status: lastOutcome.ok ? "OK" : lastOutcome.status,
    httpStatus: lastOutcome.httpStatus,
    contentHash: lastOutcome.contentHash,
    contentType: lastOutcome.contentType,
    contentLengthBytes: lastOutcome.contentLengthBytes,
    responseTimeMs,
    error: lastOutcome.error,
    fetchedAt,
    retryCount,
  };
}

/**
 * Like safeFetch, but also returns the decoded HTML body for text extraction.
 * The rawContent is returned separately and is NEVER stored in FetchResult
 * or the audit log — it is transient in-memory data used only during the run.
 *
 * Returns htmlContent = null when:
 *   - The fetch failed (non-OK status)
 *   - The response content-type is not text/html
 */
export async function fetchHtmlContent(
  url: string,
  options: SafeFetchOptions = {}
): Promise<{ fetchResult: FetchResult; htmlContent: string | null }> {
  const rateLimitMs = options.rateLimitDelayMs ?? DEFAULT_RATE_LIMIT_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const domain = extractDomain(url);

  const fetchedAt = new Date().toISOString();
  const startMs = Date.now();

  await waitForRateLimit(domain, rateLimitMs);

  let lastOutcome: SingleFetchOutcome = {
    ok: false,
    status: "ERROR",
    finalUrl: url,
    error: "No attempt made",
  };
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = RETRY_DELAYS_MS[attempt - 1] ?? 8_000;
      await sleep(backoffMs);
      retryCount++;
    }

    const outcome = await attemptFetch(url, true);  // includeContent: true
    lastOutcome = outcome;

    if (outcome.ok) {
      recordFetch(domain);
      break;
    }

    if (outcome.status === "BLOCKED") break;

    if (outcome.status === "RATE_LIMITED" && attempt < maxRetries) {
      await sleep(30_000);
    }
  }

  const responseTimeMs = Date.now() - startMs;

  const fetchResult: FetchResult = {
    url,
    finalUrl: lastOutcome.finalUrl,
    status: lastOutcome.ok ? "OK" : lastOutcome.status,
    httpStatus: lastOutcome.httpStatus,
    contentHash: lastOutcome.contentHash,
    contentType: lastOutcome.contentType,
    contentLengthBytes: lastOutcome.contentLengthBytes,
    responseTimeMs,
    error: lastOutcome.error,
    fetchedAt,
    retryCount,
  };

  return {
    fetchResult,
    htmlContent: lastOutcome.rawContent ?? null,
  };
}

/**
 * Compute a stable SHA-256 snapshot reference for a JavaScript value.
 * Used for preRunSnapshotRef to capture canonical data state.
 */
export function computeSnapshotRef(data: unknown): string {
  const json = JSON.stringify(data, null, 0);
  return `sha256:${sha256Hex(json)}`;
}
