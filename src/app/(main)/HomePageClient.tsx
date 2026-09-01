"use client";
// HomePageClient — interactive shell. Metadata is exported from page.tsx (server).

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Search,
  ArrowRight,
  Sparkles,
  BookMarked,
  Calculator,
  Sun,
  Send,
  BellRing,
} from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { JobCard } from "@/components/jobs/JobCard";
import { LocationPopover } from "@/components/jobs/LocationPopover";
import { EcosystemCard } from "@/components/ecosystem/EcosystemCard";
import { Ticker } from "@/components/common/Ticker";
import { RevealSection } from "@/components/common/RevealSection";
import { CursorTiltCard } from "@/components/common/CursorTiltCard";
import { MagneticButton } from "@/components/common/MagneticButton";
import { CareerOrbitCenterpiece } from "@/components/discovery/CareerOrbitCenterpiece";
import { ResultsTimelineFeed } from "@/components/results/ResultsTimelineFeed";
import { AdmitCardDocumentGrid } from "@/components/admit-cards/AdmitCardDocumentGrid";
import { AnswerKeyHexCluster } from "@/components/answer-keys/AnswerKeyHexCluster";
import { PopularOrganizationsBento } from "@/components/organizations/PopularOrganizationsBento";
import { UpcomingExamsTimeline } from "@/components/exams/UpcomingExamsTimeline";
import { siteConfig } from "@/config/site";
import { getAllVerifiedOpportunities } from "@/lib/repository";
import {
  POPULAR_SEARCHES,
  HOW_IT_HELPS_STEPS,
} from "@/data/homepage";

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("All India");
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/jobs?q=${encodeURIComponent(searchQuery)}&location=${encodeURIComponent(selectedLocation)}`);
    } else {
      router.push("/jobs");
    }
  };

  const handlePopularSearchClick = (term: string) => {
    setSearchQuery(term);
    router.push(`/jobs?q=${encodeURIComponent(term)}`);
  };

  // Semantic icon renderer for 5-step journey
  const renderStepIcon = (iconName: string) => {
    switch (iconName) {
      case "Search":
        return <Search className="h-5 w-5 text-[#EA580C]" />;
      case "BookMarked":
        return <BookMarked className="h-5 w-5 text-[#EA580C]" />;
      case "Calculator":
        return <Calculator className="h-5 w-5 text-[#EA580C]" />;
      case "Sun":
        return <Sun className="h-5 w-5 text-[#EA580C]" />;
      case "Send":
        return <Send className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <Search className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  return (
    <div className="flex flex-col space-y-9 sm:space-y-11 pb-16 bg-[#F7F6F3]">
      {/* ================================================== */}
      {/* HERO SECTION WITH CONTINUOUS CINEMATIC ARTWORK */}
      {/* ================================================== */}
      <section className="relative border-b border-[#E2E8F0] pt-10 pb-14 lg:pt-16 lg:pb-20 overflow-hidden min-h-[560px] lg:min-h-[620px] flex items-center">
        {/* Full-Bleed Continuous Background Image Layer */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="relative w-full h-full animate-ken-burns">
            <Image
              src="/images/hero-bg.jpg"
              alt="LakshyaNaukri — Government Jobs & Career Intelligence Platform"
              fill
              priority
              quality={95}
              className="object-cover object-[75%_center] lg:object-[70%_center]"
            />
          </div>

          {/* Broad Imperceptible Atmospheric Radial Glow (No hard vertical split line) */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_85%_at_25%_45%,rgba(247,246,243,0.88)_0%,rgba(247,246,243,0.45)_55%,transparent_85%)] z-1 pointer-events-none" />
        </div>

        <Container className="relative z-10">
          <div className="max-w-xl lg:max-w-2xl space-y-5 text-left">
            {/* Top Tagline Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-[#FED7AA] text-xs font-bold text-[#EA580C] shadow-2xs backdrop-blur-xs">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Your Trusted Career & Examination Gateway</span>
            </div>

            {/* Headline */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-[#0F172A] tracking-tight leading-[1.15]">
              One Destination. <br className="hidden sm:inline" />
              Every Opportunity. <br className="hidden sm:inline" />
              Your <span className="text-[#EA580C] underline decoration-[#FED7AA] underline-offset-4">Future.</span>
            </h1>

            {/* Supporting Subtitle */}
            <p className="text-sm sm:text-lg text-[#475569] font-medium max-w-lg leading-relaxed">
              Find government & private jobs, exam updates, prepare smart, use powerful tools and choose the right time to begin.
            </p>

            {/* Universal Search Bar */}
            <form
              onSubmit={handleSearchSubmit}
              className="bg-white/95 backdrop-blur-xs p-2 rounded-2xl border border-[#E2E8F0] shadow-md hover:border-[#FED7AA] focus-within:border-[#EA580C] focus-within:ring-4 focus-within:ring-[#EA580C]/15 transition-all duration-300 max-w-xl mt-4"
            >
              <div className="flex flex-col md:flex-row items-center gap-2">
                {/* Search Input */}
                <div className="flex-1 w-full relative">
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search jobs, exams, companies or keywords..."
                    icon={<Search className="h-5 w-5 text-slate-400" />}
                    className="border-none shadow-none focus:ring-0 text-sm sm:text-base h-11 bg-transparent"
                  />
                </div>

                {/* Vertical Divider (Desktop) */}
                <div className="hidden md:block h-7 w-px bg-slate-200 shrink-0" />

                {/* Location Selector */}
                <LocationPopover
                  selectedLocation={selectedLocation}
                  onSelectLocation={setSelectedLocation}
                  className="w-full md:w-44 shrink-0"
                  buttonClassName="h-11 sm:h-11 border-slate-200 text-sm font-semibold rounded-xl"
                />

                {/* Search Submit Button */}
                <MagneticButton>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    className="w-full md:w-auto h-10 px-6 text-sm font-bold rounded-xl shrink-0 gap-1.5"
                  >
                    <span>Search</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </MagneticButton>
              </div>
            </form>

            {/* Popular Searches Chips */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="text-[#475569] font-semibold">Popular Searches:</span>
              {POPULAR_SEARCHES.map((term) => (
                <button
                  key={term}
                  onClick={() => handlePopularSearchClick(term)}
                  className="px-2.5 py-0.5 rounded-full bg-white/90 backdrop-blur-xs border border-slate-200 text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-all text-xs font-semibold cursor-pointer shadow-2xs"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* ================================================== */}
      {/* IMPORTANT UPDATES TICKER */}
      {/* ================================================== */}
      <RevealSection className="-mt-6">
        <Container>
          <div className="bg-white border border-[#FED7AA] rounded-2xl p-3 sm:p-3.5 shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 sm:gap-4 flowing-border">
            <div className="flex items-center gap-2 shrink-0 pl-1">
              <div className="h-8 w-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C] shrink-0">
                <BellRing className="h-4 w-4" />
              </div>
              <span className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wider">
                Updates
              </span>
            </div>

            {/* Dynamic Infinite Scroll Ticker */}
            <div className="flex-1 overflow-hidden w-full">
              <Ticker />
            </div>

            <Link href="/jobs" className="shrink-0 pr-1">
              <Button variant="ghost" size="sm" className="text-[#EA580C] hover:text-[#c2410c] hover:bg-[#FFF7ED] gap-1 font-bold text-xs group py-1 h-8">
                <span>View All</span>
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </Link>
          </div>
        </Container>
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 1: LATEST OPPORTUNITIES */}
      {/* ================================================== */}
      <RevealSection>
        <Container>
          <SectionHeading
            title="Latest Opportunities"
            subtitle="Verified government recruitment notices, private jobs, and exam schedules."
            actionText="View All Jobs"
            actionHref="/jobs"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-3.5">
            {getAllVerifiedOpportunities().slice(0, 3).map((job, idx) => (
              <React.Fragment key={job.id}>
                {idx === 0 ? (
                  <CursorTiltCard maxTiltDegrees={3}>
                    <JobCard job={job} isFeatured={true} />
                  </CursorTiltCard>
                ) : (
                  <JobCard job={job} />
                )}
              </React.Fragment>
            ))}
          </div>
        </Container>
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 2: LATEST RESULTS (LIVE TIMELINE FEED) */}
      {/* ================================================== */}
      <RevealSection delayMs={100}>
        <ResultsTimelineFeed />
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 3: LATEST ADMIT CARDS (DOCUMENT CARDS) */}
      {/* ================================================== */}
      <RevealSection delayMs={150}>
        <AdmitCardDocumentGrid />
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 4: LATEST ANSWER KEYS (HEX CLUSTER) */}
      {/* ================================================== */}
      <RevealSection delayMs={200}>
        <AnswerKeyHexCluster />
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 5: EXPLORE OPPORTUNITIES (CAREER ORBIT CENTERPIECE) */}
      {/* ================================================== */}
      <RevealSection>
        <CareerOrbitCenterpiece />
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 6: POPULAR ORGANIZATIONS (BRAND TILES) */}
      {/* ================================================== */}
      <RevealSection delayMs={100}>
        <PopularOrganizationsBento />
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 7: UPCOMING EXAMS (TIMELINE SPINE) */}
      {/* ================================================== */}
      <RevealSection delayMs={150}>
        <UpcomingExamsTimeline />
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 8: OUR ECOSYSTEM (CHAMFERED GEOMETRIC CARDS) */}
      {/* ================================================== */}
      <RevealSection>
        <Container>
          <SectionHeading
            title="Our Ecosystem"
            subtitle="Everything you need for your complete career journey — preparation, calculations, and auspicious timing."
            align="center"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {/* Card 1: Career Campus 2 */}
            <EcosystemCard
              partnerId="cc2"
              badgeText="Preparation Partner"
              title="Career Campus 2"
              subtitle="EXAM PREPARATION & MOCK TESTS"
              description="Access structured study material, previous-year question papers, topic-wise practice, and live mock tests for competitive exams."
              features={[
                "Exam Syllabus Breakdown",
                "PYQ Papers with Solutions",
                "Real-time Performance Analytics",
              ]}
              ctaText="Go to Career Campus 2"
              ctaUrl={siteConfig.ecosystem.careerCampus2.url}
            />

            {/* Card 2: CalcInfinity */}
            <EcosystemCard
              partnerId="calcinfinity"
              badgeText="Utility Tool Engine"
              title="CalcInfinity"
              subtitle="ELIGIBILITY & DATE CALCULATORS"
              description="Use 100+ smart calculators designed specifically for students and job aspirants to verify age criteria, calculate marks, and check key dates."
              features={[
                "Pre-filled Cutoff Age Calculator",
                "Marks to Percentage Converter",
                "Important Date & Interval Calculator",
              ]}
              ctaText="Explore CalcInfinity"
              ctaUrl={siteConfig.ecosystem.calcInfinity.url}
            />

            {/* Card 3: Anantamarg */}
            <EcosystemCard
              partnerId="anantamarg"
              badgeText="Auspicious Timings"
              title="Anantamarg"
              subtitle="SHUBH MUHURAT GUIDE"
              description="Find auspicious timings and shubh muhurat for submitting job applications, starting exam preparation, and attending interviews."
              features={[
                "Form Submission Shubh Timing",
                "Exam Preparation Start Muhurat",
                "Auspicious Date Finder",
              ]}
              ctaText="Check Muhurat"
              ctaUrl={siteConfig.ecosystem.anantamarg.url}
            />
          </div>
        </Container>
      </RevealSection>

      {/* ================================================== */}
      {/* SECTION 9: HOW LAKSHYANAUKRI HELPS YOU */}
      {/* ================================================== */}
      <RevealSection className="bg-white py-8 border-y border-[#E2E8F0]">
        <Container>
          <SectionHeading
            title="How LakshyaNaukri Helps You"
            subtitle="A simple 5-step roadmap from opportunity discovery to final official application."
            align="center"
          />

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3.5 mt-5">
            {HOW_IT_HELPS_STEPS.map((step) => (
              <div
                key={step.stepNumber}
                className="bg-[#F7F6F3] border border-[#E2E8F0] rounded-xl p-3.5 text-center flex flex-col items-center space-y-2 group hover:border-[#FED7AA] hover:bg-[#FFF7ED] transition-all duration-300 hover:-translate-y-1 shadow-2xs"
              >
                <div className="h-9 w-9 rounded-xl bg-white border border-[#FED7AA] flex items-center justify-center shadow-xs transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 group-hover:border-[#EA580C]">
                  {renderStepIcon(step.iconName)}
                </div>
                <h4 className="text-xs font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors">
                  {step.title}
                </h4>
                <p className="text-[11px] text-[#475569] leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </RevealSection>


      {/* ================================================== */}
      {/* SECTION 11: STAY CONNECTED (Telegram CTA) */}
      {/* ================================================== */}
      <RevealSection>
        <Container>
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 sm:p-10 text-white text-center space-y-4 shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,rgba(234,88,12,0.18)_0%,transparent_70%)] pointer-events-none" />
            <div className="relative z-10 space-y-3">
              <Badge variant="orange" className="text-xs">Stay Updated</Badge>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">Never Miss a Notification</h2>
              <p className="text-sm text-slate-300 max-w-lg mx-auto leading-relaxed">
                Join our Telegram channel for instant alerts on new job notifications, exam date changes, admit cards, and results — directly from official sources.
              </p>
              <div className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-600 text-slate-300 font-bold text-sm shadow-md mt-2 cursor-not-allowed select-none">
                <Send className="h-4 w-4" />
                <span>Telegram — Launching Soon</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Free. No spam. Verified government updates only.</p>
            </div>
          </div>
        </Container>
      </RevealSection>
    </div>
  );
}
