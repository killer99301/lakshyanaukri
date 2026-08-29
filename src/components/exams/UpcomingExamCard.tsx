import React from "react";
import { ExternalLink } from "lucide-react";
import { UpcomingExamItem } from "@/types/job";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";

export interface UpcomingExamRowProps {
  exam: UpcomingExamItem;
}

export const UpcomingExamRow: React.FC<UpcomingExamRowProps> = ({ exam }) => {
  // Parse month & day for timeline badge
  const hasValidDate = Boolean(exam.examDateIso && !isNaN(new Date(exam.examDateIso).getTime()));
  const dateObj = hasValidDate ? new Date(exam.examDateIso) : null;
  const monthStr = dateObj ? dateObj.toLocaleString("en-US", { month: "short" }).toUpperCase() : "TBA";
  const dayStr = dateObj ? dateObj.getDate().toString() : "—";

  return (
    <Card className="p-3 sm:p-4 flex items-center justify-between gap-3 bg-white border-[#E2E8F0] hover:border-[#FED7AA] hover:shadow-xs transition-all duration-200 group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Timeline Date Pill */}
        <div className="h-12 w-12 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex flex-col items-center justify-center shrink-0 text-center transition-all duration-200 group-hover:scale-105 group-hover:border-[#EA580C]">
          <span className="text-[10px] font-black text-[#EA580C] uppercase leading-none">
            {monthStr}
          </span>
          <span className="text-base font-extrabold text-[#0F172A] leading-tight">
            {dayStr}
          </span>
        </div>

        {/* Content Info */}
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="orange" size="sm" className="px-1.5 py-0 text-[10px]">
              {exam.statusText || "Scheduled"}
            </Badge>
            <span className="text-[11px] font-semibold text-[#475569] truncate">
              {exam.organization}
            </span>
          </div>

          <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug truncate">
            {exam.title}
          </h4>
        </div>
      </div>

      {/* Action */}
      <a
        href={exam.officialUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] hover:underline px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 group-hover:border-[#FED7AA] transition-colors shrink-0"
      >
        <span>Official Site</span>
        <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-[#EA580C]" />
      </a>
    </Card>
  );
};
