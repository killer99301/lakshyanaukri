"use client";

import React from "react";
import { FileText, ExternalLink, Archive, AlertCircle } from "lucide-react";
import type { ResolvedDocumentAccess } from "@/types";

interface DocumentAccessButtonProps {
  access: ResolvedDocumentAccess;
  size?: "sm" | "md";
  className?: string;
  showDisclaimer?: boolean;
}

export const DocumentAccessButton: React.FC<DocumentAccessButtonProps> = ({
  access,
  size = "md",
  className = "",
  showDisclaimer = false,
}) => {
  if (!access.isAvailable || !access.url) {
    return (
      <div className={`inline-flex flex-col gap-1 ${className}`}>
        <button
          type="button"
          disabled
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-400 font-bold cursor-not-allowed border border-slate-200 ${
            size === "sm" ? "text-[11px]" : "text-xs"
          }`}
          title={access.disclaimer}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{access.label}</span>
        </button>
        {showDisclaimer && access.disclaimer && (
          <span className="text-[10px] text-slate-400 font-medium">
            {access.disclaimer}
          </span>
        )}
      </div>
    );
  }

  const isMirror = access.isMirror;
  const isPdf = access.isDirectPdf;

  const btnColor = isMirror
    ? "bg-amber-600 hover:bg-amber-700 text-white"
    : isPdf
    ? "bg-emerald-700 hover:bg-emerald-800 text-white"
    : "bg-[#0F172A] hover:bg-slate-800 text-white";

  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      <a
        href={access.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center justify-center gap-1.5 font-bold rounded-xl transition-all shadow-2xs hover:shadow-xs active:scale-[0.98] ${btnColor} ${
          size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs"
        }`}
        title={access.disclaimer}
      >
        {isMirror ? (
          <Archive className="h-3.5 w-3.5 text-amber-200" />
        ) : isPdf ? (
          <FileText className="h-3.5 w-3.5 text-emerald-200" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5 text-slate-300" />
        )}
        <span>{access.label}</span>
      </a>

      {showDisclaimer && access.disclaimer && (
        <span
          className={`text-[10px] font-semibold leading-tight ${
            isMirror ? "text-amber-800" : "text-[#475569]"
          }`}
        >
          {access.disclaimer}
        </span>
      )}
    </div>
  );
};
