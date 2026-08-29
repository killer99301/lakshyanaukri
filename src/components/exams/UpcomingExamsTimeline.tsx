import React from "react";
import { ExternalLink, CalendarCheck } from "lucide-react";
import { UPCOMING_EXAMS } from "@/data/homepage";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";

export const UpcomingExamsTimeline: React.FC = () => {
  return (
    <section>
      <Container>
        <SectionHeading
          title="Upcoming Exams Timeline"
          subtitle="Track scheduled examination dates, admit card timelines, and official portals."
          actionText="View All Exams"
          actionHref="/exams"
        />

        <div className="mt-4 relative">
          {/* Vertical Connecting Timeline Spine (Desktop) */}
          <div className="hidden md:block absolute left-6 top-6 bottom-6 w-0.5 bg-[#FED7AA]/60 pointer-events-none" />

          <div className="space-y-3">
            {UPCOMING_EXAMS.map((ue) => {
              const hasValidDate = Boolean(ue.examDateIso && !isNaN(new Date(ue.examDateIso).getTime()));
              const dateObj = hasValidDate ? new Date(ue.examDateIso) : null;
              const monthStr = dateObj ? dateObj.toLocaleString("en-US", { month: "short" }).toUpperCase() : "TBA";
              const dayStr = dateObj ? dateObj.getDate().toString() : "—";

              return (
                <Card
                  key={ue.id}
                  className="p-3.5 sm:p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-white border-[#E2E8F0] hover:border-[#FED7AA] hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 group relative z-10"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* Stylized Timeline Date Badge Pod */}
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#FFF7ED] to-white border border-[#FED7AA] flex flex-col items-center justify-center shrink-0 text-center shadow-xs group-hover:scale-105 group-hover:border-[#EA580C] transition-transform">
                      <span className="text-[10px] font-black text-[#EA580C] uppercase leading-none">
                        {monthStr}
                      </span>
                      <span className="text-base font-black text-[#0F172A] leading-tight">
                        {dayStr}
                      </span>
                    </div>

                    {/* Content Info */}
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="orange" size="sm" className="px-1.5 py-0 text-[10px] font-bold">
                          {ue.statusText || "Scheduled"}
                        </Badge>
                        <span className="text-[11px] font-semibold text-[#475569] truncate">
                          {ue.organization}
                        </span>
                      </div>

                      <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug truncate">
                        {ue.title}
                      </h4>
                    </div>
                  </div>

                  {/* Actions & Schedule Details */}
                  <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                    {ue.admitCardDateIso && (
                      <span className="text-[11px] text-[#475569] hidden sm:flex items-center gap-1 font-medium bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                        <CalendarCheck className="h-3 w-3 text-[#EA580C]" />
                        <span>Admit Card: {ue.admitCardDateIso}</span>
                      </span>
                    )}

                    <a
                      href={ue.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] hover:underline px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 group-hover:border-[#FED7AA] transition-colors"
                    >
                      <span>Official Portal</span>
                      <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-[#EA580C]" />
                    </a>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
};
