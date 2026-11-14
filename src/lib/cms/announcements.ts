// ═══════════════════════════════════════════════════════════
// Announcements: current or superseded (maintenance batch, Nov 2026)
// ═══════════════════════════════════════════════════════════
//
// Pure. An announcement whose information was replaced by newer verified
// information carries a `superseded` note: it is kept, word for word, but
// it is no longer presented as current anywhere public (banner, NEW badge,
// update count, Telegram news). Nothing here deletes or rewrites an entry's
// own text, date or id; supersede and restore only add or remove the note,
// and the caller saves that through the job's normal change history.
//
// Older entries have no note and stay current, exactly as before.

import type { UpdateRecord } from "@/types";

export type SupersededNote = NonNullable<UpdateRecord["superseded"]>;

export const isCurrent = (u: Pick<UpdateRecord, "superseded">): boolean => !u.superseded;
export const currentUpdates = <T extends Pick<UpdateRecord, "superseded">>(list: readonly T[] | undefined | null): T[] => (list ?? []).filter(isCurrent);
export const supersededUpdates = <T extends Pick<UpdateRecord, "superseded">>(list: readonly T[] | undefined | null): T[] => (list ?? []).filter((u) => !isCurrent(u));

export const MAX_REASON = 200;

export interface SupersedeInput {
  ids: string[];
  reason: string;
  /** Another announcement of the same job that carries the correct information. */
  replacedBy?: string;
  /** Or the official notice that shows it. */
  sourceUrl?: string;
  on: string;   // YYYY-MM-DD
  by: string;   // admin id
}

const isHttp = (u: string) => { try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; } };

