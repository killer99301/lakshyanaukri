// ═══════════════════════════════════════════════════════════
// Is this announcement already there? (CMS usability batch 1, 11 Nov 2026)
// ═══════════════════════════════════════════════════════════
//
// Changing an exam stage on a job that has been public writes its own
// announcement ("Preliminary Examination: admit card released", see
// stage-updates.ts). An admin who then adds "Prelims admit card released" by
// hand puts the same news on the page twice. This finds entries already in the
// job that are probably the same news, so the form can ask before adding.
// It only warns: nothing is merged or removed, and the admin may go ahead.
//
// Pure.

import type { UpdateRecord } from "@/types";

/** The kinds of news an announcement can carry, each with the words that say it. */
const EVENTS: Array<[string, RegExp]> = [
  ["admit card", /admit[\s-]*card|call[\s-]*letter|hall[\s-]*ticket|e-?admit/i],
  ["result", /\bresults?\b|merit[\s-]*list|selection[\s-]*list|score[\s-]*card/i],
  ["answer key", /answer[\s-]*key|response[\s-]*sheet/i],
  ["cut-off", /cut[\s-]*off/i],
  ["postponed", /postpone|deferred/i],
  ["rescheduled", /reschedul|revised\s+(exam\s+)?date|new\s+date|date\s+changed/i],
  ["deadline extended", /extend|extension|last\s+date/i],
  ["cancelled", /cancel/i],
  ["exam date", /date\s+announced|exam\s+(date|schedule)|will\s+be\s+held|to\s+be\s+held|\bheld\b|scheduled/i],
  ["corrigendum", /corrigendum|addendum|amendment/i],
  ["vacancies", /vacanc|posts?\s+(increased|reduced|revised)/i],
];

const STOP = new Set(["the", "of", "for", "and", "a", "an", "to", "on", "in", "is", "has", "been", "by", "at", "from", "with", "exam", "examination", "recruitment", "notice", "update", "released", "out", "now", "available", "date", "dates"]);

/** What news a text carries. */
export function eventsOf(text: string): string[] {
  return EVENTS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Number.isNaN(ta) || Number.isNaN(tb) ? Infinity : Math.abs(ta - tb) / 86_400_000;
}

export interface DuplicateHit { entry: UpdateRecord; why: string }

/**
 * Entries in the job that are probably the same news as the one being added:
 * dated within `windowDays` of it, and either telling the same kind of news
 * (admit card, result, postponement…) or sharing most of their title words.
 */
export function likelyDuplicates(
  candidate: { date: string; title: string; description?: string },
  existing: UpdateRecord[],
  windowDays = 10,
): DuplicateHit[] {
  const text = `${candidate.title} ${candidate.description ?? ""}`;
  const mine = eventsOf(text);
  const myWords = words(candidate.title);
  const hits: DuplicateHit[] = [];
  for (const entry of existing) {
    // A superseded announcement is no longer current news: a new one replacing it is not a repeat.
    if (entry.superseded) continue;
    if (candidate.date && daysBetween(candidate.date, entry.date) > windowDays) continue;
    const theirs = eventsOf(`${entry.title} ${entry.description ?? ""}`);
    const shared = mine.filter((e) => theirs.includes(e));
    if (shared.length > 0) {
      hits.push({ entry, why: `both are about: ${shared.join(", ")}` });
      continue;
    }
    const theirWords = words(entry.title);
    const common = [...myWords].filter((w) => theirWords.has(w)).length;
    const union = new Set([...myWords, ...theirWords]).size;
    if (union > 0 && common / union >= 0.5) hits.push({ entry, why: "the titles are nearly the same" });
  }
  return hits;
}
