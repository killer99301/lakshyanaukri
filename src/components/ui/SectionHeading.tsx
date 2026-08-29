import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./Badge";

export interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  badge?: string;
  actionHref?: string;
  actionText?: string;
  align?: "left" | "center";
  className?: string;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({
  title,
  subtitle,
  badge,
  actionHref,
  actionText,
  align = "left",
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 sm:mb-8",
        align === "center" && "md:flex-col md:items-center text-center",
        className
      )}
    >
      <div className={cn("space-y-1.5", align === "center" && "text-center")}>
        {badge && (
          <Badge variant="orange" className="mb-2">
            {badge}
          </Badge>
        )}
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A]">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm sm:text-base text-[#475569] max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>

      {actionHref && actionText && (
        <Link
          href={actionHref}
          className="inline-flex items-center text-sm font-semibold text-[#EA580C] hover:text-[#c2410c] hover:underline gap-1 transition-colors shrink-0"
        >
          <span>{actionText}</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
};
