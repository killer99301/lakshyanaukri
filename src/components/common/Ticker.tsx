"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "../ui/Badge";
import { IMPORTANT_UPDATES } from "@/data/homepage";
import { getAllVerifiedOpportunities } from "@/lib/repository";
import { deriveStatusBadge, getVacancyDisplay } from "@/lib/lifecycle";

export interface TickerItem {
  id: string;
  title: string;
  href: string;
  tag: string;
  tagVariant?: "coral" | "orange" | "peach" | "neutral";
}

export const Ticker: React.FC = () => {
  const now = new Date();
  const opportunities = getAllVerifiedOpportunities();

  // Combine IMPORTANT_UPDATES with key notifications from canonical repository
  const items: TickerItem[] = [
    ...IMPORTANT_UPDATES.map((up) => ({
      id: up.id,
      title: up.title,
      href: up.href,
      tag: up.tag,
      tagVariant: up.tag === "New" ? ("coral" as const) : ("orange" as const),
    })),
    ...opportunities.slice(0, 4).map((job) => {
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
