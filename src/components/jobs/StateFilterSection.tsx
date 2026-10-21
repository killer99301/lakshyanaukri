"use client";

// ═══════════════════════════════════════════════════════════
// Filter panel: State / UT
// ═══════════════════════════════════════════════════════════
//
// India has 28 states and 8 union territories, most of them with no job on
// the site at a given moment. The panel lists only the states that have
// jobs, with how many, so it stays short; "Show all states & UTs" opens the
// full list, and a search box narrows it. Choosing a state is the same choice
// as the location box beside the search bar: one setting, never two that
// disagree. Jobs open to all of India are shown whichever state is chosen.

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNationwide, stateChoiceLine, stateCounts, stateKey } from "@/lib/filters";
import { INDIAN_STATES, REGIONS_AND_UTS } from "@/components/jobs/LocationPopover";
import type { Opportunity } from "@/types";

const ALL_PLACES = [...INDIAN_STATES, ...REGIONS_AND_UTS];

export function StateFilterSection({
  allJobs,
  location,
  onLocationChange,
}: {
  allJobs: Opportunity[];
  location: string;
  onLocationChange: (location: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  const { byState, nationwide } = useMemo(() => stateCounts(allJobs), [allJobs]);
  const count = (place: string) => byState.get(stateKey(place)) ?? 0;
  const chosen = isNationwide(location) ? "" : stateKey(location);

  const withJobs = ALL_PLACES.filter((p) => count(p) > 0).sort((a, b) => count(b) - count(a) || a.localeCompare(b));
  const q = query.trim().toLowerCase();
  const list = q
    ? ALL_PLACES.filter((p) => p.toLowerCase().includes(q))
    : showAll
      ? ALL_PLACES
      : withJobs;
  // A state chosen from the search bar stays visible here even if it has no jobs.
  const shown = chosen && !list.some((p) => stateKey(p) === chosen)
    ? [ALL_PLACES.find((p) => stateKey(p) === chosen) ?? location, ...list]
    : list;

  const row = (label: string, value: string, n: number, selected: boolean) => (
    <button
      key={label}
      type="button"
      onClick={() => onLocationChange(value)}
      className={cn(
        "w-full flex items-center justify-between gap-2 text-xs text-left rounded-md px-1 py-0.5 transition-colors cursor-pointer",
        selected ? "text-[#0F172A]" : n === 0 ? "text-slate-400 hover:text-[#475569]" : "text-[#475569] hover:text-[#0F172A]",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={cn("h-3.5 w-3.5 rounded-full border shrink-0 flex items-center justify-center", selected ? "border-[#EA580C]" : "border-slate-300 bg-white")}>
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-[#EA580C]" />}
        </span>
        <span className={cn("truncate", selected ? "font-extrabold" : "font-semibold")}>{label}</span>
      </span>
      <span className={cn(
        "text-[11px] font-extrabold font-mono px-1.5 py-0.5 rounded min-w-[22px] text-center shrink-0",
        selected ? "bg-[#EA580C] text-white" : n === 0 ? "bg-slate-50 text-slate-300" : "bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]",
      )}>
        {n}
      </span>
    </button>
  );

  return (
    <div data-filter-section="state" className="space-y-2 border-b border-slate-100 pb-3 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-xs font-bold text-[#0F172A] cursor-pointer"
      >
        <span>State / UT</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>

      {open && (
        <div className="space-y-1.5 pt-1">
          <label className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1 bg-white focus-within:border-[#FED7AA]">
            <Search className="h-3 w-3 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your state…"
              aria-label="Find a state or union territory"
              className="w-full text-xs outline-none bg-transparent text-[#0F172A] placeholder:text-slate-400"
            />
          </label>

          {!q && row("All India (every state)", "All India", allJobs.length, chosen === "")}
          {shown.map((place) => row(place, place, count(place), stateKey(place) === chosen))}
          {q && shown.length === 0 && <p className="text-[11px] text-slate-400 px-1">No state or UT matches “{query}”.</p>}

          {!q && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="flex items-center gap-1 text-[11px] font-bold text-[#EA580C] hover:underline cursor-pointer px-1"
            >
              {showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showAll ? "Show only states with jobs" : `Show all ${ALL_PLACES.length} states & UTs`}
            </button>
          )}
          {chosen ? (
            <p data-state-breakdown className="text-[11px] font-semibold text-[#9A3412] bg-[#FFF7ED] border border-[#FED7AA] rounded-md leading-relaxed px-2 py-1">
              {stateChoiceLine(ALL_PLACES.find((p) => stateKey(p) === chosen) ?? location, count(location), nationwide)}
            </p>
          ) : nationwide > 0 && (
            <p className="text-[10.5px] text-slate-400 leading-relaxed px-1">
              {nationwide} job{nationwide === 1 ? " is" : "s are"} open to all of India and {nationwide === 1 ? "shows" : "show"} whichever state you choose.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
