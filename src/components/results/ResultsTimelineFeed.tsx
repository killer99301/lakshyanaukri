import React from "react";
import { ExternalLink, FileText, Calendar, Activity } from "lucide-react";
import { HOMEPAGE_RESULTS } from "@/data/homepage";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";
import { formatDate } from "@/lib/utils";

export const ResultsTimelineFeed: React.FC = () => {
  const getFloatClass = (idx: number) => {
    const classes = ["idle-float-1", "idle-float-2", "idle-float-3"];
    return classes[idx % classes.length];
  };

  return (
    <section>
      <Container>
        <SectionHeading
          title="Latest Results"
          subtitle="Live activity feed of recently declared recruitment results, merit lists & scorecards."
          actionText="View All Results"
          actionHref="/results"
        />

        <div className="mt-4 relative pl-4 sm:pl-6 border-l-2 border-[#FED7AA] space-y-3">
          {HOMEPAGE_RESULTS.map((res, idx) => (
            <div key={res.id} className={`relative group ${getFloatClass(idx)}`}>
              {/* Live Timeline Status Pulse Dot */}
              <div className="absolute -left-[23px] sm:-left-[31px] top-4 h-3.5 w-3.5 rounded-full bg-[#EA580C] ring-4 ring-white shadow-xs flex items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
              </div>

              {/* Feed Card */}
              <Card className="p-3.5 sm:p-4 bg-white border-[#E2E8F0] hover:border-[#FED7AA] hover:shadow-md transition-all duration-300 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group-hover:-translate-y-1 group-hover:scale-[1.01]">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Badge variant="coral" size="sm" className="px-2 py-0.5 text-[11px] font-bold gap-1">
                      <Activity className="h-3 w-3" />
                      <span>{res.statusText || "Declared"}</span>
                    </Badge>
                    <span className="font-semibold text-[#475569] truncate">
                      {res.organization}
                    </span>
                    <span className="text-slate-300 hidden sm:inline">•</span>
                    <span className="text-[#475569] flex items-center gap-1 text-[11px]">
                      <Calendar className="h-3 w-3 text-slate-400" />
                      <span>Declared: {formatDate(res.resultDateIso)}</span>
                    </span>
                  </div>

                  <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug line-clamp-1">
                    {res.title}
                  </h4>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {res.documentUrl && (
                    <a
                      href={res.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-bold text-white bg-[#EA580C] hover:bg-[#c2410c] px-3 py-1.5 rounded-xl shadow-2xs transition-all shimmer-hover"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>Official PDF ↗</span>
                    </a>
                  )}

                  <a
                    href={res.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] hover:underline px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 group-hover:border-[#FED7AA] transition-colors"
                  >
                    <span>View Result</span>
                    <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-[#EA580C]" />
                  </a>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};
