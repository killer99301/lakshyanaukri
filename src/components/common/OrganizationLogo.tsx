"use client";

import React from "react";
import { Building2 } from "lucide-react";
import { getOrgIdentity } from "@/lib/orgRegistry";
import { cn } from "@/lib/utils";

interface OrganizationLogoProps {
  organizationName: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export const OrganizationLogo: React.FC<OrganizationLogoProps> = ({
  organizationName,
  className,
  size = "md",
}) => {
  const org = getOrgIdentity(organizationName);

  const sizeClasses = {
    sm: "h-8 w-8 text-[10px] rounded-lg",
    md: "h-11 w-11 text-xs sm:text-xs font-black rounded-xl sm:rounded-2xl tracking-tighter",
    lg: "h-14 w-14 text-sm font-black rounded-2xl tracking-tight",
    xl: "h-16 w-16 sm:h-20 sm:w-20 text-base sm:text-lg font-black rounded-2xl sm:rounded-3xl tracking-tight",
  };

  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center font-black transition-transform duration-300 group-hover:scale-105 overflow-hidden shadow-2xs border select-none",
        sizeClasses[size],
        org.bgLight,
        className
      )}
      title={org.name}
    >
      {org.officialLogoSvg ? (
        <div className="w-full h-full p-1.5 flex items-center justify-center">
          {org.officialLogoSvg}
        </div>
      ) : org.shortName ? (
        <span className={cn("font-black uppercase tracking-tighter", org.textColor)}>
          {org.shortName}
        </span>
      ) : (
        <Building2 className={cn("h-1/2 w-1/2", org.textColor)} />
      )}
    </div>
  );
};
