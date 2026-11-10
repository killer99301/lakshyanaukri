// ═══════════════════════════════════════════════════════════
// Job discovery, on demand: what a listing page announces
// ═══════════════════════════════════════════════════════════
//
// Server only. The admin gives the address of a listing page (a portal's
// "Bihar jobs" page, a commission's notices page). The page is fetched once,
// through the importer's safe fetch, if the site's robots.txt allows it. Its
// links are sorted into new recruitments and updates to existing ones, with
// the same rules the portal collector uses (link-rules.ts, Stage 1), and each
// is compared with the jobs already in the CMS with the collector's matching
// (match.ts). Nothing is saved, no AI is used, and nothing follows the links:
// the admin picks one and opens it in Smart intake, where a portal's page
// stays research.
//
// One page per request, no crawling, no logins.

import { extractLinks, extractNotificationNumber } from "@/intelligence/discovery";
import { detectOrgFromText } from "@/intelligence/multi-source/org-classifier";
import { ORG_NAMES } from "@/intelligence/org-registry";
import { classifyLink } from "@/lib/cms/discovery/link-rules";
import { isEligibilityExam } from "@/lib/cms/discovery/eligibility-exam";
import { matchLead, bodyWords, bodyAcronyms, titleAcronyms, VERIFIED_ALIASES, type CmsJob, type MatchKind } from "@/lib/cms/discovery/match";
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
  /** A date printed in the link's own row (its text or what follows it), never a neighbour's; it may be a posting date. */
  date?: string;
  /** The last date the title (or its row) gives, labelled "Last Date": the portal's word, which an extension can change. */
  lastDate?: string;
  /** Whether that last date has passed, by today's date in India; UNKNOWN when none is given. Separate from being in the CMS. */
  applications: "OPEN" | "LAST_DATE_PASSED" | "UNKNOWN";
  /** The recruiting body's own site (a listed host or a government domain), or a portal. */
  official: boolean;
  /** A standalone eligibility exam (UGC NET, CTET, a TET or SET, GATE): kept and shown as found, never a recruitment. */
  eligibilityExam?: true;
  /** The organisation recognised from the title, when one was: the CMS's own organisations first, then the registry. */
  organizationId?: string;
  /** Also set, without an ID, for a common body the CMS has no job of yet: a name to read, never used to match. */
  organizationName?: string;
  /** CMS bodies the title fits equally well (the same acronym): none chosen, for the admin to decide. */
  organizationUnclear?: string[];
  /** The notice number printed in the title, when one was. */
  notificationNumber?: string;
  /** How it compares with the CMS's jobs, as the collector would match it. */
  match: MatchKind;
  matchReason: string | null;
  /** Jobs in the CMS this may already be, strongest first, each with why. */
  maybe: Array<{ id: string; title: string; kind?: string; reason?: string }>;
  /** Jobs with a like title but another notice number: probably other recruitments, shown apart. */
  differentNotice?: Array<{ id: string; title: string; reason: string }>;
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

// ── Dates in a listing row (listing finder, SarkariResult 10 Nov) ──
// The older readers look 100 characters either side of a link, which on a tight list is the previous row's
// "Last Date : 11/11/2026". The finder reads only the link's own text and what follows it in its row.
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function isoDate(d: string, m: string, y: string): string | undefined {
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : undefined;
}
/** The first date in a text: 13/11/2026, 13-11-2026, 13.11.2026 or 13 Nov 2026. */
export function firstDate(text: string): string | undefined {
  const re = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b|\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const month = m[1] ? m[2] : MONTHS[m[5].slice(0, 3).toLowerCase()];
    const iso = month ? (m[1] ? isoDate(m[1], month, m[3]) : isoDate(m[4], month, m[6])) : undefined;
    if (iso) return iso;
  }
  return undefined;
}
/** The date a "Last Date" label gives ("Last Date : 13/11/2026", "Last Date Extended to 20/11/2026"); none for "Last Date : District Wise". */
export function labelledLastDate(text: string): string | undefined {
  const m = /\blast\s+date\b(.{0,40})/i.exec(text);
  if (!m) return undefined;
  // The date must come straight after the label, not after other words ("Last Date : District Wise, posted 05/11/2026").
  if (!/^[\s:\-–|]*(?:(?:is|extended|extend|revised|now)\b[\s:\-–]*)*(?:(?:to|till|upto|up to)\b[\s:\-–]*)?\d/i.test(m[1])) return undefined;
  return firstDate(m[1]);
}
/** Today's date in India. */
export const todayInIndia = (now = Date.now()) => new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);

