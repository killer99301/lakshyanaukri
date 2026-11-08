"use client";

import React from "react";
import { FileText, ExternalLink, ShieldCheck, AlertCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface OfficialNotificationCardProps {
  notificationPdfUrl?: string;
  officialWebsiteUrl?: string;
  /** The job's source standing (G1): what its links are, never whether anything was checked. */
  sourceType?: string;
  /** The day a person checked the job; absent when nobody has. */
  verifiedAt?: string;
  /** Imported jobs: every key detail was checked against the official notice before publishing. */
  keyDetailsChecked?: boolean;
}

// The words for each standing. "Official" says where a link points, not that a value was verified.
const STANDING: Record<string, { label: string; official: boolean }> = {
  OFFICIAL_NOTIFICATION: { label: "Official notice link", official: true },
  OFFICIAL_CORRIGENDUM: { label: "Official corrigendum link", official: true },
  OFFICIAL_EXAM_NOTICE: { label: "Official exam notice link", official: true },
  OFFICIAL_PORTAL: { label: "Official portal link", official: true },
  OFFICIAL_WEBSITE: { label: "Official website link", official: true },
  SECONDARY_SOURCE: { label: "Not from an official source", official: false },
  NOT_VERIFIED: { label: "No official source linked", official: false },
};

export const OfficialNotificationCard: React.FC<OfficialNotificationCardProps> = ({
  notificationPdfUrl,
  officialWebsiteUrl,
  sourceType = "NOT_VERIFIED",
  verifiedAt,
  keyDetailsChecked = false,
}) => {
  const standing = STANDING[sourceType] ?? STANDING.NOT_VERIFIED;
  return (
    <div id="official-notification" className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
      {/* Decorative background circle */}
      <div className="absolute -right-10 -bottom-10 h-44 w-44 rounded-full bg-orange-500/10 blur-2xl pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
        <div className="space-y-2 max-w-xl">
          <div data-source-standing={sourceType} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${standing.official ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
            {standing.official ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            <span>{standing.label}</span>
          </div>

          <h3 className="text-xl font-black text-white tracking-tight">
            Official Recruitment Notification PDF
          </h3>

          <p className="text-xs text-slate-300 leading-relaxed">
            {standing.official
              ? "The links open the recruiting body's own copy. LakshyaNaukri does not host notice PDFs. Always read the official notice before applying."
              : "No official notice is linked for this job yet. Read the recruiting body's own notice before applying."}
          </p>

          <p data-checked-line className="text-[11px] text-slate-400 font-medium">
            {verifiedAt
              ? <>{keyDetailsChecked ? "Key details checked against the official notice" : "Checked"}: <span className="text-slate-200 font-semibold">{formatDate(verifiedAt)}</span></>
              : "Details not yet checked against the official notice"}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {notificationPdfUrl ? (
            <a
              href={notificationPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[#EA580C] text-white font-extrabold text-xs sm:text-sm hover:bg-[#F95738] shadow-md shadow-orange-950/40 transition-all cursor-pointer"
            >
              <FileText className="h-4 w-4" />
              <span>View Official PDF ↗</span>
            </a>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/90 text-slate-300 border border-slate-700/80 text-xs font-bold">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>Official PDF unavailable</span>
            </div>
          )}

          {officialWebsiteUrl && (
            <a
              href={officialWebsiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs sm:text-sm transition-colors cursor-pointer"
            >
              <span>Official Website</span>
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
