// ═══════════════════════════════════════════════════════════
// Career Campus — Centralized Document Access Priority Chain
// ═══════════════════════════════════════════════════════════
// Resolves document access targets in strict priority order:
//
// 1. OFFICIAL_PDF       → Direct link to authoritative commission PDF
// 2. OFFICIAL_PORTAL    → Official candidate login or board webpage
// 3. VERIFIED_MIRROR    → a copy stored by LakshyaNaukri (never labelled official). The type name is historical:
//                         no verification process stands behind it, so the public wording says "stored copy" (Nov 2026).
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
      label: source.customPdfLabel || "Linked document",
      badgeLabel: "PDF",
      badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
      isOfficial: true,
      isMirror: false,
      isDirectPdf: true,
      isAvailable: true,
      organization: source.organization || undefined,
      publishedDate: source.publishedDate || undefined,
      disclaimer: "Open the linked document",
    };
  }

  // 2. Official Portal (second priority)
  if (source.officialPortalUrl && source.officialPortalUrl.trim() !== "") {
    return {
      type: "OFFICIAL_PORTAL",
      url: source.officialPortalUrl.trim(),
      label: source.customPortalLabel || "Linked portal",
      badgeLabel: "Portal",
      badgeClass: "bg-blue-50 text-blue-800 border-blue-200",
      isOfficial: true,
      isMirror: false,
      isDirectPdf: false,
      isAvailable: true,
      organization: source.organization || undefined,
      publishedDate: source.publishedDate || undefined,
      disclaimer: "Open the linked portal",
    };
  }

  // 3. Verified LakshyaNaukri Mirror (third priority — NEVER labelled as official)
  if (source.mirrorUrl && source.mirrorUrl.trim() !== "") {
    return {
      type: "VERIFIED_MIRROR",
      url: source.mirrorUrl.trim(),
      label: "LakshyaNaukri stored copy",
      badgeLabel: "Stored copy",
      badgeClass: "bg-amber-50 text-amber-900 border-amber-300",
      isOfficial: false, // Invariant: Never label a mirror as official
      isMirror: true,
      isDirectPdf: source.mirrorUrl.toLowerCase().endsWith(".pdf"),
      isAvailable: true,
      organization: source.organization || undefined,
      publishedDate: source.publishedDate || undefined,
      mirrorVerifiedAt: source.mirrorVerifiedAt || undefined,
      disclaimer: `A copy of a ${org} document stored by LakshyaNaukri${
        source.publishedDate ? `, dated ${source.publishedDate}` : ""
      }. Check the official website for the current version.`,
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
    disclaimer: "No document link has been added yet.",
  };
}
