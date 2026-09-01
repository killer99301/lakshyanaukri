"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, Bell, ArrowRight } from "lucide-react";
import { Card } from "../ui/Card";
import { cn } from "@/lib/utils";

interface JobsRightSidebarProps {
  onQuickCategoryClick?: (cat: string) => void;
  className?: string;
}

export const JobsRightSidebar: React.FC<JobsRightSidebarProps> = ({
  onQuickCategoryClick,
  className,
}) => {
  const quickLinks = [
    { label: "Latest Jobs", href: "/jobs" },
    { label: "Jobs by Category", category: "state-psc" },
    { label: "Jobs by State", category: "Bihar" },
    { label: "Jobs by Qualification", category: "Graduate" },
    { label: "Jobs by Recruiting Board", href: "/companies" },
  ];

  const topOrganizations = [
    { name: "BPSC", fullName: "Bihar Public Service Commission", href: "/jobs?q=BPSC" },
    { name: "SSC", fullName: "Staff Selection Commission", href: "/jobs?q=SSC" },
    { name: "RRB", fullName: "Railway Recruitment Boards", href: "/jobs?q=RRB" },
    { name: "IBPS", fullName: "Institute of Banking Personnel Selection", href: "/jobs?q=IBPS" },
    { name: "SBI", fullName: "State Bank of India", href: "/jobs?q=SBI" },
  ];

  return (
    <div className={cn("space-y-4", className)}>
      {/* 1. QUICK LINKS POD */}
      <Card className="p-4 bg-white border-[#E2E8F0] rounded-2xl shadow-2xs space-y-3">
        <h4 className="text-xs font-black text-[#0F172A] uppercase tracking-wider">
          Quick Links
        </h4>

        <div className="space-y-1">
          {quickLinks.map((item, idx) => (
            <React.Fragment key={idx}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex items-center justify-between p-2 rounded-xl text-xs font-bold text-[#0F172A] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-all group"
                >
                  <span>{item.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#EA580C] group-hover:translate-x-0.5 transition-all" />
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onQuickCategoryClick?.(item.category || "")}
                  className="flex items-center justify-between w-full p-2 rounded-xl text-xs font-bold text-[#0F172A] hover:bg-[#FFF7ED] hover:text-[#EA580C] transition-all group cursor-pointer text-left"
                >
                  <span>{item.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#EA580C] group-hover:translate-x-0.5 transition-all" />
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
      </Card>

      {/* 2. JOB ALERTS POD */}
      <Card className="p-4 sm:p-5 bg-gradient-to-br from-white to-[#FFF7ED]/50 border border-[#FED7AA] rounded-2xl shadow-2xs space-y-3 relative overflow-hidden">
        <div className="text-center space-y-1.5">
          <div className="h-10 w-10 mx-auto rounded-full bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C]">
            <Bell className="h-4.5 w-4.5" />
          </div>
          <h4 className="text-xs font-black text-[#0F172A] tracking-tight">
            Never Miss an Opportunity!
          </h4>
          <p className="text-[11px] text-[#475569]">
            Get job alerts on WhatsApp & Email
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 text-slate-500 p-2.5 rounded-xl text-center text-xs font-semibold">
          Job alerts coming soon
        </div>
      </Card>

      {/* 3. TOP HIRING ORGANIZATIONS POD */}
      <Card className="p-4 bg-white border-[#E2E8F0] rounded-2xl shadow-2xs space-y-3">
        <h4 className="text-xs font-black text-[#0F172A] uppercase tracking-wider">
          Top Hiring Organizations
        </h4>

        <div className="space-y-2">
          {topOrganizations.map((org) => (
            <Link
              key={org.name}
              href={org.href}
              className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[#FFF7ED] border border-transparent hover:border-[#FED7AA] transition-all group"
            >
              <div className="h-7 w-7 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center shrink-0 font-extrabold text-[10px] text-[#EA580C]">
                {org.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors block truncate">
                  {org.name}
                </span>
                <span className="text-[10px] font-medium text-slate-400 block truncate">
                  {org.fullName}
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-100">
          <Link
            href="/companies"
            className="inline-flex items-center gap-1 text-xs font-bold text-[#EA580C] hover:underline"
          >
            <span>View All Companies</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </Card>
    </div>
  );
};
