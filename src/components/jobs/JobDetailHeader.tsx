"use client";

import React from "react";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Calendar,
  ExternalLink,
  FileText,
  Share2,
  Bookmark,
  ChevronRight,
  AlertTriangle,
  Lock,
  ShieldCheck,
} from "lucide-react";
import type { Opportunity } from "@/types";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import {
  getOpportunityCloseDate,
  getDaysRemaining,
  deriveStatusBadge,
  getVacancyDisplay,
  getProvenanceSummary,
  getLatestUpdate,
  getCategoryBadgeClass,
  getCategoryLabel,
  getCurrentExamSummary,
} from "@/lib/lifecycle";
import { getDeadlineUrgency, formatDeadlineDate } from "@/lib/urgency";

interface JobDetailHeaderProps {
  job: Opportunity;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  now?: Date;
}

export const JobDetailHeader: React.FC<JobDetailHeaderProps> = ({
  job,
  isBookmarked,
  onToggleBookmark,
  now = new Date(),
}) => {
  const closeDate = getOpportunityCloseDate(job);
  const daysRemaining = getDaysRemaining(closeDate, now);
  const urgency = getDeadlineUrgency(daysRemaining, true);
  const derivedStatus = deriveStatusBadge(job, now);
  const isClosed = urgency.isClosed || derivedStatus.isClosed;
  const vacancyText = getVacancyDisplay(job);
  const provenance = getProvenanceSummary(job);
  const latestUpdate = getLatestUpdate(job);

  const deadlineFormatted = formatDeadlineDate(closeDate);

  const govTypeDisplay =
    job.type === "government"
      ? job.govType
      : job.type === "private"
      ? "Private"
      : "Internship";

  const examScheduleSummary =
    job.type === "government"
      ? getCurrentExamSummary(job.examStages)
      : "As per listing";

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: job.title,
          text: `Check out ${job.title} on LakshyaNaukri`,
          url: window.location.href,
        });
      } catch (e) {
        console.error("Share error:", e);
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("Job link copied to clipboard!");
    }
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-xs font-semibold text-[#475569]">
        <Link href="/" className="hover:text-[#EA580C] transition-colors">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <Link href="/jobs" className="hover:text-[#EA580C] transition-colors">
          Jobs
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="text-[#0F172A] font-bold truncate max-w-[240px] sm:max-w-md" title={job.title}>
          {job.title}
        </span>
      </nav>

      {/* Prominent Latest Update / Corrigendum Banner */}
      {latestUpdate && (
        <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border-2 border-amber-400/80 rounded-2xl p-4 text-[#0F172A] shadow-xs space-y-2 relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-amber-500 text-white shrink-0 mt-0.5 shadow-xs">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-amber-900 bg-amber-200/90 px-2 py-0.5 rounded-md">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600"></span>
                    </span>
                    <span>Official Update • {latestUpdate.type.replace(/_/g, " ")}</span>
                  </span>
                  <span className="text-xs text-amber-950 font-extrabold">
                    Published: {latestUpdate.date}
                  </span>
                </div>
                <h4 className="text-sm sm:text-base font-black text-[#0F172A] leading-snug">{latestUpdate.title}</h4>
                <p className="text-xs text-[#334155] leading-relaxed font-medium">{latestUpdate.description}</p>
                
                <div className="pt-1">
                  <a
                    href="#updates-history"
                    className="text-[11px] font-bold text-amber-800 hover:text-amber-950 underline inline-flex items-center gap-1"
                  >
                    <span>View all corrigenda & updates in history timeline ↓</span>
                  </a>
                </div>
              </div>
            </div>

            {latestUpdate.sourceUrl && (
              <a
                href={latestUpdate.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-amber-600 text-white font-extrabold text-xs shadow-xs hover:bg-amber-700 active:scale-95 transition-all shrink-0 cursor-pointer"
              >
                <span>Official PDF</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Main Header Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 sm:p-7 shadow-xs relative overflow-hidden">
        {/* Accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#EA580C] via-[#F95738] to-[#FED7AA]" />

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 pt-2">
          {/* Left Block: Logo, Title, Badges */}
          <div className="flex items-start gap-4">
            <OrganizationLogo organizationName={job.organizationName} size="xl" />

            <div className="space-y-2 min-w-0">
              {/* Badges row */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold border ${getCategoryBadgeClass(
                    job.category
                  )}`}
                >
                  {getCategoryLabel(job.category)}
                </span>

                <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-orange-50 text-[#EA580C] border border-[#FED7AA]">
                  {govTypeDisplay}
                </span>

                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${derivedStatus.badgeClass}`}>
                  {derivedStatus.label}
                </span>

                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${provenance.statusClass}`}
                  title={provenance.lastVerifiedLabel}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>{provenance.statusLabel}</span>
                </span>
              </div>

              {/* Title & Organization */}
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-[#0F172A] tracking-tight leading-snug">
                {job.title}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm font-semibold text-[#475569]">
                <span className="inline-flex items-center gap-1.5 text-[#0F172A] font-bold">
                  <Building2 className="h-4 w-4 text-[#EA580C]" />
                  {job.organizationName}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  {job.state}
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  {provenance.lastVerifiedLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Right Action Block */}
          <div className="flex flex-wrap sm:flex-nowrap lg:flex-col items-stretch lg:items-end gap-3 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
            {/* Primary Action Buttons */}
            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              {isClosed ? (
                <>
                  <button
                    disabled
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-slate-100 text-slate-500 font-extrabold text-sm border border-slate-200 cursor-not-allowed"
                  >
                    <Lock className="h-4 w-4 text-slate-400" />
                    <span>Applications Closed</span>
                  </button>

                  {job.links.website && (
                    <a
                      href={job.links.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <span>Official Portal ↗</span>
                    </a>
                  )}
                </>
              ) : (
                <>
                  {job.links.apply && (
                    <a
                      href={job.links.apply}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#EA580C] to-[#F95738] text-white font-extrabold text-sm shadow-md shadow-orange-500/20 hover:opacity-95 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <span>Apply Online</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}

                  {job.type === "government" && job.links.notification && (
                    <a
                      href={job.links.notification}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors cursor-pointer"
                      title="View Official Notification PDF"
                    >
                      <FileText className="h-4 w-4 text-orange-400" />
                      <span className="hidden sm:inline">PDF Advt</span>
                    </a>
                  )}
                  {job.type === "government" && !job.links.notification && (
                    <span
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-slate-800/50 text-slate-500 border border-slate-700 font-semibold text-xs cursor-default"
                      title="Official notification PDF link not yet verified"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">PDF Unavailable</span>
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Bookmark & Share Utility Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleBookmark}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  isBookmarked
                    ? "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]"
                    : "bg-slate-50 text-[#475569] border-slate-200 hover:bg-slate-100"
                }`}
              >
                <Bookmark className={`h-4 w-4 ${isBookmarked ? "fill-[#EA580C]" : ""}`} />
                <span>{isBookmarked ? "Saved" : "Save Job"}</span>
              </button>

              <button
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-50 text-[#475569] border border-slate-200 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
              >
                <Share2 className="h-4 w-4" />
                <span>Share</span>
              </button>
            </div>
          </div>
        </div>

        {/* Highlight Key Specs Ribbon */}
        <div className="mt-6 pt-5 border-t border-[#E2E8F0] grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">Total Vacancies</p>
            <p className="text-base sm:text-lg font-black text-[#EA580C] mt-1">{vacancyText}</p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">Qualification</p>
            <p className="text-sm sm:text-base font-extrabold text-[#0F172A] mt-1">{job.qualification}</p>
          </div>

          {/* Dynamic Urgency Apply Deadline Box */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between space-y-1">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">Apply Deadline</p>
              <p className="text-sm sm:text-base font-extrabold text-[#0F172A] mt-0.5">{deadlineFormatted}</p>
            </div>
            <div className="flex items-center justify-start pt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${urgency.badgeClass}`}>
                {!urgency.isClosed && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
                <span>{urgency.label}</span>
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#475569]">Exam Schedule</p>
            <p className="text-xs sm:text-sm font-extrabold text-[#0F172A] mt-1 leading-snug break-words">
              {examScheduleSummary}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
