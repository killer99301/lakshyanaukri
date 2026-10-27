// ═══════════════════════════════════════════════════════════
// Smart intake: pacing the AI requests of one import
// ═══════════════════════════════════════════════════════════
//
// Server only. A long notice is read in many requests (page batches, plus
// the section readers). Sent all at once they hit the model's per-minute
// limit, and some come back as "AI service unavailable". Two controls:
//
//   - A gate per import: every reading task (one section reader, one page
//     batch) waits for a free place, at most `concurrency` at a time. A task
//     starts its request, and its timeout, only once it has a place, so
//     waiting never uses up a request's time.
//   - A resending fetch: a request refused for load (429, 500, 502, 503,
//     504) is sent again, at most `retries` times, after a growing wait, or
//     after the wait the provider asks for when that is short. A 429 for
//     the provider's DAILY quota is never resent: nothing sent today can
//     succeed, and every resend would only use more of the day.
//     Every resend is counted against the daily allowance first, like any
//     request, and each refused attempt is counted as a failure. Once the
//     allowance is used up nothing is resent.
//
// It never logs, and never reads or keeps the request's address, which
// carries the API key.

import { recordAiFailure, reserveAiRequest, type AiFeature } from "@/lib/ai-usage";
import { readQuotaRefusal } from "@/lib/cms/ai-assist";

export interface PacingStats {
  /** Requests sent, resends included. */
  sent: number;
  /** Resends after a refusal for load. */
  retried: number;
  /** Attempts that failed (refused, or no answer). */
  failed: number;
}

export interface RetryOptions {
  retries?: number;
  /** Waits before each resend, in ms; the last is reused. */
  backoffMs?: number[];
  feature?: AiFeature;
  /** For tests: the clock's wait, and the allowance. */
  sleep?: (ms: number) => Promise<void>;
  reserve?: (feature: AiFeature) => Promise<{ allowed: boolean }>;
  recordFailure?: (feature: AiFeature) => Promise<void>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** The longest wait the provider may ask for before a resend; a longer one is not waited out inside a request. */
const MAX_ASKED_WAIT_MS = 30_000;

/** A fetch that resends a request refused for load; with what it did. */
export function retryingFetch(base: typeof fetch, opts: RetryOptions = {}): { fetch: typeof fetch; stats: PacingStats } {
  const retries = Math.max(0, opts.retries ?? 2);
  const backoff = opts.backoffMs ?? [5_000, 12_000];
  const feature = opts.feature ?? "import";
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const reserve = opts.reserve ?? reserveAiRequest;
  const recordFailure = opts.recordFailure ?? recordAiFailure;
  const stats: PacingStats = { sent: 0, retried: 0, failed: 0 };

  const retrying = (async (input: RequestInfo | URL, init?: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      stats.sent++;
      let response: Response;
      try {
        response = await base(input, init);
      } catch (err) {
        stats.failed++;
        throw err; // a timeout or a network failure: the reader reports it
      }
      if (response.ok) return response;
      stats.failed++;
      if (!RETRYABLE.has(response.status) || attempt >= retries || init?.signal?.aborted) return response;
      const quota = response.status === 429 ? readQuotaRefusal(await response.clone().text().catch(() => "")) : null;
      if (quota?.perDay) return response; // the day's quota is used up: no resend
      // This attempt was refused (and may have used quota): counted, then resent after a wait.
      await recordFailure(feature);
      const asked = quota?.retryAfterMs !== undefined && quota.retryAfterMs <= MAX_ASKED_WAIT_MS ? quota.retryAfterMs + 500 : undefined;
      await sleep(asked ?? backoff[Math.min(attempt, backoff.length - 1)]);
      if (init?.signal?.aborted) return response;
      if (!(await reserve(feature)).allowed) return response; // the daily allowance is used up: no resend
      stats.retried++;
    }
  }) as typeof fetch;
  return { fetch: retrying, stats };
}

/** At most `concurrency` tasks at a time, in the order they ask. */
export function createGate(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  const limit = Math.max(1, concurrency);
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next(); // the place passes straight to the next task
      else active--;
    }
  };
}
