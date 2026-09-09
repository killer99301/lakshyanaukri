// ═══════════════════════════════════════════════════════════
// Rate limiting — Upstash Redis (HTTP-based, Edge compatible)
// ═══════════════════════════════════════════════════════════
//
// Sliding window counter using Redis INCR + EXPIRE.
// In-memory fallback for non-production environments when
// Redis is not configured (logs a warning).
// In production without Redis: fail-closed.
// ═══════════════════════════════════════════════════════════

import { Redis } from "@upstash/redis";

export const LOGIN_LIMIT = { limit: 10, window: 900 } as const;    // 10 per 15m
export const RECOVERY_LIMIT = { limit: 3, window: 900 } as const;  // 3 per 15m

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}

// ─── In-memory fallback (non-production only) ─────────────

interface MemEntry {
  count: number;
  resetAt: number; // ms timestamp
}

const memStore = new Map<string, MemEntry>();

function checkMemory(
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || entry.resetAt < now) {
    memStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return { allowed: true, remaining };
}

// ─── Redis client (lazy init) ─────────────────────────────

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}

// ─── Main export ──────────────────────────────────────────

/**
 * Sliding window rate limiter.
 * @param key    Unique rate limit key (e.g. `login:ip:1.2.3.4`)
 * @param limit  Max requests allowed per window
 * @param windowSeconds  Window duration in seconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const client = getRedis();

  if (!client) {
    if (process.env.NODE_ENV === "production") {
      // Fail-closed in production without Redis
      console.error("[rate-limit] Redis not configured in production — failing closed");
      return { allowed: false, remaining: 0 };
    }
    // Dev/test: in-memory fallback with warning
    console.warn("[rate-limit] Redis not configured — using in-memory fallback (dev only)");
    return checkMemory(key, limit, windowSeconds);
  }

  // Sliding window via Redis: INCR + EXPIRE
  const count = await client.incr(key);
  if (count === 1) {
    await client.expire(key, windowSeconds);
  }

  const remaining = Math.max(0, limit - count);
  if (count > limit) {
    const ttl = await client.ttl(key);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: ttl > 0 ? ttl : windowSeconds,
    };
  }

  return { allowed: true, remaining };
}
