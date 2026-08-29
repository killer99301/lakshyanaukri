import React from "react";
import { KeyRound, ShieldCheck, ArrowRight, ExternalLink, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";
import { CardHover } from "@/components/common/motion/CardHover";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { HOMEPAGE_ANSWER_KEYS } from "@/data/homepage";
import { resolveDocumentAccess } from "@/lib/documents";

export const metadata = {
  title: "Answer Keys & Response Sheets 2026 | LakshyaNaukri",
  description:
    "Download official exam answer keys and candidate response sheets for competitive exams. Sourced directly from official exam authority portals.",
};

const OFFICIAL_ANSWER_KEY_PORTALS = [
  {
    name: "Staff Selection Commission (SSC)",
    url: "https://ssc.gov.in",
    keyPath: "Tentative Answer Keys & Objection Management System",
    tag: "Central Govt",
  },
  {
    name: "Bihar Public Service Commission (BPSC)",
    url: "https://bpsc.bih.nic.in",
    keyPath: "Provisional & Final Master Question Key Gazettes",
    tag: "State PSC",
  },
  {
    name: "Railway Recruitment Boards (RRB)",
    url: "https://indianrailways.gov.in",
    keyPath: "CBT Question Paper, Responses & Keys Review",
    tag: "Railways",
  },
  {
    name: "Union Public Service Commission (UPSC)",
    url: "https://upsc.gov.in",
    keyPath: "Official Prelims Question Keys (All Series A/B/C/D)",
    tag: "National",
  },
  {
    name: "Institute of Banking Personnel Selection (IBPS)",
    url: "https://www.ibps.in",
    keyPath: "Candidate Responses & Examination Information Handouts",
    tag: "Banking",
  },
  {
    name: "National Testing Agency (NTA)",
    url: "https://nta.ac.in",
    keyPath: "Recorded Responses & Challenge Portal",
    tag: "Academic",
  },
];

export default function AnswerKeysPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-7xl space-y-8">
        {/* Header Hero */}
        <div className="bg-gradient-to-r from-purple-950 via-slate-900 to-slate-900 rounded-3xl p-6 sm:p-10 text-white shadow-xl relative overflow-hidden">
          <div className="max-w-2xl space-y-4 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-black uppercase tracking-wider">
              <KeyRound className="h-3.5 w-3.5" /> Provisional & Final Keys
            </div>

            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
              Answer Keys & Response Sheets Portal
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
              Download provisional answer keys, check official master question papers, view your response sheets, and raise online objection challenges before deadlines.
            </p>
          </div>
        </div>

        {/* Verification Status Banner */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-[#0F172A]">
                  Verified Answer Key Pipeline
                </h3>
                <p className="text-xs text-[#475569]">
                  Answer keys and response challenge links are published only from official authority releases.
                </p>
              </div>
            </div>

            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F172A] text-white font-bold text-xs hover:bg-slate-800 transition-colors shrink-0 shadow-2xs"
            >
              <span>Explore Opportunities</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Latest Verified Answer Keys */}
        {HOMEPAGE_ANSWER_KEYS && HOMEPAGE_ANSWER_KEYS.length > 0 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-black text-[#0F172A] tracking-tight">
                Latest Released Answer Keys & Objection Windows
              </h2>
              <p className="text-xs text-[#475569]">
                Direct links to master question papers, response sheets, and objection submission portals:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {HOMEPAGE_ANSWER_KEYS.map((keyItem) => {
                const docAccess = resolveDocumentAccess({
                  officialPortalUrl: keyItem.officialUrl,
                  organization: keyItem.organization,
                  publishedDate: keyItem.releaseDateIso,
                  documentTitle: keyItem.title,
                  customPortalLabel: "Official Answer Key Portal",
                });

                return (
                  <CardHover key={keyItem.id}>
                    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <OrganizationLogo organizationName={keyItem.organization} size="md" />
                          <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300 text-[10px] font-black uppercase">
                            {keyItem.statusText}
                          </span>
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-purple-700">
                              Released: {keyItem.releaseDateIso} {keyItem.objectionDeadlineIso ? `• Objection Till: ${keyItem.objectionDeadlineIso}` : ""}
                            </span>
                            <span className={`text-[9px] font-black px-1.5 py-0.2 rounded border ${docAccess.badgeClass}`}>
                              {docAccess.badgeLabel}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-[#0F172A] leading-snug">
                            {keyItem.title}
                          </h3>
                          <p className="text-xs text-[#475569] font-medium mt-1">
                            {keyItem.organization}
                          </p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs gap-2 flex-wrap">
                        <div className="flex items-center gap-1 text-[11px] text-purple-700 font-semibold">
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
                            <span>Check Answer Key</span>
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

        {/* Official Board Answer Key Portals Directory */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-[#0F172A] tracking-tight">
              Official Examination Board Answer Key Portals
            </h2>
            <p className="text-xs text-[#475569]">
              Access direct question paper keys and objection challenge windows directly from issuing boards:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {OFFICIAL_ANSWER_KEY_PORTALS.map((portal) => (
              <CardHover key={portal.name}>
                <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <OrganizationLogo organizationName={portal.name} size="md" />
                      <span className="px-2.5 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-800 text-[10px] font-black uppercase">
                        {portal.tag}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-[#0F172A] leading-snug">
                        {portal.name}
                      </h4>
                      <p className="text-xs text-[#475569] font-medium mt-1">
                        {portal.keyPath}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-[11px] text-purple-700 font-semibold">
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
