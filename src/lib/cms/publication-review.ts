// ═══════════════════════════════════════════════════════════
// Owner publication review: what the owner sees and approves
// ═══════════════════════════════════════════════════════════
//
// docs/owner-controlled-publication-design.md, revision 3, §2–§5.
//
// One review per job, built only from the database: what is ready, what is
// missing, each material disagreement, how the sources stand (admin only),
// the links, the warnings, and the hard rules that block whatever the owner
// decides. Its fingerprint (reviewHash) covers all of it plus the job's
// freshness (record revision, latest claim, number of documents) and the
// date, so an approval given on one review never publishes a job that has
// changed since.
//
// assembleReview is pure; buildPublicationReview gathers its input.

import { createHash } from "node:crypto";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { validateRecord } from "@/lib/cms/validation";
import { canonicalJson, valueHash } from "@/lib/cms/importer/evidence-text";
import { originFor, type OriginRole } from "@/lib/cms/importer/trusted-domains";
import { isAggregatorHost } from "@/lib/public-link-labels";
import { CRITICAL_FIELDS, fieldDef } from "@/lib/cms/importer/fields";
import type { FieldClass } from "@/lib/cms/importer/classify";
import { groupByMeaning, leavesOut, type DisagreementKind } from "@/lib/cms/importer/same-meaning";
import { notShownPublicly } from "@/lib/cms/public-parity";
import { feeOverlaps } from "@/lib/cms/importer/fee-table";

// ─── What counts as material (P3) ─────────────────────────────

/** Disagreements on these fields must be edited or acknowledged one by one before publishing. */
export const MATERIAL_FIELDS: string[] = [...new Set([
  ...CRITICAL_FIELDS,
  "vacancies.table", "financial.payScale", "examPattern", "selection", "howToApply", "links#OFFICIAL_WEBSITE",
])];

/** The sections the "ready" group names, when the job holds a value for them. */
const READY_SECTIONS: Array<[string, string]> = [
  ["identity.notificationNumber", "Notification number"], ["dates.applicationOpenDate", "Applications open"],
  ["dates.applicationCloseDate", "Last date"], ["dates.feePaymentCloseDate", "Fee deadline"], ["dates.examDate", "Exam date"],
  ["vacancies.total", "Total vacancies"], ["vacancies.table", "Vacancy table"], ["eligibility", "Eligibility"], ["age", "Age limit"],
  ["financial.feeGeneral", "Fee (General/OBC)"], ["financial.feeSCST", "Fee (SC/ST/PwBD)"], ["financial.payScale", "Pay"],
  ["selection", "Selection"], ["examPattern", "Exam pattern"], ["syllabus", "Syllabus"], ["howToApply", "How to apply"],
  ["examStages", "Exam stages"],
];

// ─── Review shape ─────────────────────────────────────────────

export type ReviewStanding = "VERIFIED" | "DECIDED" | "OFFICIAL_UNCHECKED" | "RESEARCH" | "ENTERED" | "MISSING" | "CONFLICTING";

export interface ReviewConflict {
  fieldPath: string; label: string; values: string[]; part?: "qualification" | "experience" | "both";
  /** SOURCES: the sources disagree. READINGS: one source was read two ways, or itself gives two values. */
  kind?: DisagreementKind;
}
export interface ReviewRule { code: string; message: string; fieldPaths?: string[] }
export interface ReviewWarning { code: string; text: string; recordId?: string }
export interface ReviewLink { state: "NONE" | "RESEARCH" | "ENTERED" | "VERIFIED" | "LINK_LATER" | "NOT_APPLICABLE"; url: string | null; host: string | null; standing: OriginRole | null }

export interface Freshness { recordRevision: string; claimSeq: number; retrievals: number }

export interface PublicationReview {
  recordId: string;
  title: string;
  today: string;
  imported: boolean;
  freshness: Freshness;
  ready: string[];
  missing: Array<{ fieldPath: string; label: string }>;
  conflicts: ReviewConflict[];
  standing: { verified: number; decided: number; officialUnchecked: number; research: number; entered: number; missing: number; officialDocuments: number };
  links: { applyOnline: ReviewLink; notification: ReviewLink; officialSourceLink: boolean; markedOfficial: boolean };
  warnings: ReviewWarning[];
  hardRules: ReviewRule[];
  /**
   * Announcements (history entries) that this publish makes public for the first time. Listed for the owner and
   * covered by the fingerprint, so one added after the review was opened makes that approval stale.
   */
  announcements: ReviewAnnouncement[];
  /** Present only when this publish supersedes or restores announcements already public. */
  supersessions?: ReviewSupersession[];
  reviewHash: string;
}

