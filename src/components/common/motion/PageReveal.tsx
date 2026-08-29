"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface PageRevealProps {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}

export const PageReveal: React.FC<PageRevealProps> = ({
  children,
  className,
  delayMs = 0,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    <div
      className={cn(
        "transition-all duration-700 ease-out transform motion-reduce:transition-none motion-reduce:transform-none",
        isVisible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-3 pointer-events-none",
        className
      )}
    >
      {children}
    </div>
  );
};
