import React from "react";
import { Shield, Lock, Eye, FileCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";

export const metadata = {
  title: "Privacy Policy | LakshyaNaukri",
  description:
    "Privacy Policy for LakshyaNaukri. Learn how we handle candidate information, cookies, notifications, and data protection.",
};

export default function PrivacyPolicyPage() {
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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-black uppercase tracking-wider">
            <Shield className="h-3.5 w-3.5" /> Trust & Compliance
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-[#0F172A] tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] font-medium leading-relaxed">
            Effective Date: August 2026 • Last updated: August 21, 2026
          </p>
        </div>

        {/* Policy Body */}
        <div className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-10 shadow-xs space-y-8 text-sm text-[#334155] leading-relaxed">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <Lock className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>1. Information We Collect</h2>
            </div>
            <p>
              LakshyaNaukri is an open public career intelligence and recruitment notification platform. We do not require users to create mandatory accounts or submit sensitive identity documents to browse job notices, exam dates, or download links.
            </p>
            <p>
              When you voluntarily subscribe to our newsletter or job alert channels, we collect only your email address or contact handle solely for delivering requested recruitment notifications.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <Eye className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>2. How We Use Information</h2>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm">
              <li>To provide real-time updates on active government recruitments, corrigenda, and exam schedules.</li>
              <li>To improve website navigation, search filtering, and mobile performance.</li>
              <li>To prevent fraudulent automated scraping and ensure site availability.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <FileCheck className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>3. Third-Party Links & Official Portals</h2>
            </div>
            <p>
              LakshyaNaukri directs users directly to official government recruitment portals (such as BPSC, SSC, RRB, UPSC, IBPS). We do not host fraudulent third-party application forms or collect examination fees on behalf of recruiting bodies. When navigating to external official portals, their respective privacy policies apply.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-base font-extrabold text-[#0F172A]">
              <Shield className="h-4.5 w-4.5 text-[#EA580C]" />
              <h2>4. Data Protection & Contact</h2>
            </div>
            <p>
              We implement industry-standard encryption and security practices. We never sell, rent, or trade subscriber contact information with unauthorized third-party commercial marketing firms.
            </p>
            <p className="text-xs text-[#64748B]">
              If you have any questions regarding our Privacy Policy or wish to unsubscribe from alerts, contact us at: <a href="mailto:shivorahq@gmail.com" className="text-[#EA580C] font-bold hover:underline">shivorahq@gmail.com</a>.
            </p>
          </section>
        </div>
      </PageReveal>
    </div>
  );
}