export interface ReviewAnnouncement { id: string; type: string; date: string; title: string }
/** An announcement already public whose superseded note this publish adds or removes. */
export interface ReviewSupersession { id: string; date: string; title: string; change: "SUPERSEDED" | "RESTORED" }

export interface ReviewInput {
  record: RecruitmentRecord;
  today: string;
  imported: boolean;
  freshness: Freshness;
  /** Each material field's standing (imported jobs: from the claims; others: from the record). */
  standings: Record<string, ReviewStanding>;
  /** The disagreeing values of each conflicting field, short and readable. */
  conflictValues: Record<string, string[]>;
  /** How each disagreeing field disagrees (absent: sources). */
  conflictKinds?: Record<string, DisagreementKind>;
  eligibilityPart?: "qualification" | "experience" | "both";
  /** The decision recorded on the Apply Online link, when there is one: link not released yet, or not applicable (offline). */
  applyDecision?: "LINK_LATER" | "NOT_APPLICABLE";
  officialDocuments: number;
  duplicates: Array<{ id: string; title: string }>;
  filled: string[];
  /** The ids of the history entries already public (in the latest published version); none for a first publish. */
  publishedUpdateIds?: string[];
  /** Of those, the ones already superseded on the public page. */
  publishedSupersededIds?: string[];
}

// ─── Hosts ────────────────────────────────────────────────────

const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};
const isHttp = (url: string) => {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};

/** A job-news site or aggregator: never an Apply Online destination (P2). Shared with the public link labels. */
export { isAggregatorHost };

// ─── The pure review ──────────────────────────────────────────

