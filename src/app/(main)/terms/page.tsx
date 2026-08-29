import React from "react";
import { FileText, CheckCircle2, AlertCircle, HelpCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";

export const metadata = {
  title: "Terms of Service | LakshyaNaukri",
  description:
    "Terms of Service for LakshyaNaukri. Guidelines and disclaimer regarding recruitment notices, examination guidance, and portal usage.",
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-10 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-4xl space-y-8">
        {/* Header Breadcrumb */}
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#EA580C] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Home</span>
          </Link>
        </div>

        {/* Hero Card */}
        <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-10 shadow-xs space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-black uppercase tracking-wider">
            <FileText className="h-3.5 w-3.5" /> Platform Terms
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-[#0F172A] tracking-tight">
            Terms of Service
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] font-medium leading-relaxed">
            Effective Date: August 2026 • Last updated: August 21, 2026
          </p>
        </div>

        {/* Terms Body */}
        <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-10 shadow-xs space-y-8 text-sm text-[#334155] leading-relaxed">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <CheckCircle2 className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>1. Informational Service Nature</h2>
            </div>
            <p>
              LakshyaNaukri is an independent career information and exam intelligence aggregator. We provide factual updates, corrigenda tracking, and links directly to official government recruiting commissions (such as BPSC, SSC, RRB, UPSC, IBPS, and State PSCs).
            </p>
            <p>
              LakshyaNaukri is not an official government entity and does not represent recruiting authorities directly.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <AlertCircle className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>2. Candidate Verification Responsibility</h2>
            </div>
            <p>
              While our editorial engine and autonomous checkers strive for 100% accuracy and strict provenance against primary government gazettes, candidates must always verify application guidelines, fee rules, eligibility cutoffs, and exam dates on the official recruiting portal prior to final submission.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <FileText className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>3. Intellectual Property & Official Notices</h2>
            </div>
            <p>
              Recruitment notifications, gazettes, and corrigenda published by government agencies remain the public property of their respective issuing bodies. LakshyaNaukri provides structured summaries, timelines, and direct links to facilitate candidate discovery.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <HelpCircle className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>4. Contact & Discrepancy Reporting</h2>
            </div>
            <p>
              If you notice an error in any published recruitment detail or corrigendum date, please notify our editorial desk immediately at: <a href="mailto:shivorahq@gmail.com" className="text-[#EA580C] font-bold hover:underline">shivorahq@gmail.com</a>. We review and correct verified discrepancies promptly.
            </p>
          </section>
        </div>
      </PageReveal>
    </div>
  );
}
