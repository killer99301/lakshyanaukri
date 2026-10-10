// ═══════════════════════════════════════════════════════════
// "Check for updates": what has changed on a job since it was entered
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe. The AI is asked what is new for one recruitment,
// either from a page the admin points it at or from a web search. Whatever it
// answers is treated as untrusted: this module keeps only changes it can
// express exactly (a date, a stage's state, a link), throws away anything
// malformed or already on the record, and labels each survivor by where it
// came from.
//
// Nothing here changes a record. The admin ticks the proposals to accept;
// savesFor() then turns the ticked ones into ordinary field saves, which go
// through the normal save route as Pending.

import type { RecruitmentRecord, CmsRecruitmentLink, RecruitmentLinkType } from "@/types/recruitment-record";
import type { DateCertainty, ExamStage, ExamStageStatus } from "@/types";
import { formatDate } from "@/lib/utils";

// ─── What can be proposed ─────────────────────────────────

export const UPDATE_DATE_FIELDS = {
  applicationOpenDate: "Application opens",
  applicationCloseDate: "Last date to apply",
  feePaymentCloseDate: "Fee payment deadline",
  correctionWindowEnd: "Correction window ends",
  admitCardDate: "Admit card release",
  resultDate: "Result date",
} as const;
export type UpdateDateField = keyof typeof UPDATE_DATE_FIELDS;

const STAGE_STATUSES: ExamStageStatus[] = ["NOT_DECLARED", "SCHEDULED", "ADMIT_CARD_OUT", "POSTPONED", "CONDUCTED", "RESULT_DECLARED"];
const DATED_CERTAINTIES: DateCertainty[] = ["CONFIRMED", "TENTATIVE"];
const STATUS_TEXT: Record<ExamStageStatus, string> = {
  NOT_DECLARED: "not declared", SCHEDULED: "scheduled", ADMIT_CARD_OUT: "admit card out",
  POSTPONED: "postponed", CONDUCTED: "held", RESULT_DECLARED: "result declared",
};

export const UPDATE_LINK_TYPES = {
  ADMIT_CARD: "Admit card",
  RESULT: "Result",
  ANSWER_KEY: "Answer key",
  CUT_OFF: "Cut-off",
  EXAM_NOTICE: "Exam notice",
  CORRIGENDUM: "Corrigendum",
} as const;
export type UpdateLinkType = keyof typeof UPDATE_LINK_TYPES;

export interface UpdateProposal {
  id: string;
  kind: "DATE" | "STAGE" | "LINK";
  label: string;
  oldText: string;
  newText: string;
  /** The words from the source that the AI gave as its basis. */
  evidence: string;
  sourceHost: string | null;
  /** The source is one of this job's official sites, or a government domain. */
  official: boolean;
  /** The source was actually read: the page given, or a page the search opened. */
  confirmed: boolean;
  date?: { field: UpdateDateField; value: string };
  stage?: { name: string; isNew: boolean; status?: ExamStageStatus; dateIso?: string; certainty?: DateCertainty };
  link?: { type: UpdateLinkType; url: string; label: string };
}

export const MAX_PROPOSALS = 12;

// ─── Sources ──────────────────────────────────────────────

/** "https://www.IBPS.in/x" or "ibps.in" → "ibps.in". */
export function hostOf(text: string | null | undefined): string | null {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const sameSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);
const GOVERNMENT = /(^|\.)(gov\.in|nic\.in|gov)$/;

/** The job's own official sites: every host it has a link marked official for. */
export function officialHosts(record: RecruitmentRecord): string[] {
  return [...new Set(record.links.filter((l) => l.official).map((l) => hostOf(l.url)).filter((h): h is string => Boolean(h)))];
}

export function isOfficialHost(host: string | null, record: RecruitmentRecord): boolean {
  if (!host) return false;
  return GOVERNMENT.test(host) || officialHosts(record).some((site) => sameSite(host, site) || sameSite(site, host));
}

// ─── The question put to the AI ───────────────────────────

const show = (iso: string | null | undefined) => (iso ? `${iso}` : "not set");

