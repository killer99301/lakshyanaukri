// ═══════════════════════════════════════════════════════════
// Importer: the on/off switch
// ═══════════════════════════════════════════════════════════
//
// Server only. Read on every importer request, so switching off takes effect
// at once, without a deploy. Fail closed: when the store cannot be reached,
// or holds anything but "1", the importer is off.
//
// On Vercel the switch lives in Redis (the same store as the login rate
// limit). Without Redis on Vercel the importer is always off. Locally (no
// Redis, not on Vercel) it lives in memory, off until switched on, so the
// local test copy can use it.
//
// The switch never affects the publish gate: an imported job stays gated
// with the importer off.

import { Redis } from "@upstash/redis";

const KEY = "cms:importer:enabled";

export interface SwitchStore {
  get(): Promise<string | null>;
  set(on: boolean): Promise<void>;
}

let memoryValue: string | null = null;
export const memorySwitch: SwitchStore = {
  async get() { return memoryValue; },
  async set(on) { memoryValue = on ? "1" : null; },
};

let redis: Redis | null = null;
function redisSwitch(): SwitchStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis ??= new Redis({ url, token });
  const client = redis;
  return {
    async get() { const v = await client.get<string | number>(KEY); return v === null || v === undefined ? null : String(v); },
    async set(on) { if (on) await client.set(KEY, "1"); else await client.del(KEY); },
  };
}

let override: SwitchStore | null = null;
/** Tests only: replace the store. */
export function useSwitchStore(store: SwitchStore | null): void { override = store; }

function store(): SwitchStore | null {
  if (override) return override;
  const r = redisSwitch();
  if (r) return r;
  return process.env.VERCEL ? null : memorySwitch;
}

export async function importerEnabled(): Promise<boolean> {
  const s = store();
  if (!s) return false;
  try {
    return (await s.get()) === "1";
  } catch {
    return false;
  }
}

export async function setImporterEnabled(on: boolean): Promise<void> {
  const s = store();
  if (!s) throw new Error("The importer switch needs Redis, which is not configured here.");
  await s.set(on);
}
