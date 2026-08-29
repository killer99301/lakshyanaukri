import Link from "next/link";
import { Building2, MapPin, ExternalLink } from "lucide-react";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";
import { CardHover } from "@/components/common/motion/CardHover";
import { getAllVerifiedOpportunities } from "@/lib/repository";

export const metadata = {
  title: "Recruiting Organizations & Boards 2026 | LakshyaNaukri",
  description: "Browse major hiring organizations, government commissions, public sector undertakings, and top corporate employers in India.",
};

export default function CompaniesPage() {
  const opportunities = getAllVerifiedOpportunities();

  const organizations = [
    {
      id: "bpsc",
      name: "Bihar Public Service Commission",
      shortName: "BPSC",
      type: "State Commission",
      headquarters: "Patna, Bihar",
      activeJobsCount: opportunities.filter((o) =>
        o.organizationName.toLowerCase().includes("bpsc") ||
        o.organizationName.toLowerCase().includes("bihar public")
      ).length,
      website: "https://bpsc.bih.nic.in",
    },
    {
      id: "ssc",
      name: "Staff Selection Commission",
      shortName: "SSC",
      type: "Central Govt Commission",
      headquarters: "New Delhi",
      activeJobsCount: opportunities.filter((o) =>
        o.organizationName.toLowerCase().includes("ssc") ||
        o.organizationName.toLowerCase().includes("staff selection")
      ).length,
      website: "https://ssc.gov.in",
    },
    {
      id: "rrb",
      name: "Railway Recruitment Boards",
      shortName: "RRB",
      type: "Central Railways Board",
      headquarters: "Pan India (21 Zones)",
      activeJobsCount: opportunities.filter((o) =>
        o.organizationName.toLowerCase().includes("rrb") ||
        o.organizationName.toLowerCase().includes("railway")
      ).length,
      website: "https://indianrailways.gov.in",
    },
    {
      id: "ibps",
      name: "Institute of Banking Personnel Selection",
      shortName: "IBPS",
      type: "Banking Recruitment Body",
      headquarters: "Mumbai, Maharashtra",
      activeJobsCount: opportunities.filter((o) =>
        o.organizationName.toLowerCase().includes("ibps") ||
        o.organizationName.toLowerCase().includes("banking personnel")
      ).length,
      website: "https://ibps.in",
    },
    {
      id: "upsc",
      name: "Union Public Service Commission",
      shortName: "UPSC",
      type: "Constitutional Body",
      headquarters: "New Delhi",
      activeJobsCount: opportunities.filter((o) =>
        o.organizationName.toLowerCase().includes("upsc") ||
        o.organizationName.toLowerCase().includes("union public")
      ).length,
      website: "https://upsc.gov.in",
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-7xl space-y-8">
        {/* Header Hero */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden">
          <div className="max-w-2xl space-y-4 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs font-black uppercase tracking-wider">
              <Building2 className="h-3.5 w-3.5" /> Recruiting Bodies Directory
            </div>

            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Organizations & Commissions
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
              Explore profiles, active hiring drives, official websites, and exam schedules of top government recruiting boards and organizations.
            </p>
          </div>
        </div>

        {/* Organizations Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {organizations.map((org) => (
            <CardHover key={org.id}>
              <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <OrganizationLogo organizationName={org.name} size="lg" />
                    <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black uppercase">
                      {org.type}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-extrabold text-[#0F172A] leading-snug">
                      {org.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-[#475569] font-medium mt-1">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      <span>{org.headquarters}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  {org.activeJobsCount > 0 ? (
                    <Link
                      href={`/jobs?q=${encodeURIComponent(org.shortName)}`}
                      className="font-extrabold text-[#EA580C] hover:underline"
                    >
                      {org.activeJobsCount} Active {org.activeJobsCount === 1 ? "Notice" : "Notices"} ↗
                    </Link>
                  ) : (
                    <span className="font-semibold text-slate-400">
                      0 Active Notices
                    </span>
                  )}

                  <a
                    href={org.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-slate-600 hover:text-slate-900"
                  >
                    <span>Portal</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </CardHover>
          ))}
        </div>
      </PageReveal>
    </div>
  );
}
