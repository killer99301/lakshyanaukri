"use client";

import React from "react";
import Image from "next/image";
import { Search, ArrowRight, Briefcase, Sparkles } from "lucide-react";
import { Container } from "../ui/Container";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { MagneticButton } from "../common/MagneticButton";
import { LocationPopover } from "./LocationPopover";

interface JobsHeroProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedLocation: string;
  setSelectedLocation: (loc: string) => void;
  handleSearchSubmit: (e: React.FormEvent) => void;
  handlePopularChipClick: (term: string) => void;
  popularTerms: string[];
}

export const JobsHero: React.FC<JobsHeroProps> = ({
  searchQuery,
  setSearchQuery,
  selectedLocation,
  setSelectedLocation,
  handleSearchSubmit,
  handlePopularChipClick,
  popularTerms,
}) => {
  return (
    <section className="bg-white border-b border-[#E2E8F0] pt-7 pb-9 sm:pt-9 sm:pb-11 relative z-20 min-h-[350px] flex items-center">
      {/* 2400x900 Ultra-Wide Artwork Layer: Concentrated on Far Right */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <Image
          src="/images/jobs-hero-bg.png"
          alt="LakshyaNaukri Jobs & Recruitment Intelligence"
          fill
          priority
          quality={95}
          className="object-cover object-[90%_center] lg:object-right opacity-80 lg:opacity-100"
        />

        {/* Seamless Continuous Gradient: Left clean white for typography, smooth feather across center to right */}
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/90 via-[48%] to-transparent z-1 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 via-transparent to-white z-1 pointer-events-none" />
      </div>

      <Container className="relative z-10">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          {/* Left Content Area (52-55% Clean Negative Space) */}
          <div className="max-w-2xl space-y-4">
            {/* Top Tagline Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFF7ED] border border-[#FED7AA] text-[11px] font-bold text-[#EA580C] shadow-2xs backdrop-blur-xs">
              <Sparkles className="h-3 w-3" />
              <span>JOBS IN INDIA</span>
            </div>

            {/* Main Headline */}
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-4xl font-black text-[#0F172A] tracking-tight leading-tight">
                Find Your Next <br className="hidden sm:inline" />
                Career <span className="text-[#EA580C] underline decoration-[#FED7AA] underline-offset-4">Opportunity</span>
              </h1>
              <p className="text-xs sm:text-sm text-[#475569] font-semibold max-w-lg">
                Discover verified government & private jobs from across India.
              </p>
            </div>

            {/* Universal Compact Search Bar with Custom Location Popover */}
            <form
              onSubmit={handleSearchSubmit}
              className="bg-white/95 backdrop-blur-xs p-1.5 sm:p-2 rounded-2xl border border-[#E2E8F0] shadow-md hover:border-[#FED7AA] focus-within:border-[#EA580C] focus-within:ring-4 focus-within:ring-[#EA580C]/15 transition-all duration-300 max-w-xl relative z-30"
            >
              <div className="flex flex-col sm:flex-row items-center gap-2">
                {/* Search Input */}
                <div className="flex-1 w-full relative">
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search jobs, companies, skills..."
                    icon={<Search className="h-4 w-4 text-slate-400" />}
                    className="border-none shadow-none focus:ring-0 text-xs sm:text-sm h-10 bg-transparent"
                  />
                </div>

                {/* Vertical Divider */}
                <div className="hidden sm:block h-6 w-px bg-slate-200 shrink-0" />

                {/* Custom LakshyaNaukri Location Popover Dropdown */}
                <LocationPopover
                  selectedLocation={selectedLocation}
                  onSelectLocation={setSelectedLocation}
                />

                {/* Submit Button */}
                <MagneticButton>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="w-full sm:w-auto h-9 px-5 text-xs font-bold rounded-xl shrink-0 gap-1"
                  >
                    <span>Search</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </MagneticButton>
              </div>
            </form>

            {/* Popular Search Terms */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
              <span className="text-[#475569] font-bold text-[11px]">Popular Searches:</span>
              {popularTerms.map((term) => (
                <button
                  key={term}
                  onClick={() => handlePopularChipClick(term)}
                  className="px-2.5 py-0.5 rounded-full bg-white/90 backdrop-blur-xs border border-slate-200 text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-all text-[11px] font-bold cursor-pointer shadow-2xs"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>

          {/* Right Chamfered Feature Pod (Visually separate & distinct) */}
          <div className="hidden lg:flex items-center justify-center relative shrink-0">
            <div
              className="h-44 w-44 bg-[#FFF7ED]/90 backdrop-blur-md border-2 border-[#FED7AA] p-4 flex flex-col items-center justify-center text-center shadow-lg shadow-orange-500/5 transition-all hover:scale-105 duration-300 relative z-10"
              style={{
                clipPath: "polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 80% 100%, 20% 100%, 0% 80%, 0% 20%)",
              }}
            >
              <div className="h-11 w-11 rounded-2xl bg-white border border-[#FED7AA] flex items-center justify-center text-[#EA580C] mb-2 shadow-2xs">
                <Briefcase className="h-6 w-6" />
              </div>
              <span className="text-[10px] font-black text-[#EA580C] uppercase tracking-wider block">
                MARKETPLACE
              </span>
              <h4 className="text-xs font-black text-[#0F172A] leading-tight mt-0.5">
                Verified Career <br /> Intelligence
              </h4>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};
