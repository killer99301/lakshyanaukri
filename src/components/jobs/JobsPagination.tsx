"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobsPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const JobsPagination: React.FC<JobsPaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  className,
}) => {
  // If all items fit on 1 page or 0 items, hide pagination bar
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1);

  return (
    <div className={cn("flex items-center justify-center gap-1.5 pt-4", className)}>
      {/* Previous Button */}
      <button
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="h-8 w-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-[#0F172A] hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Page Number Buttons */}
      {pages.map((p) => {
        const isActive = p === currentPage;
        return (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={cn(
              "h-8 w-8 rounded-xl text-xs font-bold transition-all cursor-pointer",
              isActive
                ? "bg-[#EA580C] text-white shadow-2xs"
                : "bg-white border border-slate-200 text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C]"
            )}
          >
            {p}
          </button>
        );
      })}

      {/* Ellipsis if totalPages > 5 */}
      {totalPages > 5 && <span className="text-xs text-slate-400 font-bold px-1">...</span>}

      {/* Total Pages Button if totalPages > 5 */}
      {totalPages > 5 && (
        <button
          onClick={() => onPageChange(totalPages)}
          className={cn(
            "h-8 min-w-8 px-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors",
            currentPage === totalPages
              ? "bg-[#EA580C] text-white shadow-2xs border-[#EA580C]"
              : "bg-white border-slate-200 text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C]"
          )}
        >
          {totalPages}
        </button>
      )}

      {/* Next Button */}
      <button
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="h-8 w-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:text-[#0F172A] hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
};
