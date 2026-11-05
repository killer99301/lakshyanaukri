// ═══════════════════════════════════════════════════════════
// Check portals now (N4): one admin-started collector run, and its summary
// ═══════════════════════════════════════════════════════════
//
// Server only. How a run fetches is decided here, never by the request:
//   off       the default: nothing is fetched; the inbox says live scans are not enabled
//   fixtures  DISCOVERY_FIXTURES_DIR names a folder of saved pages (a local test copy only;
//             refused on Vercel): every address is answered from its manifest, nothing leaves
//             the machine, and the run is labelled a test run, never a portal scan
//   live      DISCOVERY_LIVE_SCAN=on: the real portals through the importer's safe fetch.
//             Not enabled anywhere until the owner approves a controlled live run.
// One run at a time (a lock in Redis when configured, else in this process). The
// collector keeps every review decision; this module only counts what it did.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { getEnabledSources } from "@/intelligence/multi-source/source-config";
import type { MultiSourceConfig } from "@/intelligence/multi-source/types";
import type { FetchedSource } from "@/lib/cms/importer/fetch-source";
import { collectLeads, type CollectorReport, type SourceOutcome } from "@/lib/cms/discovery/collector";

export type RunMode = "off" | "fixtures" | "live";

export function runMode(env: NodeJS.ProcessEnv = process.env): RunMode {
  if (env.DISCOVERY_FIXTURES_DIR) return env.VERCEL ? "off" : "fixtures";
  return env.DISCOVERY_LIVE_SCAN === "on" ? "live" : "off";
}

interface Manifest { pages: Record<string, { file: string; type: string }>; extraSources?: MultiSourceConfig[] }

function fixtures(dir: string): { sources: MultiSourceConfig[]; fetchSourceFn: (url: string) => Promise<FetchedSource> } {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new RunError("The saved test pages have no manifest.json", 500);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  return {
    sources: [...getEnabledSources(), ...(manifest.extraSources ?? [])],
    fetchSourceFn: async (url) => {
      const page = manifest.pages[url];
      if (!page) return { ok: false, error: "No saved test page for this address" };
      return { ok: true, finalUrl: url, contentType: page.type, bytes: readFileSync(join(dir, page.file)) };
    },
  };
}

export class RunError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "RunError"; }
}

// ── One run at a time ──
const LOCK_KEY = "cms:discovery:run";
const LOCK_SECONDS = 300;
let memoryLock = 0;
let redis: Redis | null = null;
async function takeLock(): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis ??= new Redis({ url, token });
    return (await redis.set(LOCK_KEY, "1", { nx: true, ex: LOCK_SECONDS })) === "OK";
  }
  if (memoryLock > Date.now()) return false;
  memoryLock = Date.now() + LOCK_SECONDS * 1000;
  return true;
}
async function releaseLock(): Promise<void> {
  if (redis) await redis.del(LOCK_KEY).catch(() => undefined);
  memoryLock = 0;
}

export interface RunSummary {
  mode: Exclude<RunMode, "off">;
  startedAt: string;
  finishedAt: string;
  /** Every source read without a fault. */
  complete: boolean;
  counts: { newLeads: number; alreadyKnown: number; moreSources: number; failedSources: number; sourcesRead: number };
  sources: SourceOutcome[];
}

export function summarise(mode: Exclude<RunMode, "off">, startedAt: string, report: CollectorReport): RunSummary {
  const failed = report.sources.filter((s) => s.status !== "OK" && s.status !== "EMPTY");
  return {
    mode, startedAt, finishedAt: new Date().toISOString(), complete: failed.length === 0,
    counts: {
      newLeads: report.leads.filter((l) => l.created).length,
      // Seen again: a known lead is never counted as new, whether or not this run found it somewhere else too.
      alreadyKnown: report.leads.filter((l) => !l.created && l.sourcesAdded === 0).length,
      moreSources: report.leads.filter((l) => !l.created && l.sourcesAdded > 0).length,
      failedSources: failed.length,
      sourcesRead: report.sources.length - failed.length,
    },
    sources: report.sources,
  };
}

/** One collector run, started by the admin. Refused when scans are off, or while another run is going. */
export async function checkPortalsNow(env: NodeJS.ProcessEnv = process.env): Promise<RunSummary> {
  const mode = runMode(env);
  if (mode === "off") throw new RunError("Live portal scans are not enabled on this site yet. Nothing was fetched.", 409);
  if (!(await takeLock())) throw new RunError("A portal check is already running. Wait for it to finish.", 409);
  const startedAt = new Date().toISOString();
  try {
    const report = mode === "fixtures"
      ? await collectLeads({ ...fixtures(env.DISCOVERY_FIXTURES_DIR!), sleep: async () => {} })
      : await collectLeads({});
    return summarise(mode, startedAt, report);
  } finally {
    await releaseLock();
  }
}

/** What the inbox shows before a run: the mode and the sources a run would read. */
export function runInfo(env: NodeJS.ProcessEnv = process.env): { mode: RunMode; sources: Array<{ id: string; name: string; url: string }> } {
  const mode = runMode(env);
  let sources: MultiSourceConfig[] = getEnabledSources();
  if (mode === "fixtures") { try { sources = fixtures(env.DISCOVERY_FIXTURES_DIR!).sources; } catch { /* said on the run */ } }
  return { mode, sources: sources.map((s) => ({ id: s.id, name: s.name, url: s.url })) };
}
