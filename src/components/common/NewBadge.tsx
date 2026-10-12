import React from "react";
import { cn } from "@/lib/utils";

/**
 * The red "NEW" marker shown beside something that changed in the last few
 * days. The dot pulses to draw the eye; it stays still for visitors who have
 * asked their device to reduce motion.
 */
export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-black uppercase tracking-wider leading-none shrink-0",
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-80 animate-ping motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
      </span>
      New
    </span>
  );
}