export function assembleReview(input: ReviewInput): PublicationReview {
  const { record, standings } = input;
  const orgId = record.identity.organizationId;
  const label = (p: string) => fieldDef(p).label;

  const missing = CRITICAL_FIELDS.filter((p) => standings[p] === "MISSING").map((p) => ({ fieldPath: p, label: label(p) }));
  const conflicts: ReviewConflict[] = MATERIAL_FIELDS.filter((p) => standings[p] === "CONFLICTING").map((p) => ({
    fieldPath: p, label: label(p), values: (input.conflictValues[p] ?? []).slice(0, 6), kind: input.conflictKinds?.[p] ?? "SOURCES",
    ...(p === "eligibility" && input.eligibilityPart ? { part: input.eligibilityPart } : {}),
  }));

  const count = (s: ReviewStanding) => MATERIAL_FIELDS.filter((p) => standings[p] === s).length;
  const standing = {
    verified: count("VERIFIED"), decided: count("DECIDED"), officialUnchecked: count("OFFICIAL_UNCHECKED"),
    research: count("RESEARCH"), entered: count("ENTERED"), missing: count("MISSING"), officialDocuments: input.officialDocuments,
  };

  const live = record.links.filter((l) => !l.savedFrom);
  const linkOf = (type: string, path: string): ReviewLink => {
    const l = live.find((x) => x.type === type);
    const s = standings[path];
    if (!l) return { state: type === "APPLY_ONLINE" && s === "DECIDED" && input.applyDecision ? input.applyDecision : "NONE", url: null, host: null, standing: null };
    const host = hostOf(l.url);
    return {
      state: s === "VERIFIED" ? "VERIFIED" : input.imported ? "RESEARCH" : "ENTERED",
      url: l.url, host, standing: host ? originFor(orgId, host).role : null,
    };
  };
  const applyOnline = linkOf("APPLY_ONLINE", "links#APPLY_ONLINE");
  const notification = linkOf("OFFICIAL_NOTIFICATION", "links#OFFICIAL_NOTIFICATION");
  const officialSourceLink = live.some((l) => { const h = hostOf(l.url); return !!h && originFor(orgId, h).role === "AUTHORITY"; });
  const markedOfficial = live.some((l) => l.official);

  // ── Hard rules: they block whatever the owner decides ──
  const hardRules: ReviewRule[] = [];
  const validation = validateRecord(record);
  if (!validation.valid) {
    hardRules.push({ code: "VALIDATION", message: `The record is not valid: ${validation.errors.map((e) => e.message).slice(0, 5).join("; ")}`,
      fieldPaths: [...new Set(validation.errors.map((e) => e.fieldPath))].slice(0, 20) });
  }
  const unresolved = (record.lifecycle?.conflicts ?? []).filter((c) => !c.resolvedAt);
  if (unresolved.length) hardRules.push({ code: "LIFECYCLE_CONFLICT", message: `${unresolved.length} unresolved conflict(s) must be resolved in the editor first` });
  const badLinks = record.links.filter((l) => !isHttp(l.url));
  if (badLinks.length) hardRules.push({ code: "NON_HTTP_LINK", message: "Every link must be an http(s) address", fieldPaths: badLinks.map((l) => `links#${l.type}`) });
  if (applyOnline.url && isAggregatorHost(applyOnline.host)) {
    hardRules.push({ code: "APPLY_AGGREGATOR", message: `The Apply Online link is on a job-news or aggregator site (${applyOnline.host}): it is not where candidates apply. Keep it as "Other", or add the real application address.`, fieldPaths: ["links#APPLY_ONLINE"] });
  }

  // ── Warnings: advice, shown before publishing ──
  const warnings: ReviewWarning[] = [];
  if (input.officialDocuments === 0 && !officialSourceLink) warnings.push({ code: "NO_OFFICIAL_SOURCE", text: "No official source: no document or link from the recruiting body's own site" });
  if (applyOnline.state === "NONE") warnings.push({ code: "NO_APPLY_LINK", text: "No Apply Online link: the page will show no Apply button" });
  if (applyOnline.url && applyOnline.standing !== "AUTHORITY" && applyOnline.standing !== "PARTNER" && !isAggregatorHost(applyOnline.host)) {
    warnings.push({ code: "QUESTIONABLE_APPLY_URL", text: `The Apply Online link's site (${applyOnline.host ?? "unknown"}) is not established for this organisation` });
  }
  if (applyOnline.url && applyOnline.state !== "VERIFIED") warnings.push({ code: "APPLY_NOT_CHECKED", text: "The Apply Online link is not checked against an official document" });
  const close = record.dates.applicationCloseDate?.value;
  if (typeof close === "string" && close.slice(0, 10) < input.today) warnings.push({ code: "PAST_DEADLINE", text: `The last date (${close.slice(0, 10)}) has passed` });
  for (const d of input.duplicates) warnings.push({ code: "POSSIBLE_DUPLICATE", text: `Possible duplicate: ${d.title}`, recordId: d.id });
  if (missing.length) warnings.push({ code: "MISSING_KEY_DETAILS", text: `${missing.length} key detail(s) missing` });
  // R2: stored information the public page cannot show yet (fee table rows, extra Apply portals), said before publishing.
  for (const text of notShownPublicly(record)) warnings.push({ code: "NOT_SHOWN_PUBLICLY", text });
  // U5: fee rows giving the same candidates two fees. The page says "check the notice"; settle it before publishing if you can.
  const overlaps = feeOverlaps(record.financial.feeTable?.value ?? []);
  if (overlaps.length) warnings.push({ code: "FEE_ROWS_OVERLAP", text: `The fee table gives the same candidates more than one fee (${overlaps.join("; ")}). The page asks visitors to check the notice; correct the rows if the notice is clear.` });
  if (standing.research + standing.officialUnchecked + standing.entered > 0) {
    warnings.push({ code: "NOT_CONFIRMED", text: `${standing.research + standing.officialUnchecked + standing.entered} detail(s) not confirmed against an official document` });
  }

  const ready = READY_SECTIONS.filter(([p]) => input.filled.includes(p)).map(([, l]) => l);
  // Announcements not yet public: each goes live with this publish, once.
  const alreadyPublic = new Set(input.publishedUpdateIds ?? []);
  const announcements: ReviewAnnouncement[] = (record.updates ?? [])
    .filter((u) => !alreadyPublic.has(u.id))
    .map((u) => ({ id: u.id, type: u.type, date: u.date, title: u.title }));
  // Announcements already public that this publish marks superseded, or makes current again.
  const publicSuperseded = new Set(input.publishedSupersededIds ?? []);
  const supersessions: ReviewSupersession[] = (record.updates ?? [])
    .filter((u) => alreadyPublic.has(u.id) && Boolean(u.superseded) !== publicSuperseded.has(u.id))
    .map((u) => ({ id: u.id, date: u.date, title: u.title, change: u.superseded ? "SUPERSEDED" as const : "RESTORED" as const }));
  const body = {
    recordId: record.id, title: record.identity.title.value ?? record.slug, today: input.today, imported: input.imported,
    freshness: input.freshness, ready, missing, conflicts, standing,
    links: { applyOnline, notification, officialSourceLink, markedOfficial }, warnings, hardRules, announcements,
    // Only present when there is something to say, so the review of every other job is exactly as before.
    ...(supersessions.length > 0 ? { supersessions } : {}),
  };
  const reviewHash = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return { ...body, reviewHash };
}

