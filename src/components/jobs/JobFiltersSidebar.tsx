"use client";

import React, { useState } from "react";
import { Filter, RotateCcw, ChevronDown, ChevronUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFilterCounts } from "@/lib/filters";
import { getAllVerifiedOpportunities } from "@/lib/repository";
import type { Opportunity, FilterState, Category, Qualification, Experience, ApplicationStatus } from "@/types";

interface JobFiltersSidebarProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  handleResetFilters: () => void;
  allJobs?: Opportunity[];
  className?: string;
  now?: Date;
}

export const JobFiltersSidebar: React.FC<JobFiltersSidebarProps> = ({
  filters,
  setFilters,
  handleResetFilters,
  allJobs = getAllVerifiedOpportunities(),
  className,
  now = new Date(),
}) => {
  const [openSections, setOpenSections] = useState({
    opportunityTypes: true,
    category: true,
    qualification: true,
    experience: true,
    appStatus: true,
  });

  // Calculate exact dynamic counts from the canonical dataset
  const counts = getFilterCounts(allJobs, now);

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleCheckboxToggle = (categoryKey: keyof FilterState, value: string) => {
    setFilters((prev) => {
      const currentList = (prev[categoryKey] as string[]) || [];
      const exists = currentList.includes(value);
      const updated = exists ? currentList.filter((item) => item !== value) : [...currentList, value];
      return { ...prev, [categoryKey]: updated };
    });
  };

  const opportunityTypeOptions = [
    { label: "Government Jobs", value: "government", count: counts.byType.government || 0 },
    { label: "Private Jobs", value: "private", count: counts.byType.private || 0 },
    { label: "Internships", value: "internship", count: counts.byType.internship || 0 },
  ];

  const categoryOptions = [
    { label: "State PSC / BPSC", value: "state-psc", count: counts.byCategory["state-psc"] || 0 },
    { label: "SSC", value: "ssc", count: counts.byCategory["ssc"] || 0 },
    { label: "Banking & Finance", value: "banking", count: counts.byCategory["banking"] || 0 },
    { label: "Railway Recruitment", value: "railway", count: counts.byCategory["railway"] || 0 },
    { label: "Teaching & KVS", value: "teaching", count: counts.byCategory["teaching"] || 0 },
    { label: "Defence & Police", value: "defence", count: counts.byCategory["defence"] || 0 },
    { label: "Government", value: "government", count: counts.byCategory["government"] || 0 },
    { label: "Private & Corporate", value: "private", count: counts.byCategory["private"] || 0 },
  ];

  const qualificationOptions = [
    { label: "10th Pass", value: "10th Pass", count: counts.byQualification["10th Pass"] || 0 },
    { label: "12th Pass", value: "12th Pass", count: counts.byQualification["12th Pass"] || 0 },
    { label: "Graduate", value: "Graduate", count: counts.byQualification["Graduate"] || 0 },
    { label: "Post Graduate", value: "Post Graduate", count: counts.byQualification["Post Graduate"] || 0 },
    { label: "Diploma", value: "Diploma", count: counts.byQualification["Diploma"] || 0 },
    { label: "ITI", value: "ITI", count: counts.byQualification["ITI"] || 0 },
  ];

  const experienceOptions = [
    { label: "Fresher", value: "Fresher", count: counts.byExperience["Fresher"] || 0 },
    { label: "0–2 Years", value: "0–2 Years", count: counts.byExperience["0–2 Years"] || 0 },
    { label: "1–3 Years", value: "1–3 Years", count: counts.byExperience["1–3 Years"] || 0 },
    { label: "2–5 Years", value: "2–5 Years", count: counts.byExperience["2–5 Years"] || 0 },
    { label: "3–5 Years", value: "3–5 Years", count: counts.byExperience["3–5 Years"] || 0 },
  ];

  const appStatusOptions = [
    { label: "Applications Open", value: "OPEN", count: (counts.byAppStatus.OPEN || 0) + (counts.byAppStatus.CLOSING_SOON || 0) },
    { label: "Closing Soon", value: "CLOSING_SOON", count: counts.byAppStatus.CLOSING_SOON || 0 },
    { label: "Closed", value: "APPLICATIONS_CLOSED", count: counts.byAppStatus.APPLICATIONS_CLOSED || 0 },
  ];

  return (
    <aside className={cn("bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-2xs space-y-4", className)}>
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[#EA580C]" />
          <h3 className="text-sm font-bold text-[#0F172A]">Filter Jobs</h3>
        </div>

        <button
          onClick={handleResetFilters}
          className="text-xs font-bold text-[#EA580C] hover:underline flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Clear All</span>
        </button>
      </div>

      {/* 1. Opportunity Type Section */}
      <div className="space-y-2 border-b border-slate-100 pb-3">
        <button
          onClick={() => toggleSection("opportunityTypes")}
          className="w-full flex items-center justify-between text-xs font-bold text-[#0F172A] cursor-pointer"
        >
          <span>Opportunity Type</span>
          {openSections.opportunityTypes ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>

        {openSections.opportunityTypes && (
          <div className="space-y-1.5 pt-1">
            {opportunityTypeOptions.map((opt) => {
              const checked = filters.types?.includes(opt.value as Opportunity["type"]);
              const isDisabled = opt.count === 0 && !checked;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex items-center justify-between text-xs transition-colors",
                    isDisabled
                      ? "opacity-35 cursor-not-allowed select-none text-slate-400"
                      : "text-[#475569] hover:text-[#0F172A] cursor-pointer group"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      onClick={() => !isDisabled && handleCheckboxToggle("types", opt.value)}
                      className={cn(
                        "h-4 w-4 rounded border transition-colors flex items-center justify-center shrink-0",
                        checked
                          ? "bg-[#EA580C] border-[#EA580C] text-white"
                          : isDisabled
                          ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                          : "border-slate-300 group-hover:border-[#FED7AA] bg-white cursor-pointer"
                      )}
                    >
                      {checked && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className={cn("font-semibold", isDisabled ? "text-slate-400" : "text-[#0F172A]")}>
                      {opt.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded",
                      isDisabled ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {opt.count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Application Status Section */}
      <div className="space-y-2 border-b border-slate-100 pb-3">
        <button
          onClick={() => toggleSection("appStatus")}
          className="w-full flex items-center justify-between text-xs font-bold text-[#0F172A] cursor-pointer"
        >
          <span>Application Status</span>
          {openSections.appStatus ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>

        {openSections.appStatus && (
          <div className="space-y-1.5 pt-1">
            {appStatusOptions.map((opt) => {
              const checked = filters.applicationStatuses?.includes(opt.value as ApplicationStatus);
              const isDisabled = opt.count === 0 && !checked;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex items-center justify-between text-xs transition-colors",
                    isDisabled
                      ? "opacity-35 cursor-not-allowed select-none text-slate-400"
                      : "text-[#475569] hover:text-[#0F172A] cursor-pointer group"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      onClick={() => !isDisabled && handleCheckboxToggle("applicationStatuses", opt.value)}
                      className={cn(
                        "h-4 w-4 rounded border transition-colors flex items-center justify-center shrink-0",
                        checked
                          ? "bg-[#EA580C] border-[#EA580C] text-white"
                          : isDisabled
                          ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                          : "border-slate-300 group-hover:border-[#FED7AA] bg-white cursor-pointer"
                      )}
                    >
                      {checked && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className={cn("font-semibold", isDisabled ? "text-slate-400" : "text-[#0F172A]")}>
                      {opt.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded",
                      isDisabled ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {opt.count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Category Section */}
      <div className="space-y-2 border-b border-slate-100 pb-3">
        <button
          onClick={() => toggleSection("category")}
          className="w-full flex items-center justify-between text-xs font-bold text-[#0F172A] cursor-pointer"
        >
          <span>Category</span>
          {openSections.category ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>

        {openSections.category && (
          <div className="space-y-1.5 pt-1">
            {categoryOptions.map((opt) => {
              const checked = filters.categories.includes(opt.value as Category);
              const isDisabled = opt.count === 0 && !checked;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex items-center justify-between text-xs transition-colors",
                    isDisabled
                      ? "opacity-35 cursor-not-allowed select-none text-slate-400"
                      : "text-[#475569] hover:text-[#0F172A] cursor-pointer group"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      onClick={() => !isDisabled && handleCheckboxToggle("categories", opt.value)}
                      className={cn(
                        "h-4 w-4 rounded border transition-colors flex items-center justify-center shrink-0",
                        checked
                          ? "bg-[#EA580C] border-[#EA580C] text-white"
                          : isDisabled
                          ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                          : "border-slate-300 group-hover:border-[#FED7AA] bg-white cursor-pointer"
                      )}
                    >
                      {checked && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className={cn("font-semibold", isDisabled ? "text-slate-400" : "text-[#0F172A]")}>
                      {opt.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded",
                      isDisabled ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {opt.count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Qualification Section */}
      <div className="space-y-2 border-b border-slate-100 pb-3">
        <button
          onClick={() => toggleSection("qualification")}
          className="w-full flex items-center justify-between text-xs font-bold text-[#0F172A] cursor-pointer"
        >
          <span>Qualification</span>
          {openSections.qualification ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>

        {openSections.qualification && (
          <div className="space-y-1.5 pt-1">
            {qualificationOptions.map((opt) => {
              const checked = filters.qualifications.includes(opt.value as Qualification);
              const isDisabled = opt.count === 0 && !checked;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex items-center justify-between text-xs transition-colors",
                    isDisabled
                      ? "opacity-35 cursor-not-allowed select-none text-slate-400"
                      : "text-[#475569] hover:text-[#0F172A] cursor-pointer group"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      onClick={() => !isDisabled && handleCheckboxToggle("qualifications", opt.value)}
                      className={cn(
                        "h-4 w-4 rounded border transition-colors flex items-center justify-center shrink-0",
                        checked
                          ? "bg-[#EA580C] border-[#EA580C] text-white"
                          : isDisabled
                          ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                          : "border-slate-300 group-hover:border-[#FED7AA] bg-white cursor-pointer"
                      )}
                    >
                      {checked && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className={cn("font-semibold", isDisabled ? "text-slate-400" : "text-[#0F172A]")}>
                      {opt.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded",
                      isDisabled ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {opt.count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Experience Section */}
      <div className="space-y-2">
        <button
          onClick={() => toggleSection("experience")}
          className="w-full flex items-center justify-between text-xs font-bold text-[#0F172A] cursor-pointer"
        >
          <span>Experience</span>
          {openSections.experience ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>

        {openSections.experience && (
          <div className="space-y-1.5 pt-1">
            {experienceOptions.map((opt) => {
              const checked = filters.experiences.includes(opt.value as Experience);
              const isDisabled = opt.count === 0 && !checked;
              return (
                <label
                  key={opt.value}
                  className={cn(
                    "flex items-center justify-between text-xs transition-colors",
                    isDisabled
                      ? "opacity-35 cursor-not-allowed select-none text-slate-400"
                      : "text-[#475569] hover:text-[#0F172A] cursor-pointer group"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      onClick={() => !isDisabled && handleCheckboxToggle("experiences", opt.value)}
                      className={cn(
                        "h-4 w-4 rounded border transition-colors flex items-center justify-center shrink-0",
                        checked
                          ? "bg-[#EA580C] border-[#EA580C] text-white"
                          : isDisabled
                          ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                          : "border-slate-300 group-hover:border-[#FED7AA] bg-white cursor-pointer"
                      )}
                    >
                      {checked && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className={cn("font-semibold", isDisabled ? "text-slate-400" : "text-[#0F172A]")}>
                      {opt.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-extrabold font-mono px-1.5 py-0.5 rounded",
                      isDisabled ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {opt.count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
