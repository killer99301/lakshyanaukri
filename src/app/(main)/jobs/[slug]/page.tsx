import React from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  Sparkles,
  ArrowRight,
  Calculator,
  Compass,
} from "lucide-react";
import { getBySlug, getAllSlugs, getRelated } from "@/lib/repository";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { JobSectionTabs } from "@/components/jobs/JobSectionTabs";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import { OfficialNotificationCard } from "@/components/jobs/OfficialNotificationCard";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";

interface JobDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({
    slug,
  }));
}

export async function generateMetadata({ params }: JobDetailPageProps) {
  const resolvedParams = await params;
  const job = getBySlug(resolvedParams.slug);

  if (!job) {
    return {
      title: "Opportunity Not Found | LakshyaNaukri",
    };
  }

  const title = `${job.title} — Official Notification & Details`;
  const description =
    job.shortDescription ||
    `Check eligibility, application dates, vacancies, exam pattern, and official notifications for ${job.title}.`;
  const canonicalPath = `/jobs/${job.slug}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: `${title} | LakshyaNaukri`,
      description,
      type: "article",
      url: canonicalPath,
      images: ["/og.jpg"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | LakshyaNaukri`,
      description,
      images: ["/og.jpg"],
    },
  };
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const resolvedParams = await params;
  const job = getBySlug(resolvedParams.slug);

  if (!job) {
    notFound();
  }

  // JSON-LD structured data — WebPage only, using canonical data fields.
  // We do NOT include JobPosting schema here because:
  // (a) these are government exam notifications, not employment job listings;
  // (b) required fields like baseSalary, employmentType, validThrough are
  //     not consistently available in canonical data and must not be fabricated.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${job.title} — Official Notification & Details`,
    description:
      job.shortDescription ||
      `Check eligibility, application dates, vacancies, exam pattern, and official notifications for ${job.title}.`,
    url: `https://lakshyanaukri.in/jobs/${job.slug}`,
    dateModified: job.provenance.lastVerifiedAt,
    publisher: {
      "@type": "Organization",
      name: "LakshyaNaukri",
      url: "https://lakshyanaukri.in",
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://lakshyanaukri.in",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Jobs",
          item: "https://lakshyanaukri.in/jobs",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: job.title,
          item: `https://lakshyanaukri.in/jobs/${job.slug}`,
        },
      ],
    },
  };
  // Related Jobs in same category/state from canonical repository
  const relatedJobs = getRelated(job, 4);

  const asOfDate =
    job.type === "government" && job.ageLimit?.asOf
      ? job.ageLimit.asOf
      : "2026-08-01";

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-16 pt-4 relative">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-7xl space-y-6">
        {/* Header Hero */}
        <JobDetailHeader job={job} />

        {/* Sticky Section Nav */}
        <JobSectionTabs />

        {/* Content Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Details Column */}
          <main className="lg:col-span-8 space-y-8">
            <OfficialNotificationCard
              notificationPdfUrl={job.type === "government" ? job.links.notification : undefined}
              officialWebsiteUrl={job.links.website}
              sourceName={job.provenance.primarySourceType.replace(/_/g, " ")}
              verifiedAt={job.provenance.lastVerifiedAt}
            />

            <JobDetailSections job={job} />
          </main>

          {/* Right Sidebar - Ecosystem Cards & Related Jobs */}
          <aside className="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
            {/* Ecosystem Card 1: Career Campus 2 Exam Prep */}
            <div className="bg-gradient-to-br from-orange-500 via-orange-600 to-amber-600 text-white rounded-3xl p-5 shadow-lg relative overflow-hidden group">
              <div className="absolute -right-4 -bottom-4 h-24 w-24 rounded-full bg-white/10 blur-lg" />
              <div className="space-y-3 relative z-10">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-black uppercase tracking-wider text-white">
                  <Sparkles className="h-3 w-3" /> Career Campus 2
                </div>
                <h3 className="text-lg font-black tracking-tight leading-snug">
                  Prepare for {job.organizationName} Mock Tests & PYQs
                </h3>
                <p className="text-xs text-orange-100 leading-relaxed font-medium">
                  Access 50,000+ chapter-wise questions, previous year papers, and speed tests tailored for this exam.
                </p>
                <a
                  href={(job.type === "government" ? job.ecosystem?.careerCampus2 : undefined) || "https://cc2.careercampus.in"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#EA580C] font-extrabold text-xs shadow-md hover:bg-orange-50 transition-colors cursor-pointer"
                >
                  <span>Start Free Mock Test</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            {/* Ecosystem Card 2: CalcInfinity Age & Eligibility Calculator */}
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2.5 text-[#0F172A]">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                  <Calculator className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-[#0F172A]">CalcInfinity Age Calculator</h4>
                  <p className="text-[11px] text-[#475569] font-medium">Verify cut-off eligibility</p>
                </div>
              </div>
              <p className="text-xs text-[#475569] leading-relaxed">
                Check exact age as of cutoff date ({asOfDate}) with category relaxations.
              </p>
              <a
                href={(job.type === "government" ? job.ecosystem?.calcInfinityAge : undefined) || "https://calcinfinity.com/age-calculator"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-between w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-colors cursor-pointer"
              >
                <span>Calculate Exact Age ↗</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </a>
            </div>

            {/* Ecosystem Card 3: Anantamarg Shubh Muhurat */}
            <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2.5 text-[#0F172A]">
                <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                  <Compass className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-[#0F172A]">Anantamarg Muhurat</h4>
                  <p className="text-[11px] text-[#475569] font-medium">Auspicious Application Times</p>
                </div>
              </div>
              <p className="text-xs text-[#475569] leading-relaxed">
                Find optimal dates and timings to submit high-priority competitive exam applications.
              </p>
              <a
                href={(job.type === "government" ? job.ecosystem?.anantamarg : undefined) || "https://anantamarg.com/shubh-muhurat"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-between w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-colors cursor-pointer"
              >
                <span>Check Auspicious Time ↗</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </a>
            </div>

            {/* Related Jobs Box */}
            {relatedJobs.length > 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-xs space-y-4">
                <h4 className="text-sm font-black text-[#0F172A] border-b border-slate-100 pb-2">
                  Similar Opportunities
                </h4>

                <div className="space-y-3">
                  {relatedJobs.map((rj) => (
                    <Link
                      key={rj.id}
                      href={`/jobs/${rj.slug}`}
                      className="block p-3 rounded-2xl bg-slate-50 hover:bg-[#FFF7ED] border border-slate-100 hover:border-[#FED7AA] transition-all group"
                    >
                      <span className="text-xs font-extrabold text-[#0F172A] group-hover:text-[#EA580C] line-clamp-1 block">
                        {rj.title}
                      </span>
                      <span className="text-[11px] font-semibold text-[#475569] block mt-0.5">
                        {rj.organizationName} • {rj.state}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </PageReveal>
    </div>
  );
}
