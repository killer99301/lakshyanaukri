"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface AmbientBackgroundProps {
  className?: string;
}

export const AmbientBackground: React.FC<AmbientBackgroundProps> = ({ className }) => {
  return (
    <div className={cn("fixed inset-0 z-0 pointer-events-none overflow-hidden", className)}>
      {/* Top right subtle orange light blob */}
      <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-orange-400/8 via-amber-300/5 to-transparent blur-3xl animate-pulse duration-[12000ms] motion-reduce:animate-none" />

      {/* Bottom left subtle blue atmospheric blob */}
      <div className="absolute top-1/2 -left-40 w-[600px] h-[600px] rounded-full bg-gradient-to-tr from-blue-500/5 via-sky-300/5 to-transparent blur-3xl animate-pulse duration-[16000ms] motion-reduce:animate-none" />

      {/* Center ambient glow */}
      <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] rounded-full bg-gradient-to-tl from-indigo-500/4 via-purple-300/4 to-transparent blur-3xl" />
    </div>
  );
};
