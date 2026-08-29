// ═══════════════════════════════════════════════════════════
// Career Campus — Centralized Document Access Priority Chain
// ═══════════════════════════════════════════════════════════
// Resolves document access targets in strict priority order:
//
// 1. OFFICIAL_PDF       → Direct link to authoritative commission PDF
// 2. OFFICIAL_PORTAL    → Official candidate login or board webpage
// 3. VERIFIED_MIRROR    → Career Campus verified archive (never labelled official)
// 4. UNAVAILABLE        → Explicitly indicated when no document exists
//
// Shared across: Results, Admit Cards, Answer Keys, Cutoffs,
// Corrigenda & Updates, and Job Detail Pages.
// ═══════════════════════════════════════════════════════════

import type { DocumentSourceInput, ResolvedDocumentAccess } from "@/types";

/**
 * Resolve the document access target for any recruitment document,
 * result gazette, admit card, answer key, or corrigendum.
 */
export function resolveDocumentAccess(
  source: DocumentSourceInput
): ResolvedDocumentAccess {
  const org = source.organization || "the issuing authority";

  // 1. Official PDF (highest priority)
  if (source.officialPdfUrl && source.officialPdfUrl.trim() !== "") {
    return {
      type: "OFFICIAL_PDF",
      url: source.officialPdfUrl.trim(),
      label: source.customPdfLabel || "Official PDF Gazette",
      badgeLabel: "Official PDF",
      badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
      isOfficial: true,
      isMirror: false,
      isDirectPdf: true,
      isAvailable: true,
      organization: source.organization || undefined,
      publishedDate: source.publishedDate || undefined,
      disclaimer: `Authoritative official document published directly on ${org} server.`,
    };
  }

  // 2. Official Portal (second priority)
  if (source.officialPortalUrl && source.officialPortalUrl.trim() !== "") {
    return {
      type: "OFFICIAL_PORTAL",
      url: source.officialPortalUrl.trim(),
      label: source.customPortalLabel || "Official Commission Portal",
      badgeLabel: "Official Portal",
      badgeClass: "bg-blue-50 text-blue-800 border-blue-200",
      isOfficial: true,
      isMirror: false,
      isDirectPdf: false,
      isAvailable: true,
      organization: source.organization || undefined,
      publishedDate: source.publishedDate || undefined,
      disclaimer: `Direct candidate login and notice portal on official ${org} server.`,
    };
  }

  // 3. Verified LakshyaNaukri Mirror (third priority — NEVER labelled as official)
  if (source.mirrorUrl && source.mirrorUrl.trim() !== "") {
    return {
      type: "VERIFIED_MIRROR",
      url: source.mirrorUrl.trim(),
      label: "LakshyaNaukri Verified Mirror",
      badgeLabel: "Verified Mirror",
      badgeClass: "bg-amber-50 text-amber-900 border-amber-300",
      isOfficial: false, // Invariant: Never label a mirror as official
      isMirror: true,
      isDirectPdf: source.mirrorUrl.toLowerCase().endsWith(".pdf"),
      isAvailable: true,
      organization: source.organization || undefined,
      publishedDate: source.publishedDate || undefined,
      mirrorVerifiedAt: source.mirrorVerifiedAt || undefined,
      disclaimer: `LakshyaNaukri verified mirror archive. Verified and preserved from original ${org} publication${
        source.publishedDate ? ` on ${source.publishedDate}` : ""
      }.`,
    };
  }

  // 4. Document Unavailable (fallback)
  return {
    type: "UNAVAILABLE",
    url: undefined,
    label: "Document Unavailable",
    badgeLabel: "Unavailable",
    badgeClass: "bg-slate-100 text-slate-500 border-slate-200",
    isOfficial: false,
    isMirror: false,
    isDirectPdf: false,
    isAvailable: false,
    organization: source.organization || undefined,
    publishedDate: source.publishedDate || undefined,
    disclaimer: `Official document or portal URL not yet published or released by ${org}.`,
  };
}