// ── Organisations ──
// Common bodies the registry has no entry for, recognised by their own unmistakable names, only to show the
// admin a name: no ID is made up, so nothing is matched by them. Ambiguous acronyms (CWC, NTPC, HCL) are left out.
const COMMON_BODIES: Array<[RegExp, string]> = [
  [/\blic\s+(?:hfl|housing\s+finance)\b/i, "LIC Housing Finance Limited"],
  [/\bindian\s+bank\b/i, "Indian Bank"],
  [/\bsupreme\s+court\b/i, "Supreme Court of India"],
  [/\bongc\b/i, "Oil and Natural Gas Corporation"],
  [/\bisro\b/i, "Indian Space Research Organisation"],
  [/\bbhel\b/i, "Bharat Heavy Electricals Limited"],
  [/\bupsssc\b/i, "Uttar Pradesh Subordinate Services Selection Commission"],
  [/\buppsc\b/i, "Uttar Pradesh Public Service Commission"],
  [/\bupessc\b/i, "Uttar Pradesh Education Service Selection Commission"],
  [/\bdsssb\b/i, "Delhi Subordinate Services Selection Board"],
  [/\bhindustan\s+copper\b/i, "Hindustan Copper Limited"],
  [/\bbhu\b|\bbanaras\s+hindu\s+university\b/i, "Banaras Hindu University"],
  [/\bpgcil\b|\bpower\s+grid\s+corporation\b/i, "Power Grid Corporation of India"],
  [/\brites\b/i, "RITES Limited"],
  [/\bnpcil\b/i, "Nuclear Power Corporation of India"],
  [/\bnicl\b|\bnational\s+insurance\s+company\b/i, "National Insurance Company Limited"],
  [/\buiic\b|\bunited\s+india\s+insurance\b/i, "United India Insurance Company Limited"],
  [/\bniacl\b|\bnew\s+india\s+assurance\b/i, "The New India Assurance Co. Ltd."],
  [/\bafms\b/i, "Armed Forces Medical Services"],
  [/\biffco\b/i, "Indian Farmers Fertiliser Cooperative (IFFCO)"],
  [/\bbceceb?\b/i, "BCECE Board, Bihar"],
  [/\bmpesb\b/i, "MP Employee Selection Board"],
  [/\brsmssb\b/i, "Rajasthan Staff Selection Board"],
  [/\bbtsc\b/i, "Bihar Technical Service Commission"],
  [/\baiims\b/i, "All India Institute of Medical Sciences"],
];
export const commonBodyIn = (title: string) => COMMON_BODIES.find(([re]) => re.test(title))?.[1];

const titleWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/s$/, "")));
/**
 * The CMS organisation a title names, so a lead carries the CMS's own ID ("LIC HFL …" is lic-hfl-apprentice, not
 * LIC): every word of the organisation's ID, its ID run together, every distinctive word of its name when that is at
 * least two words, one of its own acronyms written in capitals ("MPESB" for Madhya Pradesh Employees Selection
 * Board), or a verified alias ("NWR RRC"). The most specific wins. When two bodies fit equally, neither is chosen:
 * the lead is left unrecognised and the bodies are named as possibilities.
 */
export function cmsOrganisationIn(title: string, jobs: Array<{ organizationId: string; organizationName?: string | null }>): { id: string; name: string | null } | { ambiguous: string[] } | null {
  const lead = title.slice(0, 150);
  const words = titleWords(lead);
  const acronyms = titleAcronyms(lead);
  const orgs = new Map<string, string | null>();
  for (const j of jobs) if (j.organizationId && !orgs.has(j.organizationId)) orgs.set(j.organizationId, j.organizationName ?? null);
  const scored: Array<{ id: string; name: string | null; score: number }> = [];
  for (const [id, name] of orgs) {
    const idTokens = id.toLowerCase().split("-").filter((w) => w.length > 1).map((w) => w.replace(/s$/, ""));
    const ofId = bodyWords(id);
    let score = 0;
    if (idTokens.length && ofId.words.size && idTokens.every((w) => words.has(w))) score = idTokens.length;
    if (ofId.joined && words.has(ofId.joined)) score = Math.max(score, 2);
    const nameWords = [...bodyWords(null, name).words];
    if (nameWords.length >= 2 && nameWords.every((w) => words.has(w))) score = Math.max(score, nameWords.length);
    if ([...bodyAcronyms(name)].some((a) => acronyms.has(a))) score = Math.max(score, 2);
    if (name && VERIFIED_ALIASES.some((a) => a.title.test(lead) && a.body.test(name.trim()))) score = Math.max(score, 3);
    if (score) scored.push({ id, name, score });
  }
  if (!scored.length) return null;
  const top = Math.max(...scored.map((c) => c.score));
  const best = scored.filter((c) => c.score === top);
  return best.length === 1 ? { id: best[0].id, name: best[0].name } : { ambiguous: best.map((c) => c.name ?? c.id) };
}

