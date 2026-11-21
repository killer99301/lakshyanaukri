// ═══════════════════════════════════════════════════════════
// Daily public-page refresh (Option A, daily-html-freshness-assessment.md).
//
// Public pages are statically cached, so their server HTML keeps the date they were rendered on. This marks every
// public page (and the sitemap) for re-rendering, the same two calls a publish makes. Pages are not rendered here:
// each is rendered again on its next request.
//
//   - Only for a caller carrying "Authorization: Bearer <CRON_SECRET>" (Vercel adds it to its cron calls). With no
//     CRON_SECRET set, every call is refused.
//   - Before marking anything, reads the published jobs with the same query the public pages use. If that read fails
//     or finds no published job, nothing is marked: the pages already cached stay as they are.
//   - Reads only. Writes no record; no Telegram, AI, discovery, importer or publishing code.
//
// Limit (documented, not solved here): the check runs before the pages are rendered. If the database fails after the
// check, while a page is being rendered, the public loaders fall back to empty or built-in data and that page can be
// cached until the next refresh or publish.
// ═══════════════════════════════════════════════════════════

import { timingSafeEqual } from "node:crypto";

/** Paths marked by a refresh, exactly as publish, take-down and put-back do. */
export const REFRESH_TARGETS: ReadonlyArray<readonly [string, "layout" | undefined]> = [
  ["/", "layout"],
  ["/sitemap.xml", undefined],
];

/** True only for "Bearer <CRON_SECRET>", compared in constant time; false when no secret is configured. */
export function cronAuthorised(secret: string | undefined, authorization: string | null): boolean {
  const s = secret?.trim();
  if (!s) return false;
  const given = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${s}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type RefreshResult =
  | { refreshed: true; indiaDate: string; publishedJobs: number; paths: string[] }
  | { refreshed: false; indiaDate: string; reason: "unauthorised" | "data-check-failed" | "no-published-jobs" | "revalidation-failed" };

export interface RefreshDeps {
  secret: string | undefined;
  authorization: string | null;
  /** Number of published jobs, read with the public pages' own query. Throws when the database cannot be read. */
  countPublishedJobs: () => Promise<number>;
  revalidate: (path: string, type?: "layout") => void;
  now?: () => Date;
  log?: (line: string) => void;
}

const indiaDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export async function runPublicRefresh(deps: RefreshDeps): Promise<{ status: number; body: RefreshResult }> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const day = indiaDate((deps.now ?? (() => new Date()))());
  if (!cronAuthorised(deps.secret, deps.authorization)) {
    return { status: 401, body: { refreshed: false, indiaDate: day, reason: "unauthorised" } };
  }
  let jobs: number;
  try {
    jobs = await deps.countPublishedJobs();
  } catch (err) {
    log(`[Refresh] ${day}: skipped, published jobs could not be read (${err instanceof Error ? err.message.slice(0, 120) : "error"}); cached pages kept`);
    return { status: 503, body: { refreshed: false, indiaDate: day, reason: "data-check-failed" } };
  }
  if (!(jobs > 0)) {
    log(`[Refresh] ${day}: skipped, the read found no published job; cached pages kept`);
    return { status: 503, body: { refreshed: false, indiaDate: day, reason: "no-published-jobs" } };
  }
  try {
    for (const [path, type] of REFRESH_TARGETS) deps.revalidate(path, type);
  } catch (err) {
    log(`[Refresh] ${day}: revalidation failed (${err instanceof Error ? err.message.slice(0, 120) : "error"})`);
    return { status: 500, body: { refreshed: false, indiaDate: day, reason: "revalidation-failed" } };
  }
  log(`[Refresh] ${day}: public pages marked for re-rendering (${jobs} published jobs)`);
  return { status: 200, body: { refreshed: true, indiaDate: day, publishedJobs: jobs, paths: REFRESH_TARGETS.map(([p]) => p) } };
}
