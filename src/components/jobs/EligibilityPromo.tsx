import React from "react";
import Link from "next/link";
import { ArrowRight, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The way in to the eligibility finder, shown near the top of the home page
 * and the jobs page. A single link: the whole strip is clickable.
 */
export function EligibilityPromo({ className }: { className?: string }) {
  return (
    <Link
      href="/eligibility"
      className={cn(
        "group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl p-4 sm:p-5 shadow-xs",
        "bg-gradient-to-r from-[#0F172A] via-slate-900 to-[#7C2D12] text-white hover:shadow-md transition-shadow",
        className,
      )}
    >
      <span className="flex items-start sm:items-center gap-3 min-w-0">
        <span className="h-10 w-10 rounded-xl bg-orange-500/20 border border-orange-400/30 flex items-center justify-center text-orange-200 shrink-0">
          <UserCheck className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm sm:text-base font-black leading-snug">Which jobs can I apply for?</span>
          <span className="block text-xs text-slate-300 font-medium leading-relaxed mt-0.5">
            Enter your date of birth and qualification. We check your age against every open job’s own cut-off date.
          </span>
        </span>
      </span>
      <span className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl bg-[#EA580C] text-white text-sm font-extrabold shrink-0 group-hover:bg-[#C2410C] transition-colors">
        Check my eligibility
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
