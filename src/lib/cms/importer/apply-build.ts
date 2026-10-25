// ═══════════════════════════════════════════════════════════
// Importer: from the stored preview and the ticked ids to the writes
// ═══════════════════════════════════════════════════════════
//
// Server only. Values come from the stored, immutable proposal, never from
// the browser. Each ticked value goes through the ordinary field-update
// builder (routeFieldUpdate) as a Pending value, so validation and history
// are the same as any save; the database function then checks that every
// ticked value is what the record will hold.

import { randomUUID } from "node:crypto";
import type { CmsRecruitmentLink, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { buildAiField } from "@/lib/cms/ai-assist-apply";
import { comparable, type Proposal, type ProposalItem } from "@/lib/cms/importer/proposal";
import { valueHash } from "@/lib/cms/importer/evidence-text";
import { fieldValue, recordColumns } from "@/lib/cms/importer/repository";

export interface ApplyPayload {
  record: Record<string, unknown>;
  revisions: Array<{ id: string; fieldPath: string; oldValue: unknown; newValue: unknown; reason: string }>;
  claims: Array<{ id: string; fieldPath: string; value: unknown; valueHash: string; retrievalId: string; page: number | null; quote: string | null; tableCell: unknown }>;
  supersessions: Array<{ superseding: string; superseded: string }>;
}

export class ApplySelectionError extends Error {
  constructor(message: string) { super(message); this.name = "ApplySelectionError"; }
}

/**
 * A value as the editor would store it: run through the same field builder
 * as any save, on an empty record. A value the editor refuses comes back
 * with the editor's reason, so the preview never offers it as a fill.
 */
export function editorValue(fieldPath: string, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    const record = blankRecord({ organizationId: "-", organizationName: "-", recruitmentYear: 2026, title: { value: "-", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } } as unknown as RecruitmentRecord["identity"], "00000000-0000-0000-0000-000000000000");
    const result = routeFieldUpdate(record, fieldPath, buildAiField(value) as ProvenanceField<unknown>, "00000000-0000-0000-0000-000000000000", "preview");
    return { ok: true, value: fieldValue(result.record, fieldPath) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message.replace(/^[\w.]+ invariant: /, "") : "refused" };
  }
}

/** An empty record for a new job, in memory only, to run the ordinary field builders on. */
export function blankRecord(identity: RecruitmentRecord["identity"], adminId: string): RecruitmentRecord {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    slug: "",
    draftState: "DRAFT",
    recordRevision: "00000000",
    identity,
    dates: {},
    vacancies: {},
    financial: {},
    links: [],
    documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] } as unknown as RecruitmentRecord["lifecycle"],
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: now.slice(0, 10), primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: now,
    updatedAt: now,
    createdBy: adminId,
    updatedBy: adminId,
  } as RecruitmentRecord;
}

export function buildApplyPayload(input: {
  record: RecruitmentRecord;
  proposal: Proposal;
  selected: string[];
  /** Separate confirmation for replacing values that are currently verified. */
  confirmReplaceVerified: boolean;
  adminId: string;
  sourceLabel: string;
  slug?: string;
}): ApplyPayload {
  const byId = new Map(input.proposal.items.map((i) => [i.id, i]));
  const chosen: ProposalItem[] = [];
  for (const id of input.selected) {
    const item = byId.get(id);
    if (!item) throw new ApplySelectionError(`"${id}" is not part of this preview`);
    if (item.action === "REPLACE_VERIFIED" && !input.confirmReplaceVerified) {
      throw new ApplySelectionError(`${item.label}: replacing a verified value needs the separate confirmation`);
    }
    chosen.push(item);
  }
  const perField = new Set<string>();
  for (const item of chosen) {
    if (item.kind === "FIELD" && perField.has(item.fieldPath)) throw new ApplySelectionError(`${item.label}: tick only one of the conflicting values`);
    perField.add(item.fieldPath);
  }

  let record = input.record;
  const revisions: ApplyPayload["revisions"] = [];
  const claims: ApplyPayload["claims"] = [];
  const supersessions: ApplyPayload["supersessions"] = [];
  const reason = `Imported (${input.sourceLabel})`;

  const pushRevision = (fieldPath: string, field: ProvenanceField<unknown>) => {
    const result = routeFieldUpdate(record, fieldPath, field, input.adminId, reason);
    record = result.record;
    revisions.push({ id: result.revision.id, fieldPath, oldValue: result.revision.oldValue ?? null, newValue: result.revision.newValue ?? null, reason });
  };

  // Fields first, then all links in one save of the list.
  for (const item of chosen.filter((i) => i.kind === "FIELD")) {
    if (item.action !== "MATCHES") pushRevision(item.fieldPath, buildAiField(item.value) as ProvenanceField<unknown>);
  }
  const newLinks = chosen.filter((i) => i.kind === "LINK" && i.action !== "MATCHES").map((i) => i.value as CmsRecruitmentLink);
  if (newLinks.length > 0) {
    pushRevision("links", { value: [...record.links, ...newLinks], status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false } as ProvenanceField<unknown>);
  }

  for (const item of chosen) {
    const newClaimIds: string[] = [];
    for (const c of item.claims) {
      const id = randomUUID();
      newClaimIds.push(id);
      claims.push({
        id, fieldPath: item.fieldPath, value: item.value, valueHash: valueHash(comparable(item.fieldPath, item.value)),
        retrievalId: c.retrievalId, page: c.page ?? null, quote: c.quote ?? null, tableCell: c.tableCell ?? null,
      });
    }
    for (const superseded of item.supersedes) for (const superseding of newClaimIds) supersessions.push({ superseding, superseded });
  }

  return { record: recordColumns(record, input.slug), revisions, claims, supersessions };
}
