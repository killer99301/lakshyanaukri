// ═══════════════════════════════════════════════════════════
// What a job stores but its public page does not show (CMS 2.0 R2, U5)
// ═══════════════════════════════════════════════════════════
//
// Pure. So the owner never mistakes stored information for published information, this builds the public page's
// data exactly as the site does (projectForPreview → snapshotToGovernmentRecruitment, the same functions the job
// page and the editor's preview use) and names what is stored but missing from it: fee table rows, Apply Online
// portals, who a portal is for. Since U5 the page shows all of these, so normally this says nothing; it still
// catches what the page deliberately leaves out (an aggregator page is never an Apply portal) and any future gap.
// Nothing here changes what is saved or shown.

import type { CmsRecruitmentLink, FeeRow, ProvenanceField, RecruitmentRecord } from "@/types/recruitment-record";
import type { GovernmentRecruitment } from "@/types";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { isAggregatorHost } from "@/lib/public-link-labels";
import { hostOf } from "@/lib/cms/importer/trusted-domains";

const feeWords = (r: Pick<FeeRow, "category" | "post" | "exempt" | "amount">) => `${r.category}${r.post ? ` (${r.post})` : ""}: ${r.exempt || r.amount === 0 ? "exempt" : `₹${r.amount}`}`;
const feeKey = (r: Pick<FeeRow, "category" | "post" | "amount">) => `${r.category}|${r.post ?? ""}|${r.amount}`;
const portalKey = (url: string) => {
  try { const u = new URL(url); return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`; } catch { return url.trim(); }
};

/** The public page's data for this record, as the site builds it. */
function pageOf(record: RecruitmentRecord): GovernmentRecruitment | null {
  try { return snapshotToGovernmentRecruitment(projectForPreview(record)) as GovernmentRecruitment; } catch { return null; }
}

export interface Hidden { fees: FeeRow[]; portals: CmsRecruitmentLink[]; audiences: CmsRecruitmentLink[] }

/** What the record stores that its public page does not show. */
export function hiddenOnPage(record: RecruitmentRecord): Hidden {
  const out: Hidden = { fees: [], portals: [], audiences: [] };
  const page = pageOf(record);
  if (!page) return out;
  const shownFees = new Set((page.feeTable ?? []).map(feeKey));
  out.fees = (record.financial.feeTable?.value ?? []).filter((r) => !shownFees.has(feeKey(r)));
  const shown = new Map<string, { appliesTo?: string }>();
  for (const p of page.applyPortals ?? []) shown.set(portalKey(p.url), p);
  if (page.links.apply && !shown.has(portalKey(page.links.apply))) shown.set(portalKey(page.links.apply), {});
  for (const l of record.links.filter((x) => x.type === "APPLY_ONLINE" && !x.savedFrom)) {
    const s = shown.get(portalKey(l.url));
    if (!s) { if (!out.portals.some((p) => portalKey(p.url) === portalKey(l.url))) out.portals.push(l); continue; }
    if (l.appliesTo && !s.appliesTo) out.audiences.push(l);
  }
  return out;
}

/** Sentences for the publication review: stored, but not on the public page. Empty when everything shows. */
export function notShownPublicly(record: RecruitmentRecord): string[] {
  const h = hiddenOnPage(record);
  const out: string[] = [];
  if (h.fees.length) out.push(`Fees stored but not shown on the public page: ${h.fees.map(feeWords).join("; ")}`);
  if (h.portals.length) {
    out.push(`Apply Online links stored but not shown on the public page: ${h.portals.map((l) => `${l.label}${l.appliesTo ? ` for ${l.appliesTo}` : ""} (${l.url})${isAggregatorHost(hostOf(l.url)) ? " — a job-news or aggregator page is never shown as an Apply portal" : ""}`).join("; ")}`);
  }
  if (h.audiences.length) out.push(`Who an Apply link is for is stored but not shown: ${h.audiences.map((l) => `“${l.appliesTo}” (${l.url})`).join("; ")}`);
  return out;
}

/** The same, for one import item: what the job's page would still not show if this value were saved. */
export function notShownNote(fieldPath: string, value: unknown, record: RecruitmentRecord | null): string | null {
  if (!record) return null;
  const pf = <T,>(v: T): ProvenanceField<T> => ({ value: v, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false });
  let candidate: RecruitmentRecord | null = null;
  if (fieldPath === "financial.feeTable" && Array.isArray(value)) candidate = { ...record, financial: { ...record.financial, feeTable: pf(value as FeeRow[]) } };
  if (fieldPath === "links#APPLY_ONLINE" && value && typeof value === "object") candidate = { ...record, links: [...record.links, value as CmsRecruitmentLink] };
  if (!candidate) return null;
  const h = hiddenOnPage(candidate);
  if (fieldPath === "financial.feeTable" && h.fees.length) return `saved, but not shown on the public page: ${h.fees.map(feeWords).join("; ")}`;
  const url = (value as { url?: string }).url ?? "";
  if (fieldPath === "links#APPLY_ONLINE" && h.portals.some((p) => portalKey(p.url) === portalKey(url))) return "saved, but not shown on the public page as an Apply portal";
  return null;
}
