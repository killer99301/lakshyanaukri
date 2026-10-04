import React from "react";
import { Trophy, ShieldCheck, ArrowRight, ExternalLink, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";
import { CardHover } from "@/components/common/motion/CardHover";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { getLifecycleLinks } from "@/lib/cms/lifecycle-links";
import { LifecycleLinkGrid } from "@/components/lifecycle/LifecycleLinkList";

export const metadata = {
  title: "Exam Results & Cutoff Marks 2026 | LakshyaNaukri",
  description:
    "Official exam results, merit lists, scorecards, and cutoff marks for UPSC, SSC, Banking, Railway, and State PSC competitive exams. Results are published as they are officially released.",
};

const OFFICIAL_RESULT_PORTALS = [
  {
    name: "Staff Selection Commission (SSC)",
    url: "https://ssc.gov.in",
    resultPath: "Results & Final Answer Keys",
    tag: "Central Govt",
  },
  {
    name: "Bihar Public Service Commission (BPSC)",
    url: "https://bpsc.bih.nic.in",
    resultPath: "Official Results & Cutoff Gazettes",
    tag: "State PSC",
  },
  {
    name: "Union Public Service Commission (UPSC)",
    url: "https://upsc.gov.in",
    resultPath: "Written & Final Recommended Lists",
    tag: "National",
  },
  {
    name: "Institute of Banking Personnel Selection (IBPS)",
    url: "https://www.ibps.in",
    resultPath: "CRP Scores & Provisional Allotments",
    tag: "Banking",
  },
  {
    name: "Railway Recruitment Boards (RRB)",
    url: "https://indianrailways.gov.in",
    resultPath: "CBT Scorecards & Document Verification",
    tag: "Railways",
  },
  {
    name: "State Bank of India (SBI Careers)",
    url: "https://sbi.co.in/careers",
    resultPath: "PO / Clerk / SO Final Results",
    tag: "Banking",
  },
];

export default async function ResultsPage() {
  const links = await getLifecycleLinks();
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-7xl space-y-8">
        {/* Header Hero */}
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden">
          <div className="max-w-2xl space-y-4 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-black uppercase tracking-wider">
              <Trophy className="h-3.5 w-3.5" /> Official Scorecards & Merit Lists
            </div>

            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Exam Results & Cutoff Portal
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
              Find instant results, merit lists, final marks, and category-wise cutoff announcements across national and state government examinations.
            </p>
          </div>
        </div>

        {/* Verification Status Banner */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A]">
                  Data Trust Guarantee: Direct Verification in Progress
                </h3>
                <p className="text-xs text-[#475569]">
                  Results are published only after cross-verification against primary government gazettes.
                </p>
              </div>
            </div>

            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] text-white font-bold text-xs hover:bg-slate-800 transition-colors shrink-0 shadow-2xs"
            >
              <span>Explore Active Recruitments</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Links added in the CMS to published jobs; empty until one exists */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-[#0F172A] tracking-tight">
              Results & Merit Lists
            </h2>
            <p className="text-xs text-[#475569]">
              Official result links added to jobs on this site, newest first:
            </p>
          </div>
          <LifecycleLinkGrid kind="result" items={links.results} />
        </div>

        {/* Official Board Portals Directory */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-[#0F172A] tracking-tight">
              Official Examination Board Result Portals
            </h2>
            <p className="text-xs text-[#475569]">
              Access direct, unmediated official result announcement pages from respective commissions:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {OFFICIAL_RESULT_PORTALS.map((portal) => (
              <CardHover key={portal.name}>
                <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <OrganizationLogo organizationName={portal.name} size="md" />
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-black uppercase">
                        {portal.tag}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-[#0F172A] leading-snug">
                        {portal.name}
                      </h4>
                      <p className="text-xs text-[#475569] font-medium mt-1">
                        {portal.resultPath}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Official Source</span>
                    </div>

                    <a
                      href={portal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-bold text-[#EA580C] hover:underline"
                    >
                      <span>Direct Portal</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </CardHover>
            ))}
          </div>
        </div>
      </PageReveal>
    </div>
  );
}
