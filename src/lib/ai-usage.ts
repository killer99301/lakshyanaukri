// ═══════════════════════════════════════════════════════════
// AI usage: a daily count per feature, and a daily cap
// ═══════════════════════════════════════════════════════════
//
// Every request the site sends to the AI model passes through reserve()
// first. It counts the request against today's total and refuses it once the
// site's own cap is reached, so the site stops itself well before the
// provider's daily limit would.
//
// Counts live in Redis (the same store the login rate limit uses) and are
// kept for 45 days. Without Redis (local development, tests) they are held
// in memory. Counting must never break an AI request: if the store cannot be
// reached, the request is allowed and simply not counted.
//
// Server-only.

import { Redis } from "@upstash/redis";

export type AiFeature = "assist" | "update-check" | "job-search";

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  assist: "AI Assist",
  "update-check": "Check for updates",
  "job-search": "New jobs search",
};

export const DEFAULT_AI_DAILY_CAP = 150;
const KEEP_SECONDS = 45 * 86_400;

/** The site's own daily request cap. AI_DAILY_CAP overrides it; nonsense values fall back. */
export function resolveDailyCap(envValue: string | undefined = process.env.AI_DAILY_CAP): number {
  const n = Number(envValue);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : DEFAULT_AI_DAILY_CAP;
}

/** Calendar day in India, "YYYY-MM-DD": the day the counts are kept under. */
export function usageDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export interface UsageStore {
  /** Adds `by` to one field of a day's counts and returns the field's new value. */
  increment(day: string, field: string, by: number): Promise<number>;
  read(day: string): Promise<Record<string, number>>;
}

const memory = new Map<string, Record<string, number>>();
export const memoryStore: UsageStore = {
  async increment(day, field, by) {
    const row = memory.get(day) ?? {};
    row[field] = (row[field] ?? 0) + by;
    memory.set(day, row);
    return row[field];
  },
  async read(day) {
    return { ...(memory.get(day) ?? {}) };
  },
};
export function resetMemoryUsage(): void {
  memory.clear();
}

let redis: Redis | null = null;
function redisStore(): UsageStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis ??= new Redis({ url, token });
  const client = redis;
  const key = (day: string) => `ai-usage:${day}`;
  return {
    async increment(day, field, by) {
      const value = await client.hincrby(key(day), field, by);
      await client.expire(key(day), KEEP_SECONDS);
      return value;
    },
    async read(day) {
      const row = (await client.hgetall<Record<string, string | number>>(key(day))) ?? {};
      return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v) || 0]));
    },
  };
}

const defaultStore = (): UsageStore => redisStore() ?? memoryStore;

export interface Reservation {
  allowed: boolean;
  /** Requests counted today, including this one when it was allowed. */
  usedToday: number;
  cap: number;
}

/**
 * Counts one request about to be sent. Refuses it when today's total has
 * already reached the cap; a refused request is not counted.
 */
export async function reserveAiRequest(
  feature: AiFeature,
  opts: { store?: UsageStore; cap?: number; now?: Date } = {},
): Promise<Reservation> {
  const cap = opts.cap ?? resolveDailyCap();
  const day = usageDay(opts.now);
  try {
    const store = opts.store ?? defaultStore();
    const total = await store.increment(day, "total", 1);
    if (total > cap) {
      await store.increment(day, "total", -1);
      await store.increment(day, "refused", 1);
      return { allowed: false, usedToday: total - 1, cap };
    }
    await store.increment(day, feature, 1);
    return { allowed: true, usedToday: total, cap };
  } catch (err) {
    console.error("[AI usage] count failed:", err instanceof Error ? err.name : "error");
    return { allowed: true, usedToday: 0, cap };
  }
}

/** Notes that a counted request came back refused or unreadable. Never throws. */
export async function recordAiFailure(feature: AiFeature, opts: { store?: UsageStore; now?: Date } = {}): Promise<void> {
  try {
    await (opts.store ?? defaultStore()).increment(usageDay(opts.now), `${feature}:failed`, 1);
  } catch {
    // Counting is best-effort.
  }
}

export interface UsageDay {
  day: string;
  total: number;
  failed: number;
  refused: number;
  byFeature: Record<AiFeature, number>;
}

export const capReachedMessage = (cap: number) =>
  `Today’s AI limit for the site (${cap} requests) has been reached. It resets at midnight.`;

/** The last `days` days, today first. */
export async function readAiUsage(days = 7, opts: { store?: UsageStore; now?: Date } = {}): Promise<UsageDay[]> {
  const store = opts.store ?? defaultStore();
  const now = opts.now ?? new Date();
  const features = Object.keys(AI_FEATURE_LABELS) as AiFeature[];
  const out: UsageDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = usageDay(new Date(now.getTime() - i * 86_400_000));
    const row = await store.read(day).catch(() => ({} as Record<string, number>));
    out.push({
      day,
      total: row.total ?? 0,
      refused: row.refused ?? 0,
      failed: features.reduce((n, f) => n + (row[`${f}:failed`] ?? 0), 0),
      byFeature: Object.fromEntries(features.map((f) => [f, row[f] ?? 0])) as Record<AiFeature, number>,
    });
  }
  return out;
}
