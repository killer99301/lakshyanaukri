import React from "react";
import { ExternalLink, FileText, Calendar } from "lucide-react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { formatDate } from "@/lib/utils";

export interface PortalItemProps {
  id: string;
  title: string;
  organization: string;
  examName?: string;
  dateIso: string;
  dateLabel?: string;
  statusText?: string;
  statusVariant?: "coral" | "orange" | "peach" | "neutral";
  officialUrl: string;
  documentUrl?: string;
  actionText?: string;
  type?: "result" | "admit-card" | "answer-key";
}

export const PortalItemRow: React.FC<PortalItemProps> = ({
  title,
  organization,
  dateIso,
  dateLabel = "Date",
  statusText = "Declared",
  statusVariant = "orange",
  officialUrl,
  documentUrl,
  actionText = "View Details",
  type = "result",
}) => {
  const targetUrl = documentUrl || officialUrl;

  return (
    <Card className="p-3 sm:p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-4 bg-white border-[#E2E8F0] hover:border-[#FED7AA] hover:-translate-y-0.5 hover:shadow-xs transition-all duration-200 group rounded-xl">
      <div className="space-y-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Badge with pulse dot for declared results */}
          <Badge variant={statusVariant} size="sm" className="gap-1.5 px-2 py-0.5 text-[11px] font-bold">
            {type === "result" && (
              <span className="h-1.5 w-1.5 rounded-full bg-[#EA580C] animate-pulse shrink-0" />
            )}
            <span>{statusText}</span>
          </Badge>

          <span className="text-[11px] font-semibold text-[#475569] truncate">
            {organization}
          </span>
          <span className="text-xs text-slate-300 font-normal hidden sm:inline">•</span>
          <span className="text-[11px] text-[#475569] flex items-center gap-1">
            <Calendar className="h-3 w-3 text-slate-400" />
            <span>{dateLabel}: {formatDate(dateIso)}</span>
          </span>
        </div>

        <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug line-clamp-1">
          {title}
        </h4>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {documentUrl && (
          <a
            href={documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-bold text-white bg-[#EA580C] hover:bg-[#c2410c] px-3 py-1.5 rounded-lg shadow-2xs transition-all shimmer-hover"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Official PDF ↗</span>
          </a>
        )}

        <a
          href={targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] hover:underline px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 group-hover:border-[#FED7AA] transition-colors"
        >
          <span>{actionText}</span>
          <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-[#EA580C]" />
        </a>
      </div>
    </Card>
  );
};
