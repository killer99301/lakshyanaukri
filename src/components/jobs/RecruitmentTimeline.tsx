"use client";

import React from "react";
import { ArrowRight, Check, Clock, HelpCircle } from "lucide-react";
import type { Opportunity } from "@/types";
import { buildTimeline, whatsNext, type TimelineState } from "@/lib/timeline";
import { cn } from "@/lib/utils";

const DOT: Record<TimelineState, string> = {
  done: "bg-emerald-500 border-emerald-500 text-white",
  next: "bg-[#EA580C] border-[#EA580C] text-white ring-4 ring-[#FFF7ED]",
  upcoming: "bg-white border-slate-300 text-slate-400",
  awaiting: "bg-amber-50 border-amber-300 text-amber-600",
  unknown: "bg-white border-dashed border-slate-300 text-slate-300",
};

const STATE_NOTE: Partial<Record<TimelineState, string>> = {
  next: "Next",
  awaiting: "Date passed — awaiting an official update",
};

/**
 * "What's next" and the dated path of a recruitment, from the application
 * window and its exam stages. Computed in the browser so a cached page moves
 * on by itself as dates pass.
 */
export function RecruitmentTimeline({ job }: { job: Opportunity }) {
  const now = new Date();
  const events = buildTimeline(job, now);
  const next = whatsNext(job, now);
  if (events.length === 0) return null;

  return (
    <div className="space-y-4">
      {next && (
        <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl px-4 py-3 flex items-start gap-3">
          <div className="h-8 w-8 rounded-xl bg-white border border-[#FED7AA] flex items-center justify-center text-[#EA580C] shrink-0">
            <ArrowRight className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#C2410C]">What&apos;s next</p>
            <p className="text-sm font-extrabold text-[#0F172A] leading-snug">{next.title}</p>
            <p className="text-xs text-[#475569] font-semibold mt-0.5">{next.detail}</p>
          </div>
        </div>
      )}

      <ol className="relative pl-1">
        {events.map((event, index) => (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The line joining this dot to the one below */}
            {index < events.length - 1 && (
              <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-200" />
            )}
            <span
              className={cn(
                "relative z-10 h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                DOT[event.state],
              )}
            >
              {event.state === "done" ? (
                <Check className="h-3.5 w-3.5 stroke-[3]" />
              ) : event.state === "unknown" ? (
                <HelpCircle className="h-3 w-3" />
              ) : (
                <Clock className="h-3 w-3" />
              )}
            </span>
            <div className="min-w-0 flex-1 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className={cn("text-xs sm:text-sm font-bold leading-snug", event.state === "unknown" ? "text-[#475569]" : "text-[#0F172A]")}>
                  {event.label}
                </p>
                {(event.note || STATE_NOTE[event.state]) && (
                  <p className={cn("text-[11px] font-semibold mt-0.5", event.state === "next" ? "text-[#C2410C]" : event.state === "awaiting" ? "text-amber-700" : "text-[#475569]")}>
                    {[STATE_NOTE[event.state], event.note].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <p className={cn("text-xs sm:text-sm font-extrabold text-right shrink-0", event.state === "unknown" ? "text-slate-400" : "text-[#0F172A]")}>
                {event.dateText}
                {event.tentative && <span className="block text-[10px] font-bold text-amber-700 uppercase tracking-wide">Tentative</span>}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
