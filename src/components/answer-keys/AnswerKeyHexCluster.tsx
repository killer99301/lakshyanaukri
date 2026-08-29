import React, { useState } from "react";
import { KeyRound, Calendar } from "lucide-react";
import { HOMEPAGE_ANSWER_KEYS } from "@/data/homepage";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";
import { formatDate, cn } from "@/lib/utils";

export const AnswerKeyHexCluster: React.FC = () => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const getFloatClass = (idx: number) => {
    const classes = ["idle-float-1", "idle-float-2", "idle-float-3"];
    return classes[idx % classes.length];
  };

  return (
    <section>
      <Container>
        <SectionHeading
          title="Latest Answer Keys"
          subtitle="Official provisional & final answer keys, response sheets, and objection portals."
          actionText="View All Answer Keys"
          actionHref="/answer-keys"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {HOMEPAGE_ANSWER_KEYS.map((ak, idx) => {
            const isHovered = hoveredIdx === idx;
            const isOtherHovered = hoveredIdx !== null && !isHovered;

            return (
              <div
                key={ak.id}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={isHovered ? { animation: "none" } : undefined}
                className={cn("group transition-all duration-300", !isHovered && getFloatClass(idx))}
              >
                <Card
                  className={cn(
                    "bg-white border rounded-2xl p-4 flex items-center gap-3.5 relative transition-all duration-300",
                    isHovered
                      ? "border-[#EA580C] shadow-md shadow-orange-500/10 -translate-y-1.5 scale-[1.015]"
                      : isOtherHovered
                      ? "border-[#E2E8F0] opacity-80 shadow-xs"
                      : "border-[#E2E8F0] shadow-xs hover:border-[#FED7AA]"
                  )}
                >
                  {/* Tasteful Hexagonal Emblem Pod */}
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#FFF7ED] to-white border border-[#FED7AA] flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-110 group-hover:rotate-6 group-hover:border-[#EA580C] transition-transform">
                    <KeyRound className="h-5 w-5 text-[#EA580C]" />
                  </div>

                  {/* Content Info */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="peach" size="sm" className="px-1.5 py-0 text-[10px] font-bold">
                        {ak.statusText || "Key Out"}
                      </Badge>
                      <span className="text-[11px] font-semibold text-[#475569] truncate">
                        {ak.organization}
                      </span>
                    </div>

                    <h4 className="text-xs sm:text-sm font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug line-clamp-1">
                      {ak.title}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-[#475569] pt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-slate-400" />
                        <span>{formatDate(ak.releaseDateIso)}</span>
                      </span>

                      <a
                        href={ak.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-bold text-[#EA580C] hover:underline"
                      >
                        <span>Check Key ↗</span>
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
