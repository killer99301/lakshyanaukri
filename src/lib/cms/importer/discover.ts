// ═══════════════════════════════════════════════════════════
// Job discovery, on demand: what a listing page announces
// ═══════════════════════════════════════════════════════════
//
// Server only. The admin gives the address of a listing page (a portal's
// "Bihar jobs" page, a commission's notices page). The page is fetched once,
// through the importer's safe fetch, if the site's robots.txt allows it. Its
// links are sorted into new recruitments and updates to existing ones, and
// each is compared with the jobs already in the CMS. Nothing is saved, no AI
// is used, and nothing follows the links: the admin picks one and opens it
// in Smart intake, where a portal's page stays research.
//
// One page per request, no crawling, no logins.

import { extractLinks, isNewRecruitmentNotice } from "@/intelligence/discovery";
import { fetchSource, type FetchedSource } from "@/lib/cms/importer/fetch-source";
import { hostOf } from "@/lib/cms/importer/trusted-domains";
import { TRUSTED_DOMAINS } from "@/lib/cms/importer/trusted-domains";
import { linkFlags } from "@/lib/cms/importer/links";

export const MAX_FOUND = 60;
const AGENT = "LakshyaNaukriBot";

export interface FoundJob {
  title: string;
  url: string;
  /** NEW: a recruitment announced; UPDATE: an extension, result, admit card… of one. */
  kind: "NEW" | "UPDATE";
  date?: string;
  /** The recruiting body's own site (a listed host or a government domain), or a portal. */
  official: boolean;
  /** Jobs in the CMS this may already be. */
  maybe: Array<{ id: string; title: string }>;
}

export interface DiscoverResult { ok: true; page: string; found: FoundJob[] }
export type DiscoverOutcome = DiscoverResult | { ok: false; error: string };

/** Whether robots.txt lets a general crawler (or this one) fetch the path. Missing or unreadable: allowed. */
export function robotsAllows(robots: string, path: string, agent = AGENT): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", path: value });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const applicable = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes("*"));
  // The longest matching rule wins; Allow wins a tie.
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    const pattern = new RegExp("^" + rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (!pattern.test(path)) continue;
    if (!best || rule.path.length > best.length || (rule.path.length === best.length && rule.allow)) best = { allow: rule.allow, length: rule.path.length };
  }
  return best ? best.allow : true;
}

/** Courses, test series and shop pages: not announcements. */
export const NOT_ANNOUNCEMENT = /batch|mock test|test series|course|enrol|enroll|mahapack|live class|ebook|previous year/i;
export const UPDATE_WORDS = /extended|extension|postponed|rescheduled|admit card|hall ticket|result|answer key|cut ?off|merit list|exam date|city intimation|corrigendum|revised/i;
const STOP = new Set(["the", "and", "for", "of", "in", "out", "to", "on", "a", "check", "apply", "online", "notification", "recruitment", "vacancy", "vacancies", "posts", "post", "pdf", "link", "details", "now", "download", "form", "last", "date", "at", "with", "new"]);
/** A title's words, without years and filler; plus the initials of each run of words ("food safety officer" → "fso"). */
// Words most job titles share: they make initials ("food safety officer" →
// "fso") but do not count as a match on their own.
const GENERIC = new Set(["officer", "officers", "assistant", "junior", "senior", "exam", "examination", "manager", "grade", "group"]);

function words(s: string): { words: Set<string>; all: Set<string> } {
  const list = s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t) && !/^20\d{2}$/.test(t));
  const all = new Set(list.filter((t) => !GENERIC.has(t)));
  for (let i = 0; i < list.length; i++) {
    for (let n = 2; n <= 4 && i + n <= list.length; n++) all.add(list.slice(i, i + n).map((w) => w[0]).join(""));
  }
  return { words: new Set(list.filter((t) => !GENERIC.has(t))), all };
}

/** Jobs whose titles share the year and most of their words (or their initials) with the announcement. */
export function similarJobs(title: string, jobs: Array<{ id: string; title: string }>): Array<{ id: string; title: string }> {
  const a = words(title);
  const year = /\b20\d{2}\b/.exec(title)?.[0];
  return jobs.filter((j) => {
    if (year && !j.title.includes(year)) return false;
    const b = words(j.title);
    const shared = new Set([...a.words].filter((t) => b.all.has(t)).concat([...b.words].filter((t) => a.all.has(t))));
    return shared.size >= 2 && shared.size / Math.min(a.words.size, b.words.size) >= 0.5;
  }).slice(0, 3);
}

// A listed host, or a .gov.in site. Not every .nic.in site: NIC hosts portals
// for many bodies (pariksha.nic.in), so those count only when listed.
export const officialHost = (host: string | null) => !!host && (
  /\.gov\.in$/.test(host) || Object.values(TRUSTED_DOMAINS).flat().some((e) => host === e.host || host.endsWith(`.${e.host}`)));

export async function discoverFromPage(opts: {
  url: string;
  jobs: Array<{ id: string; title: string }>;
  fetchSourceFn?: (url: string) => Promise<FetchedSource>;
}): Promise<DiscoverOutcome> {
  const fetchOne = opts.fetchSourceFn ?? ((u: string) => fetchSource(u));
  let page: URL;
  try { page = new URL(opts.url); } catch { return { ok: false, error: "That is not a web address" }; }
  if (page.protocol !== "https:" && page.protocol !== "http:") return { ok: false, error: "Only web pages can be searched" };

  const robots = await fetchOne(`${page.origin}/robots.txt`);
  if (robots.ok && /text\/plain/i.test(robots.contentType) && !robotsAllows(robots.bytes.toString("utf8"), page.pathname + page.search)) {
    return { ok: false, error: `${page.host} asks crawlers not to read this page (robots.txt), so it was not fetched` };
  }
  const got = await fetchOne(page.toString());
  if (!got.ok) return { ok: false, error: `${page.host}: ${got.error}` };
  if (!/html/i.test(got.contentType)) return { ok: false, error: "That address is not a web page (a PDF goes straight into Smart intake)" };

  const seen = new Set<string>();
  const found: FoundJob[] = [];
  for (const link of extractLinks(got.bytes.toString("utf8"), got.finalUrl)) {
    if (found.length >= MAX_FOUND) break;
    let href: URL;
    try { href = new URL(link.href); } catch { continue; }
    if (href.protocol !== "https:" && href.protocol !== "http:") continue;
    href.hash = "";
    const key = href.toString();
    if (seen.has(key) || key === got.finalUrl) continue;
    const isUpdate = UPDATE_WORDS.test(link.text);
    if (!isUpdate && !isNewRecruitmentNotice(link.text)) continue;
    if (!isUpdate && !/\b20\d{2}\b|recruit|vacanc|bharti|notification|advt|apply/i.test(link.text)) continue;
    // Courses, test series and shop pages are not announcements.
    if (NOT_ANNOUNCEMENT.test(link.text)) continue;
    seen.add(key);
    const host = hostOf(key);
    found.push({
      title: link.text.slice(0, 200), url: key, kind: isUpdate ? "UPDATE" : "NEW",
      ...(link.nearbyDate ? { date: link.nearbyDate } : {}),
      official: officialHost(host) && linkFlags(key, key).length === 0,
      maybe: similarJobs(link.text, opts.jobs),
    });
  }
  return { ok: true, page: got.finalUrl, found };
}
