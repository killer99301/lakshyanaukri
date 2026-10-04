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
import { JobsRightSidebar, SIDEBAR_ORGANIZATIONS, type QuickLinkKind } from "@/components/jobs/JobsRightSidebar";
import { JobsPagination } from "@/components/jobs/JobsPagination";
import { searchOpportunities, closestMatches, textSearch, getDefaultFilterState, jobsUrlState, inGovScope, GOV_SCOPE_LABELS, SortOption, type GovScope } from "@/lib/filters";
import type { Opportunity, FilterState } from "@/types";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";

const ITEMS_PER_PAGE = 10;


interface JobsPageClientProps {
  opportunities: Opportunity[];
}

function JobsPageContent({ opportunities }: JobsPageClientProps) {
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

  // Filter State. Links elsewhere on the site open this page with a category
  // or qualification already chosen.
  const initialFilterState = getDefaultFilterState();
  const [filters, setFilters] = useState<FilterState>(() => jobsUrlState(searchParams).filters);
  // Set by links such as "Central Govt" on the home page; cleared from the notice above the results.
  const [govScope, setGovScope] = useState<GovScope | null>(() => jobsUrlState(searchParams).govScope);
  const scopedJobs = useMemo(() => opportunities.filter((opp) => inGovScope(opp, govScope)), [opportunities, govScope]);

  // Only suggest searches that currently lead somewhere.
  const popularTerms = useMemo(
    () =>
      ["SSC CGL", "SSC CHSL", "BPSC", "UPSC", "Banking", "Railway", "12th Pass", "Graduate", "Teaching", "Defence"]
        .filter((term) => textSearch(opportunities, term).length > 0)
        .slice(0, 7),
    [opportunities],
  );

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
    setGovScope(null);
    setSearchQuery("");
    setSelectedLocation("All India");
    setCurrentPage(1);
  };

  const handleToggleBookmark = (id: string) => {
    setBookmarkedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // "Jobs by Category / State / Qualification" take the visitor to the control
  // where that choice is made, rather than picking one for them.
  const handleQuickLink = (kind: QuickLinkKind) => {
    if (kind === "state") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      // Opened after this click has finished, or the popover's outside-click handler closes it again.
      window.setTimeout(() => {
        const trigger = document.querySelector<HTMLButtonElement>("[data-location-trigger]");
        if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      }, 350);
      return;
    }

    const reveal = () => {
      const section = Array.from(document.querySelectorAll<HTMLElement>(`[data-filter-section="${kind}"]`))
        .find((el) => el.offsetParent !== null);
      if (!section) return;
      // A collapsed section has no options showing; its header button expands it.
      if (!section.querySelector("label")) section.querySelector("button")?.click();
      section.scrollIntoView({ behavior: "smooth", block: "center" });
      section.classList.add("ring-2", "ring-[#EA580C]", "ring-offset-4");
      window.setTimeout(() => section.classList.remove("ring-2", "ring-[#EA580C]", "ring-offset-4"), 1800);
    };

    // The filter panel is a drawer below the lg breakpoint.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      reveal();
    } else {
      setIsMobileFilterOpen(true);
      window.setTimeout(reveal, 150);
    }
  };

  // Organisations are listed only while they have a job to show.
  const sidebarOrganizations = useMemo(
    () => SIDEBAR_ORGANIZATIONS.filter((org) => textSearch(opportunities, org.name).length > 0).slice(0, 5),
    [opportunities],
  );

  // Canonical Dynamic Filtering & Sorting Logic via searchOpportunities
  const filteredJobs = useMemo(() => {
    const now = new Date();
    return searchOpportunities(
      scopedJobs,
      searchQuery,
      selectedLocation,
      filters,
      sortBy,
      now
    );
  }, [scopedJobs, searchQuery, selectedLocation, filters, sortBy]);

  // Nothing matched every word: offer the jobs that match most of them
  // (still within the chosen location and filters) rather than a dead end.
  const closestJobs = useMemo(() => {
    if (filteredJobs.length > 0 || !searchQuery.trim()) return [];
    return searchOpportunities(closestMatches(scopedJobs, searchQuery), "", selectedLocation, filters, sortBy, new Date());
  }, [scopedJobs, filteredJobs, searchQuery, selectedLocation, filters, sortBy]);
  const showingClosest = closestJobs.length > 0;
  const shownJobs = showingClosest ? closestJobs : filteredJobs;

  // Dynamic Pagination Calculation
  const totalPages = Math.ceil(shownJobs.length / ITEMS_PER_PAGE);

  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return shownJobs.slice(start, start + ITEMS_PER_PAGE);
  }, [shownJobs, currentPage]);

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
                allJobs={scopedJobs}
              />
            </div>

            {/* CENTER: RESULTS & TOOLBAR (lg:col-span-6 on desktop) */}
            <div className="lg:col-span-6 space-y-4">
              {/* Toolbar: Results Count, Sort & View Switcher */}
              <JobsToolbar
                totalCount={shownJobs.length}
                sortBy={sortBy}
                setSortBy={(sort) => {
                  setSortBy(sort as SortOption);
                  setCurrentPage(1);
                }}
                viewMode={viewMode}
                setViewMode={setViewMode}
                onOpenMobileFilters={() => setIsMobileFilterOpen(true)}
              />

              {govScope && (
                <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl px-4 py-2.5 text-xs text-[#475569] flex items-center justify-between gap-3">
                  <span>
                    Showing <span className="font-extrabold text-[#0F172A]">{GOV_SCOPE_LABELS[govScope]}</span> jobs only.
                  </span>
                  <button
                    type="button"
                    onClick={() => { setGovScope(null); setCurrentPage(1); }}
                    className="font-extrabold text-[#EA580C] hover:underline cursor-pointer shrink-0"
                  >
                    Show all jobs
                  </button>
                </div>
              )}

              {showingClosest && (
                <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl px-4 py-3 text-xs text-[#475569]">
                  <span className="font-extrabold text-[#0F172A]">No exact match for “{searchQuery.trim()}”.</span>{" "}
                  Showing the closest {closestJobs.length === 1 ? "result" : "results"} instead.
                </div>
              )}

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
              {shownJobs.length > 0 && (
                <JobsPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(page) => setCurrentPage(page)}
                />
              )}
            </div>

            {/* RIGHT: SUPPORTING UTILITIES (Desktop lg:col-span-3) */}
            <div className="lg:col-span-3 space-y-4">
              <JobsRightSidebar onQuickLink={handleQuickLink} organizations={sidebarOrganizations} />
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
              allJobs={scopedJobs}
              className="border-none shadow-none p-0"
            />

            <div className="pt-2 sticky bottom-0 bg-white border-t border-slate-100">
              <Button
                onClick={() => setIsMobileFilterOpen(false)}
                variant="primary"
                size="md"
                className="w-full font-bold text-sm cursor-pointer"
              >
                Apply Filters ({shownJobs.length} Results)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The search box and filters start from the URL. Keying on it means a link to
// /jobs?q=… or /jobs?category=… clicked while already on this page applies too.
function JobsPageForUrl({ opportunities }: JobsPageClientProps) {
  const searchParams = useSearchParams();
  return <JobsPageContent key={searchParams.toString()} opportunities={opportunities} />;
}

export default function JobsPageClient({ opportunities }: JobsPageClientProps) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">Loading Jobs Marketplace...</div>}>
      <JobsPageForUrl opportunities={opportunities} />
    </Suspense>
  );
}
