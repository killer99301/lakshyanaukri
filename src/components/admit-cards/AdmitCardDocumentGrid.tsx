import React, { useState } from "react";
import { FileBadge, Calendar } from "lucide-react";
import { HOMEPAGE_ADMIT_CARDS } from "@/data/homepage";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";
import { formatDate, cn } from "@/lib/utils";

export const AdmitCardDocumentGrid: React.FC = () => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const getFloatClass = (idx: number) => {
    const classes = ["idle-float-1", "idle-float-2", "idle-float-3"];
    return classes[idx % classes.length];
  };

  return (
    <section>
      <Container>
        <SectionHeading
          title="Latest Admit Cards"
          subtitle="Recently released e-admit cards, call letters, and city intimation slips."
          actionText="View All Admit Cards"
          actionHref="/admit-cards"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {HOMEPAGE_ADMIT_CARDS.map((ac, idx) => {
            const isHovered = hoveredIdx === idx;
            const isOtherHovered = hoveredIdx !== null && !isHovered;

            return (
              <div
                key={ac.id}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={isHovered ? { animation: "none" } : undefined}
                className={cn("group transition-all duration-300", !isHovered && getFloatClass(idx))}
              >
                <Card
                  className={cn(
                    "bg-white border flex flex-col justify-between h-full rounded-2xl overflow-hidden transition-all duration-300",
                    isHovered
                      ? "border-[#EA580C] shadow-md shadow-orange-500/10 -translate-y-1.5 scale-[1.015]"
                      : isOtherHovered
                      ? "border-[#E2E8F0] opacity-80 shadow-xs"
                      : "border-[#E2E8F0] shadow-xs hover:border-[#FED7AA]"
                  )}
                >
                  {/* Document Header Bar */}
                  <div className="bg-[#FFF7ED] px-4 py-2.5 border-b border-[#FED7AA]/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileBadge className="h-4 w-4 text-[#EA580C]" />
                      <span className="text-[11px] font-bold text-[#EA580C] uppercase tracking-wider">
                        Call Letter
                      </span>
                    </div>
                    <Badge variant="orange" size="sm" className="px-1.5 py-0 text-[10px] font-bold">
                      {ac.statusText || "Released"}
                    </Badge>
                  </div>

                  {/* Document Body Content */}
                  <div className="p-4 space-y-2 flex-1 flex flex-col justify-between">
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#475569] block truncate">
                        {ac.organization}
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug line-clamp-2">
                        {ac.title}
                      </h4>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-[#475569]">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-slate-400" />
                        <span>Released: {formatDate(ac.releaseDateIso)}</span>
                      </div>

                      <a
                        href={ac.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-bold text-[#EA580C] hover:underline"
                      >
                        <span>Download ↗</span>
                      </a>
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
};
