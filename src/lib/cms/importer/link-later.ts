// ═══════════════════════════════════════════════════════════
// Importer: "the application link will be released later" (ADMIN_NOT_YET_OPEN)
// ═══════════════════════════════════════════════════════════
//
// Pure. The rules a "link not released yet" decision must pass before it is
// recorded (docs/apply-link-not-yet-open-design.md, revision 3, §2), the
// public wording (§4) and the Updates Needed reminder (§5).
//
// The server checks here only FILTER out wrong uses: a schedule of dates, an
// "apply online from …", words that give the application address. Passing
// them never proves the notice's meaning: the reviewer's own statement is
// always required as well (D4).
//
// Two dates are kept apart and never copied into each other:
//   linkReleaseOn       the date the notice gives for the LINK's release;
//   applicationsOpenOn  the date the notice gives for APPLICATIONS opening.

export const LINK_LATER_FIELD = "links#APPLY_ONLINE";
export const REVIEWER_STATEMENT =
  "The official notice says the online application link itself is not available yet — not only that applications open later.";

export interface LinkLaterValue {
  linkNotReleased: true;
  reviewerConfirmed: true;
  linkReleaseOn: string | null;
  applicationsOpenOn: string | null;
  where: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};

/** Every date in the text, with where it starts: 01.12.2026, 01/12/2026, 01-12-2026, 2026-12-01, 1 December 2026, 1st Dec, 2026, December 1, 2026. */
export function datesIn(text: string): Array<{ iso: string; at: number }> {
  const out: Array<{ iso: string; at: number }> = [];
  const push = (v: string | null, at: number) => { if (v) out.push({ iso: v, at }); };
  for (const m of text.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) push(iso(+m[3], +m[2], +m[1]), m.index!);
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(iso(+m[1], +m[2], +m[3]), m.index!);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, "gi"))) push(iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), m.index!);
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"))) push(iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), m.index!);
  return out.sort((a, b) => a.at - b.at);
}

// Words naming the link or the online facility itself, and words naming applications or registration.
const LINK_WORD = /\b(?:link|weblink|web-link|portal|website|web\s?site|facility|module)\b/gi;
const APPLY_WORD = /\b(?:applications?|registrations?|apply|applying)\b/gi;
// The link or facility being made available later: a link word, then (within the same clause) a future verb.
const FUTURE_LINK = new RegExp(
  "\\b(?:link|weblink|web-link|portal|website|web\\s?site|facility|module)\\b[^;\\n]{0,80}?" +
  "(?:\\b(?:will|shall|would|is\\s+to|are\\s+to)\\s+(?:be\\s+)?(?:activated|made\\s+available|available|released|hosted|enabled|live|opened|uploaded|provided|go\\s+live|open|start)\\b" +
  "|\\b(?:to\\s+be|being)\\s+(?:activated|made\\s+available|released|hosted|enabled|opened|uploaded|provided)\\b" +
  "|\\b(?:opens|active)\\s+(?:on|from)\\b)", "i");
const LINK_NOUN = /\b(?:activation|release|opening)\s+of\s+(?:the\s+)?(?:online\s+)?(?:(?:application|registration)\s+)*(?:link|weblink|portal|module|facility)\b/i;

/** The clauses of a quote: split at ";", line ends and sentence ends (a full stop after a letter, then a capital). */
function clauses(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let start = 0;
  const re = /;|\n|(?<=[A-Za-z)\]])\.\s+(?=[A-Z])/g;
  for (const m of text.matchAll(re)) {
    out.push({ text: text.slice(start, m.index), start });
    start = m.index! + m[0].length;
  }
  out.push({ text: text.slice(start), start });
  return out;
}

/** Whether the words describe the application link (or online facility) being released later. */
export function describesFutureLink(quote: string): boolean {
  return clauses(quote).some((c) => FUTURE_LINK.test(c.text) || LINK_NOUN.test(c.text));
}

/**
 * Which event each date in the words belongs to: the nearest naming word before it in the same clause (after it,
 * when none is before). "LINK" for a link or facility word, "APPLY" for applications or registration, null when
 * the clause names neither.
 */
