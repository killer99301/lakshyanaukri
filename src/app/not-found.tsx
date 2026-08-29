import React from "react";
import Link from "next/link";
import { Search, Compass, ArrowRight, Home } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const metadata = {
  title: "404 - Page Not Found | LakshyaNaukri",
  description: "The page you are looking for does not exist or has been moved.",
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6 bg-white border border-[#E2E8F0] p-8 sm:p-10 rounded-3xl shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#EA580C] via-[#F95738] to-[#FED7AA]" />

        <div className="h-16 w-16 mx-auto rounded-2xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C] shadow-2xs">
          <Compass className="h-8 w-8 animate-spin-slow" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-black uppercase tracking-widest text-[#EA580C]">
            Error 404
          </span>
          <h1 className="text-2xl font-black text-[#0F172A] tracking-tight">
            Page Not Found
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
            The page or recruitment record you requested could not be found. It may have been archived or the URL might be incorrect.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full justify-center gap-1.5 text-xs font-bold">
              <Home className="h-4 w-4" />
              <span>Back to Home</span>
            </Button>
          </Link>
          <Link href="/jobs" className="w-full sm:w-auto">
            <Button variant="primary" className="w-full justify-center gap-1.5 text-xs font-bold">
              <Search className="h-4 w-4" />
              <span>Browse All Jobs</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        <div className="pt-4 border-t border-slate-100 text-xs text-slate-400">
          LakshyaNaukri • Verified Government Jobs & Exams
        </div>
      </div>
    </div>
  );
}
