import React from "react";
import { Download, ShieldCheck, ArrowRight, ExternalLink, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";
import { CardHover } from "@/components/common/motion/CardHover";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { HOMEPAGE_ADMIT_CARDS } from "@/data/homepage";
import { resolveDocumentAccess } from "@/lib/documents";

export const metadata = {
  title: "Admit Cards & Hall Tickets 2026 | LakshyaNaukri",
  description:
    "Download official admit cards, hall tickets, and call letters for UPSC, SSC, Banking, Railway, and State PSC examinations. Sourced directly from official exam authority portals.",
};

const OFFICIAL_ADMIT_CARD_PORTALS = [
  {
    name: "Staff Selection Commission (SSC)",
    url: "https://ssc.gov.in",
    cardPath: "Regional Admission Certificates & City Intimations",
    tag: "Central Govt",
  },
  {
    name: "Bihar Public Service Commission (BPSC)",
    url: "https://bpsc.bih.nic.in",
    cardPath: "CCE & Departmental E-Admit Cards",
    tag: "State PSC",
  },
  {
    name: "Union Public Service Commission (UPSC)",
    url: "https://upsc.gov.in",
    cardPath: "E-Admit Card Portal (e-Summon Letters)",
    tag: "National",
  },
  {
    name: "Institute of Banking Personnel Selection (IBPS)",
    url: "https://www.ibps.in",
    cardPath: "Online Exam Call Letters (PO/Clerk/SO)",
    tag: "Banking",
  },
  {
    name: "Railway Recruitment Boards (RRB)",
    url: "https://indianrailways.gov.in",
    cardPath: "CEN E-Call Letter & Travel Authority",
    tag: "Railways",
  },
  {
    name: "National Testing Agency (NTA)",
    url: "https://nta.ac.in",
    cardPath: "UGC NET, CSIR, CUET Advance City & Admit Slips",
    tag: "Academic",
  },
];

export default function AdmitCardsPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-7xl space-y-8">
        {/* Header Hero */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden">
          <div className="max-w-2xl space-y-4 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs font-black uppercase tracking-wider">
              <Download className="h-3.5 w-3.5" /> Official Direct Downloads
            </div>

            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Admit Cards & Hall Tickets Portal
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
              Instant access to direct official download links for call letters, exam hall tickets, and city intimation slips across all competitive exams in India.
            </p>
          </div>
        </div>

        {/* Verification Status Banner */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A]">
                  Direct Official Sourcing Guarantee
                </h3>
                <p className="text-xs text-[#475569]">
                  We do not guess admit card links. All candidate login pages are sourced from official commission servers.
                </p>
              </div>
            </div>

            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] text-white font-bold text-xs hover:bg-slate-800 transition-colors shrink-0 shadow-2xs"
            >
              <span>View Exam Schedules</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Released & Active Admit Cards */}
        {HOMEPAGE_ADMIT_CARDS && HOMEPAGE_ADMIT_CARDS.length > 0 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-black text-[#0F172A] tracking-tight">
                Active & Released Hall Tickets / Call Letters
              </h2>
              <p className="text-xs text-[#475569]">
                Direct download portals for live exam admit cards and city intimation slips:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {HOMEPAGE_ADMIT_CARDS.map((card) => {
                const docAccess = resolveDocumentAccess({
                  officialPortalUrl: card.officialUrl,
                  organization: card.organization,
                  publishedDate: card.releaseDateIso,
                  documentTitle: card.title,
                  customPortalLabel: "Official E-Admit Card Portal",
                });

                return (
                  <CardHover key={card.id}>
                    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <OrganizationLogo organizationName={card.organization} size="md" />
                          <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-300 text-[10px] font-black uppercase">
                            {card.statusText}
                          </span>
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">
                              Released: {card.releaseDateIso} • Exam: {card.examDateIso}
                            </span>
                            <span className={`text-[9px] font-black px-1.5 py-0.2 rounded border ${docAccess.badgeClass}`}>
                              {docAccess.badgeLabel}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-[#0F172A] leading-snug">
                            {card.title}
                          </h3>
                          <p className="text-xs text-[#475569] font-medium mt-1">
                            {card.organization}
                          </p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs gap-2 flex-wrap">
                        <div className="flex items-center gap-1 text-[11px] text-blue-700 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Direct Authority Server</span>
                        </div>

                        {docAccess.url && (
                          <a
                            href={docAccess.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-[#EA580C] hover:underline ml-auto"
                            title={docAccess.disclaimer}
                          >
                            <span>Download Hall Ticket</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </CardHover>
                );
              })}
            </div>
          </div>
        )}

        {/* Official Board Admit Card Portals Directory */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-[#0F172A] tracking-tight">
              Official Examination Board Admit Card Portals
            </h2>
            <p className="text-xs text-[#475569]">
              Download your call letters directly from the official servers of issuing recruiting authorities:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {OFFICIAL_ADMIT_CARD_PORTALS.map((portal) => (
              <CardHover key={portal.name}>
                <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <OrganizationLogo organizationName={portal.name} size="md" />
                      <span className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-black uppercase">
                        {portal.tag}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-[#0F172A] leading-snug">
                        {portal.name}
                      </h4>
                      <p className="text-xs text-[#475569] font-medium mt-1">
                        {portal.cardPath}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-[11px] text-blue-700 font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Official Authority</span>
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