export function dateRoles(quote: string): Array<{ iso: string; role: "LINK" | "APPLY" | null }> {
  const dates = datesIn(quote);
  return dates.map((d) => {
    const clause = clauses(quote).filter((c) => c.start <= d.at).pop()!;
    const rel = d.at - clause.start;
    // After a "link … will be activated" phrase, a date belongs to the link unless applications or registration
    // are named between the phrase and the date ("the link for online registration will be activated from 01.12.2099").
    for (const re of [FUTURE_LINK, LINK_NOUN]) {
      const m = re.exec(clause.text);
      if (m && m.index + m[0].length <= rel) {
        const between = clause.text.slice(m.index + m[0].length, rel);
        if (!new RegExp(APPLY_WORD.source, "i").test(between)) return { iso: d.iso, role: "LINK" as const };
      }
    }
    const words = [
      ...[...clause.text.matchAll(LINK_WORD)].map((m) => ({ at: m.index!, role: "LINK" as const })),
      ...[...clause.text.matchAll(APPLY_WORD)].map((m) => ({ at: m.index!, role: "APPLY" as const })),
    ];
    const before = words.filter((w) => w.at < rel).sort((a, b) => b.at - a.at)[0];
    const after = words.filter((w) => w.at > rel).sort((a, b) => a.at - b.at)[0];
    return { iso: d.iso, role: (before ?? after)?.role ?? null };
  });
}

/** An application address with a path (the link exists): "https://ibps.in/crp-xv/" or "www.ibps.in/register". A bare site is not one. */
export function applicationAddressIn(quote: string): string | null {
  for (const m of quote.matchAll(/(?:https?:\/\/|www\.)[^\s"'<>()]+/gi)) {
    const raw = m[0].replace(/[.,;:]+$/, "");
    const rest = raw.replace(/^https?:\/\//i, "");
    const slash = rest.indexOf("/");
    if (slash >= 0 && rest.slice(slash).replace(/\/+$/, "").length > 0) return raw;
  }
  return null;
}

const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const bareHost = (s: string) => s.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export interface LinkLaterInput {
  quote: string;
  linkReleaseOn: string | null;
  applicationsOpenOn: string | null;
  where: string | null;
  reviewerConfirmed: boolean;
  /** The job's own "Applications open" date when it is verified against the same notice. */
  verifiedOpenDate?: string | null;
}

/** The decision's rules (§2.1–2.3). The page check and the document's standing are the caller's (service.decide). */
export function checkLinkLater(input: LinkLaterInput): { ok: true; value: LinkLaterValue } | { ok: false; error: string } {
  const no = (error: string) => ({ ok: false as const, error });
  const quote = input.quote ?? "";
  if (!input.reviewerConfirmed) return no("Confirm the statement: the official notice says the application link itself is not available yet.");
  const address = applicationAddressIn(quote);
  if (address) return no(`The notice gives the application address (${address}): add it as the Apply Online link and verify it.`);
  if (!describesFutureLink(quote)) {
    return no("These words do not say the application link will be released later. If they give only dates, or say applications open later, "
      + "they are not enough: if the notice gives the application address, add it as the Apply Online link and verify it; otherwise the job stays blocked until the link is out.");
  }
  const isIso = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isIso(input.linkReleaseOn) || !isIso(input.applicationsOpenOn)) return no("Give the dates as dates.");
  const where = input.where?.trim() ? bareHost(input.where) : null;
  if (where && (/\s/.test(where) || where.includes("/") || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(where))) return no("Give the place as the site's name only, for example www.ibps.in.");
  if (!input.linkReleaseOn && !where) return no("Give the date the notice gives for the link's release, or the site it names, or both.");
  if (where && !squash(quote).includes(squash(where))) return no(`“${where}” is not in the quoted words.`);
  const roles = dateRoles(quote);
  if (input.linkReleaseOn) {
    const found = roles.filter((r) => r.iso === input.linkReleaseOn);
    if (found.length === 0) return no("The link's release date is not in the quoted words.");
    if (!found.some((r) => r.role === "LINK")) return no("In these words that date is given for applications or registration, not for the link. It is never taken as the link's release date.");
  }
  if (input.applicationsOpenOn) {
    const found = roles.filter((r) => r.iso === input.applicationsOpenOn);
    const supported = found.some((r) => r.role === "APPLY") || (input.verifiedOpenDate ?? null) === input.applicationsOpenOn;
    if (!supported) {
      return no(found.length > 0
        ? "In these words that date is given for the link, not for applications opening. It is never taken as the opening date."
        : "The application-opening date is not in the quoted words, and it is not the job's verified “Applications open” date.");
    }
  }
  if (input.linkReleaseOn && input.applicationsOpenOn && input.linkReleaseOn === input.applicationsOpenOn
    && !roles.some((r) => r.iso === input.applicationsOpenOn && r.role === "APPLY")) {
    return no("The same date cannot be both the link's release and the opening of applications unless the notice says so for each.");
  }
  return { ok: true, value: { linkNotReleased: true, reviewerConfirmed: true, linkReleaseOn: input.linkReleaseOn, applicationsOpenOn: input.applicationsOpenOn, where } };
}

/** A stored decision's value, read back defensively. */
export function readLinkLater(v: unknown): LinkLaterValue | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.linkNotReleased !== true) return null;
  const s = (x: unknown) => (typeof x === "string" && x ? x : null);
  return { linkNotReleased: true, reviewerConfirmed: true, linkReleaseOn: s(o.linkReleaseOn), applicationsOpenOn: s(o.applicationsOpenOn), where: s(o.where) };
}