export async function discoverFromPage(opts: {
  url: string;
  /** The CMS's jobs; organisation, notice number and year make the match as good as the collector's. */
  jobs: Array<{ id: string; title: string } & Partial<CmsJob>>;
  fetchSourceFn?: (url: string) => Promise<FetchedSource>;
  /** Today's date (YYYY-MM-DD) for whether a last date has passed; India's date by default. */
  today?: string;
}): Promise<DiscoverOutcome> {
  const today = opts.today ?? todayInIndia();
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
  const jobs: CmsJob[] = opts.jobs.map((j) => ({ organizationId: "", organizationName: null, notificationNumber: null, year: null, ...j }));
  for (const link of extractLinks(got.bytes.toString("utf8"), got.finalUrl)) {
    if (found.length >= MAX_FOUND) break;
    let href: URL;
    try { href = new URL(link.href); } catch { continue; }
    if (href.protocol !== "https:" && href.protocol !== "http:") continue;
    href.hash = "";
    const key = href.toString();
    if (seen.has(key) || key === got.finalUrl) continue;
    // The collector's own rules (Stage 1): menus, courses and links with no recruitment or update wording are not leads.
    const verdict = classifyLink(link.text, link.href);
    if ("skip" in verdict) continue;
    seen.add(key);
    const title = verdict.title;
    const host = hostOf(key);
    // The organisation from the title only (the leading part, not a table row's cells): the CMS's own
    // organisations first, so a lead carries the ID its jobs use; then the registry, as the collector reads it.
    const lead = title.slice(0, 150);
    const found0 = cmsOrganisationIn(lead, jobs);
    const cmsOrg = found0 && "id" in found0 ? found0 : null;
    const unclear = found0 && "ambiguous" in found0 ? found0.ambiguous : null;
    const common = cmsOrg || unclear ? undefined : commonBodyIn(lead);
    // Two CMS bodies fit equally: none is chosen, and nothing else is guessed in its place.
    const orgId = cmsOrg?.id ?? (common || unclear ? null : detectOrgFromText(lead) ?? null);
    const orgName = cmsOrg ? (cmsOrg.name ?? ORG_NAMES[cmsOrg.id] ?? cmsOrg.id.toUpperCase()) : orgId ? ORG_NAMES[orgId] ?? orgId.toUpperCase() : common ?? null;
    const notice = extractNotificationNumber(title) ?? null;
    const match = matchLead({ organizationId: orgId, organizationName: orgId ? orgName : null, title, notificationNumber: notice, namedBody: common ?? unclear?.join(" / ") ?? null }, jobs);
    // Dates from this row only: the link's text, then what follows it before the next link.
    const row = `${link.text} ${link.after ?? ""}`;
    const lastDate = labelledLastDate(row);
    const date = lastDate ?? firstDate(row);
    found.push({
      title: title.slice(0, 200), url: key, kind: verdict.kind,
      ...(date ? { date } : {}),
      ...(lastDate ? { lastDate } : {}),
      applications: lastDate ? (lastDate < today ? "LAST_DATE_PASSED" : "OPEN") : "UNKNOWN",
      official: officialHost(host) && linkFlags(key, key).length === 0,
      ...(isEligibilityExam(title) ? { eligibilityExam: true as const } : {}),
      ...(orgId ? { organizationId: orgId } : {}),
      ...(orgName ? { organizationName: orgName } : {}),
      ...(unclear ? { organizationUnclear: unclear.slice(0, 3) } : {}),
      ...(notice ? { notificationNumber: notice } : {}),
      match: match.kind,
      matchReason: match.kind === "UNRESOLVED" && common ? `${common} has no job in the CMS yet; no CMS job like it` : match.reason,
      maybe: match.candidates.map((c) => ({ id: c.id, title: c.title, kind: c.kind, reason: c.reason })),
      ...(match.differentNotice?.length ? { differentNotice: match.differentNotice } : {}),
    });
  }
  return { ok: true, page: got.finalUrl, found };
}