// ─── Gathering the input ──────────────────────────────────────

const CLASS_TO_STANDING: Record<FieldClass, ReviewStanding> = {
  VERIFIED: "VERIFIED", NOT_APPLICABLE: "DECIDED", NOT_STATED: "DECIDED", NOT_YET_OPEN: "DECIDED",
  SUPPORTED: "OFFICIAL_UNCHECKED", RESEARCH_ONLY: "RESEARCH", UNSUPPORTED: "RESEARCH", LEGACY: "RESEARCH",
  MISSING: "MISSING", CONFLICTING: "CONFLICTING",
};

// A disagreeing value in words: the stored evidence is left out, an age limit reads as a range.
const short = (v: unknown, max = 140): string => {
  let x = v;
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const { evidence: _e, ...rest } = x as Record<string, unknown>;
    void _e;
    if ("min" in rest || "max" in rest) {
      const relax = Array.isArray(rest.relaxations) ? (rest.relaxations as Array<{ category?: string; years?: number }>).map((r) => `${r.category} +${r.years}`).join(", ") : "";
      x = `${rest.min ?? "?"} to ${rest.max ?? "?"} years${rest.asOf ? ` (as of ${rest.asOf})` : ""}${relax ? `; relaxation: ${relax}` : ""}`;
    } else x = rest;
  }
  const s = typeof x === "string" ? x : JSON.stringify(x);
  return s.length > max ? `${s.slice(0, max - 3)}…` : s;
};

/** Which part of eligibility the sources disagree on: qualification, experience, or both (D3). */
export function eligibilityDisagreement(values: unknown[]): "qualification" | "experience" | "both" | undefined {
  const rows = values.filter(Array.isArray) as Array<Array<{ post?: string; qualification?: unknown; experience?: unknown }>>;
  if (rows.length < 2) return undefined;
  const of = (key: "qualification" | "experience") => new Set(rows.map((r) => valueHash(r.map((p) => ({ post: p.post ?? null, v: p[key] ?? null }))))).size > 1;
  const q = of("qualification"), e = of("experience");
  return q && e ? "both" : q ? "qualification" : e ? "experience" : undefined;
}

/** A field's own ProvenanceField on the record, for jobs that were never imported. */
function recordField(record: RecruitmentRecord, path: string): { status?: string; value?: unknown } | undefined {
  const [ns, key] = path.split(".");
  const at = (o: unknown, k: string) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
  const f = key ? at(at(record, ns), key) : at(record, ns);
  return f && typeof f === "object" && "status" in (f as object) ? (f as { status?: string; value?: unknown }) : undefined;
}

