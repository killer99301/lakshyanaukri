"use client";

import React, { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { X, SlidersHorizontal, AlertCircle, RefreshCw } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { JobsHero } from "@/components/jobs/JobsHero";
import { JobFiltersSidebar } from "@/components/jobs/JobFiltersSidebar";
import { JobsToolbar } from "@/components/jobs/JobsToolbar";
import { MarketplaceJobCard } from "@/components/jobs/MarketplaceJobCard";
import { JobsRightSidebar } from "@/components/jobs/JobsRightSidebar";
import { JobsPagination } from "@/components/jobs/JobsPagination";
import { getAllVerifiedOpportunities } from "@/lib/repository";
import { searchOpportunities, getDefaultFilterState, SortOption } from "@/lib/filters";
import type { FilterState, Category } from "@/types";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";

const ITEMS_PER_PAGE = 10;

function JobsPageContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialLocation = searchParams.get("location") || "All India";

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedLocation, setSelectedLocation] = useState(initialLocation);
  const [sortBy, setSortBy] = useState<SortOption>("latest");
  const [viewMode, setViewMode] = useState<"compact-list" | "card-grid">("compact-list");
  const [currentPage, setCurrentPage] = useState(1);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  // Filter State
  const initialFilterState = getDefaultFilterState();
  const [filters, setFilters] = useState<FilterState>(initialFilterState);

  const popularTerms = ["SSC CGL", "BPSC", "UPSC", "Banking", "Railway", "Teaching", "Defence"];

  const allOpportunities = useMemo(() => getAllVerifiedOpportunities(), []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
  };

  const handlePopularChipClick = (term: string) => {
    setSearchQuery(term);
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setFilters(initialFilterState);
    setSearchQuery("");
    setSelectedLocation("All India");
    setCurrentPage(1);
  };

  const handleToggleBookmark = (id: string) => {
    setBookmarkedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleQuickCategoryClick = (cat: string) => {
    if (!cat) return;
    setFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(cat as Category)
        ? prev.categories
        : [...prev.categories, cat as Category],
    }));
    setCurrentPage(1);
  };

  // Canonical Dynamic Filtering & Sorting Logic via searchOpportunities
  const filteredJobs = useMemo(() => {
    const now = new Date();
    return searchOpportunities(
      allOpportunities,
      searchQuery,
      selectedLocation,
      filters,
      sortBy,
      now
    );
  }, [allOpportunities, searchQuery, selectedLocation, filters, sortBy]);

  // Dynamic Pagination Calculation
  const totalPages = Math.ceil(filteredJobs.length / ITEMS_PER_PAGE);

  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredJobs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredJobs, currentPage]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-16 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 space-y-6">
        {/* 1. HERO SEARCH & FILTERS HEADER BAR */}
        <JobsHero
          searchQuery={searchQuery}
          setSearchQuery={(q) => {
            setSearchQuery(q);
            setCurrentPage(1);
          }}
          selectedLocation={selectedLocation}
          setSelectedLocation={(loc) => {
            setSelectedLocation(loc);
            setCurrentPage(1);
          }}
          handleSearchSubmit={handleSearchSubmit}
          handlePopularChipClick={handlePopularChipClick}
          popularTerms={popularTerms}
        />

        {/* 2. THREE-COLUMN MARKETPLACE RESULTS AREA */}
        <Container>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT: STICKY FILTER SIDEBAR (Desktop lg:col-span-3) */}
            <div className="hidden lg:block lg:col-span-3 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-none">
              <JobFiltersSidebar
                filters={filters}
                setFilters={(action) => {
                  setFilters(action);
                  setCurrentPage(1);
                }}
                handleResetFilters={handleResetFilters}
                allJobs={allOpportunities}
              />
            </div>

            {/* CENTER: RESULTS & TOOLBAR (lg:col-span-6 on desktop) */}
            <div className="lg:col-span-6 space-y-4">
              {/* Toolbar: Results Count, Sort & View Switcher */}
              <JobsToolbar
                totalCount={filteredJobs.length}
                sortBy={sortBy}
                setSortBy={(sort) => {
                  setSortBy(sort as SortOption);
                  setCurrentPage(1);
                }}
                viewMode={viewMode}
                setViewMode={setViewMode}
                onOpenMobileFilters={() => setIsMobileFilterOpen(true)}
              />

              {/* Results Grid / List */}
              {paginatedJobs.length > 0 ? (
                <div
                  className={
                    viewMode === "card-grid"
                      ? "grid grid-cols-1 sm:grid-cols-2 gap-3.5"
                      : "space-y-3.5"
                  }
                >
                  {paginatedJobs.map((job) => (
                    <MarketplaceJobCard
                      key={job.id}
                      job={job}
                      isBookmarked={bookmarkedIds.includes(job.id)}
                      onToggleBookmark={handleToggleBookmark}
                    />
                  ))}
                </div>
              ) : (
                /* No Results Fallback State */
                <div className="bg-white border border-[#FED7AA] rounded-2xl p-8 text-center space-y-3 shadow-2xs">
                  <div className="h-12 w-12 mx-auto rounded-full bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C]">
                    <AlertCircle className="h-6 w-6" />
                  </div>
                  <div className="space-y-1 max-w-sm mx-auto">
                    <h3 className="text-base font-extrabold text-[#0F172A]">
                      No Jobs Found Matching Your Criteria
                    </h3>
                    <p className="text-xs text-[#475569]">
                      Try adjusting your filters, searching for alternate keywords, or clearing your active filters.
                    </p>
                  </div>
                  <Button
                    onClick={handleResetFilters}
                    variant="outline"
                    size="sm"
                    className="font-bold text-xs border-[#FED7AA] text-[#EA580C] hover:bg-[#FFF7ED] gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Reset All Filters</span>
                  </Button>
                </div>
              )}

              {/* Dynamic Pagination Controls */}
              {filteredJobs.length > 0 && (
                <JobsPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => setCurrentPage(page)}
                />
              )}
            </div>

            {/* RIGHT: SUPPORTING UTILITIES (Desktop lg:col-span-3) */}
            <div className="lg:col-span-3 space-y-4">
              <JobsRightSidebar onQuickCategoryClick={handleQuickCategoryClick} />
            </div>
          </div>
        </Container>
      </PageReveal>

      {/* 3. MOBILE FILTER SLIDE-OVER BOTTOM SHEET / DRAWER */}
      {isMobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs">
          <div className="bg-white w-full max-h-[85vh] rounded-t-3xl p-5 overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[#EA580C]" />
                <h3 className="text-base font-bold text-[#0F172A]">Filter Jobs</h3>
              </div>
              <button
                onClick={() => setIsMobileFilterOpen(false)}
                className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:text-[#0F172A] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <JobFiltersSidebar
              filters={filters}
              setFilters={(action) => {
                setFilters(action);
                setCurrentPage(1);
              }}
              handleResetFilters={handleResetFilters}
              allJobs={allOpportunities}
              className="border-none shadow-none p-0"
            />

            <div className="pt-2 sticky bottom-0 bg-white border-t border-slate-100">
              <Button
                onClick={() => setIsMobileFilterOpen(false)}
                variant="primary"
                size="md"
                className="w-full font-bold text-sm cursor-pointer"
              >
                Apply Filters ({filteredJobs.length} Results)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">Loading Jobs Marketplace...</div>}>
      <JobsPageContent />
    </Suspense>
  );
}
