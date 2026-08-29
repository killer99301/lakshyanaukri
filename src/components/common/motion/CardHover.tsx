"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardHoverProps {
  children: React.ReactNode;
  className?: string;
}

export const CardHover: React.FC<CardHoverProps> = ({ children, className }) => {
  return (
    <div
      className={cn(
        "transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-[#FED7AA]/80 motion-reduce:transform-none motion-reduce:transition-none",
        className
      )}
    >
      {children}
    </div>
  );
};