// ─── Public wording (§4.2) ───────────────────────────────────

export interface PublicLinkLater { linkReleaseOn: string | null; applicationsOpenOn: string | null; where: string | null }

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const showDate = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
};

/**
 * The sentences built into the page: true on any day, until the next publish. They say what the official notice
 * announced and what this page provides, never that the link is still unreleased.
 */
export function durableWords(p: PublicLinkLater): string[] {
  const at = p.where ? ` (at ${p.where})` : "";
  const out = ["No direct Apply Online link is provided on this page."];
  if (p.linkReleaseOn) out.push(`The official notice states that the application link was scheduled for release on ${showDate(p.linkReleaseOn)}${at}.`);
  else if (p.where) out.push(`The official notice states that the application link would be released at ${p.where}.`);
  if (p.applicationsOpenOn) out.push(`The official notice gives ${showDate(p.applicationsOpenOn)} as the date applications open.`);
  return out;
}

/** The lines drawn in the browser after loading, from the visitor's own date in India. Never says the official site lacks the link. */
export function dateLines(p: PublicLinkLater, todayIso: string): string[] {
  const out: string[] = [];
  if (p.linkReleaseOn) {
    out.push(todayIso < p.linkReleaseOn
      ? `Link scheduled for release on ${showDate(p.linkReleaseOn)}.`
      : `The scheduled release date (${showDate(p.linkReleaseOn)}) has passed. This page does not have the link yet — look for it on the official website.`);
  }
  if (p.applicationsOpenOn && todayIso < p.applicationsOpenOn) out.push(`Applications open on ${showDate(p.applicationsOpenOn)}.`);
  return out;
}

// ─── Updates Needed (§5) ─────────────────────────────────────

export interface LinkLaterReminderInput {
  /** The latest "link not released" decision ever recorded on the job (in force or not). */
  latest: PublicLinkLater;
  /** The decision is in force on the field's current revision. */
  inForce: boolean;
  /** The field's class now (VERIFIED, SUPPORTED, MISSING …). */
  cls: string;
  /** The job has an Apply Online link now. */
  hasLink: boolean;
  /** The published copy carries an Apply Online link (published while the gate had it verified). */
  publishedHasLink: boolean;
  /** The published copy still shows the scheduled-link wording. */
  publishedShowsLater: boolean;
}

export interface LinkLaterReminder { level: "NOW" | "SOON"; message: string }

/** The urgent date: the link's release date; without one, the applications' opening date. */
export const urgentDate = (p: PublicLinkLater): string | null => p.linkReleaseOn ?? p.applicationsOpenOn;

export function linkLaterReminder(i: LinkLaterReminderInput, todayIso: string): LinkLaterReminder | null {
  if (i.publishedHasLink) return null;
  const due = urgentDate(i.latest);
  const urgent = due !== null && todayIso >= due;
  const level = urgent ? "NOW" as const : "SOON" as const;
  const dates = [
    i.latest.linkReleaseOn ? `link scheduled for release on ${showDate(i.latest.linkReleaseOn)}` : null,
    i.latest.applicationsOpenOn ? `applications open ${showDate(i.latest.applicationsOpenOn)}` : null,
  ].filter(Boolean).join("; ");
  const when = dates ? ` (${dates})` : "";
  if (i.cls === "VERIFIED") return { level, message: `The Apply Online link is verified but the public page does not show it yet. Republish to show the Apply Online button${when}.` };
  if (i.hasLink) return { level, message: `An Apply Online link was added but is not verified. Verify it against the official notice before it can be shown${when}.` };
  if (i.inForce) {
    return urgent
      ? { level: "NOW", message: `The application link was due by ${showDate(due!)}${when} and there is no verified link. Check the official site.` }
      : { level: "SOON", message: `No Apply Online link yet${when}. Add it and verify it when it is out.` };
  }
  if (i.publishedShowsLater) return { level: "NOW", message: "The live page still shows the scheduled-link wording, but no decision supports it now. Verify a link, or record the correct decision." };
  return { level: "SOON", message: "The “link not released yet” decision was withdrawn and there is no Apply Online link. Verify a link or record the correct decision before publishing." };
}
