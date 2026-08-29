"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface StaggerContainerProps {
  children: React.ReactNode;
  className?: string;
}

export const StaggerContainer: React.FC<StaggerContainerProps> = ({
  children,
  className,
}) => {
  return (
    <div className={cn("space-y-4", className)}>
      {React.Children.map(children, (child, idx) => {
        if (!React.isValidElement(child)) return child;
        return (
          <div
            style={{ animationDelay: `${idx * 60}ms` }}
            className="transition-all duration-300 motion-reduce:transition-none"
          >
            {child}
          </div>
        );
      })}
    </div>
  );
};
