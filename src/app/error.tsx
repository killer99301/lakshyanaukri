"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error for diagnostics
    console.error("Application Error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6 bg-white border border-[#E2E8F0] p-8 sm:p-10 rounded-3xl shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 via-amber-500 to-[#EA580C]" />

        <div className="h-16 w-16 mx-auto rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shadow-2xs">
          <AlertTriangle className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-black uppercase tracking-widest text-rose-600">
            System Notice
          </span>
          <h1 className="text-2xl font-black text-[#0F172A] tracking-tight">
            Something Went Wrong
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
            We encountered an unexpected issue while rendering this page. You can try reloading or return to the main dashboard.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            onClick={() => reset()}
            variant="primary"
            className="w-full sm:w-auto justify-center gap-1.5 text-xs font-bold"
          >
            <RefreshCcw className="h-4 w-4" />
            <span>Try Again</span>
          </Button>

          <Link href="/" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full justify-center gap-1.5 text-xs font-bold">
              <Home className="h-4 w-4" />
              <span>Back to Home</span>
            </Button>
          </Link>
        </div>

        <div className="pt-4 border-t border-slate-100 text-xs text-slate-400">
          LakshyaNaukri Support • shivorahq@gmail.com
        </div>
      </div>
    </div>
  );
}
