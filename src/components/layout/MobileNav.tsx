"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV_ITEMS } from "@/lib/constants";
import { Button } from "../ui/Button";

export const MobileNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const pathname = usePathname();

  const toggleOpen = () => setIsOpen((prev) => !prev);

  return (
    <div className="md:hidden">
      <button
        onClick={toggleOpen}
        aria-label="Toggle mobile menu"
        className="p-2 text-[#0F172A] hover:text-[#EA580C] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {isOpen && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-50 bg-white border-b border-[#E2E8F0] overflow-y-auto shadow-2xl">
          <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
            <div className="space-y-1">
              {MAIN_NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                const hasSubitems = item.items && item.items.length > 0;
                const isExpanded = expandedItem === item.title;

                return (
                  <div key={item.title} className="border-b border-slate-100 last:border-none pb-1">
                    {hasSubitems ? (
                      <div>
                        <button
                          onClick={() => setExpandedItem(isExpanded ? null : item.title)}
                          className={cn(
                            "flex items-center justify-between w-full py-3 px-3 text-base font-semibold rounded-lg transition-colors",
                            isActive ? "text-[#EA580C] bg-[#FFF7ED]" : "text-[#0F172A]"
                          )}
                        >
                          <span>{item.title}</span>
                          <ChevronDown
                            className={cn(
                              "h-5 w-5 text-slate-400 transition-transform",
                              isExpanded && "rotate-180 text-[#EA580C]"
                            )}
                          />
                        </button>
                        {isExpanded && (
                          <div className="pl-4 pr-2 py-1 space-y-1 bg-slate-50 rounded-lg mb-2">
                            {item.items?.map((subitem) => (
                              <Link
                                key={subitem.title}
                                href={subitem.href}
                                onClick={() => setIsOpen(false)}
                                className="block py-2 px-3 text-sm font-medium text-[#475569] hover:text-[#EA580C]"
                              >
                                {subitem.title}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                          "block py-3 px-3 text-base font-semibold rounded-lg transition-colors",
                          isActive ? "text-[#EA580C] bg-[#FFF7ED]" : "text-[#0F172A]"
                        )}
                      >
                        {item.title}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-[#E2E8F0] space-y-2">
              <Link href="/jobs" onClick={() => setIsOpen(false)} className="block w-full">
                <Button variant="primary" className="w-full justify-center text-xs font-bold py-2.5">
                  Browse All Jobs & Recruitments
                </Button>
              </Link>
              <a
                href="https://t.me/careercampus"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsOpen(false)}
                className="block w-full"
              >
                <Button variant="outline" className="w-full justify-center text-xs font-bold py-2.5 border-slate-300">
                  Join Official Telegram Channel ↗
                </Button>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
