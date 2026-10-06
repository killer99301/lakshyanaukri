"use client";

import React from "react";
import { ChevronRight, Compass } from "lucide-react";
import type { Opportunity } from "@/types";
import { getOpportunityApplicationStatus } from "@/lib/lifecycle";
import { siteConfig } from "@/config/site";

/**
 * Link to AnantaMarg's "Starting Important Work" muhurat (its Exam Form / Job
 * Application purpose).
 *
 * Shown ONLY on a real exam or job notice that can still be applied for. It is
 * not for the home page, listings, results pages or closed notices: a good day
 * to apply means nothing where there is nothing to apply to.
 *
 * The wording keeps AnantaMarg's own fixed line: the deadline comes first.
 */
export function MuhuratCard({ job }: { job: Opportunity }) {
  if (job.type !== "government") return null;
  // Decided in the browser, so a cached page stops showing it once the last date has passed.
  if (getOpportunityApplicationStatus(job, new Date()) === "APPLICATIONS_CLOSED") return null;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-xs space-y-3">
      <div className="flex items-center gap-2.5 text-[#0F172A]">
        <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
          <Compass className="h-4 w-4" />
        </div>
        <div>
          <h4 className="text-sm font-black text-[#0F172A]">AnantaMarg Muhurat</h4>
          <p className="text-[11px] text-[#475569] font-medium">Starting Important Work</p>
        </div>
      </div>
      <p className="text-xs text-[#475569] leading-relaxed">
        Days a traditional panchang considers good for filling an exam form or job application.
      </p>
      <p className="text-[11px] font-bold text-[#0F172A] leading-relaxed bg-[#FFF7ED] border border-[#FED7AA] rounded-xl px-3 py-2">
        Your deadline comes first. Never delay a required application to wait for a favourable time.
      </p>
      <a
        href={siteConfig.ecosystem.anantamarg.muhuratUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-between w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-colors cursor-pointer"
      >
        <span>See good days to apply ↗</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