export async function buildPublicationReview(record: RecruitmentRecord, today: string): Promise<PublicationReview> {
  const { sql } = await import("@/lib/db");
  const repo = await import("@/lib/cms/importer/repository");
  const { classifyField } = await import("@/lib/cms/importer/classify");
  const { tableTotalContext } = await import("@/lib/cms/importer/service");

  const imported = await repo.isImportedJob(record.id).catch(() => false);
  const fresh = await freshnessOf(record);

  const standings: Record<string, ReviewStanding> = {};
  const conflictValues: Record<string, string[]> = {};
  const conflictKinds: Record<string, DisagreementKind> = {};
  let eligibilityPart: ReviewInput["eligibilityPart"];
  let applyDecision: ReviewInput["applyDecision"];
  let officialDocuments = 0;
  const filled: string[] = READY_SECTIONS.map(([p]) => p).filter((p) => {
    const v = repo.fieldValue(record, p);
    return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
  });

  if (imported) {
    const first = await repo.firstImportAt(record.id);
    const ctx = await tableTotalContext(record, first);
    for (const s of await repo.fieldStates(record, MATERIAL_FIELDS)) {
      const verdict = classifyField(s, first, ctx);
      const cls = verdict.cls;
      standings[s.fieldPath] = CLASS_TO_STANDING[cls] ?? "RESEARCH";
      if (cls === "CONFLICTING") {
        const extracted = s.claims.filter((c) => c.kind === "EXTRACTED" && !c.superseded);
        // One entry per meaning: forms of the same value are not listed twice. An omission shows the saved value
        // beside what the source states (research or official alike: "the source", never "the official notice").
        conflictValues[s.fieldPath] = verdict.conflictKind === "OMITTED"
          ? [`Saved: ${short(s.value, 700)}`, ...new Set(extracted.filter((c) => leavesOut(s.fieldPath, s.value, c.value)).map((c) => `Source says: ${short(c.value, 700)}`))]
          : [...new Set(groupByMeaning(s.fieldPath, extracted).map((g) => short(g.value)))];
        conflictKinds[s.fieldPath] = verdict.conflictKind ?? "SOURCES";
        if (s.fieldPath === "eligibility") eligibilityPart = eligibilityDisagreement(extracted.map((c) => c.value));
      }
      if (s.fieldPath === "links#APPLY_ONLINE" && (cls === "NOT_YET_OPEN" || cls === "NOT_APPLICABLE")) applyDecision = cls === "NOT_YET_OPEN" ? "LINK_LATER" : "NOT_APPLICABLE";
    }
    officialDocuments = (await repo.retrievalsFor(record.id)).filter((r) => (r.authenticity === "CONFIRMED" || r.authenticity === "ATTESTED")
      && (r.originRole === "AUTHORITY" || r.originRole === "PARTNER") && r.declaredKind !== "RESEARCH").length;
  } else {
    for (const p of MATERIAL_FIELDS) {
      const v = repo.fieldValue(record, p);
      const has = !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
      const f = recordField(record, p);
      standings[p] = !has ? "MISSING" : f?.status === "VERIFIED" ? "VERIFIED" : f?.status === "CONFLICTED" ? "CONFLICTING" : "ENTERED";
    }
  }

  // Possible duplicates: another live or draft job with the same notice number, or the same organisation and year.
  const notice = (record.identity.notificationNumber?.value ?? "").trim().toUpperCase();
  const dups = await sql`
    SELECT id, identity->'title'->>'value' AS title FROM recruitments
    WHERE id <> ${record.id}::uuid AND draft_state <> 'ARCHIVED'
      AND ((${notice} <> '' AND UPPER(TRIM(COALESCE(identity->'notificationNumber'->>'value', ''))) = ${notice})
        OR (organization_id = ${record.identity.organizationId} AND (identity->>'recruitmentYear')::int = ${record.identity.recruitmentYear}))
    ORDER BY created_at LIMIT 5`;

  // The history entries already on the public page, so the review lists only what this publish adds.
  const live = await sql`
    SELECT snapshot->'updates' AS updates FROM published_recruitments
    WHERE recruitment_id = ${record.id}::uuid ORDER BY published_at DESC LIMIT 1`;
  const publishedUpdates = (live[0]?.updates ?? []) as Array<{ id?: unknown; superseded?: unknown }>;
  const publishedUpdateIds = Array.isArray(publishedUpdates) ? publishedUpdates.map((u) => String(u?.id ?? "")).filter(Boolean) : [];
  const publishedSupersededIds = Array.isArray(publishedUpdates) ? publishedUpdates.filter((u) => u?.superseded).map((u) => String(u?.id ?? "")).filter(Boolean) : [];

  return assembleReview({
    record, today, imported, freshness: fresh, standings, conflictValues, conflictKinds, eligibilityPart, applyDecision, officialDocuments,
    duplicates: dups.map((d) => ({ id: String(d.id), title: String(d.title ?? "") })), filled, publishedUpdateIds, publishedSupersededIds,
  });
}

/**
 * The job's freshness as the publish statement checks it: the record revision, the latest claim (confirmations,
 * decisions and new imports add claims without a new revision), and how many documents were brought in (a new
 * preview adds documents without claims).
 */
