"use client";

import React from "react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils";

export interface RevealSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  delayMs?: number;
}

export const RevealSection: React.FC<RevealSectionProps> = ({
  children,
  className,
  delayMs = 0,
  ...props
}) => {
  const { ref, isInView } = useInView({ threshold: 0.1 });

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delayMs}ms` }}
      className={cn("reveal-item", isInView && "is-visible", className)}
      {...props}
    >
      {children}
    </div>
  );
};
