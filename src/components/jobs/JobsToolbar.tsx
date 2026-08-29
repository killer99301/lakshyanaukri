"use client";

import React from "react";
import { LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobsToolbarProps {
  totalCount: number;
  sortBy: string;
  setSortBy: (sort: string) => void;
  viewMode: "compact-list" | "card-grid";
  setViewMode: (mode: "compact-list" | "card-grid") => void;
  onOpenMobileFilters?: () => void;
}

export const JobsToolbar: React.FC<JobsToolbarProps> = ({
  totalCount,
  sortBy,
  setSortBy,
  viewMode,
  setViewMode,
  onOpenMobileFilters,
}) => {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
      {/* Left Results Count */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-black text-[#0F172A]">
          {totalCount.toLocaleString()}
        </span>
        <span className="text-xs font-semibold text-[#475569]">
          Jobs Found
        </span>
      </div>

      {/* Right Controls: Sort Selector + View Switcher + Mobile Filter Trigger */}
      <div className="flex items-center gap-2.5">
        {/* Mobile Filter Button */}
        {onOpenMobileFilters && (
          <button
            onClick={onOpenMobileFilters}
            className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#EA580C]" />
            <span>Filters</span>
          </button>
        )}

        {/* Sort Selector */}
        <div className="flex items-center gap-1.5 text-xs text-[#475569]">
          <span className="font-semibold hidden sm:inline">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-8 pl-2.5 pr-7 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 appearance-none cursor-pointer"
          >
            <option value="latest">Latest</option>
            <option value="closing-soon">Closing Soon</option>
            <option value="vacancies-high">Vacancies (High to Low)</option>
          </select>
        </div>

        {/* Grid / List View Toggle */}
        <div className="hidden sm:flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
          <button
            onClick={() => setViewMode("compact-list")}
            title="List View"
            className={cn(
              "p-1.5 rounded-lg transition-colors cursor-pointer",
              viewMode === "compact-list" ? "bg-white text-[#EA580C] shadow-2xs" : "text-slate-400 hover:text-[#0F172A]"
            )}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("card-grid")}
            title="Grid View"
            className={cn(
              "p-1.5 rounded-lg transition-colors cursor-pointer",
              viewMode === "card-grid" ? "bg-white text-[#EA580C] shadow-2xs" : "text-slate-400 hover:text-[#0F172A]"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
