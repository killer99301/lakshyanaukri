"use client";

import React, { useState, useRef, useEffect } from "react";
import { MapPin, ChevronDown, Search, Check, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LocationPopoverProps {
  selectedLocation: string;
  onSelectLocation: (loc: string) => void;
  className?: string;
  buttonClassName?: string;
}

// 1. Popular Locations (exact order specified by prompt)
export const POPULAR_LOCATIONS = [
  "Bihar",
  "Uttar Pradesh",
  "Delhi NCR",
  "Maharashtra",
  "Karnataka",
  "Telangana",
  "West Bengal",
  "Rajasthan",
];

// 2. All States (28 States)
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

// 3. Union Territories & Special Regions (Delhi NCR treated as a region)
export const REGIONS_AND_UTS = [
  "Delhi NCR",
  "Andaman & Nicobar Islands",
  "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Jammu & Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

// Combine all unique locations for master filtering
export const ALL_LOCATIONS_MASTER = Array.from(
  new Set(["All India", ...POPULAR_LOCATIONS, ...INDIAN_STATES, ...REGIONS_AND_UTS])
);

// City alias mapping for smart search (e.g. typing "Pat" -> Patna matches Bihar)
const CITY_ALIASES: Record<string, string[]> = {
  Bihar: ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Purnea"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Noida", "Prayagraj", "Ghaziabad", "Gorakhpur"],
  "Delhi NCR": ["Delhi", "New Delhi", "Noida", "Gurgaon", "Gurugram", "Faridabad", "Ghaziabad", "Greater Noida"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Navi Mumbai"],
  Karnataka: ["Bengaluru", "Bangalore", "Mysuru", "Hubballi", "Mangaluru"],
  Telangana: ["Hyderabad", "Warangal", "Nizamabad"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Asansol"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior", "Jabalpur"],
  Jharkhand: ["Ranchi", "Jamshedpur", "Dhanbad"],
  Punjab: ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar"],
  Haryana: ["Gurugram", "Faridabad", "Panipat", "Ambala"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli"],
  Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela"],
  Assam: ["Guwahati", "Silchar", "Dibrugarh"],
};

export const LocationPopover: React.FC<LocationPopoverProps> = ({
  selectedLocation,
  onSelectLocation,
  className,
  buttonClassName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click or Escape keypress
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Auto focus search input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSelect = (loc: string) => {
    onSelectLocation(loc);
    setIsOpen(false);
    setSearchQuery("");
  };

  const q = searchQuery.toLowerCase().trim();

  // Search matching function that handles both state names and city aliases
  const matchLocation = (loc: string): { matches: boolean; matchedCity?: string } => {
    if (!q) return { matches: true };
    if (loc.toLowerCase().includes(q)) return { matches: true };
    
    const cities = CITY_ALIASES[loc];
    if (cities) {
      const foundCity = cities.find((city) => city.toLowerCase().includes(q));
      if (foundCity) {
        return { matches: true, matchedCity: foundCity };
      }
    }
    return { matches: false };
  };

  // Filtered lists when searching
  const isSearching = q.length > 0;

  const filteredPopular = POPULAR_LOCATIONS.map((loc) => ({
    name: loc,
    ...matchLocation(loc),
  })).filter((item) => item.matches);

  const filteredStates = INDIAN_STATES.map((loc) => ({
    name: loc,
    ...matchLocation(loc),
  })).filter((item) => item.matches);

  const filteredRegions = REGIONS_AND_UTS.map((loc) => ({
    name: loc,
    ...matchLocation(loc),
  })).filter((item) => item.matches);

  const totalResultsCount = isSearching
    ? filteredPopular.length + filteredStates.length + filteredRegions.length
    : ALL_LOCATIONS_MASTER.length;

  return (
    <div ref={popoverRef} className={cn("relative shrink-0 overflow-visible", className)}>
      {/* Custom Trigger Button — Replaces native select */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full sm:w-36 h-9 pl-8 pr-7 bg-slate-50 border rounded-xl text-xs font-bold text-[#0F172A] hover:bg-[#FFF7ED] hover:border-[#FED7AA] hover:text-[#EA580C] transition-all flex items-center justify-between cursor-pointer shadow-2xs relative select-none",
          isOpen ? "border-[#EA580C] ring-2 ring-[#EA580C]/20 bg-[#FFF7ED] text-[#EA580C]" : "border-slate-200",
          buttonClassName
        )}
      >
        <MapPin className="h-3.5 w-3.5 text-[#EA580C] absolute left-2.5 pointer-events-none" />
        <span className="truncate">{selectedLocation || "All India"}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-slate-400 absolute right-2.5 transition-transform duration-200 pointer-events-none",
            isOpen && "rotate-180 text-[#EA580C]"
          )}
        />
      </button>

      {/* Custom Dropdown Panel (Floating 320-360px panel over marketplace content) */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute right-0 sm:left-0 top-full mt-2 w-80 sm:w-84 max-w-[calc(100vw-2rem)] bg-white border border-[#E2E8F0] rounded-2xl shadow-2xl shadow-slate-900/15 z-50 overflow-hidden"
        >
          {/* Search Header Bar */}
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Search location..."
                className="w-full h-8 pl-8 pr-7 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Container (Max height ~360px) */}
          <div className="max-h-[360px] overflow-y-auto p-2 space-y-3 scrollbar-thin scrollbar-thumb-slate-200 text-xs">
            {/* All India Base Option */}
            {!isSearching && (
              <div>
                <button
                  type="button"
                  onClick={() => handleSelect("All India")}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 rounded-xl font-bold transition-all text-left cursor-pointer",
                    selectedLocation === "All India"
                      ? "bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA]"
                      : "text-[#0F172A] hover:bg-slate-50 hover:text-[#EA580C]"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-[#EA580C]" />
                    <span>All India</span>
                  </div>
                  {selectedLocation === "All India" && (
                    <Check className="h-3.5 w-3.5 text-[#EA580C] shrink-0" />
                  )}
                </button>
              </div>
            )}

            {/* Popular Locations Section */}
            {!isSearching && (
              <div className="space-y-1">
                <span className="text-[10px] font-black text-[#EA580C] uppercase tracking-wider px-3 block">
                  Popular Locations
                </span>
                <div className="grid grid-cols-2 gap-1 pt-1">
                  {POPULAR_LOCATIONS.map((loc) => {
                    const isSelected = selectedLocation === loc;
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => handleSelect(loc)}
                        className={cn(
                          "flex items-center justify-between px-2.5 py-1.5 rounded-xl font-medium transition-all text-left cursor-pointer truncate",
                          isSelected
                            ? "bg-[#FFF7ED] text-[#EA580C] font-bold border border-[#FED7AA]"
                            : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
                        )}
                      >
                        <span className="truncate">{loc}</span>
                        {isSelected && <Check className="h-3 w-3 text-[#EA580C] shrink-0 ml-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* All States & UTs Section */}
            {!isSearching && (
              <>
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider px-3 block">
                    All States (28)
                  </span>
                  <div className="space-y-0.5 pt-0.5">
                    {INDIAN_STATES.map((loc) => {
                      const isSelected = selectedLocation === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => handleSelect(loc)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-1.5 rounded-xl font-medium transition-all text-left cursor-pointer",
                            isSelected
                              ? "bg-[#FFF7ED] text-[#EA580C] font-bold border border-[#FED7AA]"
                              : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
                          )}
                        >
                          <span className="truncate">{loc}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#EA580C] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider px-3 block">
                    Union Territories & Regions
                  </span>
                  <div className="space-y-0.5 pt-0.5">
                    {REGIONS_AND_UTS.map((loc) => {
                      const isSelected = selectedLocation === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => handleSelect(loc)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-1.5 rounded-xl font-medium transition-all text-left cursor-pointer",
                            isSelected
                              ? "bg-[#FFF7ED] text-[#EA580C] font-bold border border-[#FED7AA]"
                              : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
                          )}
                        >
                          <span className="truncate">{loc}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#EA580C] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Filtered Results View when typing */}
            {isSearching && (
              <div className="space-y-1">
                <span className="text-[10px] font-black text-[#EA580C] uppercase tracking-wider px-3 block">
                  Matching Locations ({totalResultsCount})
                </span>
                <div className="space-y-0.5 pt-0.5">
                  {totalResultsCount > 0 ? (
                    <>
                      {/* Check if All India matches query */}
                      {"all india".includes(q) && (
                        <button
                          type="button"
                          onClick={() => handleSelect("All India")}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-1.5 rounded-xl font-medium transition-all text-left cursor-pointer",
                            selectedLocation === "All India"
                              ? "bg-[#FFF7ED] text-[#EA580C] font-bold border border-[#FED7AA]"
                              : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
                          )}
                        >
                          <span>All India</span>
                          {selectedLocation === "All India" && (
                            <Check className="h-3.5 w-3.5 text-[#EA580C] shrink-0" />
                          )}
                        </button>
                      )}

                      {/* Display matched items */}
                      {Array.from(
                        new Map(
                          [...filteredPopular, ...filteredStates, ...filteredRegions].map((item) => [
                            item.name,
                            item,
                          ])
                        ).values()
                      ).map((item) => {
                        const isSelected = selectedLocation === item.name;
                        return (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => handleSelect(item.name)}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-1.5 rounded-xl font-medium transition-all text-left cursor-pointer",
                              isSelected
                                ? "bg-[#FFF7ED] text-[#EA580C] font-bold border border-[#FED7AA]"
                                : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
                            )}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="truncate">{item.name}</span>
                              {item.matchedCity && (
                                <span className="text-[10px] px-1.5 py-0.2 bg-orange-100 text-[#EA580C] font-bold rounded-md shrink-0">
                                  via {item.matchedCity}
                                </span>
                              )}
                            </div>
                            {isSelected && <Check className="h-3.5 w-3.5 text-[#EA580C] shrink-0" />}
                          </button>
                        );
                      })}
                    </>
                  ) : (
                    <div className="px-3 py-6 text-center text-slate-400 text-xs font-semibold">
                      No locations match &quot;{searchQuery}&quot;
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