/** What the record says today, as plain lines the AI compares against. */
export function describeForCheck(record: RecruitmentRecord): string {
  const lines: string[] = [
    `Recruitment: ${record.identity.title.value}`,
    `Organisation: ${record.identity.organizationName}`,
    `Notification number: ${record.identity.notificationNumber?.value ?? "not set"}`,
    `Year: ${record.identity.recruitmentYear}`,
    "",
    "Dates on record:",
    ...(Object.keys(UPDATE_DATE_FIELDS) as UpdateDateField[]).map((f) => `- ${f}: ${show(record.dates[f]?.value)}`),
    "",
    "Stages on record:",
  ];
  const stages = [...(record.examStages ?? [])].sort((a, b) => a.order - b.order);
  if (stages.length === 0) lines.push("- none entered");
  for (const s of stages) {
    lines.push(`- ${s.name}: status ${s.status}, date ${s.dateIso ?? s.dateDisplay ?? "not set"}${s.certainty ? `, ${s.certainty}` : ""}`);
  }
  lines.push("", "Links on record:");
  if (record.links.length === 0) lines.push("- none");
  for (const l of record.links) lines.push(`- ${l.type}: ${l.url}`);
  return lines.join("\n");
}

export function buildUpdatePrompt(record: RecruitmentRecord, todayIso: string, source: { url: string; text: string } | null): string {
  const where = source
    ? `Use ONLY the page text given below (from ${source.url}). Do not use anything you remember.`
    : `Search the web. Prefer the recruiting body's own website (${officialHosts(record).join(", ") || "its official site"}) and government domains over news, coaching and job-portal sites.`;
  return [
    "You are checking one Indian government recruitment for changes since it was last recorded.",
    `Today is ${todayIso}.`,
    "",
    describeForCheck(record),
    "",
    where,
    "",
    "Report only what is NEW or DIFFERENT from the record above: a date announced, changed or extended; an exam stage scheduled, postponed, held, or its admit card or result released; a new official link (admit card, result, answer key, cut-off, exam notice, corrigendum).",
    "Do not repeat anything the record already says. Do not guess: if a date is not stated, leave it out. If nothing is new, return an empty list.",
    "",
    "Answer with JSON only, in exactly this shape:",
    '{"summary": "one sentence", "changes": [',
    '  {"type": "date", "field": "<one of: ' + Object.keys(UPDATE_DATE_FIELDS).join(", ") + '>", "value": "YYYY-MM-DD", "evidence": "the words that say so", "source": "domain or URL where it is stated"},',
    '  {"type": "stage", "stage": "stage name as on the record, or the new stage’s name", "status": "<one of: ' + STAGE_STATUSES.join(", ") + '>", "date": "YYYY-MM-DD or empty", "certainty": "<CONFIRMED if the date is stated as final, TENTATIVE if it may change, or empty>", "evidence": "…", "source": "…"},',
    '  {"type": "link", "linkType": "<one of: ' + Object.keys(UPDATE_LINK_TYPES).join(", ") + '>", "url": "https://…", "label": "short label", "evidence": "…", "source": "…"}',
    "]}",
    ...(source ? ["", "PAGE TEXT:", source.text] : []),
  ].join("\n");
}

/**
 * A web page as plain reading text. Scripts, styles and tags go; each link
 * keeps its address in brackets after its words, because a link the AI
 * proposes is only trusted when its address is on the page.
 */
