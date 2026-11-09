"use client";

import React from "react";
import { FileText, ExternalLink, AlertCircle } from "lucide-react";
import { NO_NOTICE_ADVICE, publicLinkWords } from "@/lib/public-link-labels";

interface OfficialNotificationCardProps {
  notificationPdfUrl?: string;
  officialWebsiteUrl?: string;
  /** The job's organisation: decides whether a link is called official (trusted-domains registry). */
  organizationId?: string;
}

// No verification badge (owner-controlled publication, D5). A link is "official" only when its host is listed
// for the organisation; otherwise it is named by kind.
export const OfficialNotificationCard: React.FC<OfficialNotificationCardProps> = ({
  notificationPdfUrl,
  officialWebsiteUrl,
  organizationId,
}) => {
  const notice = notificationPdfUrl ? publicLinkWords(organizationId, notificationPdfUrl, "notification") : null;
  const site = officialWebsiteUrl ? publicLinkWords(organizationId, officialWebsiteUrl, "website") : null;
  return (
    <div id="official-notification" className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
      {/* Decorative background circle */}
      <div className="absolute -right-10 -bottom-10 h-44 w-44 rounded-full bg-orange-500/10 blur-2xl pointer-events-none" />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
        <div className="space-y-2 max-w-xl">
          <h3 className="text-xl font-black text-white tracking-tight">
            Recruitment notification
          </h3>

          <p className="text-xs text-slate-300 leading-relaxed">
            {notice
              ? "LakshyaNaukri does not host notice PDFs. Read the notice before applying."
              : NO_NOTICE_ADVICE}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          {notice ? (
            <a
              href={notificationPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-link-standing={notice.official ? "official" : "other"}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[#EA580C] text-white font-extrabold text-xs sm:text-sm hover:bg-[#F95738] shadow-md shadow-orange-950/40 transition-all cursor-pointer"
            >
              <FileText className="h-4 w-4" />
              <span>{notice.label} ↗</span>
            </a>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/90 text-slate-300 border border-slate-700/80 text-xs font-bold">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>No notification link</span>
            </div>
          )}

          {site && (
            <a
              href={officialWebsiteUrl}
              data-link-standing={site.official ? "official" : "other"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs sm:text-sm transition-colors cursor-pointer"
            >
              <span>{site.label}</span>
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
