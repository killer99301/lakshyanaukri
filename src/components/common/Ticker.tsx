"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "../ui/Badge";
import { deriveStatusBadge, getVacancyDisplay } from "@/lib/lifecycle";
import type { Opportunity } from "@/types";

export interface TickerItem {
  id: string;
  title: string;
  href: string;
  tag: string;
  tagVariant?: "coral" | "orange" | "peach" | "neutral";
}

interface TickerProps {
  opportunities?: Opportunity[];
}

export const Ticker: React.FC<TickerProps> = ({ opportunities = [] }) => {
  const now = new Date();

  // Built from the jobs themselves, so it can never drift from what the job pages say.
  const items: TickerItem[] = [
    ...opportunities.slice(0, 6).map((job) => {
      const statusBadge = deriveStatusBadge(job, now);
      const vacancyText = getVacancyDisplay(job);
      return {
        id: `job-ticker-${job.id}`,
        title: `${job.title} — ${vacancyText}`,
        href: `/jobs/${job.slug}`,
        tag: statusBadge.label,
        tagVariant: statusBadge.isClosed ? ("neutral" as const) : ("orange" as const),
      };
    }),
  ];

  // Duplicate items array to achieve a seamless infinite loop
  const duplicatedItems = [...items, ...items];

  return (
    <div className="overflow-hidden w-full relative">
      <div className="animate-ticker space-x-6 sm:space-x-8 py-1">
        {duplicatedItems.map((item, index) => (
          <Link
            key={`${item.id}-${index}`}
            href={item.href}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#0F172A] hover:text-[#EA580C] transition-colors group shrink-0"
          >
            <Badge variant={item.tagVariant || "neutral"} size="sm">
              {item.tag}
            </Badge>
            <span className="group-hover:underline">{item.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
};
