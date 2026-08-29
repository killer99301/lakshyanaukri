"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Users,
  GraduationCap,
  Briefcase,
  Bookmark,
  ArrowRight,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type { Opportunity } from "@/types";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { CardHover } from "@/components/common/motion/CardHover";
import {
  getOpportunityCloseDate,
  getDaysRemaining,
  deriveStatusBadge,
  getVacancyDisplay,
  getProvenanceSummary,
  getCurrentExamSummary,
} from "@/lib/lifecycle";
import { getDeadlineUrgency, formatDeadlineDate } from "@/lib/urgency";
import { cn } from "@/lib/utils";

interface MarketplaceJobCardProps {
  job: Opportunity;
  isBookmarked?: boolean;
  onToggleBookmark?: (id: string) => void;
  className?: string;
  now?: Date;
}

export const MarketplaceJobCard: React.FC<MarketplaceJobCardProps> = ({
  job,
  isBookmarked = false,
  onToggleBookmark,
  className,
  now = new Date(),
}) => {
  const [saved, setSaved] = useState(isBookmarked);
  
  const closeDate = getOpportunityCloseDate(job);
  const isDeadlineKnown = Boolean(closeDate);
  const daysRemaining = isDeadlineKnown ? getDaysRemaining(closeDate, now) : 0;
  const urgency = getDeadlineUrgency(daysRemaining, isDeadlineKnown);
  const derivedStatus = deriveStatusBadge(job, now);
  const vacancyText = getVacancyDisplay(job);
  const provenance = getProvenanceSummary(job);

  const deadlineFormatted = formatDeadlineDate(closeDate);

  const govTypeDisplay =
    job.type === "government"
      ? job.govType
      : job.type === "private"
      ? "Private"
      : "Internship";

  const jobTypeDisplay =
    job.type === "private"
      ? job.jobType
      : job.type === "internship"
      ? "Internship"
      : "Full Time";

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSaved(!saved);
    if (onToggleBookmark) onToggleBookmark(job.id);
  };

  return (
    <CardHover>
      <Card
        className={cn(
          "p-4 bg-white border border-[#E2E8F0] rounded-2xl flex flex-col justify-between gap-3 group relative overflow-hidden",
          className
        )}
      >
        {/* Top Header Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Official Logo / Initials Pod */}
            <OrganizationLogo organizationName={job.organizationName} size="md" />

            {/* Title & Organization Info */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/jobs/${job.slug}`} className="min-w-0 flex-1">
                  <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug line-clamp-2">
                    {job.title}
                  </h3>
                </Link>
                <div className="shrink-0 flex items-center justify-end">
                  <span
                    className={cn(
                      "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border tracking-tight text-center whitespace-nowrap",
                      derivedStatus.badgeClass
                    )}
                  >
                    {derivedStatus.label}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[#475569] font-medium flex-wrap">
                <span className="font-semibold text-[#0F172A] line-clamp-1">
                  {job.organizationName}
                </span>
                <span>•</span>
                <span className="text-[#EA580C] font-semibold">{govTypeDisplay}</span>
                <span>•</span>
                <span>{job.state}</span>
              </div>
            </div>
          </div>

          {/* Bookmark Save Button */}
          <button
            onClick={handleBookmarkClick}
            title={saved ? "Remove Bookmark" : "Save Job"}
            className={cn(
              "p-2 rounded-xl border transition-all cursor-pointer shrink-0 mt-0.5",
              saved
                ? "bg-[#FFF7ED] border-[#FED7AA] text-[#EA580C] shadow-2xs"
                : "bg-slate-50 border-slate-200 text-slate-400 hover:text-[#EA580C] hover:border-[#FED7AA] hover:bg-[#FFF7ED]"
            )}
          >
            <Bookmark className={cn("h-4 w-4", saved && "fill-[#EA580C]")} />
          </button>
        </div>

        {/* Key Stats Grid - Flexible to ensure complete vacancy text readability */}
        <div className="flex items-center justify-between gap-2 py-2 border-y border-slate-100 text-xs flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-1.5 text-[#0F172A] font-extrabold shrink-0" title={vacancyText}>
            <Users className="h-3.5 w-3.5 text-[#EA580C] shrink-0" />
            <span>{vacancyText}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[#475569] font-semibold shrink-0">
            <GraduationCap className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>{job.qualification}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[#475569] font-semibold shrink-0">
            <Briefcase className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>{jobTypeDisplay}</span>
          </div>
        </div>

        {/* Bottom Dynamic Urgency Deadline & CTA Action Row */}
        <div className="flex items-center justify-between gap-3 pt-1 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-1.5 text-xs text-[#475569] flex-wrap">
            {urgency.isClosed ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-200">
                <Lock className="h-3 w-3 text-slate-400" />
                <span>Applications Closed</span>
              </span>
            ) : (
              <>
                <span className="font-semibold text-slate-600">Apply by {deadlineFormatted}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border",
                    urgency.badgeClass
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  <span>{urgency.label}</span>
                </span>
              </>
            )}

            {/* Secondary Exam Status Indicator for Government opportunities when closed */}
            {job.type === "government" && (
              (() => {
                const examSummary = getCurrentExamSummary(job.examStages);
                if (examSummary && !examSummary.includes("not declared") && !derivedStatus.label.includes("Postponed")) {
                  return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200" title={examSummary}>
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span className="max-w-[140px] truncate">{examSummary}</span>
                    </span>
                  );
                }
                return null;
              })()
            )}
            
            {/* Provenance Badge */}
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
                provenance.statusClass
              )}
              title={provenance.lastVerifiedLabel}
            >
              <ShieldCheck className="h-3 w-3" />
              <span>{provenance.statusLabel}</span>
            </span>
          </div>

          <Link href={`/jobs/${job.slug}`} className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="px-3.5 py-1.5 text-xs font-bold border-[#FED7AA] text-[#EA580C] hover:bg-[#FFF7ED] rounded-xl gap-1 group/btn"
            >
              <span>View Details</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-1" />
            </Button>
          </Link>
        </div>
      </Card>
    </CardHover>
  );
};
