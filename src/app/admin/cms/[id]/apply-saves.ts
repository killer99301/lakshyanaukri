// ═══════════════════════════════════════════════════════════
// Admin: saving a set of field changes to a job, the one way both update panels do it
// ═══════════════════════════════════════════════════════════
//
// Shared by "Check for updates" and Simple Update (CMS usability batch 2), so
// there is one path for these saves, not two. On a live job it first opens
// the job for editing, exactly as "Open for editing" does, so the public keeps
// the published version. Then it saves each change through the normal fields
// route as Pending, each on the revision the previous one returned. An
// announcement, when there is one, goes through the announcement route, which
// keeps it in the job until the owner publishes. Nothing here approves or
// publishes.

import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { UpdateRecord } from "@/types";
import type { FieldSave } from "@/lib/cms/update-check";

export type Outcome = { record: RecruitmentRecord } | { error: string };

export async function call(url: string, init: RequestInit, fetchFn: typeof fetch = fetch): Promise<Outcome> {
  try {
    const res = await fetchFn(url, init);
    const data = await res.json();
    if (!res.ok || !data.record) return { error: data.error === "CONFLICT" ? "The record was changed somewhere else. Reload the page." : data.error ?? `HTTP ${res.status}` };
    return { record: data.record as RecruitmentRecord };
  } catch {
    return { error: "Could not reach the server." };
  }
}

export interface ApplyResult {
  /** The job as it stands after the last successful step. */
  record: RecruitmentRecord;
  /** Field changes saved. */
  saved: number;
  /** Set when a step failed; the steps before it stay saved, as Pending, in the draft. */
  error?: { where: string; why: string };
}

export async function applySaves(
  record: RecruitmentRecord,
  saves: FieldSave[] | ((opened: RecruitmentRecord) => FieldSave[]),
  announcement: Omit<UpdateRecord, "id"> | null = null,
  fetchFn: typeof fetch = fetch,
): Promise<ApplyResult> {
  let current = record;
  let saved = 0;
  if (record.draftState === "PUBLISHED") {
    const out = await call(`/api/admin/cms/records/${record.id}/revert`, { method: "POST" }, fetchFn);
    if ("error" in out) return { record: current, saved, error: { where: "Could not open the record for editing", why: out.error } };
    current = out.record;
  }
  // Saves worked out on the job as it is once opened (Check for updates builds them from the opened record).
  const list = typeof saves === "function" ? saves(current) : saves;
  for (const save of list) {
    const out = await call(`/api/admin/cms/records/${record.id}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fieldPath: save.fieldPath,
        field: { value: save.value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false },
        clientRevision: current.recordRevision,
        reason: save.reason,
      }),
    }, fetchFn);
    if ("error" in out) return { record: current, saved, error: { where: "A change could not be saved", why: out.error.replace(/^.*invariant:\s*/, "") } };
    current = out.record;
    saved++;
  }
  if (announcement) {
    const out = await call(`/api/admin/cms/records/${record.id}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update: announcement }),
    }, fetchFn);
    if ("error" in out) return { record: current, saved, error: { where: "The announcement could not be saved", why: out.error } };
    current = out.record;
  }
  return { record: current, saved };
}
