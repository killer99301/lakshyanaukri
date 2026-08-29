import React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "orange" | "coral" | "peach" | "neutral" | "outline" | "urgent";
  size?: "sm" | "md";
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = "orange",
  size = "md",
  children,
  ...props
}) => {
  const baseStyles = "inline-flex items-center font-medium rounded-md border transition-colors";

  const variants = {
    orange: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]",
    coral: "bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]",
    peach: "bg-[#FFF7ED] text-[#9A3412] border-[#FDBA74]",
    neutral: "bg-[#F8FAFC] text-[#475569] border-[#E2E8F0]",
    outline: "bg-white text-[#0F172A] border-[#E2E8F0]",
    urgent: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA] font-semibold animate-pulse",
  };

  const sizes = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-xs font-semibold",
  };

  return (
    <span
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </span>
  );
};
