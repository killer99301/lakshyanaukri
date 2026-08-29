"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Building2,
  Landmark,
  Factory,
  CreditCard,
  BookOpen,
  Shield,
  Cpu,
  Grid,
  ArrowRight,
  GraduationCap,
  Award,
  Briefcase,
  UserCheck,
  Wrench,
  Stethoscope,
  Calculator,
} from "lucide-react";
import { SectionHeading } from "../ui/SectionHeading";
import {
  EXPLORE_CATEGORIES,
  EXPLORE_STATES,
  EXPLORE_QUALIFICATIONS,
  EXPLORE_ROLES,
} from "@/data/homepage";
import { cn } from "@/lib/utils";

type TabType = "categories" | "states" | "qualifications" | "roles";

export const InteractiveDiscovery: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("categories");

  // Semantic Lucide icon renderer for categories
  const renderCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case "Building2":
        return <Building2 className="h-5 w-5 text-[#EA580C]" />;
      case "Landmark":
        return <Landmark className="h-5 w-5 text-[#EA580C]" />;
      case "Factory":
        return <Factory className="h-5 w-5 text-[#EA580C]" />;
      case "CreditCard":
        return <CreditCard className="h-5 w-5 text-[#EA580C]" />;
      case "BookOpen":
        return <BookOpen className="h-5 w-5 text-[#EA580C]" />;
      case "Shield":
        return <Shield className="h-5 w-5 text-[#EA580C]" />;
      case "Cpu":
        return <Cpu className="h-5 w-5 text-[#EA580C]" />;
      case "Grid":
        return <Grid className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <Grid className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  // Semantic icon for qualifications
  const renderQualificationIcon = (slug: string) => {
    switch (slug) {
      case "10th-pass":
      case "12th-pass":
        return <BookOpen className="h-5 w-5 text-[#EA580C]" />;
      case "iti":
      case "diploma":
        return <Wrench className="h-5 w-5 text-[#EA580C]" />;
      case "graduate":
      case "post-graduate":
        return <GraduationCap className="h-5 w-5 text-[#EA580C]" />;
      case "be-btech":
        return <Cpu className="h-5 w-5 text-[#EA580C]" />;
      case "mba":
      case "mca":
        return <Briefcase className="h-5 w-5 text-[#EA580C]" />;
      case "bed":
        return <Award className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <GraduationCap className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  // Semantic icon for job roles
  const renderRoleIcon = (slug: string) => {
    switch (slug) {
      case "teacher":
      case "professor":
        return <BookOpen className="h-5 w-5 text-[#EA580C]" />;
      case "engineer":
        return <Cpu className="h-5 w-5 text-[#EA580C]" />;
      case "clerk":
      case "accountant":
      case "stenographer":
        return <Calculator className="h-5 w-5 text-[#EA580C]" />;
      case "police":
        return <Shield className="h-5 w-5 text-[#EA580C]" />;
      case "nurse":
      case "doctor":
        return <Stethoscope className="h-5 w-5 text-[#EA580C]" />;
      case "apprentice":
        return <UserCheck className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <Briefcase className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  return (
    <div className="bg-white border-y border-[#E2E8F0] py-8 sm:py-10 shadow-2xs">
      <SectionHeading
        title="Explore Opportunities"
        subtitle="Find your path in seconds"
        align="center"
      />

      {/* Segmented Control Tabs */}
      <div className="flex items-center justify-center mt-5 mb-6 px-4">
        <div className="bg-[#F7F6F3] p-1.5 rounded-2xl border border-[#E2E8F0] inline-flex items-center gap-1 max-w-full overflow-x-auto scrollbar-none shadow-2xs">
          <button
            onClick={() => setActiveTab("categories")}
            className={cn(
              "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
              activeTab === "categories"
                ? "bg-white text-[#EA580C] shadow-xs border border-[#FED7AA] shimmer-hover"
                : "text-[#475569] hover:text-[#0F172A]"
            )}
          >
            Categories
          </button>
          <button
            onClick={() => setActiveTab("states")}
            className={cn(
              "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
              activeTab === "states"
                ? "bg-white text-[#EA580C] shadow-xs border border-[#FED7AA] shimmer-hover"
                : "text-[#475569] hover:text-[#0F172A]"
            )}
          >
            States
          </button>
          <button
            onClick={() => setActiveTab("qualifications")}
            className={cn(
              "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
              activeTab === "qualifications"
                ? "bg-white text-[#EA580C] shadow-xs border border-[#FED7AA] shimmer-hover"
                : "text-[#475569] hover:text-[#0F172A]"
            )}
          >
            Qualifications
          </button>
          <button
            onClick={() => setActiveTab("roles")}
            className={cn(
              "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
              activeTab === "roles"
                ? "bg-white text-[#EA580C] shadow-xs border border-[#FED7AA] shimmer-hover"
                : "text-[#475569] hover:text-[#0F172A]"
            )}
          >
            Job Roles
          </button>
        </div>
      </div>

      {/* Signature Circular Discovery UI Grid */}
      <div className="max-w-6xl mx-auto px-4">
        {activeTab === "categories" && (
          <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-8 gap-3 sm:gap-4">
            {EXPLORE_CATEGORIES.map((cat) => (
              <Link key={cat.id} href={cat.href} className="group flex flex-col items-center text-center space-y-1.5">
                <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-[#FFF7ED]/70 border border-[#FED7AA]/60 flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:border-[#EA580C] group-hover:ring-4 group-hover:ring-[#EA580C]/20 group-hover:bg-[#FFF7ED] group-hover:shadow-md">
                  <div className="transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
                    {renderCategoryIcon(cat.iconName)}
                  </div>
                </div>
                <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-all duration-200 group-hover:-translate-y-0.5 truncate max-w-[85px] sm:max-w-[100px]">
                  {cat.label}
                </span>
              </Link>
            ))}
          </div>
        )}

        {activeTab === "states" && (
          <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-8 gap-3 sm:gap-4">
            {EXPLORE_STATES.map((st) => (
              <Link key={st.id} href={st.href} className="group flex flex-col items-center text-center space-y-1.5">
                <div
                  className={cn(
                    "h-12 w-12 sm:h-14 sm:w-14 rounded-full border flex items-center justify-center font-black text-xs sm:text-sm transition-all duration-300 group-hover:scale-110 group-hover:shadow-md",
                    st.isAction
                      ? "bg-[#FFF7ED] border-[#FED7AA] text-[#EA580C] group-hover:bg-[#EA580C] group-hover:text-white"
                      : "bg-[#FFF7ED]/70 border-[#FED7AA]/60 text-[#0F172A] group-hover:border-[#EA580C] group-hover:ring-4 group-hover:ring-[#EA580C]/20 group-hover:bg-[#FFF7ED]"
                  )}
                >
                  {st.isAction ? (
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                  ) : (
                    <span>{st.label.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-all duration-200 group-hover:-translate-y-0.5 truncate max-w-[85px] sm:max-w-[100px]">
                  {st.label}
                </span>
              </Link>
            ))}
          </div>
        )}

        {activeTab === "qualifications" && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-3 sm:gap-4">
            {EXPLORE_QUALIFICATIONS.map((q) => (
              <Link key={q.id} href={q.href} className="group flex flex-col items-center text-center space-y-1.5">
                <div
                  className={cn(
                    "h-12 w-12 sm:h-14 sm:w-14 rounded-full border flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:shadow-md",
                    q.slug === "qualifications"
                      ? "bg-[#FFF7ED] border-[#FED7AA] text-[#EA580C] group-hover:bg-[#EA580C] group-hover:text-white"
                      : "bg-[#FFF7ED]/70 border-[#FED7AA]/60 text-[#0F172A] group-hover:border-[#EA580C] group-hover:ring-4 group-hover:ring-[#EA580C]/20 group-hover:bg-[#FFF7ED]"
                  )}
                >
                  {q.slug === "qualifications" ? (
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                  ) : (
                    <div className="transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
                      {renderQualificationIcon(q.slug)}
                    </div>
                  )}
                </div>
                <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-all duration-200 group-hover:-translate-y-0.5 truncate max-w-[85px] sm:max-w-[95px]">
                  {q.label}
                </span>
              </Link>
            ))}
          </div>
        )}

        {activeTab === "roles" && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11 gap-3 sm:gap-4">
            {EXPLORE_ROLES.map((r) => (
              <Link key={r.id} href={r.href} className="group flex flex-col items-center text-center space-y-1.5">
                <div
                  className={cn(
                    "h-12 w-12 sm:h-14 sm:w-14 rounded-full border flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:shadow-md",
                    r.slug === "roles"
                      ? "bg-[#FFF7ED] border-[#FED7AA] text-[#EA580C] group-hover:bg-[#EA580C] group-hover:text-white"
                      : "bg-[#FFF7ED]/70 border-[#FED7AA]/60 text-[#0F172A] group-hover:border-[#EA580C] group-hover:ring-4 group-hover:ring-[#EA580C]/20 group-hover:bg-[#FFF7ED]"
                  )}
                >
                  {r.slug === "roles" ? (
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                  ) : (
                    <div className="transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
                      {renderRoleIcon(r.slug)}
                    </div>
                  )}
                </div>
                <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-all duration-200 group-hover:-translate-y-0.5 truncate max-w-[85px] sm:max-w-[95px]">
                  {r.label}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
