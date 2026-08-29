import Link from "next/link";
import { GraduationCap, ChevronRight } from "lucide-react";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";
import { CardHover } from "@/components/common/motion/CardHover";
import { getFilterCounts } from "@/lib/filters";
import { getAllVerifiedOpportunities } from "@/lib/repository";

export const metadata = {
  title: "Competitive Exams Directory 2026 | LakshyaNaukri",
  description: "Explore complete exam patterns, syllabi, exam calendars, and eligibility criteria for UPSC CSE, SSC CGL, RRB NTPC, IBPS PO, and State PSCs.",
};

export default function ExamsDirectoryPage() {
  const opportunities = getAllVerifiedOpportunities();
  const counts = getFilterCounts(opportunities, new Date());

  const examCategories = [
    {
      id: "state-psc",
      title: "State Public Service Commissions (PSC)",
      description: "BPSC, UPPSC, RPSC, MPSC, KPSC, WBPSC, TSPSC administrative examinations.",
      count: `${counts.byCategory["state-psc"] || 0} Exams Active`,
      badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      id: "ssc",
      title: "Staff Selection Commission (SSC)",
      description: "CGL, CHSL, MTS, CPO, JE, Stenographer graduate & matriculation level tests.",
      count: `${counts.byCategory["ssc"] || 0} Exams Active`,
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      id: "banking",
      title: "Banking & Financial Services",
      description: "IBPS PO/Clerk, SBI PO/Clerk, RBI Grade B, LIC AAO, NABARD recruitment cycles.",
      count: `${counts.byCategory["banking"] || 0} Exams Active`,
      badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      id: "railway",
      title: "Railway Recruitment Boards (RRB)",
      description: "RRB NTPC, ALP, Group D, JE technical & non-technical zonal recruitment.",
      count: `${counts.byCategory["railway"] || 0} Exams Active`,
      badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
    },
    {
      id: "defence",
      title: "Defence & Armed Forces",
      description: "UPSC CDS, NDA, AFCAT, Indian Navy SSC, Delhi Police Sub-Inspector.",
      count: `${counts.byCategory["defence"] || 0} Exams Active`,
      badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    },
    {
      id: "teaching",
      title: "Teaching & Academic Eligibility",
      description: "KVS, NVS, UGC NET, CTET, State TET teacher recruitment exams.",
      count: `${counts.byCategory["teaching"] || 0} Exams Active`,
      badgeColor: "bg-sky-50 text-sky-700 border-sky-200",
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-7xl space-y-8">
        {/* Header Hero */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden">
          <div className="max-w-2xl space-y-4 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-black uppercase tracking-wider">
              <GraduationCap className="h-3.5 w-3.5" /> Comprehensive Exam Guides
            </div>

            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Competitive Exams Directory
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
              Complete guidance, exam pattern, syllabus breakdown, previous year question trends, and official exam dates for top Indian recruitment examinations.
            </p>
          </div>
        </div>

        {/* Exam Categories Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {examCategories.map((cat) => (
            <Link key={cat.id} href={`/jobs?category=${cat.id}`} className="block group">
              <CardHover>
                <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-3 h-full flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${cat.badgeColor}`}>
                        {cat.count}
                      </span>
                    </div>

                    <h3 className="text-base font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug">
                      {cat.title}
                    </h3>

                    <p className="text-xs text-[#475569] leading-relaxed font-medium">
                      {cat.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-[#EA580C]">
                    <span>Explore Exam Opportunities</span>
                    <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </CardHover>
            </Link>
          ))}
        </div>
      </PageReveal>
    </div>
  );
}
