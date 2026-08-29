"use client";

import React from "react";
import Link from "next/link";
import { Users, ArrowRight, Lock } from "lucide-react";
import type { Opportunity } from "@/types";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { CardHover } from "@/components/common/motion/CardHover";
import {
  getOpportunityCloseDate,
  getDaysRemaining,
  deriveStatusBadge,
  getVacancyDisplay,
  getProvenanceSummary,
} from "@/lib/lifecycle";
import { getDeadlineUrgency, formatDeadlineDate } from "@/lib/urgency";

export interface JobCardProps {
  job: Opportunity;
  isFeatured?: boolean;
  className?: string;
  now?: Date;
}

export const JobCard: React.FC<JobCardProps> = ({
  job,
  isFeatured = false,
  className,
  now = new Date(),
}) => {
  const closeDate = getOpportunityCloseDate(job);
  const isDeadlineKnown = Boolean(closeDate);
  const daysRemaining = isDeadlineKnown ? getDaysRemaining(closeDate, now) : 0;
  const urgency = getDeadlineUrgency(daysRemaining, isDeadlineKnown);
  const derivedStatus = deriveStatusBadge(job, now);
  const formattedVacancies = getVacancyDisplay(job);
  const provenance = getProvenanceSummary(job);

  const deadlineFormatted = formatDeadlineDate(closeDate);

  const govTypeDisplay =
    job.type === "government"
      ? job.govType
      : job.type === "private"
      ? "Private"
      : "Internship";

  return (
    <Link href={`/jobs/${job.slug}`} className="block h-full group">
      <CardHover className="h-full">
        <div
          className={`p-4 flex flex-col justify-between h-full bg-white border border-[#E2E8F0] rounded-2xl ${
            isFeatured ? "flowing-border" : ""
          } ${className || ""}`}
        >
          <div className="space-y-3">
            {/* Top Header: Logo, Badges, Title & Action Arrow */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <OrganizationLogo organizationName={job.organizationName} size="md" />

                <div className="min-w-0 space-y-1 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border ${derivedStatus.badgeClass}`}>
                      {derivedStatus.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700">
                      {govTypeDisplay}
                    </span>
                  </div>

                  <h3 className="text-sm font-extrabold text-[#0F172A] line-clamp-1 group-hover:text-[#EA580C] transition-colors leading-snug">
                    {job.title}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-[#475569] font-medium truncate">
                    <span className="font-semibold text-[#0F172A] truncate max-w-[180px]">{job.organizationName}</span>
                    <span>•</span>
                    <span>{job.state}</span>
                  </div>
                </div>
              </div>

              <div className="h-7 w-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center group-hover:bg-[#FFF7ED] group-hover:border-[#FED7AA] group-hover:text-[#EA580C] transition-all shrink-0 mt-0.5 shadow-2xs">
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#EA580C] group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>

            {/* Middle specs ribbon */}
            <div className="grid grid-cols-2 gap-2 text-xs py-1.5 px-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Qualification</span>
                <span className="font-extrabold text-[#0F172A] truncate block">{job.qualification}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Verification</span>
                <span className="font-extrabold text-[#0F172A] truncate block">{provenance.statusLabel}</span>
              </div>
            </div>

            {/* Footer info strip: Vacancies & Dynamic Urgency Deadline */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs flex-wrap gap-1.5">
              <div className="flex items-center gap-1 font-extrabold text-[#EA580C] shrink-0" title={formattedVacancies}>
                <Users className="h-3.5 w-3.5 shrink-0 text-[#EA580C]" />
                <span>{formattedVacancies}</span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {urgency.isClosed ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 border border-slate-200">
                    <Lock className="h-3 w-3 text-slate-400" />
                    <span>Applications Closed</span>
                  </span>
                ) : (
                  <>
                    <span className="font-medium text-slate-500 text-[11px]">Apply by {deadlineFormatted}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${urgency.badgeClass}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                      <span>{urgency.label}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHover>
    </Link>
  );
};
