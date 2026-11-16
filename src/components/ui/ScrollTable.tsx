"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ScrollTableProps {
  /** What the table is, read out when the region is focused (e.g. "Post-wise vacancies"). */
  label: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wrapper for a table that may be wider than the screen (usually on phones). While the table actually overflows,
 * the wrapper is a named region that can be reached with Tab and scrolled sideways with the arrow keys, with a
 * visible focus ring. A table that fits adds no Tab stop and no extra region. The server and the first client render
 * are identical (no tabIndex), so there is no hydration mismatch; overflow is measured after mounting and again
 * whenever the wrapper or the table changes size (window resize, a <details> opening, fonts loading).
 */
export function ScrollTable({ label, className, children }: ScrollTableProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1 px tolerance for sub-pixel rounding
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", check);
      return () => window.removeEventListener("resize", check);
    }
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      data-scroll-table={scrolls ? "scrolls" : "fits"}
      className={cn(
        "overflow-x-auto",
        className,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A] focus-visible:ring-offset-2"
      )}
    >
      {children}
    </div>
  );
}
