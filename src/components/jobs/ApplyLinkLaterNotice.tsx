"use client";

// ═══════════════════════════════════════════════════════════
// Public job page: the application link to be released later
// ═══════════════════════════════════════════════════════════
//
// Shown in place of an Apply Online button when the recruiting body's own
// notice says the application link will be released later
// (docs/apply-link-not-yet-open-design.md, revision 3, §4).
//
// The page is static HTML, rebuilt only on publish. So the sentences built
// into it say only what the official notice announced and what this page
// provides — true on any day. The date lines are drawn in the browser after
// loading, from the visitor's own date in India; before that, and without
// scripts, only the durable sentences are there. Nothing here says the
// official website still lacks the link: nobody has checked that.

import React, { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { dateLines, durableWords, type PublicLinkLater } from "@/lib/cms/importer/link-later";

const todayInIndia = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function ApplyLinkLaterNotice({ later }: { later: PublicLinkLater }) {
  const [today, setToday] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the visitor's date is known only in the browser, after loading
  useEffect(() => { setToday(todayInIndia()); }, []);
  const lines = today ? dateLines(later, today) : [];
  return (
    <div data-apply-link-later className="mt-5 p-4 rounded-2xl bg-sky-50 border border-sky-200 text-left">
      <div className="flex items-start gap-2.5">
        <CalendarClock className="h-5 w-5 text-sky-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          {durableWords(later).map((s, i) => (
            <p key={i} data-durable className={i === 0 ? "text-sm font-extrabold text-[#0F172A]" : "text-xs sm:text-sm font-semibold text-[#334155]"}>{s}</p>
          ))}
          {lines.map((s, i) => (
            <p key={`d${i}`} data-date-line className="text-xs font-bold text-sky-800">{s}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
