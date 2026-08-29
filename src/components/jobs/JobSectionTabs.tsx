"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";

interface JobSectionTabsProps {
  activeSection?: string;
}

export const JobSectionTabs: React.FC<JobSectionTabsProps> = ({
  activeSection: initialActive = "overview",
}) => {
  const [activeSection, setActiveSection] = useState(initialActive);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "important-dates", label: "Important Dates" },
    { id: "vacancies", label: "Vacancies" },
    { id: "eligibility", label: "Eligibility & Age" },
    { id: "application-fee", label: "Application Fee" },
    { id: "selection-process", label: "Selection Process" },
    { id: "how-to-apply", label: "How to Apply" },
    { id: "official-notification", label: "Notification PDF" },
  ];

  const handleTabClick = (sectionId: string) => {
    setActiveSection(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      const yOffset = -80; // Offset for sticky navbar
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div className="sticky top-16 z-20 bg-white/95 backdrop-blur-md border border-[#E2E8F0] rounded-2xl p-1.5 shadow-xs overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1 min-w-max">
        {tabs.map((tab) => {
          const isActive = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap",
                isActive
                  ? "bg-[#EA580C] text-white shadow-xs"
                  : "text-[#475569] hover:bg-slate-100 hover:text-[#0F172A]"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