/** A new list with the chosen announcements marked superseded, or the reason it cannot be done. */
export function supersede(list: readonly UpdateRecord[], input: SupersedeInput): { ok: true; list: UpdateRecord[] } | { ok: false; error: string } {
  const ids = [...new Set(input.ids ?? [])];
  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim();
  if (ids.length === 0) return { ok: false, error: "Choose at least one announcement." };
  if (!reason) return { ok: false, error: "Give the reason (it is kept in the job's history, never shown publicly)." };
  if (reason.length > MAX_REASON) return { ok: false, error: `Keep the reason to ${MAX_REASON} characters.` };
  const byId = new Map(list.map((u) => [u.id, u]));
  for (const id of ids) {
    const u = byId.get(id);
    if (!u) return { ok: false, error: "One of the chosen announcements is not in this job (reload the page)." };
    if (u.superseded) return { ok: false, error: `“${u.title}” is already marked superseded.` };
  }
  const replacedBy = input.replacedBy?.trim() || undefined;
  const sourceUrl = input.sourceUrl?.trim() || undefined;
  if (!replacedBy && !sourceUrl) return { ok: false, error: "Say what replaces it: a newer announcement of this job, or the official notice." };
  if (replacedBy) {
    const r = byId.get(replacedBy);
    if (!r) return { ok: false, error: "The replacing announcement is not in this job." };
    if (ids.includes(replacedBy)) return { ok: false, error: "An announcement cannot replace itself." };
    if (r.superseded) return { ok: false, error: "The replacing announcement is itself superseded; choose a current one." };
  }
  if (sourceUrl && !isHttp(sourceUrl)) return { ok: false, error: "The official notice must be a web address (https://…)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on) || !input.by) return { ok: false, error: "Missing date or admin." };
  const note: SupersededNote = { on: input.on, by: input.by, reason, ...(replacedBy ? { replacedBy } : {}), ...(sourceUrl ? { sourceUrl } : {}) };
  return { ok: true, list: list.map((u) => (ids.includes(u.id) ? { ...u, superseded: note } : u)) };
}

/** A new list with the chosen announcements current again, or the reason it cannot be done. */
export function restore(list: readonly UpdateRecord[], ids: string[], reason: string): { ok: true; list: UpdateRecord[] } | { ok: false; error: string } {
  const chosen = [...new Set(ids ?? [])];
  if (chosen.length === 0) return { ok: false, error: "Choose at least one announcement." };
  if (!(reason ?? "").trim()) return { ok: false, error: "Give the reason for restoring it." };
  if (reason.trim().length > MAX_REASON) return { ok: false, error: `Keep the reason to ${MAX_REASON} characters.` };
  const byId = new Map(list.map((u) => [u.id, u]));
  for (const id of chosen) {
    const u = byId.get(id);
    if (!u) return { ok: false, error: "One of the chosen announcements is not in this job (reload the page)." };
    if (!u.superseded) return { ok: false, error: `“${u.title}” is not superseded.` };
  }
  return {
    ok: true,
    list: list.map((u) => {
      if (!chosen.includes(u.id)) return u;
      const { superseded: _gone, ...rest } = u;
      void _gone;
      return rest;
    }),
  };
}

/**
 * A short fingerprint of a job's announcement list, as the editor last saw it. A supersede or restore saved
 * from a page showing an older list is refused (another tab or person changed the announcements meanwhile).
 * Same simple hash as the record revision, so it runs in the browser too.
 */
export function updatesFingerprint(list: readonly UpdateRecord[] | undefined | null): string {
  const content = JSON.stringify((list ?? []).map((u) => [u.id, u.date, u.title, u.superseded ?? null]));
  let hash = 0;
  for (let i = 0; i < content.length; i++) hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** For the public correction list: the announcement that replaced this one, when it is in the same job. */
export function replacementOf(u: UpdateRecord, list: readonly UpdateRecord[]): UpdateRecord | null {
  const id = u.superseded?.replacedBy;
  return id ? list.find((x) => x.id === id) ?? null : null;
}

/**
 * The announcements as sent to public pages (13 Nov 2026: the whole list, superseded notes included, was
 * serialized into the job page's data, so the internal reason, the admin id and the old wording were in the
 * page source although never displayed). An explicit allowlist: only the fields a public page shows are copied,
 * so a field added to announcements later stays internal until it is added here on purpose.
 *   - current: id, date, type, title, description, sourceUrl, field, previousValue, newValue, and (P1) event,
 *     relevantUntil, action, each checked for shape
 *   - superseded: id, date, type, title, and the note's on / replacedBy / sourceUrl (never its reason or author,
 *     never the old description or values)
 * The stored record, the editor and the change history keep everything.
 */
export function toPublicUpdates(list: readonly UpdateRecord[] | undefined | null): UpdateRecord[] {
  const str = (v: unknown): v is string => typeof v === "string" && v !== "";
  return (list ?? []).map((u) => {
    const base = { id: u.id, date: u.date, type: u.type, title: u.title };
    if (u.superseded) {
      const s = u.superseded;
      return {
        ...base,
        description: "",
        superseded: { on: s.on, ...(str(s.replacedBy) ? { replacedBy: s.replacedBy } : {}), ...(str(s.sourceUrl) ? { sourceUrl: s.sourceUrl } : {}) },
      } as UpdateRecord;
    }
    return {
      ...base,
      description: u.description,
      ...(str(u.sourceUrl) ? { sourceUrl: u.sourceUrl } : {}),
      ...(str(u.field) ? { field: u.field } : {}),
      ...(u.previousValue !== undefined ? { previousValue: u.previousValue } : {}),
      ...(u.newValue !== undefined ? { newValue: u.newValue } : {}),
      // P1 (CMS 2.0, Nov 2026): what the "Important update" block needs, checked for shape. Only on current
      // announcements: a superseded one is never promoted, so it carries none of them.
      ...(u.event && EVENT_KINDS.has(u.event.kind) ? { event: { kind: u.event.kind, ...(str(u.event.stage) ? { stage: u.event.stage.slice(0, 120) } : {}) } } : {}),
      ...(str(u.relevantUntil) && /^\d{4}-\d{2}-\d{2}$/.test(u.relevantUntil) ? { relevantUntil: u.relevantUntil } : {}),
      ...(str(u.action) && ACTION_TYPES.has(u.action) ? { action: u.action } : {}),
    };
  });
}

const EVENT_KINDS = new Set<string>(["ADMIT_CARD", "RESULT", "ANSWER_KEY", "CUT_OFF", "EXAM_DATE", "POSTPONEMENT", "CANCELLATION", "EXTENSION", "CORRIGENDUM", "NEW_RECRUITMENT", "OTHER"]);
const ACTION_TYPES = new Set<string>(["APPLY_ONLINE", "OFFICIAL_NOTIFICATION", "OFFICIAL_WEBSITE", "CORRIGENDUM", "ADMIT_CARD", "RESULT", "ANSWER_KEY", "CUT_OFF", "EXAM_NOTICE"]);
