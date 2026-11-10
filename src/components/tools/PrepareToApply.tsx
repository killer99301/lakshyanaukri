"use client";

// Shortcuts to the Application Tools under a job's How to Apply steps. Plain
// links: nothing about the job's own upload sizes is assumed or stored. Shown
// only while the job can still be applied for, decided in the browser (as the
// muhurat links are), so a cached page drops them once the last date passes.

import Link from "next/link";
import { Calculator, ChevronRight, ImageUp, PenLine } from "lucide-react";
import type { Opportunity } from "@/types";
import { getOpportunityApplicationStatus } from "@/lib/lifecycle";

const linkClass =
  "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-colors";

export function PrepareToApply({ job }: { job: Opportunity }) {
  if (getOpportunityApplicationStatus(job, new Date()) === "APPLICATIONS_CLOSED") return null;
  return (
    <div data-prepare-to-apply className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-black text-[#0F172A]">Preparing to apply?</h3>
        <p className="text-xs text-[#475569]">Get your files ready before opening the form, at the sizes the official notification gives.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/tools/photo-signature?mode=photo" className={linkClass}><ImageUp className="h-3.5 w-3.5" aria-hidden /> Resize photo</Link>
        <Link href="/tools/photo-signature?mode=signature" className={linkClass}><PenLine className="h-3.5 w-3.5" aria-hidden /> Resize signature</Link>
        {job.type === "government" && <a href="#eligibility" className={linkClass}><Calculator className="h-3.5 w-3.5" aria-hidden /> Check your age</a>}
        <Link href="/tools" className={linkClass}>All application tools <ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
    </div>
  );
}