export function pageTextForCheck(html: string, pageUrl: string, limit: number): string {
  const absolute = (href: string) => {
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      return href;
    }
  };
  const plain = html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, words: string) =>
      /^(javascript|mailto|tel):/i.test(href) ? ` ${words} ` : ` ${words} [${absolute(href)}] `)
    .replace(/<\/(p|div|li|tr|h[1-6]|table|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return plain.slice(0, limit);
}

/** The JSON object in an answer that may have prose or a code fence around it. */
export function jsonFromAnswer(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── Reading the answer ───────────────────────────────────

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDate(value: unknown, year: number): string | null {
  if (typeof value !== "string") return null;
  const m = ISO.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  // A recruitment's dates fall in or around its own year; anything else is a misread.
  return Number(m[1]) >= year - 1 && Number(m[1]) <= year + 3 ? value.trim() : null;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === "string" && (allowed as readonly string[]).includes(v.trim().toUpperCase()) ? (v.trim().toUpperCase() as T) : undefined;

export interface CheckContext {
  /** Hosts of pages the web search actually opened. */
  groundedHosts?: string[];
  /** The page the admin pointed at, when there was one. */
  source?: { url: string; text: string };
}

function supported(evidence: string, sourceHost: string | null, ctx: CheckContext, mustContain?: string): boolean {
  if (ctx.source) {
    const page = squash(ctx.source.text);
    if (mustContain) return ctx.source.text.includes(mustContain);
    const words = squash(evidence);
    return words.length >= 12 && page.includes(words.slice(0, 60));
  }
  return Boolean(sourceHost) && (ctx.groundedHosts ?? []).some((h) => sameSite(sourceHost!, h) || sameSite(h, sourceHost!));
}

export function readProposals(raw: unknown, record: RecruitmentRecord, ctx: CheckContext = {}): { proposals: UpdateProposal[]; summary: string; dropped: number } {
  const body = (raw && typeof raw === "object" ? raw : {}) as { summary?: unknown; changes?: unknown };
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const year = record.identity.recruitmentYear;
  const pageHost = ctx.source ? hostOf(ctx.source.url) : null;
  const proposals: UpdateProposal[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const item of changes) {
    if (proposals.length >= MAX_PROPOSALS) break;
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const evidence = text(c.evidence, 300);
    // With a page given, that page is the source whatever the AI says.
    const sourceHost = pageHost ?? hostOf(text(c.source, 300));
    const official = isOfficialHost(sourceHost, record);
    const base = { evidence, sourceHost, official };
    const type = text(c.type, 20).toLowerCase();
    let proposal: UpdateProposal | null = null;

    if (type === "date") {
      const field = Object.keys(UPDATE_DATE_FIELDS).find((f) => f === text(c.field, 40)) as UpdateDateField | undefined;
      const value = realDate(c.value, year);
      const current = field ? record.dates[field]?.value ?? null : null;
      if (field && value && value !== current) {
        proposal = {
          ...base, id: `date:${field}`, kind: "DATE", label: UPDATE_DATE_FIELDS[field],
          oldText: current ? formatDate(current) : "not set", newText: formatDate(value),
          confirmed: supported(evidence, sourceHost, ctx), date: { field, value },
        };
      }
    } else if (type === "stage") {
      const name = text(c.stage, 80);
      const status = oneOf(c.status, STAGE_STATUSES);
      const dateIso = realDate(c.date, year) ?? undefined;
      // A dated stage is either confirmed or tentative; anything else the AI says is ignored.
      const certainty = oneOf(c.certainty, DATED_CERTAINTIES);
      const existing = (record.examStages ?? []).find((s) => squash(s.name) === squash(name));
      // The site does not accept a stage that is "scheduled" with no date at all.
      const undatedSchedule = (status ?? existing?.status) === "SCHEDULED" && !dateIso && !existing?.dateIso && !existing?.dateDisplay;
      const changed = existing
        ? (status !== undefined && status !== existing.status) || (dateIso !== undefined && dateIso !== existing.dateIso) || (certainty !== undefined && dateIso !== undefined && certainty !== existing.certainty)
        : status !== undefined || dateIso !== undefined;
      if (name && changed && !undatedSchedule) {
        const describe = (s: { status?: ExamStageStatus; dateIso?: string; dateDisplay?: string; certainty?: DateCertainty }) =>
          [s.status ? STATUS_TEXT[s.status] : "", s.dateIso ? formatDate(s.dateIso) : s.dateDisplay ?? "", s.certainty === "TENTATIVE" ? "tentative" : ""].filter(Boolean).join(", ") || "no details";
        proposal = {
          ...base, id: `stage:${squash(name)}`, kind: "STAGE", label: existing ? existing.name : `${name} (new stage)`,
          oldText: existing ? describe(existing) : "not on record",
          newText: describe({ status: status ?? existing?.status, dateIso: dateIso ?? existing?.dateIso, dateDisplay: dateIso ? undefined : existing?.dateDisplay, certainty: dateIso ? certainty : existing?.certainty }),
          confirmed: supported(evidence, sourceHost, ctx),
          stage: { name: existing?.name ?? name, isNew: !existing, ...(status ? { status } : {}), ...(dateIso ? { dateIso } : {}), ...(dateIso && certainty ? { certainty } : {}) },
        };
      }
    } else if (type === "link") {
      const linkType = oneOf(c.linkType, Object.keys(UPDATE_LINK_TYPES) as UpdateLinkType[]);
      const url = text(c.url, 500);
      const linkHost = hostOf(url);
      const valid = /^https?:\/\//i.test(url) && Boolean(linkHost);
      const already = record.links.some((l) => l.url.replace(/\/$/, "") === url.replace(/\/$/, ""));
      if (linkType && valid && !already) {
        proposal = {
          ...base, id: `link:${url}`, kind: "LINK", label: `${UPDATE_LINK_TYPES[linkType]} link`,
          oldText: record.links.some((l) => l.type === linkType) ? "another link of this kind is on record" : "none",
          newText: url,
          // What matters for a link is where it points, not who mentioned it.
          sourceHost: linkHost, official: isOfficialHost(linkHost, record),
          // An address the AI wrote out is only trusted when it is on the page that was read.
          confirmed: ctx.source ? supported(evidence, linkHost, ctx, url) : false,
          link: { type: linkType, url, label: text(c.label, 120) || UPDATE_LINK_TYPES[linkType] },
        };
      }
    }

    if (!proposal || seen.has(proposal.id)) { dropped++; continue; }
    seen.add(proposal.id);
    proposals.push(proposal);
  }
  return { proposals, summary: text(body.summary, 300), dropped };
}

/** Ticked by default only when the source is official and was actually read. */
export const tickedByDefault = (p: UpdateProposal) => p.official && p.confirmed;

// ─── Turning accepted proposals into saves ────────────────

export interface FieldSave { fieldPath: string; value: unknown; reason: string }

/**
 * The field saves for the accepted proposals, in the order to apply them:
 * each date by itself, then the stages as one list, then the links as one list.
 */
export function savesFor(record: RecruitmentRecord, accepted: UpdateProposal[]): FieldSave[] {
  const saves: FieldSave[] = [];
  const from = (p: UpdateProposal) => (p.sourceHost ? ` (source: ${p.sourceHost})` : "");

  for (const p of accepted) {
    if (p.kind === "DATE" && p.date) {
      saves.push({ fieldPath: `dates.${p.date.field}`, value: p.date.value, reason: `Check for updates: ${p.label} ${p.oldText} → ${p.newText}${from(p)}` });
    }
  }

  const stageChanges = accepted.filter((p) => p.kind === "STAGE" && p.stage);
  if (stageChanges.length > 0) {
    const stages: ExamStage[] = [...(record.examStages ?? [])].sort((a, b) => a.order - b.order).map((s) => ({ ...s }));
    for (const p of stageChanges) {
      const change = p.stage!;
      let stage = stages.find((s) => s.name === change.name);
      if (!stage) {
        stage = { name: change.name, order: stages.reduce((n, s) => Math.max(n, s.order), 0) + 1, status: change.status ?? "NOT_DECLARED" };
        stages.push(stage);
      }
      if (change.status) stage.status = change.status;
      if (change.dateIso) {
        stage.dateIso = change.dateIso;
        // A range or month typed earlier no longer describes the stage.
        delete stage.dateDisplay;
        // Unless the source says the date is confirmed, it goes in as tentative.
        stage.certainty = change.certainty ?? "TENTATIVE";
      }
    }
    saves.push({ fieldPath: "examStages", value: stages, reason: `Check for updates: ${stageChanges.map((p) => `${p.label} → ${p.newText}`).join("; ")}`.slice(0, 480) });
  }

  const newLinks = accepted.filter((p) => p.kind === "LINK" && p.link);
  if (newLinks.length > 0) {
    const links: CmsRecruitmentLink[] = [
      ...record.links,
      ...newLinks.map((p) => ({ type: p.link!.type as RecruitmentLinkType, label: p.link!.label, url: p.link!.url, official: p.official })),
    ];
    saves.push({ fieldPath: "links", value: links, reason: `Check for updates: added ${newLinks.map((p) => p.label.toLowerCase()).join(", ")}`.slice(0, 480) });
  }
  return saves;
}
