"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV_ITEMS } from "@/lib/constants";

// Shown only from xl (1280 px), where the logo, all links and "Explore Jobs" fit on one line (16 Nov 2026: from md,
// 768 px, the links were squeezed, wrapped onto two lines and the last ones were cut off the screen). Narrower screens
// use the menu (MobileNav). A dropdown opens on hover as before, and also on click or Enter/Space for keyboard users;
// Escape or moving focus out of it closes it.
export const MainNav: React.FC = () => {
  const pathname = usePathname();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  return (
    <nav aria-label="Main" className="hidden xl:flex items-center space-x-2">
      {MAIN_NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/" && pathname?.startsWith(item.href));
        const hasSubitems = item.items && item.items.length > 0;

        if (hasSubitems) {
          return (
            <div
              key={item.title}
              className="relative"
              onMouseEnter={() => setActiveDropdown(item.title)}
              onMouseLeave={() => setActiveDropdown(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && activeDropdown === item.title) { setActiveDropdown(null); buttons.current[item.title]?.focus(); }
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiveDropdown((d) => (d === item.title ? null : d));
              }}
            >
              <button
                type="button"
                ref={(el) => { buttons.current[item.title] = el; }}
                aria-expanded={activeDropdown === item.title}
                aria-controls={`nav-menu-${item.href.replace(/\W+/g, "")}`}
                onClick={() => setActiveDropdown((d) => (d === item.title ? null : item.title))}
                className={cn(
                  "inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap",
                  isActive
                    ? "text-[#EA580C] bg-[#FFF7ED]"
                    : "text-[#0F172A] hover:text-[#EA580C] hover:bg-slate-50"
                )}
              >
                <span>{item.title}</span>
                <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-[#EA580C]" aria-hidden />
              </button>

              {activeDropdown === item.title && (
                <div id={`nav-menu-${item.href.replace(/\W+/g, "")}`} className="absolute top-full left-0 w-64 pt-2 z-50">
                  <div className="bg-white rounded-xl shadow-lg border border-[#E2E8F0] p-2 space-y-1">
                    {item.items?.map((subitem) => (
                      <Link
                        key={subitem.title}
                        href={subitem.href}
                        className="block p-2.5 rounded-lg hover:bg-[#FFF7ED] transition-colors group"
                      >
                        <div className="text-sm font-semibold text-[#0F172A] group-hover:text-[#EA580C]">
                          {subitem.title}
                        </div>
                        {subitem.description && (
                          <div className="text-xs text-[#475569] mt-0.5">
                            {subitem.description}
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        }

        return (
          <Link
            key={item.title}
            href={item.href}
            className={cn(
              "px-3 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap",
              isActive
                ? "text-[#EA580C] bg-[#FFF7ED]"
                : "text-[#0F172A] hover:text-[#EA580C] hover:bg-slate-50"
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
};
