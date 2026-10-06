"use client";

import React from "react";
import { ChevronRight, Compass, ExternalLink } from "lucide-react";
import type { Opportunity } from "@/types";
import { getOpportunityApplicationStatus } from "@/lib/lifecycle";
import { siteConfig } from "@/config/site";

// ═══════════════════════════════════════════════════════════
// AnantaMarg links for someone about to fill a form
// ═══════════════════════════════════════════════════════════
//
// Offered on every exam or job notice that can still be applied for — beside
// the apply button, with the how-to-apply steps, and in the sidebar. Never on
// the home page, listings, results pages or closed notices: a good day to
// apply means nothing where there is nothing to apply to.
//
// The wording always keeps AnantaMarg's own fixed line: the deadline comes first.

const DEADLINE_FIRST = "Your deadline comes first. Never delay a required application to wait for a favourable time.";

interface MuhuratLink {
  label: string;
  href: string;
}

/** The links to offer for this job, or none if it is not an open notice. Decided in the browser, so a cached page stops showing them once the last date has passed. */
function linksFor(job: Opportunity): MuhuratLink[] {
  if (job.type !== "government") return [];
  if (getOpportunityApplicationStatus(job, new Date()) === "APPLICATIONS_CLOSED") return [];
  const { anantamarg } = siteConfig.ecosystem;
  const links: MuhuratLink[] = [];
  // The muhurat finder gains its "Exam Form / Job Application" purpose in a later AnantaMarg release.
  if (anantamarg.formMuhuratLive) links.push({ label: "Best muhurat to fill the form", href: anantamarg.muhuratUrl });
  links.push({ label: "Today's panchang & Rahu Kaal", href: anantamarg.panchangUrl });
  return links;
}

/** One compact line, for beside the apply button and under the how-to-apply steps. */
export function MuhuratPrompt({ job, className }: { job: Opportunity; className?: string }) {
  const links = linksFor(job);
  if (links.length === 0) return null;
  return (
    <div className={`bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl px-4 py-3 ${className ?? ""}`}>
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-xs font-black text-[#0F172A]">
          <Compass className="h-3.5 w-3.5 text-[#EA580C]" />
          Before you fill the form
        </span>
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-extrabold text-[#EA580C] hover:underline"
          >
            <span>{link.label}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        ))}
        <span className="text-[11px] text-[#475569] font-medium">on AnantaMarg</span>
      </div>
      <p className="text-[11px] text-[#475569] mt-1.5 leading-relaxed">{DEADLINE_FIRST}</p>
    </div>
  );
}

/** The sidebar card on a job page. */
export function MuhuratCard({ job }: { job: Opportunity }) {
  const links = linksFor(job);
  if (links.length === 0) return null;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-xs space-y-3">
      <div className="flex items-center gap-2.5 text-[#0F172A]">
        <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
          <Compass className="h-4 w-4" />
        </div>
        <div>
          <h4 className="text-sm font-black text-[#0F172A]">AnantaMarg</h4>
          <p className="text-[11px] text-[#475569] font-medium">Muhurat & Panchang</p>
        </div>
      </div>
      <p className="text-xs text-[#475569] leading-relaxed">
        Check the day before you fill your form: a traditional panchang view of good timings and the hours usually avoided.
      </p>
      <div className="space-y-2">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-between w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-colors cursor-pointer"
          >
            <span>{link.label} ↗</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </a>
        ))}
      </div>
      <p className="text-[11px] font-bold text-[#0F172A] leading-relaxed bg-[#FFF7ED] border border-[#FED7AA] rounded-xl px-3 py-2">
        {DEADLINE_FIRST}
      </p>
    </div>
  );
}