export async function freshnessOf(record: RecruitmentRecord): Promise<Freshness> {
  const { sql } = await import("@/lib/db");
  let claimSeq = 0, retrievals = 0;
  try {
    const r = (await sql`
      SELECT (SELECT coalesce(max(seq), 0) FROM recruitment_field_claims WHERE recruitment_id = ${record.id}::uuid) AS claim_seq,
             (SELECT count(*) FROM recruitment_source_retrievals r JOIN recruitment_imports i ON i.import_id = r.import_id
              WHERE i.recruitment_id = ${record.id}::uuid) AS retrievals`)[0];
    claimSeq = Number(r?.claim_seq ?? 0);
    retrievals = Number(r?.retrievals ?? 0);
  } catch { /* importer tables not in this database: nothing to compare */ }
  return { recordRevision: record.recordRevision, claimSeq, retrievals };
}

// ─── The owner's approval ─────────────────────────────────────

export interface OwnerApproval {
  acknowledged: boolean;
  reviewHash: string;
  recordRevision: string;
  claimSeq: number;
  retrievals: number;
  conflictsAcknowledged: string[];
}

export function readOwnerApproval(v: unknown): OwnerApproval | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.reviewHash !== "string" || typeof o.recordRevision !== "string") return null;
  return {
    acknowledged: o.acknowledged === true, reviewHash: o.reviewHash, recordRevision: o.recordRevision,
    claimSeq: Number.isInteger(o.claimSeq) ? (o.claimSeq as number) : -1, retrievals: Number.isInteger(o.retrievals) ? (o.retrievals as number) : -1,
    conflictsAcknowledged: Array.isArray(o.conflictsAcknowledged) ? o.conflictsAcknowledged.filter((x): x is string => typeof x === "string") : [],
  };
}

/** Why an approval does not fit this review, or null when it does. */
export function approvalProblem(review: PublicationReview, a: OwnerApproval | null):
  { reason: "OWNER_REVIEW_REQUIRED" | "REVIEW_CHANGED" | "CONFLICT_NOT_ACKNOWLEDGED"; fieldPaths?: string[] } | null {
  if (!a || !a.acknowledged) return { reason: "OWNER_REVIEW_REQUIRED" };
  if (a.reviewHash !== review.reviewHash || a.recordRevision !== review.freshness.recordRevision
    || a.claimSeq !== review.freshness.claimSeq || a.retrievals !== review.freshness.retrievals) return { reason: "REVIEW_CHANGED" };
  // One acknowledgement per material conflict, no more, no fewer, no repeats: never a blanket override.
  const need = review.conflicts.map((c) => c.fieldPath).sort();
  const given = [...a.conflictsAcknowledged].sort();
  if (given.length !== need.length || given.some((g, i) => g !== need[i])) {
    return { reason: "CONFLICT_NOT_ACKNOWLEDGED", fieldPaths: need.filter((p) => !given.includes(p)) };
  }
  return null;
}

/** The approval as kept in OWNER_PUBLICATION_APPROVAL (§3.2). */
export function approvalMetadata(review: PublicationReview, adminId: string, kind: "FIRST_PUBLISH" | "REPUBLISH", telegram: boolean): Record<string, unknown> {
  return {
    approver: { adminId, authorisedBy: "CMS_PUBLISHERS" },
    recordRevision: review.freshness.recordRevision, claimSeq: review.freshness.claimSeq, retrievals: review.freshness.retrievals,
    reviewHash: review.reviewHash, kind, acknowledged: true, standing: review.standing,
    missing: review.missing.map((m) => m.fieldPath),
    conflicts: review.conflicts.map((c) => ({ fieldPath: c.fieldPath, ...(c.part ? { part: c.part } : {}), kind: c.kind ?? "SOURCES", values: c.values, action: "ACKNOWLEDGED" })),
    links: {
      applyOnline: review.links.applyOnline.state, applyHost: review.links.applyOnline.host, applyStanding: review.links.applyOnline.standing,
      notification: review.links.notification.state, officialSourceLink: review.links.officialSourceLink,
    },
    warnings: review.warnings.map((w) => ({ code: w.code, text: w.text, ...(w.recordId ? { recordId: w.recordId } : {}) })),
    telegram,
  };
}
